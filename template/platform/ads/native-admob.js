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
import { readConsentSignals, hasYandexConsent, showIosConsentForm, showIosPrivacyOptionsForm } from '../consent-signals.js';

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
  if (shows[format]) throw new Error(`Previous AdMob ${format} presentation has not settled`);
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

// Whether a request bag exists to fetch with. The two are separate on purpose:
// an owner gets rewarded options but never interstitial ones, so one shared
// readiness answer would let the bridge open a load that can never settle.
export function isInterstitialReady() {
  return Boolean(interstitialOptions);
}

export function isRewardedReady() {
  return Boolean(rewardOptions);
}

// Both native providers share one UMP update per WebView launch. A fallback
// from Yandex to AdMob must not ask twice or bypass a failed consent flow.
let consentPromise = null;
let consentInfo = { canRequestAds: false, privacyOptionsRequired: false, yandexConsent: false };

export function getNativeConsentInfo() {
  return { ...consentInfo };
}

export function prepareNativeConsent() {
  if (!consentPromise) consentPromise = collectNativeConsent();
  return consentPromise;
}

async function collectNativeConsent() {
  try {
    let info = await AdMob.requestConsentInfo();
    if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
      info = await (getNativeKey() === 'ios' ? showIosConsentForm() : AdMob.showConsentForm());
    }
    consentInfo = {
      canRequestAds: info.canRequestAds === true,
      privacyOptionsRequired: info.privacyOptionsRequirementStatus === 'REQUIRED',
      yandexConsent: false,
    };
    if (consentInfo.canRequestAds) {
      try {
        consentInfo.yandexConsent = hasYandexConsent(await readConsentSignals());
      } catch (error) {
        // Missing native choices never become permission for personalization.
        console.warn('Native consent choices unavailable; Yandex consent stays false.', error);
      }
    }
  } catch (error) {
    console.warn('Ad consent flow failed; native ads stay disabled.', error);
  }
  return getNativeConsentInfo();
}

export function showNativePrivacyOptions() {
  return getNativeKey() === 'ios' ? showIosPrivacyOptionsForm() : AdMob.showPrivacyOptionsForm();
}

export function hasPresentation() {
  return Object.values(shows).some(Boolean);
}

export async function init(injected) {
  deps = injected;
  const config = getConfig();
  const consent = await prepareNativeConsent();
  if (!consent.canRequestAds) return false;
  // Neither ATT refusal nor an ATT bridge error grants data-processing consent.
  await requestIosTrackingAuthorization();
  try {
    await AdMob.initialize({
      initializeForTesting: config.testMode,
      testingDevices: config.testingDevices,
    });
    debugLog(`AdMob OK (${config.testMode ? 'test' : 'production'} ads)`);
  } catch (error) {
    console.warn('AdMob initialize failed', error);
    return false;
  }

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
      const bannerOptions = {
        adId: config.banner,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position: BannerAdPosition.BOTTOM_CENTER,
        margin: 0,
        isTesting: config.useSampleAds,
      };
      // One application request. Refresh and failure behavior belong to the
      // unmodified plugin/SDK; do not start an application retry timer.
      // Stock Android can leave this promise pending when a banner already
      // exists after a WebView reload. Fullscreen setup must not depend on it.
      void Promise.resolve()
        .then(() => {
          if (!deps.isAdsRemoved()) return AdMob.showBanner(bannerOptions);
        })
        .catch((error) => console.warn('AdMob banner load failed', error));
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
  void Promise.resolve(AdMob.hideBanner())
    .catch((error) => console.warn('AdMob banner hide failed', error));
}

// QA provider switching: the native banner view outlives a WebView reload, so
// the one left behind has to go before the new provider draws its own. Nothing
// to load here — unlike the Yandex plugin this one is always present.
export function removeBanner() {
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
