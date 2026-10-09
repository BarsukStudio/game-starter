import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('../template/platform/ads/banner-telemetry.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ native = true, platform = 'android', reject = false, brokenRandom = false } = {}) {
  const events = [];
  const context = {
    isNative: native, nativePlatform: platform, crypto: { randomUUID: brokenRandom ? () => { throw Error('unavailable'); } : randomUUID },
    FirebaseAnalytics: { logEvent(event) { events.push(event); if (reject) throw Error('offline'); } },
  };
  const idSource = fs.readFileSync(new URL('../template/platform/request-id.js', import.meta.url), 'utf8');
  vm.runInNewContext(idSource.replace(/^export /gm, ''), context);
  vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return { events, create: context.createBannerTelemetry };
}

test('each recovery request has an ID; duplicate SDK/rejection failures coalesce', async () => {
  const f = fixture(); const t = f.create('admob', true);
  t.request(); t.failed({ code: 2, message: 'private details' }, 'sdk_callback');
  t.failed({ code: 2 }, 'bridge_rejection'); t.retryScheduled(1, 5000);
  t.request(1); t.loaded(); t.loaded();
  await flush();
  assert.deepEqual(f.events.map(e => e.name), ['bs_banner_request', 'bs_banner_error', 'bs_banner_retry', 'bs_banner_request', 'bs_banner_loaded']);
  assert.equal(f.events[0].params.banner_request_id, f.events[1].params.banner_request_id);
  assert.notEqual(f.events[0].params.banner_request_id, f.events[3].params.banner_request_id);
  assert.equal(f.events[1].params.error_code, '2');
  assert.equal(f.events[2].params.delay_ms, 5000);
  assert.equal(f.events[4].params.retry_count, 1);
  assert.equal(f.events[4].params.test_ads, 1);
  assert.ok(!JSON.stringify(f.events).includes('private details'));
});
test('SDK refresh failure is separate from app request; cap emits once; stopped callbacks ignored', async () => {
  const f = fixture(); const t = f.create('admob', false);
  t.request(); t.loaded(); t.failed({ code: 'long secret message' }, 'sdk_callback');
  t.retryExhausted(); t.retryExhausted(); t.stop(); t.loaded(); t.failed({}, 'sdk_callback');
  await flush();
  const failure = f.events.find(e => e.name === 'bs_banner_error').params;
  assert.equal(failure.load_scope, 'sdk_refresh');
  assert.equal(failure.banner_request_id, undefined);
  assert.equal(failure.error_code, 'unknown');
  assert.equal(f.events.filter(e => e.name === 'bs_banner_retry_exhausted').length, 1);
  assert.equal(f.events.length, 4);
});
test('iOS/Yandex uses same diagnostic schema, web makes no Firebase calls', async () => {
  for (const native of [false, true]) {
    const f = fixture({ native, platform: 'ios' }); const t = f.create('yandex', false);
    t.request(); t.failed({ code: 'ADS_RESET' }, 'bridge_rejection'); await flush();
    assert.equal(f.events.length, native ? 2 : 0);
    if (native) {
      assert.equal(f.events[1].params.native_platform, 'ios');
      assert.equal(f.events[1].params.ad_provider, 'yandex');
      assert.equal(f.events[1].params.error_code, 'ADS_RESET');
    }
  }
});
test('Firebase rejection is consumed and not retried', async () => {
  const f = fixture({ reject: true }); const t = f.create('admob', true);
  t.request(); t.loaded(); await flush();
  assert.equal(f.events.length, 2);
});

test('observation ID failure cannot block advertising or mislabel an app request', async () => {
  const f = fixture({ brokenRandom: true }); const t = f.create('admob', true);
  assert.doesNotThrow(() => { t.request(); t.loaded(); }); await flush();
  assert.equal(f.events.length, 2);
  assert.equal(f.events[0].params.load_scope, 'app_request');
  assert.equal(f.events[0].params.banner_request_id, undefined);
});

let adapterSequence = 0;
test('Yandex adapter wires success and deduplicates callback plus bridge failure', async () => {
  const adapterSource = fs.readFileSync(new URL('../template/platform/ads/native-yandex.js', import.meta.url), 'utf8');
  const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
  for (const fails of [false, true]) {
    const f = fixture(); const listeners = new Map();
    const sdk = {
      resetAds: async () => {}, initialize: async () => {}, setUserConsent: async () => {}, removeBanner: async () => {},
      addListener: async (name, handler) => { listeners.set(name, handler); return { remove() {} }; },
      showBanner: async () => {
        if (fails) {
          listeners.get('bannerFailedToLoad')({ code: 2 });
          throw Object.assign(Error('network'), { code: 2 });
        }
        listeners.get('bannerLoaded')();
      },
    };
    globalThis.__bannerAdapterFixture = { sdk, create: f.create };
    const stub = url(`
      const f = globalThis.__bannerAdapterFixture;
      export const YandexAds = f.sdk;
      export const createBannerTelemetry = f.create;
      export const createNativeAdEvents = x => x;
    export { createRequestId } from '${new URL('../template/platform/request-id.js', import.meta.url).href}';
      export const debugLog = () => {};
      export const APP_CONFIG = { ads: { nativeTestMode: true, yandex: { test: {} } } };
      export const getNativeKey = () => 'android';
      export const requestIosTrackingAuthorization = async () => {};
      export const waitForConsentRetry = async () => {};
      export const bindAdRevenueEvents = async () => {};
      // ${++adapterSequence}
    `);
    const adapter = await import(url(`const console = { warn() {} };\n` + adapterSource
      .replace(/from '[^']+'/g, `from ${JSON.stringify(stub)}`)
      .replace("import('capacitor-plugin-yandex-ads')", `import(${JSON.stringify(stub)})`)));
    delete globalThis.__bannerAdapterFixture;
    await adapter.init({ interstitial: {}, rewarded: {}, isAdsRemoved: () => false,
      preloadInterstitial() {}, preloadRewarded() {} });
    await flush();
    assert.deepEqual(f.events.map(e => e.name), ['bs_banner_request', fails ? 'bs_banner_error' : 'bs_banner_loaded']);
    adapter.hideBanner(); listeners.get('bannerLoaded')();
    listeners.get('bannerFailedToLoad')({ code: 2 }); await flush();
    assert.equal(f.events.length, 2);
  }
});
