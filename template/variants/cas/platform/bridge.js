import { withAdAttemptScopes } from '@barsuk/game-runtime/ad-attempt-scope';
import {
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
import * as nativeCas from './ads/native-cas.js';
import * as cdvPurchase from './purchases/cdv-purchase.js';

const state = { callbacks: {}, provider: 'none', removeAdsFlag: false };

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
  const adapter = state.provider === 'cas-native' ? nativeCas : null;
  if (!adapter) return false;
  const unresolved = ['interstitial', 'rewarded'].find(adapter.isPresentationUnresolved);
  if (!unresolved) return false;
  onBlocked?.();
  console.warn('Ad presentation has no terminal native callback', { provider: state.provider, format, unresolved });
  state.callbacks.onAdUnavailable?.({ format, reason: 'unresolved-presentation' });
  return true;
}

function resetAdLifecycles() {
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
    onLoadFailed: (error) => state.callbacks.onInterstitialLoadFailed?.(error, { sdkManaged: state.provider === 'cas-native' }),
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
  lateRewardGraceMs: 0,
  callbacks: {
    onLoaded: (payload) => state.callbacks.onRewardedLoaded?.(payload),
    onLoadFailed: (error) => state.callbacks.onRewardedLoadFailed?.(error, { sdkManaged: state.provider === 'cas-native' }),
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

}
resetAdLifecycles();

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

let platformInitialization = null;
export async function initializePlatformServices(callbacks) {
  // Repeated initialization must preserve the first callbacks and ownership.
  if (!platformInitialization) {
    adsInitializing = true;
    platformInitialization = initializeAds(callbacks).finally(() => { adsInitializing = false; });
  }
  return platformInitialization;
}

export function getPrivacyOptionsState() {
  const privacy = nativeCas.getPrivacyOptionsState();
  return { available: isNative && privacy.available, busy: adsInitializing || privacy.busy };
}

export async function showPrivacyOptions() {
  if (!isNative || !nativeCas.isReady() || adsInitializing || nativeCas.hasPresentation() || nativeCas.getPrivacyOptionsState().busy) return false;
  adsInitializing = true;
  try {
    return await nativeCas.showPrivacyOptions();
  } finally {
    // Consent retires native inventory. Fresh lifecycles must retire its old readiness too.
    resetAdLifecycles();
    nativeCas.resumeInventory(createAdAdapterDeps());
    adsInitializing = false;
  }
}

async function initializeAds(callbacks) {
  state.callbacks = callbacks;
  state.removeAdsFlag ||= Boolean(callbacks.removeAdsFlag);

  if (isNative) {
    state.provider = 'cas-native';
    if (!await nativeCas.init(createAdAdapterDeps())) state.provider = 'none';
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

export function describePurchaseTransaction(transaction) {
  return cdvPurchase.describeTransaction(transaction);
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
  if (state.provider === 'cas-native' && nativeCas.hasPresentation()
    && !['interstitial', 'rewarded'].some(nativeCas.isPresentationUnresolved)) return false;
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
      case 'cas-native':
        return await nativeCas.showInterstitial();
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
  if (reportUnresolvedPresentation('rewarded', () => {
    state.callbacks.onRewardedShowFailed?.(new Error('Ad presentation state is unknown'));
  })) return false;
  if (state.provider === 'cas-native' && nativeCas.hasPresentation()) return false;
  const lifecycle = state.rewardedLifecycle;
  if (!lifecycle.beginShow()) return false;
  state.rewardConfirmation = typeof onRewardConfirmed === 'function' ? onRewardConfirmed : null;
  const attempt = lifecycle.captureShow();

  try {
    switch (state.provider) {
      case 'cas-native':
        return await nativeCas.showRewarded();
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
  const lifecycle = state.interstitialLifecycle;
  if (state.provider === 'cas-native' && nativeCas.isReady()) {
    if (!lifecycle.beginLoad()) return;
    nativeCas.preloadInterstitial();
  } else if (state.provider === 'yandex-web') {
    if (!lifecycle.beginLoad()) return;
    yandexWeb.preloadInterstitial();
  } else if (state.provider === 'crazygames-web') {
    if (!lifecycle.beginLoad()) return;
    crazyGames.preloadInterstitial();
  }
}

export function preloadRewardedAd() {
  const lifecycle = state.rewardedLifecycle;
  if (state.provider === 'cas-native' && nativeCas.isReady()) {
    if (!lifecycle.beginLoad()) return;
    nativeCas.preloadRewarded();
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
  if (state.provider === 'cas-native') nativeCas.hideBanner();
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
