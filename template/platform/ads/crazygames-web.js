// CrazyGames web ads.
//
// The portal's SDK arrives as a `<script>` injected by `scripts/build-web.mjs`,
// so there is nothing to import and nothing to cache: `window.CrazyGames.SDK`
// is read again at every call, because the page can finish loading the SDK
// after the game has started. The banner container is portal-specific DOM from
// the same injection, so its absence is normal on every other target.
//
// This adapter owns no provider state and has no module-scope side effect — the
// injected dependencies are all it keeps. The bridge decides which provider is
// active, owns the shared ad lifecycles and opens every operation on them
// (`beginShow`, `beginLoad`); this file only reports what the SDK answered. The
// game's callbacks never reach here.
let deps = null;

function getCrazyBannerSize() {
  const mobile = /android|ipad|ipod|iphone|mobile|phone/i.test(navigator.userAgent);
  if (mobile) return { width: 320, height: 50 };
  return { width: 728, height: 90 };
}

// Returns whether the environment came up, so the bridge could decide the
// provider from it. For CrazyGames the answer is always yes on purpose: a
// missing SDK or a missing banner container is the portal being slow or the
// page being another target, not a failed initialization — the preloads have
// already recorded that as a load failure, and the fullscreen calls report it
// per attempt. Only an exception thrown out of here reaches the bridge's outer
// catch and turns the provider off.
export function init(injected) {
  deps = injected;
  deps.preloadInterstitial();
  deps.preloadRewarded();

  if (deps.isAdsRemoved()) return true;

  const crazySdk = window.CrazyGames?.SDK;
  const bannerContainer = document.getElementById('banner-container');
  if (!crazySdk?.banner?.requestBanner || !bannerContainer) return true;

  const size = getCrazyBannerSize();
  crazySdk.banner.requestBanner(
    {
      id: 'banner-container',
      width: size.width,
      height: size.height,
    },
    (error) => {
      if (error) console.warn('CrazyGames banner request failed', error);
    },
  );
  return true;
}

export function showInterstitial() {
  const lifecycle = deps.interstitial;
  const crazySdk = window.CrazyGames?.SDK;
  if (typeof crazySdk?.ad?.requestAd !== 'function') {
    lifecycle.showFailed(new Error('CrazyGames interstitial API is unavailable'));
    return false;
  }
  crazySdk.ad.requestAd('midgame', {
    adStarted: () => {
      crazySdk.game?.gameplayStop?.();
      lifecycle.showStarted();
    },
    adFinished: () => {
      crazySdk.game?.gameplayStart?.();
      lifecycle.showStarted();
      lifecycle.showClosed();
    },
    adError: (error) => {
      crazySdk.game?.gameplayStart?.();
      lifecycle.showFailed(error);
    },
  });
  return true;
}

export function showRewarded() {
  const lifecycle = deps.rewarded;
  const crazySdk = window.CrazyGames?.SDK;
  if (typeof crazySdk?.ad?.requestAd !== 'function') {
    lifecycle.showFailed(new Error('CrazyGames rewarded API is unavailable'));
    return false;
  }
  crazySdk.ad.requestAd('rewarded', {
    adStarted: () => {
      crazySdk.game?.gameplayStop?.();
      lifecycle.showStarted();
    },
    adFinished: () => {
      crazySdk.game?.gameplayStart?.();
      lifecycle.showStarted();
      lifecycle.rewardEarned();
      lifecycle.showClosed();
    },
    adError: (error) => {
      crazySdk.game?.gameplayStart?.();
      lifecycle.showFailed(error);
    },
  });
  return true;
}

// There is nothing to prepare — the portal fetches the ad inside `requestAd` —
// so a preload only reports whether the SDK is there to be called. The load is
// already open by the time these run: the bridge owns `beginLoad`.
export function preloadInterstitial() {
  const lifecycle = deps.interstitial;
  if (typeof window.CrazyGames?.SDK?.ad?.requestAd === 'function') {
    lifecycle.loadSucceeded();
  } else {
    lifecycle.loadFailed(new Error('CrazyGames interstitial API is unavailable'));
  }
}

export function preloadRewarded() {
  const lifecycle = deps.rewarded;
  if (typeof window.CrazyGames?.SDK?.ad?.requestAd === 'function') {
    lifecycle.loadSucceeded();
  } else {
    lifecycle.loadFailed(new Error('CrazyGames rewarded API is unavailable'));
  }
}
