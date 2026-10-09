import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const clean = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const read = file => fs.readFileSync(new URL(`../src/js/platform/ads/${file}.js`, import.meta.url), 'utf8');
for (const platform of ['android', 'ios']) for (const provider of ['admob', 'yandex']) {
  test(`${platform} ${provider}: actual adapter SDK bindings reach the actual collector for all formats`, async () => {
    const listeners = new Map(), logged = [];
    const sdk = {
      resetAds: async () => {}, initialize: async () => {}, setUserConsent: async () => {},
      requestConsentInfo: async () => ({ canRequestAds: true }),
      trackingAuthorizationStatus: async () => ({ status: 'denied' }),
      addListener: async (name, callback) => {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
        return { remove() {} };
      },
    };
    const common = { isNative: true, nativePlatform: platform, crypto: { randomUUID }, console,
      FirebaseAnalytics: { logEvent: async event => logged.push(event) } };
    const collector = vm.createContext(common);
    const idSource = fs.readFileSync(new URL('../src/js/platform/request-id.js', import.meta.url), 'utf8');
    vm.runInContext(clean(idSource), collector);
    vm.runInContext(clean(read('ad-revenue')), collector);
    const events = prefix => ({ AdImpression: `${prefix}Paid`, AdPaid: `${prefix}Paid`, Showed: `${prefix}Showed`, FailedToShow: `${prefix}Failed`, Dismissed: `${prefix}Dismissed` });
    const adapter = vm.createContext({ ...common, sdk, AdMob: sdk,
      bindAdRevenueEvents: collector.bindAdRevenueEvents,
      APP_CONFIG: { ads: { nativeTestMode: false, admob: { [platform]: {}, testingDevices: [] }, yandex: { [platform]: {} } } },
      getNativeKey: () => platform, debugLog() {},
      createBannerTelemetry: () => ({ stop() {} }),
      beginConsentTelemetry: () => () => {}, recordConsentAttempt() {},
      readConsentSignals: async () => ({}), hasYandexConsent: () => false,
      prepareNativeConsent: async () => ({ canRequestAds: true, yandexConsent: false }),
      requestIosTrackingAuthorization: async () => {}, createNativeAdEvents: x => x,
      AdmobConsentStatus: { REQUIRED: 'REQUIRED' },
      BannerAdPluginEvents: events('banner'), InterstitialAdPluginEvents: events('interstitial'), RewardAdPluginEvents: events('rewarded'),
      BannerAdSize: {}, BannerAdPosition: {},
      document: { visibilityState: 'visible' },
    });
    vm.runInContext(clean(read(`native-${provider}`)).replace(/import\('capacitor-plugin-yandex-ads'\)/, 'Promise.resolve({ YandexAds: sdk })'), adapter);
    assert.equal(await adapter.init({ isAdsRemoved: () => true, preloadInterstitial() {}, preloadRewarded() {}, interstitial: {}, rewarded: {} }), true);
    for (const format of ['banner', 'interstitial', 'rewarded']) {
      const name = provider === 'admob' ? `${format}Paid` : `${format}Impression`;
      assert.equal(listeners.get(name)?.length, 1, `missing or duplicate ${name} binding`);
      const payload = provider === 'admob' ? { valueMicros: 10000, currencyCode: 'USD', precision: 1 }
        : { impressionData: JSON.stringify({ revenue: '0.01', currency: 'USD', precision: 'estimated' }) };
      listeners.get(name)[0](payload);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(logged.length, 3);
    assert.deepEqual(logged.map(x => x.params.ad_format).sort(), ['banner', 'interstitial', 'rewarded']);
    for (const event of logged) {
      assert.equal(event.name, 'bs_ad_revenue');
      assert.equal(event.params.ad_provider, provider);
      assert.equal(event.params.revenue_amount, 0.01);
      assert.equal(event.params.test_ads, 0);
    }
  });
}
