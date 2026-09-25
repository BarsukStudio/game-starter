import { createNativeAdEvents } from './native-ad-events.js';
// Yandex native ads, through the Capacitor plugin.
//
// Routed by a `ru*` locale (the bridge decides), so this is the ad stack a
// Russian-locale native player gets instead of AdMob. The plugin is imported
// dynamically: every other target ships without it, and a static import would
// pull it into all five bundles.
//
// The adapter retains the native presentation until a correlated terminal reply.
// The bridge owns the
// shared ad lifecycles and opens every operation on them (`beginShow`,
// `beginLoad`); this file only drives the SDK and reports what it answered.
import { debugLog } from '../../debug.js';
import { APP_CONFIG } from '../config.js';
import { getNativeKey } from '../env.js';
import { prepareNativeConsent, requestIosTrackingAuthorization } from './native-admob.js';

let deps = null;
let plugin = null;
let presentation = null;

export function hasPresentation() {
  return presentation !== null;
}

export function isPresentationUnresolved(format) {
  return presentation?.format === format && !presentation.scope.isCurrent();
}

function settlePresentation(format, requestId) {
  if (!presentation || presentation.format !== format || presentation.scope.requestId !== requestId) return;
  const unresolved = !presentation.scope.isCurrent();
  presentation = null;
  if (unresolved) deps.onPresentationSettled?.();
}

function getConfig() {
  if (APP_CONFIG.ads.nativeTestMode) return APP_CONFIG.ads.yandex.test;
  return APP_CONFIG.ads.yandex[getNativeKey()];
}

async function ensurePlugin() {
  if (plugin) return plugin;
  const module = await import('capacitor-plugin-yandex-ads');
  // Capacitor proxies synthesize arbitrary property names as native methods,
  // including `then`. Keep the proxy inside a plain object so returning it from
  // this async function cannot trigger Promise thenable assimilation.
  plugin = { YandexAds: module.YandexAds ?? null };
  return plugin;
}

// Whether the plugin handle is already in hand. The bridge asks before it opens
// a load, because a preload dispatched at a provider whose SDK never arrived
// would leave the lifecycle waiting on a watchdog instead of not starting.
export function isPluginLoaded() {
  return Boolean(plugin);
}

async function showBanner(YandexAds) {
  if (deps.isAdsRemoved()) return false;
  const config = getConfig();
  try {
    await YandexAds.showBanner({ adUnitId: config.banner });
    // Ownership can be restored while the native banner is loading. Remove it
    // immediately instead of leaving a paid owner with a visible banner.
    if (deps.isAdsRemoved()) {
      await YandexAds.removeBanner();
      return false;
    }
    return true;
  } catch (error) {
    console.warn('YandexAds banner show failed', error);
    return false;
  }
}

// Returns whether the SDK came up. The bridge turns the provider off on false,
// and decides from its own routing whether AdMob gets a turn afterwards.
export async function init(injected) {
  deps = {
    ...injected,
    interstitial: createNativeAdEvents(injected.interstitial, () => globalThis.crypto.randomUUID()),
    rewarded: createNativeAdEvents(injected.rewarded, () => globalThis.crypto.randomUUID()),
  };

  const consent = await prepareNativeConsent();
  if (!consent.canRequestAds) return false;
  // UMP precedes ATT and SDK initialization for either native provider.
  await requestIosTrackingAuthorization();

  let YandexAds;
  try {
    YandexAds = (await ensurePlugin())?.YandexAds;
    if (!YandexAds) throw new Error('YandexAds Capacitor plugin is unavailable');
    await YandexAds.initialize({
      userConsent: consent.yandexConsent,
      locationTracking: false,
      enableLogging: APP_CONFIG.ads.nativeTestMode,
    });
    await YandexAds.setUserConsent({ value: consent.yandexConsent });

    await Promise.all([
      YandexAds.addListener(
        'rewardedLoaded',
        (payload) => deps.rewarded.loadSucceeded(payload),
      ),
      YandexAds.addListener(
        'rewardedFailedToLoad',
        (error) => deps.rewarded.loadFailed(error),
      ),
      YandexAds.addListener(
        'rewardedShown',
        (payload) => deps.rewarded.showStarted(payload),
      ),
      YandexAds.addListener(
        'rewardedFailedToShow',
        (error) => {
          settlePresentation('rewarded', error?.requestId);
          deps.rewarded.showFailed(error);
        },
      ),
      YandexAds.addListener(
        'rewardedDismissed',
        (payload) => {
          // Legacy callers need the result's reward bit before closing. Keep
          // both formats reserved so another show cannot precede that close.
          if (presentation?.format === 'rewarded'
            && presentation.scope.requestId === payload?.requestId
            && presentation.scope.isCurrent()
            && !presentation.scope.rewardConfirmationBound) return;
          // Bound rewards survive dismissal. Close the game before another
          // format can start; only confirmation may arrive later for this view.
          settlePresentation('rewarded', payload?.requestId);
          deps.rewarded.showClosed(payload);
        },
      ),
      YandexAds.addListener(
        'rewarded',
        (payload) => deps.rewarded.rewardEarned(payload),
      ),
      YandexAds.addListener(
        'interstitialLoaded',
        (payload) => deps.interstitial.loadSucceeded(payload),
      ),
      YandexAds.addListener(
        'interstitialFailedToLoad',
        (error) => deps.interstitial.loadFailed(error),
      ),
      YandexAds.addListener(
        'interstitialShown',
        (payload) => deps.interstitial.showStarted(payload),
      ),
      YandexAds.addListener(
        'interstitialFailedToShow',
        (error) => {
          settlePresentation('interstitial', error?.requestId);
          deps.interstitial.showFailed(error);
        },
      ),
      YandexAds.addListener(
        'interstitialDismissed',
        (payload) => {
          settlePresentation('interstitial', payload?.requestId);
          deps.interstitial.showClosed(payload);
        },
      ),
      YandexAds.addListener('bannerLoaded', () => debugLog('YandexAds banner loaded')),
      YandexAds.addListener(
        'bannerFailedToLoad',
        (error) => console.warn('YandexAds banner load failed', error),
      ),
    ]);
    debugLog(`YandexAds OK (${APP_CONFIG.ads.nativeTestMode ? 'test' : 'production'} ads)`);
  } catch (error) {
    console.warn('YandexAds initialize failed', error);
    return false;
  }

  if (!deps.isAdsRemoved()) {
    deps.preloadInterstitial();
    void showBanner(YandexAds);
  }

  deps.preloadRewarded();
  return true;
}

export async function showInterstitial() {
  if (presentation) throw new Error('Yandex native presentation has not settled');
  const lifecycle = deps.interstitial.captureShow();
  if (typeof plugin?.YandexAds?.showInterstitial !== 'function') {
    lifecycle.showFailed(new Error('Yandex interstitial API is unavailable'));
    return false;
  }
  presentation = { format: 'interstitial', scope: lifecycle };
  let result;
  try {
    result = await plugin.YandexAds.showInterstitial({ requestId: lifecycle.requestId });
  } catch (error) {
    settlePresentation('interstitial', lifecycle.requestId);
    throw error;
  }
  settlePresentation('interstitial', lifecycle.requestId);
  if (result?.presented !== true) {
    lifecycle.showFailed(new Error('Yandex interstitial failed to present'));
    return false;
  }
  // Native events normally drive these transitions. The result is a
  // terminal fallback for a bridge that returned without an event.
  lifecycle.showStarted();
  lifecycle.showClosed();
  return true;
}

export async function showRewarded() {
  if (presentation) throw new Error('Yandex native presentation has not settled');
  const lifecycle = deps.rewarded.captureShow();
  if (typeof plugin?.YandexAds?.showRewarded !== 'function') {
    lifecycle.showFailed(new Error('Yandex rewarded API is unavailable'));
    return false;
  }
  presentation = { format: 'rewarded', scope: lifecycle };
  let result;
  try {
    result = await plugin.YandexAds.showRewarded({ requestId: lifecycle.requestId });
  } catch (error) {
    settlePresentation('rewarded', lifecycle.requestId);
    throw error;
  }
  settlePresentation('rewarded', lifecycle.requestId);
  if (result?.presented !== true) {
    lifecycle.showFailed(new Error('Yandex rewarded ad failed to present'));
    return false;
  }
  // The event remains authoritative when available; these calls only
  // complete a lifecycle if the native listener was silent. The plugin
  // resolves this result on dismissal. Bound callers may already be closed;
  // their confirmation still belongs to this request. Legacy callers close
  // here after the reward bit, while both formats remain reserved until result.
  lifecycle.showStarted();
  if (result.rewarded === true) lifecycle.rewardEarned(result);
  lifecycle.showClosed();
  return true;
}

export function preloadInterstitial() {
  const lifecycle = deps.interstitial.captureLoad();
  void Promise.resolve()
    .then(() => plugin.YandexAds.prepareInterstitial({
      adUnitId: getConfig().interstitial,
      requestId: lifecycle.requestId,
    }))
    .then((payload) => lifecycle.loadSucceeded(payload))
    .catch((error) => {
      console.warn('YandexAds interstitial preload failed', error);
      lifecycle.loadFailed(error);
    });
}

export function preloadRewarded() {
  const lifecycle = deps.rewarded.captureLoad();
  void Promise.resolve()
    .then(() => plugin.YandexAds.prepareRewarded({
      adUnitId: getConfig().rewarded,
      requestId: lifecycle.requestId,
    }))
    .then((payload) => lifecycle.loadSucceeded(payload))
    .catch((error) => {
      console.warn('YandexAds rewarded preload failed', error);
      lifecycle.loadFailed(error);
    });
}

// Hiding a banner on the active provider: the plugin is already loaded, and an
// older build without `removeBanner` must not throw on an owner's first launch.
export function hideBanner() {
  if (typeof plugin?.YandexAds?.removeBanner !== 'function') return;
  void Promise.resolve()
    .then(() => plugin.YandexAds.removeBanner())
    .catch((error) => console.warn('YandexAds banner hide failed', error));
}

// QA provider switching, which is a different problem: the native banner view
// outlives a WebView reload, so the banner left behind by the *previous*
// provider has to go even when this adapter never initialized in this session.
// That is why this one may still load the plugin, and why it swallows
// everything — a cleanup that cannot run must not block the reload.
export async function removeBannerIfAvailable() {
  // The handle is unwrapped by property access after the await, never returned
  // from a `.then` callback. A callback that returned the proxy would hand it
  // to the promise resolution procedure, which reads `.then` on whatever it is
  // given — and the proxy synthesizes that name into a native call like any
  // other. `YandexAds.then()` does not exist, so it rejects a promise nobody
  // holds, neither settles the outer one, and this await never returns. See
  // `ensurePlugin()` for the other half of the same rule.
  let handle = null;
  try {
    handle = await ensurePlugin();
  } catch (_) {
    return;
  }
  const YandexAds = handle?.YandexAds;
  if (typeof YandexAds?.removeBanner !== 'function') return;
  await YandexAds.removeBanner();
}
