// A stand-in for the consumer's `config.js`, carrying only what the bridge and
// the two native ad adapters read on the path this suite exercises.
//
// The QA switch is gated on `ads.nativeTestMode`, so a fixture that turned it
// off would install no helper and pass every assertion by not running.
export const APP_CONFIG = {
  platform: {
    debugAdsProviderKey: 'fixture:debug-ads-provider',
    legacyAdsProviderKeys: [],
  },
  ads: {
    nativeTestMode: true,
    admob: { test: { banner: 'banner', interstitial: 'interstitial', rewarded: 'rewarded' } },
    yandex: { test: { banner: 'banner', interstitial: 'interstitial', rewarded: 'rewarded' } },
  },
  purchases: {},
  links: {},
};

export function getMobileStoreKey() {
  return 'android';
}
