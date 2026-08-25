// A stand-in for `@capacitor-community/admob`.
//
// Only `removeBanner` is driven; the enums exist because the adapter imports
// them by name, and a missing named export is a link-time error under ESM.
import { removeBanner } from './banner-probe.js';

export const AdMob = {
  removeBanner: () => removeBanner('admob'),
};

export const AdmobConsentStatus = Object.freeze({ REQUIRED: 'REQUIRED', OBTAINED: 'OBTAINED' });
export const BannerAdPluginEvents = Object.freeze({ SizeChanged: 'bannerAdSizeChanged' });
export const BannerAdPosition = Object.freeze({ BOTTOM_CENTER: 'BOTTOM_CENTER' });
export const BannerAdSize = Object.freeze({ ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' });
export const InterstitialAdPluginEvents = Object.freeze({
  Loaded: 'interstitialAdLoaded',
  FailedToLoad: 'interstitialAdFailedToLoad',
  Showed: 'interstitialAdShowed',
  FailedToShow: 'interstitialAdFailedToShow',
  Dismissed: 'interstitialAdDismissed',
});
export const RewardAdPluginEvents = Object.freeze({
  Loaded: 'onRewardedVideoAdLoaded',
  FailedToLoad: 'onRewardedVideoAdFailedToLoad',
  Showed: 'onRewardedVideoAdShowed',
  FailedToShow: 'onRewardedVideoAdFailedToShow',
  Dismissed: 'onRewardedVideoAdDismissed',
  Rewarded: 'onRewardedVideoAdReward',
});
