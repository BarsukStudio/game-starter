import { withAdAttemptScopes } from '@barsuk/game-runtime/ad-attempt-scope';
import {
  AD_LATE_REWARD_GRACE_MS,
  AD_PRESENTATION_TIMEOUT_MS,
  createAdLifecycle,
} from '@barsuk/game-runtime/ad-lifecycle';

import { APP_CONFIG } from './config.js';
import {
  getStoreKey,
  isNative,
  nativePlatform,
  runtimeTarget,
} from './env.js';
import * as nativeShell from './native-shell.js';
import * as crazyGames from './ads/crazygames-web.js';
import * as yandexWeb from './ads/yandex-web.js';
import * as nativeYandex from './ads/native-yandex.js';
import * as nativeAdmob from './ads/native-admob.js';
import * as cdvPurchase from './purchases/cdv-purchase.js';

// Storage keys are the consumer's, for the same reason the runtime-target
// global is: two games sharing one origin would read each other's QA override,
// and a key spelled here would be identifiable in every game cut from this
// template.
const DEBUG_NATIVE_AD_PROVIDER_KEY = APP_CONFIG.platform.debugAdsProviderKey;
// Keys this build no longer writes but may still find on a device. May be
// empty: a game with no such history has nothing to clean up.
const LEGACY_PRODUCTION_AD_PROVIDER_KEYS = APP_CONFIG.platform.legacyAdsProviderKeys;
const DEBUG_NATIVE_AD_PROVIDERS = new Set(['admob', 'yandex', 'off']);
// How long the QA switch waits for the native banners to come down before it
// reloads anyway. Long enough for a plugin that is going to answer, short
// enough that a stuck one is not mistaken for a dead override.
const DEBUG_BANNER_REMOVAL_TIMEOUT_MS = 1500;

const state = {
  callbacks: {},
  provider: 'none',
  providerSource: 'unresolved',
  removeAdsFlag: false,
};

function shouldUseNativeYandexAds(locale) {
  return isNative && String(locale || '').toLowerCase().startsWith('ru');
}

function readDebugNativeAdProviderOverride() {
  if (!isNative || !APP_CONFIG.ads.nativeTestMode) return '';
  try {
    const value = String(window.localStorage.getItem(DEBUG_NATIVE_AD_PROVIDER_KEY) ?? '')
      .trim()
      .toLowerCase();
    return DEBUG_NATIVE_AD_PROVIDERS.has(value) ? value : '';
  } catch (_) {
    return '';
  }
}

function clearDisabledProductionAdProviderOverride() {
  if (!isNative || APP_CONFIG.ads.nativeTestMode) return;
  try {
    // Production provider selection must always come from the automatic locale
    // route. Remove the old release-QA keys so an app update repairs devices
    // that previously persisted `debugAdsProvider('admob' | 'yandex' | 'off')`.
    for (const key of LEGACY_PRODUCTION_AD_PROVIDER_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch (_) {
    // Storage failure still fails safe: production never reads these keys.
  }
}

function resolveNativeAdProvider(locale) {
  const debugOverride = readDebugNativeAdProviderOverride();
  if (debugOverride) {
    return { provider: debugOverride, source: 'debug', debugOverride };
  }
  return {
    provider: shouldUseNativeYandexAds(locale) ? 'yandex' : 'admob',
    source: 'locale',
    debugOverride: 'auto',
  };
}

function normalizeActiveNativeAdProvider() {
  if (state.provider === 'admob-native') return 'admob';
  if (state.provider === 'yandex-native') return 'yandex';
  return 'off';
}

function getNativeAdProviderDebugStatus() {
  return {
    provider: state.providerSource === 'unresolved'
      ? 'unresolved'
      : normalizeActiveNativeAdProvider(),
    source: state.providerSource,
    debugOverride: readDebugNativeAdProviderOverride() || 'auto',
    remoteConfigKey: null,
    testMode: APP_CONFIG.ads.nativeTestMode,
    adsRemoved: state.removeAdsFlag,
  };
}

async function removeNativeBannersBeforeDebugReload() {
  // Both providers, because the banner the QA switch is escaping belongs to
  // whichever one ran before the reload. The names differ because the semantics
  // do: the Yandex plugin may still have to be loaded, the AdMob one is always
  // there.
  //
  // Bounded, because these are native calls: a plugin that answers neither way
  // leaves the promise pending for the life of the page, and an unbounded await
  // here is what strands the switch. A banner that outlived the timeout is a
  // visible, one-reload problem; a switch that never reloads looks like the
  // override was ignored.
  await Promise.race([
    Promise.allSettled([
      Promise.resolve().then(() => nativeAdmob.removeBanner()),
      nativeYandex.removeBannerIfAvailable(),
    ]),
    new Promise((resolve) => {
      window.setTimeout(resolve, DEBUG_BANNER_REMOVAL_TIMEOUT_MS);
    }),
  ]);
}

function registerNativeAdProviderDebugHelper() {
  if (!isNative || !APP_CONFIG.ads.nativeTestMode) return;
  const helper = async (value) => {
    if (value === undefined) {
      const status = getNativeAdProviderDebugStatus();
      console.log('[debugAdsProvider]', status);
      return status;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'auto' || !normalized) {
      window.localStorage.removeItem(DEBUG_NATIVE_AD_PROVIDER_KEY);
    } else if (DEBUG_NATIVE_AD_PROVIDERS.has(normalized)) {
      window.localStorage.setItem(DEBUG_NATIVE_AD_PROVIDER_KEY, normalized);
    } else {
      throw new Error('Use debugAdsProvider(\'yandex\' | \'admob\' | \'off\' | \'auto\').');
    }

    // Native banner views outlive a WebView reload. Remove both providers so a
    // QA switch cannot stack the new banner on top of the previous provider.
    //
    // The reload is scheduled in `finally`. The override is already written to
    // storage by this point, so every path out of here — a rejected native
    // call, a throw while reading the new selection — has to end in a reload;
    // otherwise the page keeps serving the provider the switch just replaced
    // and reports it back as the current one.
    try {
      await removeNativeBannersBeforeDebugReload();

      const selection = resolveNativeAdProvider(state.callbacks.locale);
      const status = {
        provider: selection.provider,
        source: selection.source,
        debugOverride: selection.debugOverride,
        remoteConfigKey: null,
        testMode: APP_CONFIG.ads.nativeTestMode,
        adsRemoved: state.removeAdsFlag,
        reloading: true,
      };
      console.log('[debugAdsProvider]', status);
      return status;
    } finally {
      window.setTimeout(() => window.location.reload(), 100);
    }
  };
  helper.status = getNativeAdProviderDebugStatus;
  window.debugAdsProvider = helper;
}

clearDisabledProductionAdProviderOverride();
registerNativeAdProviderDebugHelper();

// The portal's own interface language, when the game runs on one. It beats the
// browser locale there: a player can browse with an English UA locale and still
// open the game from the Russian portal, and the portal language is what they
// actually chose. Empty string means "no portal answer, keep the browser
// locale" — every caller must treat it that way rather than as a language.
export async function getPortalLanguage() {
  if (isNative || runtimeTarget.target !== 'yandex') return '';
  return yandexWeb.getPortalLanguage();
}

// Native SDKs report presentation almost immediately. Portal SDKs insert their
// own preparation step between the show call and the open event, so they need a
// budget that a slow network cannot exhaust — otherwise the watchdog resumes the
// game right before the ad actually opens on top of it.
const PORTAL_PROVIDERS = new Set(['yandex-web', 'crazygames-web']);
const PORTAL_PRESENTATION_TIMEOUT_MS = 15000;

function getPresentationTimeoutMs() {
  return PORTAL_PROVIDERS.has(state.provider)
    ? PORTAL_PRESENTATION_TIMEOUT_MS
    : AD_PRESENTATION_TIMEOUT_MS;
}

function reportUnresolvedPresentation(format, onBlocked) {
  const adapter = state.provider === 'admob-native' ? nativeAdmob
    : state.provider === 'yandex-native' ? nativeYandex : null;
  if (!adapter) return false;
  const unresolved = ['interstitial', 'rewarded'].find(adapter.isPresentationUnresolved);
  if (!unresolved) return false;
  onBlocked?.();
  console.warn('Ad presentation has no terminal native callback', { provider: state.provider, format, unresolved });
  state.callbacks.onAdUnavailable?.({ format, reason: 'unresolved-presentation' });
  return true;
}

state.interstitialLifecycle = withAdAttemptScopes(createAdLifecycle, {
  // Timers are a dependency, never an ambient global: the lifecycle is a headless
  // state machine that the contract tests drive on a fake clock, and the bridge is
  // the only layer here that owns a real window.
  setTimeoutFn: (handler, delayMs) => window.setTimeout(handler, delayMs),
  clearTimeoutFn: (timer) => window.clearTimeout(timer),
  name: 'Interstitial ad',
  presentationTimeoutMs: getPresentationTimeoutMs,
  callbacks: {
    onLoaded: (payload) => state.callbacks.onInterstitialLoaded?.(payload),
    onLoadFailed: (error) => state.callbacks.onInterstitialLoadFailed?.(error),
    onShown: () => state.callbacks.onInterstitialShown?.(),
    onShowFailed: (error) => {
      state.callbacks.onInterstitialShowFailed?.(error);
      reportUnresolvedPresentation('interstitial');
    },
    onClosed: () => {
      state.callbacks.onInterstitialClosed?.();
      reportUnresolvedPresentation('interstitial');
    },
  },
});

state.rewardedLifecycle = withAdAttemptScopes(createAdLifecycle, {
  setTimeoutFn: (handler, delayMs) => window.setTimeout(handler, delayMs),
  clearTimeoutFn: (timer) => window.clearTimeout(timer),
  name: 'Rewarded ad',
  presentationTimeoutMs: getPresentationTimeoutMs,
  // Legacy unbound callers retain their grace. Bound confirmations have an
  // independent lifetime, so dismissal can release the UI immediately.
  lateRewardGraceMs: () => (!state.rewardConfirmation && state.provider === 'admob-native' ? AD_LATE_REWARD_GRACE_MS : 0),
  callbacks: {
    onLoaded: (payload) => state.callbacks.onRewardedLoaded?.(payload),
    onLoadFailed: (error) => state.callbacks.onRewardedLoadFailed?.(error),
    onShown: () => state.callbacks.onRewardedShown?.(),
    onShowFailed: (error) => {
      state.callbacks.onRewardedShowFailed?.(error);
      reportUnresolvedPresentation('rewarded');
    },
    onClosed: () => {
      state.callbacks.onRewardedClosed?.();
      reportUnresolvedPresentation('rewarded');
    },
    onRewarded: (payload) => state.callbacks.onRewardedComplete?.(payload),
  },
});

// What an ad adapter is allowed to reach back for: the two shared lifecycles it
// reports into, the ownership flag it may read but never set, and the
// dispatching preloads it starts from inside its own init. Never `state`, and
// never the game's callback bag.
function createAdAdapterDeps() {
  return {
    interstitial: state.interstitialLifecycle,
    rewarded: {
      ...state.rewardedLifecycle,
      captureShow() {
        const scope = state.rewardedLifecycle.captureShow();
        const confirm = state.rewardConfirmation;
        if (!confirm) return scope;
        let rewarded = false;
        return {
          ...scope,
          rewardConfirmationBound: true,
          rewardEarned(payload) {
            if (rewarded) return false;
            rewarded = true;
            // Only this per-call confirmation survives closing the UI. All
            // presentation/close signals retain the runtime's stale-event gate.
            if (scope.isCurrent()) scope.showStarted();
            confirm(payload);
            return true;
          },
        };
      },
    },
    onPresentationSettled: () => {
      if (!reportUnresolvedPresentation('fullscreen')) state.callbacks.onAdAvailable?.();
    },
    isAdsRemoved: () => state.removeAdsFlag,
    preloadInterstitial: preloadInterstitialAd,
    preloadRewarded: preloadRewardedAd,
  };
}

// `native-shell.js` owns the implementation. This stays a real declaration
// rather than a re-export because the facade contract reads the seventeen
// methods out of this one file (`npm run test:facade`).
export async function hideNativeStatusBar() {
  return nativeShell.hideNativeStatusBar();
}

let adsInitializing = false;
let privacyOpen = false;

export async function initializePlatformServices(callbacks) {
  adsInitializing = true;
  try {
    return await initializeAds(callbacks);
  } finally {
    adsInitializing = false;
  }
}

export function getPrivacyOptionsState() {
  return {
    available: isNative && nativeAdmob.getNativeConsentInfo().privacyOptionsRequired,
    busy: adsInitializing || privacyOpen,
  };
}

export async function showPrivacyOptions() {
  const options = getPrivacyOptionsState();
  if (!options.available || options.busy
    || nativeAdmob.hasPresentation() || nativeYandex.hasPresentation()) return false;
  privacyOpen = true;
  // Old preloaded ads must never be shown after choices change. The game saves
  // first and reloads after success, so both SDKs prepare fresh ads at startup.
  state.privacyAdsStopped = true;
  try {
    let cleanupTimer;
    try {
      // Native cleanup can lose its bridge reply. Release UI busy state on timeout,
      // but never open UMP or resume old ads without confirmed cleanup.
      await Promise.race([
        Promise.all([
          nativeAdmob.removeBanner(),
          nativeYandex.removeBannerIfAvailable(),
        ]),
        new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error('Privacy ad cleanup timed out')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(cleanupTimer);
    }
    await nativeAdmob.showNativePrivacyOptions();
    return true;
  } catch (error) {
    console.warn('Privacy options failed; ads stay stopped until restart.', error);
    return false;
  } finally {
    privacyOpen = false;
  }
}

async function initializeAds(callbacks) {
  state.callbacks = callbacks;
  state.removeAdsFlag = Boolean(callbacks.removeAdsFlag);

  if (isNative) {
    const selection = resolveNativeAdProvider(callbacks.locale);
    state.providerSource = selection.source;
    if (selection.provider === 'off') {
      state.provider = 'none';
      return;
    }
    if (selection.provider === 'yandex') {
      // Set before the adapter runs, exactly where the adapter used to set it
      // itself: the preloads it starts dispatch on this value.
      state.provider = 'yandex-native';
      if (await nativeYandex.init(createAdAdapterDeps())) return;
      state.provider = 'none';
      // A forced debug provider must fail visibly instead of silently testing
      // a different SDK. Automatic locale routing keeps its production fallback.
      if (selection.source === 'debug') return;
      state.providerSource = 'locale-fallback';
    }
    // Set before the adapter runs, exactly where the adapter used to set it
    // itself: the preload it starts mid-init dispatches on this value. Not
    // wrapped in a try/catch — a listener registration that throws stays
    // thrown, as it does today.
    state.provider = 'admob-native';
    if (!await nativeAdmob.init(createAdAdapterDeps())) state.provider = 'none';
    return;
  }

  if (runtimeTarget.target === 'yandex') {
    // Set before the adapter runs, exactly where the adapter used to set it
    // itself: the preloads it starts dispatch on this value. Only a throwing
    // `YaGames.init()` answers false — an absent SDK keeps the provider and is
    // reported per attempt.
    state.provider = 'yandex-web';
    try {
      if (!await yandexWeb.init(createAdAdapterDeps())) {
        state.provider = 'none';
      }
    } catch (error) {
      console.warn('Yandex platform init failed', error);
      state.provider = 'none';
    }
    return;
  }

  if (runtimeTarget.target === 'crazygames') {
    // The provider is set before the adapter runs, exactly where the adapter
    // used to set it itself: the preloads it starts dispatch on this value.
    // Its return is deliberately not a branch here — CrazyGames never reports a
    // failed initialization (see `ads/crazygames-web.js`), so only an exception
    // reaches the catch below.
    state.provider = 'crazygames-web';
    try {
      crazyGames.init(createAdAdapterDeps());
    } catch (error) {
      console.warn('CrazyGames platform init failed', error);
      state.provider = 'none';
    }
  }
}

// Native *and* selling something. A build with an empty catalogue is a valid
// configuration, but a platform that claims it can sell owes the game a list of
// what — so the capability follows the catalogue, not just the shell it runs in.
export function supportsNativePurchases() {
  return isNative && cdvPurchase.hasProducts();
}

// `purchases/cdv-purchase.js` owns the plugin, the same way `native-shell.js`
// owns the app-shell plugins. These stay real declarations rather than
// re-exports because the facade contract reads the methods out of this one file
// (`npm run test:facade`).
export async function initializePurchaseStore(callbacks) {
  return cdvPurchase.initializeStore(callbacks);
}

export function supportsRestorePurchases() {
  return isNative && nativePlatform === 'ios';
}

export function verifyPurchaseTransaction(transaction) {
  return cdvPurchase.verifyTransaction(transaction);
}

export function getPurchasePrices() {
  return cdvPurchase.getPrices();
}

export function orderPurchase(productId) {
  return cdvPurchase.order(productId);
}

export function isPurchaseProductOwned(productId) {
  return cdvPurchase.isOwned(productId);
}

export function finishPurchaseTransaction(transaction) {
  return cdvPurchase.finishTransaction(transaction);
}

export function isPurchaseTransportAvailable() {
  return cdvPurchase.isTransportAvailable();
}

export function restorePurchases() {
  return cdvPurchase.restore();
}

export function getPurchaseDebugSnapshot() {
  return cdvPurchase.getDebugSnapshot();
}

// The store ids by the game's own key. Read through the adapter rather than off
// config directly: the adapter is what registered this set with the store, and a
// second reading of config here could hand the game a product the store never
// heard of.
export function getPurchaseProducts() {
  return cdvPurchase.getProductIds();
}

// `return await` in the async branches below is load-bearing, not style: a bare
// `return adapterPromise` settles after this function has already left the try,
// so an SDK rejection would escape as an unhandled rejection instead of becoming
// the `showFailed` the lifecycle needs. CrazyGames is synchronous and throws
// inside the try on its own.
export async function showInterstitialAd() {
  if (state.privacyAdsStopped) {
    state.callbacks.onInterstitialShowFailed?.(new Error('Advertising stopped after privacy options'));
    return false;
  }
  if (state.provider === 'yandex-native' && nativeYandex.hasPresentation()
    && !['interstitial', 'rewarded'].some(nativeYandex.isPresentationUnresolved)) return false;
  const lifecycle = state.interstitialLifecycle;
  if (!lifecycle.beginShow()) return false;
  const attempt = lifecycle.captureShow();

  // A countdown started before the restore can still fire afterwards, so the
  // owner check belongs here rather than only at the call sites.
  if (state.removeAdsFlag) {
    lifecycle.showFailed(new Error('Interstitial disabled by ads-removal ownership'));
    return false;
  }
  if (reportUnresolvedPresentation('interstitial')) {
    attempt.showFailed(new Error('Ad presentation state is unknown'));
    return false;
  }

  try {
    switch (state.provider) {
      case 'admob-native':
        return await nativeAdmob.showInterstitial();
      case 'yandex-native':
        return await nativeYandex.showInterstitial();
      case 'yandex-web':
        return await yandexWeb.showInterstitial();
      case 'crazygames-web':
        return crazyGames.showInterstitial();
      default:
        lifecycle.showFailed(new Error(`Interstitial provider ${state.provider} is unavailable`));
        return false;
    }
  } catch (error) {
    console.warn('Interstitial show failed', error);
    attempt.showFailed(error);
    return false;
  }
}

// `return await` in the async branches below is load-bearing, not style: a bare
// `return adapterPromise` settles after this function has already left the try,
// so an SDK rejection would escape as an unhandled rejection instead of becoming
// the `showFailed` the lifecycle needs. CrazyGames is synchronous and throws
// inside the try on its own.
export async function showRewardedAd(onRewardConfirmed) {
  if (state.privacyAdsStopped) {
    state.callbacks.onRewardedShowFailed?.(new Error('Advertising stopped after privacy options'));
    return false;
  }
  if (reportUnresolvedPresentation('rewarded', () => {
    state.callbacks.onRewardedShowFailed?.(new Error('Ad presentation state is unknown'));
  })) return false;
  if (state.provider === 'yandex-native' && nativeYandex.hasPresentation()) return false;
  const lifecycle = state.rewardedLifecycle;
  if (!lifecycle.beginShow()) return false;
  state.rewardConfirmation = typeof onRewardConfirmed === 'function' ? onRewardConfirmed : null;
  const attempt = lifecycle.captureShow();

  try {
    switch (state.provider) {
      case 'admob-native':
        return await nativeAdmob.showRewarded();
      case 'yandex-native':
        return await nativeYandex.showRewarded();
      case 'yandex-web':
        return await yandexWeb.showRewarded();
      case 'crazygames-web':
        return crazyGames.showRewarded();
      default:
        lifecycle.showFailed(new Error(`Rewarded provider ${state.provider} is unavailable`));
        return false;
    }
  } catch (error) {
    console.warn('Rewarded show failed', error);
    attempt.showFailed(error);
    return false;
  }
}

export function preloadInterstitialAd() {
  if (state.removeAdsFlag) return;
  if (state.privacyAdsStopped) return;
  const lifecycle = state.interstitialLifecycle;
  if (state.provider === 'admob-native' && nativeAdmob.isInterstitialReady()) {
    if (!lifecycle.beginLoad()) return;
    nativeAdmob.preloadInterstitial();
  } else if (state.provider === 'yandex-native' && nativeYandex.isPluginLoaded()) {
    if (!lifecycle.beginLoad()) return;
    nativeYandex.preloadInterstitial();
  } else if (state.provider === 'yandex-web') {
    if (!lifecycle.beginLoad()) return;
    yandexWeb.preloadInterstitial();
  } else if (state.provider === 'crazygames-web') {
    if (!lifecycle.beginLoad()) return;
    crazyGames.preloadInterstitial();
  }
}

export function preloadRewardedAd() {
  if (state.privacyAdsStopped) return;
  const lifecycle = state.rewardedLifecycle;
  if (state.provider === 'admob-native' && nativeAdmob.isRewardedReady()) {
    if (!lifecycle.beginLoad()) return;
    nativeAdmob.preloadRewarded();
  } else if (state.provider === 'yandex-native' && nativeYandex.isPluginLoaded()) {
    if (!lifecycle.beginLoad()) return;
    nativeYandex.preloadRewarded();
  } else if (state.provider === 'yandex-web') {
    if (!lifecycle.beginLoad()) return;
    yandexWeb.preloadRewarded();
  } else if (state.provider === 'crazygames-web') {
    if (!lifecycle.beginLoad()) return;
    crazyGames.preloadRewarded();
  }
}

// Single entry point for "the player owns the ads-removal entitlement", and
// deliberately one-way.
// Latching the flag before hiding matters: ownership can arrive while
// initialization is still awaiting a consent form, and a bare hide would be a
// no-op against a banner that does not exist yet, after which init would happily
// show one.
//
// There is no counterpart that turns ads back on. No store adapter can tell "the
// player does not own this" apart from "no receipt was loaded" — the App Store
// reports its receipts ready even when the load timed out — so acting on a
// negative answer means taking a paid entitlement away on a bad network. Where
// a game documents that trade is its own business, and a QA reset belongs on
// the game's side too — reloading the WebView rebuilds this state from scratch,
// which is the only reset this module needs to know about.
export function setAdsRemovedOwned() {
  state.removeAdsFlag = true;
  hideBannerAd();
}

function hideBannerAd() {
  if (state.provider === 'admob-native') {
    nativeAdmob.hideBanner();
  } else if (state.provider === 'yandex-native') {
    nativeYandex.hideBanner();
  }
}

export function openDeveloperPage() {
  window.location.replace(APP_CONFIG.links[getStoreKey()].developer);
}

export async function requestRating() {
  // The portal prompt replaces the store page only when the portal actually
  // handled it; every other answer falls through to the store link.
  if (state.provider === 'yandex-web' && await yandexWeb.requestReview()) return;

  window.location.replace(APP_CONFIG.links[getStoreKey()].app);
}

// Native side of `app-lifecycle.js`, implemented in `native-shell.js`. The
// handler bag is passed straight through: omitting it here leaves the
// destructuring default over there the one that applies.
export async function bindNativeLifecycle(handlers) {
  return nativeShell.bindNativeLifecycle(handlers);
}

export async function exitNativeApp() {
  return nativeShell.exitNativeApp();
}
