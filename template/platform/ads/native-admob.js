import { createBannerTelemetry } from './banner-telemetry.js';
// AdMob native ads, through the Capacitor community plugin.
//
// The default native ad stack: everything that is not routed to Yandex by a
// `ru*` locale ends up here. Unlike the Yandex plugin this one is a static
// import — it is in every native build regardless of routing, and the mediation
// adapters it pulls in are wired into the Gradle/Pods setup rather than loaded
// on demand.
//
// The adapter uses stock plugin events and native request options. The
// bridge owns the shared ad lifecycles and opens every operation on them
// (`beginShow`, `beginLoad`); this file only drives the SDK and reports what it
// answered.
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';

import { debugLog } from '../../debug.js';
import { APP_CONFIG } from '../config.js';
import { getNativeKey } from '../env.js';
import { beginConsentTelemetry, recordConsentAttempt } from '../consent-telemetry.js';
import { bindAdRevenueEvents } from './ad-revenue.js';

let deps = null;
let interstitialOptions = null;
let rewardOptions = null;
// Stock events have no request identity. Keep a presentation bound to its
// original scope until the SDK reports a terminal event, even after a watchdog.
const shows = { interstitial: null, rewarded: null };

async function bindPresentationEvents(format, events) {
  await Promise.all([
    AdMob.addListener(events.Showed, (payload) => shows[format]?.showStarted(payload)),
    AdMob.addListener(events.FailedToShow, (error) => {
      const scope = shows[format];
      const wasUnresolved = scope && !scope.isCurrent();
      shows[format] = null;
      scope?.showFailed(error);
      if (wasUnresolved) deps.onPresentationSettled?.();
    }),
    AdMob.addListener(events.Dismissed, (payload) => {
      const scope = shows[format];
      const wasUnresolved = scope && !scope.isCurrent();
      shows[format] = null;
      scope?.showClosed(payload);
      if (wasUnresolved) deps.onPresentationSettled?.();
    }),
  ]);
}

// A watchdog ended the JS attempt but the native presentation is still unknown.
export function isPresentationUnresolved(format) {
  return Boolean(shows[format] && !shows[format].isCurrent());
}

function beginPresentation(format) {
  if (Object.values(shows).some(Boolean)) throw new Error(`Previous AdMob ${format} presentation has not settled`);
  return (shows[format] = deps[format].captureShow());
}

function failPresentation(format, scope, error) {
  const wasUnresolved = shows[format] === scope && !scope.isCurrent();
  if (shows[format] === scope) shows[format] = null;
  scope.showFailed(error);
  if (wasUnresolved) deps.onPresentationSettled?.();
}

function getConfig() {
  return {
    ...APP_CONFIG.ads.admob[getNativeKey()],
    testMode: APP_CONFIG.ads.nativeTestMode,
    testingDevices: APP_CONFIG.ads.admob.testingDevices,
    useSampleAds: APP_CONFIG.ads.admob.useSampleAds,
  };
}

// Recover only observed failures. Healthy banners keep SDK-managed refresh.
let bannerTelemetry = null;
let bannerOptions = null;
let bannerRetryTimer = null;
let bannerRetryCount = 0;
let bannerRecoveryAfter = 0;
let bannerFailed = false;
let bannerAttempt = 0;
let bannerListenersBound = false;

function clearBannerRetry() {
  if (bannerRetryTimer !== null) clearTimeout(bannerRetryTimer);
  bannerRetryTimer = null;
}

function stopBannerRecovery() {
  bannerTelemetry?.stop();
  clearBannerRetry();
  bannerOptions = null;
  bannerFailed = false;
  bannerRetryCount = 0;
  bannerAttempt++;
}

function scheduleBannerRetry() {
  if (!bannerOptions || !bannerFailed || deps.isAdsRemoved()
    || document.visibilityState === 'hidden' || bannerRetryTimer !== null) return;
  if (bannerRetryCount >= 3) {
    bannerRecoveryAfter = performance.now() + 30000;
    bannerTelemetry?.retryExhausted();
    return;
  }
  bannerTelemetry?.retryScheduled(bannerRetryCount + 1, 5000 * (2 ** bannerRetryCount));
  bannerRetryTimer = setTimeout(() => {
    bannerRetryTimer = null;
    if (!bannerOptions || deps.isAdsRemoved() || document.visibilityState === 'hidden') return;
    bannerRetryCount++;
    requestBanner();
  }, 5000 * (2 ** bannerRetryCount));
}

function requestBanner() {
  if (!bannerOptions || deps.isAdsRemoved()) return;
  if (document.visibilityState === 'hidden') {
    bannerFailed = true;
    return;
  }
  bannerFailed = false;
  const attempt = ++bannerAttempt;
  const options = bannerOptions;
  void Promise.resolve().then(() => {
    if (attempt !== bannerAttempt || !bannerOptions || deps.isAdsRemoved()) return;
    bannerTelemetry?.request(bannerRetryCount);
    return AdMob.showBanner(options);
  }).catch((error) => {
    if (attempt !== bannerAttempt || !bannerOptions) return;
    bannerTelemetry?.failed(error, 'bridge_rejection');
    console.warn('AdMob banner load failed', error);
    bannerFailed = true;
    scheduleBannerRetry();
  });
}

function recoverBannerOnActivity() {
  if (!bannerOptions || !bannerFailed || deps.isAdsRemoved()
    || document.visibilityState === 'hidden' || bannerRetryTimer !== null) return;
  if (bannerRetryCount >= 3) {
    // A real lifecycle/network signal opens one new bounded budget. No polling.
    const delay = Math.max(0, bannerRecoveryAfter - performance.now());
    bannerRetryTimer = setTimeout(() => {
      bannerRetryTimer = null;
      if (!bannerOptions || deps.isAdsRemoved() || document.visibilityState === 'hidden') return;
      bannerRetryCount = 0;
      requestBanner();
    }, delay);
    return;
  }
  scheduleBannerRetry();
}

async function bindBannerRecovery() {
  if (bannerListenersBound) return;
  await Promise.all([
    AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      if (!bannerOptions) return;
      bannerTelemetry?.loaded();
      bannerAttempt++;
      bannerFailed = false;
      bannerRetryCount = 0;
      clearBannerRetry();
    }),
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (error) => {
      if (!bannerOptions) return;
      bannerTelemetry?.failed(error, 'sdk_callback');
      bannerFailed = true;
      scheduleBannerRetry();
    }),
  ]);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearBannerRetry();
    else recoverBannerOnActivity();
  });
  window.addEventListener('online', recoverBannerOnActivity);
  bannerListenersBound = true;
}

// Whether a request bag exists to fetch with. The two are separate on purpose:
// an owner gets rewarded options but never interstitial ones, so one shared
// readiness answer would let the bridge open a load that can never settle.
export function isInterstitialReady() {
  return Boolean(interstitialOptions);
}

export function isRewardedReady() {
  return Boolean(rewardOptions);
}

// Cache user decisions; only technical failures allow an event-driven retry.
let consentPromise = null;
let consentRetryable = false;
let consentInfo = { canRequestAds: false, privacyOptionsRequired: false };

export function getNativeConsentInfo() {
  return { ...consentInfo };
}

export function prepareNativeConsent() {
  if (!consentPromise) {
    consentPromise = collectNativeConsent().then(result => {
      if (consentRetryable) consentPromise = null;
      return result;
    });
  }
  return consentPromise;
}

// Count foreground time only. Pausing cannot consume a retry or open a form.
export function waitForConsentRetry(delay) {
  return new Promise((resolve) => {
    let remaining = delay;
    let timer = null;
    let started = 0;
    function update() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(0, remaining - (performance.now() - started));
      }
      if (document.visibilityState === 'hidden') return;
      if (remaining <= 0) {
        document.removeEventListener('visibilitychange', update);
        resolve();
        return;
      }
      started = performance.now();
      timer = setTimeout(update, remaining);
    }
    document.addEventListener('visibilitychange', update);
    update();
  });
}

async function collectNativeConsent() {
  consentRetryable = false;
  const finishTelemetry = beginConsentTelemetry('startup');
  const delays = [5000, 15000];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let stage = 'info_update';
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
        stage = 'consent_form';
        if (document.visibilityState === 'hidden') await waitForConsentRetry(0);
        info = await AdMob.showConsentForm();
      }
      consentRetryable = false;
      consentInfo = {
        canRequestAds: info.canRequestAds === true,
        privacyOptionsRequired: info.privacyOptionsRequirementStatus === 'REQUIRED',
      };
      // REQUIRED without an available form is not a completed user decision.
      consentRetryable = !consentInfo.canRequestAds && info.status === AdmobConsentStatus.REQUIRED
        && !info.isConsentFormAvailable;
      recordConsentAttempt({ attempt, stage, canRequestAds: consentInfo.canRequestAds });
      finishTelemetry({ stage, canRequestAds: consentInfo.canRequestAds, attemptCount: attempt });
      return getNativeConsentInfo();
    } catch (error) {
      // Only the native UMP callback may preserve permission after an error.
      consentInfo = {
        canRequestAds: error?.data?.canRequestAds === true,
        privacyOptionsRequired: error?.data?.privacyOptionsRequired === true,
      };
      // Android: INTERNET_ERROR=2, TIME_OUT=4. iOS: network=3;
      // iOS code 2 is INVALID_APP_ID and must never be retried.
      const code = error?.code;
      const networkError = getNativeKey() === 'ios'
        ? code === 3 || code === '3'
        : getNativeKey() === 'android' && [2, '2', 4, '4'].includes(code);
      const willRetry = !consentInfo.canRequestAds && stage === 'info_update'
        && networkError && attempt <= delays.length;
      recordConsentAttempt({ attempt, stage, failed: true, error,
        canRequestAds: consentInfo.canRequestAds, willRetry });
      console.warn('Ad consent flow failed; SDK eligibility determines ad availability.', error);
      consentRetryable = !consentInfo.canRequestAds && networkError;
      if (!willRetry) {
        finishTelemetry({ stage, failed: true, error,
          canRequestAds: consentInfo.canRequestAds, attemptCount: attempt });
        return getNativeConsentInfo();
      }
      await waitForConsentRetry(delays[attempt - 1]);
    }
  }
}

export function showNativePrivacyOptions() {
  return AdMob.showPrivacyOptionsForm();
}

export function hasPresentation() {
  return Object.values(shows).some(Boolean);
}

let initializationPromise = null;
let sdkInitialized = false;
let initializationRetryable = false;
let retryAfter = 0;

export function canRetryInitialization() {
  return initializationRetryable && !initializationPromise;
}

export function init(injected) {
  if (!initializationPromise) {
    const delay = initializationRetryable ? Math.max(0, retryAfter - performance.now()) : 0;
    initializationRetryable = false;
    initializationPromise = (delay > 0 ? waitForConsentRetry(delay) : Promise.resolve())
      .then(() => initialize(injected)).then(ready => {
      if (!ready && initializationRetryable) {
        retryAfter = performance.now() + 30000;
        initializationPromise = null;
      }
      return ready;
    });
  }
  return initializationPromise;
}

async function initialize(injected) {
  stopBannerRecovery();
  deps = injected;
  const config = getConfig();
  bannerTelemetry = createBannerTelemetry('admob', config.testMode || config.useSampleAds || config.testingDevices?.length > 0);
  try {
    if (!sdkInitialized) {
      await AdMob.initialize({
        initializeForTesting: config.testMode,
        testingDevices: config.testingDevices,
      });
      sdkInitialized = true;
    }
    debugLog(`AdMob OK (${config.testMode ? 'test' : 'production'} ads)`);
  } catch (error) {
    initializationRetryable = true;
    console.warn('AdMob initialize failed', error);
    return false;
  }

  // Stock iOS consent forms need the controller set by AdMob.initialize.
  // Ad requests remain gated by UMP; SDK initialization is not consent.
  const consent = await prepareNativeConsent();
  if (!consent.canRequestAds) {
    initializationRetryable = consentRetryable;
    return false;
  }
  await requestIosTrackingAuthorization();

  await bindAdRevenueEvents(AdMob, 'admob', {
    banner: BannerAdPluginEvents.AdPaid,
    interstitial: InterstitialAdPluginEvents.AdImpression,
    rewarded: RewardAdPluginEvents.AdImpression,
  }, config.testMode || config.useSampleAds || config.testingDevices?.length > 0);

  if (!deps.isAdsRemoved()) {
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
      debugLog('Banner size changed:', size);
    });

    interstitialOptions = {
      adId: config.interstitial,
      isTesting: config.useSampleAds,
    };

    await bindPresentationEvents('interstitial', InterstitialAdPluginEvents);

    // The consent form and ATT prompt above are modal, so ownership can land
    // mid-init. Re-read the flag instead of trusting the one checked on entry.
    if (!deps.isAdsRemoved()) {
      await bindBannerRecovery();
      bannerOptions = {
        adId: config.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: config.useSampleAds,
      };
      requestBanner();
      deps.preloadInterstitial();
    }
  }

  rewardOptions = {
    adId: config.rewarded,
    isTesting: config.useSampleAds,
  };

  await bindPresentationEvents('rewarded', RewardAdPluginEvents);

  deps.preloadRewarded();
  return true;
}

// Throws on purpose when the plugin does: the bridge's show entry point owns the
// catch that turns it into a `showFailed`.
export async function showInterstitial() {
  const scope = beginPresentation('interstitial');
  try {
    await AdMob.showInterstitial();
  } catch (error) {
    failPresentation('interstitial', scope, error);
    throw error;
  }
  return true;
}

export async function showRewarded() {
  const scope = beginPresentation('rewarded');
  // The stock Android/iOS promise resolves only when the SDK earns a reward.
  // Use this per-call channel, not the uncorrelated global Rewarded event.
  // A dismissal without a reward may leave this promise pending.
  try {
    AdMob.showRewardVideoAd().then(
      (payload) => scope.rewardEarned(payload),
      (error) => failPresentation('rewarded', scope, error),
    );
  } catch (error) {
    failPresentation('rewarded', scope, error);
    throw error;
  }
  return true;
}

export function preloadInterstitial() {
  const scope = deps.interstitial.captureLoad();
  void Promise.resolve()
    .then(() => AdMob.prepareInterstitial(interstitialOptions))
    .then((payload) => scope.loadSucceeded(payload), (error) => {
      console.warn('Interstitial preload failed', error);
      scope.loadFailed(error);
    });
}

export function preloadRewarded() {
  const scope = deps.rewarded.captureLoad();
  void Promise.resolve()
    .then(() => AdMob.prepareRewardVideoAd(rewardOptions))
    .then((payload) => scope.loadSucceeded(payload), (error) => {
      console.warn('Rewarded preload failed', error);
      scope.loadFailed(error);
    });
}

export function hideBanner() {
  stopBannerRecovery();
  void Promise.resolve(AdMob.hideBanner())
    .catch((error) => console.warn('AdMob banner hide failed', error));
}

// QA provider switching: the native banner view outlives a WebView reload, so
// the one left behind has to go before the new provider draws its own. Nothing
// to load here — unlike the Yandex plugin this one is always present.
export function removeBanner() {
  stopBannerRecovery();
  return AdMob.removeBanner();
}

// Reuse the installed plugin's system ATT bridge for either native ad provider.
// This does not initialize AdMob or grant Yandex data-processing consent.
export async function requestIosTrackingAuthorization() {
  if (getNativeKey() !== 'ios') return;
  try {
    const trackingInfo = await AdMob.trackingAuthorizationStatus();
    if (trackingInfo.status === 'notDetermined') {
      await AdMob.requestTrackingAuthorization();
    }
  } catch (error) {
    console.warn('AdMob tracking authorization flow skipped', error);
  }
}
