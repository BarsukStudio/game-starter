// Yandex Games web ads, the portal review prompt and the portal's interface
// language.
//
// The SDK arrives as a `<script>` injected by `scripts/build-web.mjs`, so there
// is nothing to import — `window.YaGames.init()` is awaited once and its result
// is cached here, because every caller below needs the same handle.
//
// A missing `window.YaGames` is not an error: `ensureSdk` resolves to `null` and
// each caller reports the API as unavailable on its own attempt. Only
// `YaGames.init()` itself throwing is a failed initialization.
//
// This adapter deliberately imports nothing, `env.js` included: it would pull
// `@capacitor/core` in behind it, and every branch here is reachable from Node
// with a stubbed `window` (`npm run test:web-adapters`). Whether this target is
// the Yandex one at all is the bridge's question, asked before it ever calls in.
//
// The adapter owns no provider state and has no module-scope side effect — the
// SDK handle and the injected dependencies are all it keeps. The bridge owns the
// shared ad lifecycles and opens every operation on them (`beginShow`,
// `beginLoad`); this file only reports what the SDK answered.
let deps = null;
let sdk = null;

async function ensureSdk() {
  if (sdk || !window.YaGames?.init) return sdk;
  sdk = await window.YaGames.init();
  return sdk;
}

// The portal's own interface language. Empty string means "no portal answer,
// keep the browser locale" — never a language. Callable before `init`, because
// the game asks for it as soon as the page is up.
export async function getPortalLanguage() {
  try {
    const portal = await ensureSdk();
    return String(portal?.environment?.i18n?.lang ?? '').trim().toLowerCase();
  } catch (error) {
    console.warn('Yandex portal language lookup failed', error);
    return '';
  }
}

// Returns whether the environment came up. Only a throwing `YaGames.init()`
// answers no; an absent SDK leaves the provider in place and is reported per
// attempt by the preloads and the show calls.
export async function init(injected) {
  deps = injected;
  let portal;
  try {
    portal = await ensureSdk();
  } catch (error) {
    console.warn('Yandex SDK init failed', error);
    return false;
  }
  deps.preloadInterstitial();
  deps.preloadRewarded();

  if (portal?.adv && !deps.isAdsRemoved()) {
    try {
      const status = await portal.adv.getBannerAdvStatus();
      if (!status.stickyAdvIsShowing && !status.reason) {
        portal.adv.showBannerAdv();
      }
    } catch (error) {
      console.warn('Yandex web banner init failed', error);
    }
  }
  return true;
}

export async function showInterstitial() {
  const lifecycle = deps.interstitial;
  const portal = await ensureSdk();
  if (typeof portal?.adv?.showFullscreenAdv !== 'function') {
    lifecycle.showFailed(new Error('Yandex fullscreen API is unavailable'));
    return false;
  }
  await portal.adv.showFullscreenAdv({
    callbacks: {
      onOpen: () => lifecycle.showStarted(),
      onClose: () => lifecycle.showClosed(),
      onError: (error) => lifecycle.showFailed(error),
      onOffline: () => lifecycle.showFailed(new Error('Yandex fullscreen ad offline')),
    },
  });
  return true;
}

export async function showRewarded() {
  const lifecycle = deps.rewarded;
  const portal = await ensureSdk();
  if (typeof portal?.adv?.showRewardedVideo !== 'function') {
    lifecycle.showFailed(new Error('Yandex rewarded API is unavailable'));
    return false;
  }
  await portal.adv.showRewardedVideo({
    callbacks: {
      onOpen: () => lifecycle.showStarted(),
      onRewarded: (payload) => lifecycle.rewardEarned(payload),
      onClose: () => lifecycle.showClosed(),
      onError: (error) => lifecycle.showFailed(error),
    },
  });
  return true;
}

// The portal prepares the ad inside the show call, so a preload only proves the
// API is reachable. The load is already open: the bridge owns `beginLoad`.
export function preloadInterstitial() {
  const lifecycle = deps.interstitial;
  void ensureSdk()
    .then((portal) => {
      if (typeof portal?.adv?.showFullscreenAdv !== 'function') {
        throw new Error('Yandex fullscreen API is unavailable');
      }
      lifecycle.loadSucceeded();
    })
    .catch((error) => lifecycle.loadFailed(error));
}

export function preloadRewarded() {
  const lifecycle = deps.rewarded;
  void ensureSdk()
    .then((portal) => {
      if (typeof portal?.adv?.showRewardedVideo !== 'function') {
        throw new Error('Yandex rewarded API is unavailable');
      }
      lifecycle.loadSucceeded();
    })
    .catch((error) => lifecycle.loadFailed(error));
}

// True only when the portal actually handled the request: it said the player may
// review, and the prompt itself came back without throwing. Everything else —
// no SDK, no `feedback`, a refusal, any error — is false, and the bridge falls
// back to the store link.
export async function requestReview() {
  try {
    const portal = await ensureSdk();
    const result = await portal?.feedback?.canReview?.();
    if (result?.value) {
      await portal.feedback.requestReview();
      return true;
    }
  } catch (error) {
    console.warn('Yandex review request failed', error);
  }
  return false;
}
