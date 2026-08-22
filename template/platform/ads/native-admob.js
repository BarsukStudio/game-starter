// AdMob native ads, through the Capacitor community plugin.
//
// The default native ad stack: everything that is not routed to Yandex by a
// `ru*` locale ends up here. Unlike the Yandex plugin this one is a static
// import — it is in every native build regardless of routing, and the mediation
// adapters it pulls in are wired into the Gradle/Pods setup rather than loaded
// on demand.
//
// The adapter owns no provider state and has no module-scope side effect — the
// two request option bags, the injected dependencies and nothing else. The
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

let deps = null;
let interstitialOptions = null;
let rewardOptions = null;

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

// Returns whether the SDK came up. Only the two paths that disabled ads before
// the split answer no — a failed `initialize`, and consent that does not allow
// requests. Deliberately *not* wrapped in one try/catch: ATT and the banner
// warn and carry on, and a listener registration or preload that throws stays
// thrown, exactly as it is today.
export async function init(injected) {
  deps = injected;
  const config = getConfig();

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

  try {
    let consentInfo = await AdMob.requestConsentInfo();
    if (
      consentInfo.status === AdmobConsentStatus.REQUIRED
      && consentInfo.isConsentFormAvailable
    ) {
      consentInfo = await AdMob.showConsentForm();
    }
    if (consentInfo.canRequestAds !== true) {
      console.warn('AdMob consent does not allow ad requests; native ads stay disabled.');
      return false;
    }
  } catch (error) {
    console.warn('AdMob consent flow failed; native ads stay disabled.', error);
    return false;
  }

  // ATT controls tracking/personalization on iOS, but it must not gate the
  // independent UMP consent form above.
  try {
    const trackingInfo = await AdMob.trackingAuthorizationStatus();
    if (trackingInfo.status === 'notDetermined') {
      await AdMob.requestTrackingAuthorization();
    }
  } catch (error) {
    console.warn('AdMob tracking authorization flow skipped', error);
  }

  if (!deps.isAdsRemoved()) {
    AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      debugLog('Banner loaded');
    });
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
      debugLog('Banner size changed:', size);
    });

    interstitialOptions = {
      adId: config.interstitial,
      isTesting: config.useSampleAds,
    };

    AdMob.addListener(
      InterstitialAdPluginEvents.Loaded,
      (payload) => deps.interstitial.loadSucceeded(payload),
    );
    AdMob.addListener(
      InterstitialAdPluginEvents.FailedToLoad,
      (error) => deps.interstitial.loadFailed(error),
    );
    AdMob.addListener(
      InterstitialAdPluginEvents.Showed,
      () => deps.interstitial.showStarted(),
    );
    AdMob.addListener(
      InterstitialAdPluginEvents.FailedToShow,
      (error) => deps.interstitial.showFailed(error),
    );
    AdMob.addListener(
      InterstitialAdPluginEvents.Dismissed,
      () => deps.interstitial.showClosed(),
    );

    // The consent form and ATT prompt above are modal, so ownership can land
    // mid-init. Re-read the flag instead of trusting the one checked on entry.
    if (!deps.isAdsRemoved()) {
      try {
        await AdMob.showBanner({
          adId: config.banner,
          adSize: BannerAdSize.SMART_BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin: 0,
          isTesting: config.useSampleAds,
        });
      } catch (error) {
        console.warn('AdMob banner show failed', error);
      }
      deps.preloadInterstitial();
    }
  }

  rewardOptions = {
    adId: config.rewarded,
    isTesting: config.useSampleAds,
  };

  AdMob.addListener(
    RewardAdPluginEvents.Loaded,
    (payload) => deps.rewarded.loadSucceeded(payload),
  );
  AdMob.addListener(
    RewardAdPluginEvents.FailedToLoad,
    (error) => deps.rewarded.loadFailed(error),
  );
  AdMob.addListener(
    RewardAdPluginEvents.Showed,
    () => deps.rewarded.showStarted(),
  );
  AdMob.addListener(
    RewardAdPluginEvents.FailedToShow,
    (error) => deps.rewarded.showFailed(error),
  );
  AdMob.addListener(
    RewardAdPluginEvents.Dismissed,
    () => deps.rewarded.showClosed(),
  );
  AdMob.addListener(
    RewardAdPluginEvents.Rewarded,
    (payload) => deps.rewarded.rewardEarned(payload),
  );

  deps.preloadRewarded();
  return true;
}

// Throws on purpose when the plugin does: the bridge's show entry point owns the
// catch that turns it into a `showFailed`.
export async function showInterstitial() {
  await AdMob.showInterstitial();
  return true;
}

export async function showRewarded() {
  // The plugin resolves this call only from its own reward callback, so
  // its resolution carries the same reward fact the Rewarded event does —
  // on a channel that survives a dismissal arriving first. It never
  // resolves when the player closes without a reward, so it must not be
  // awaited; both handlers are attached here instead.
  AdMob.showRewardVideoAd().then(
    (payload) => deps.rewarded.rewardEarned(payload),
    (error) => deps.rewarded.showFailed(error),
  );
  return true;
}

export function preloadInterstitial() {
  const lifecycle = deps.interstitial;
  void Promise.resolve()
    .then(() => AdMob.prepareInterstitial(interstitialOptions))
    .catch((error) => {
      console.warn('Interstitial preload failed', error);
      lifecycle.loadFailed(error);
    });
}

export function preloadRewarded() {
  const lifecycle = deps.rewarded;
  void Promise.resolve()
    .then(() => AdMob.prepareRewardVideoAd(rewardOptions))
    .catch((error) => {
      console.warn('Rewarded preload failed', error);
      lifecycle.loadFailed(error);
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
