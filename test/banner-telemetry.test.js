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
async function yandexFixture({ showBanner } = {}) {
  const f = fixture(); const listeners = new Map(); const timers = new Map();
  const windowListeners = new Map(); const visibilityListeners = new Set();
  Object.assign(f, { listeners, timers, banners: 0, removed: false, clock: 0 });
  f.document = {
    visibilityState: 'visible',
    addEventListener: (event, callback) => { if (event === 'visibilitychange') visibilityListeners.add(callback); },
  };
  f.window = { addEventListener: (event, callback) => windowListeners.set(event, callback) };
  f.visibility = (state) => {
    f.document.visibilityState = state;
    for (const callback of visibilityListeners) callback();
  };
  f.online = () => windowListeners.get('online')?.();
  f.tick = async () => {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); timer.fn(); await flush();
    return timer.ms;
  };
  f.sdk = {
    resetAds: async () => {}, initialize: async () => {}, setUserConsent: async () => {}, removeBanner: async () => {},
    addListener: async (name, handler) => { listeners.set(name, handler); return { remove() {} }; },
    showBanner: async () => { f.banners++; return showBanner(f); },
  };
  globalThis.__bannerAdapterFixture = f;
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
  f.adapter = await import(url(`
    const f = globalThis.__bannerAdapterFixture;
    const setTimeout = (fn, ms) => { const id = ++f.clock; f.timers.set(id, { fn, ms }); return id; };
    const clearTimeout = (id) => f.timers.delete(id);
    const document = f.document; const window = f.window;
    const console = { warn() {} };
  ` + adapterSource
    .replace(/from '[^']+'/g, `from ${JSON.stringify(stub)}`)
    .replace("import('capacitor-plugin-yandex-ads')", `import(${JSON.stringify(stub)})`)));
  delete globalThis.__bannerAdapterFixture;
  f.init = async () => {
    const ready = await f.adapter.init({ interstitial: {}, rewarded: {}, isAdsRemoved: () => f.removed,
      preloadInterstitial() {}, preloadRewarded() {} });
    await flush();
    return ready;
  };
  return f;
}
const adapterSource = fs.readFileSync(new URL('../template/platform/ads/native-yandex.js', import.meta.url), 'utf8');
const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
// The plugin emits the callback before rejecting the load call.
const failLoad = (f) => {
  f.listeners.get('bannerFailedToLoad')({ code: 2 });
  throw Object.assign(Error('network'), { code: 2 });
};

test('Yandex adapter wires success and deduplicates callback plus bridge failure', async () => {
  for (const fails of [false, true]) {
    const f = await yandexFixture({ showBanner: fails ? failLoad : (fx) => fx.listeners.get('bannerLoaded')() });
    await f.init();
    assert.deepEqual(f.events.map(e => e.name).slice(0, 2), ['bs_banner_request', fails ? 'bs_banner_error' : 'bs_banner_loaded']);
    f.adapter.hideBanner(); const before = f.events.length;
    f.listeners.get('bannerLoaded')();
    f.listeners.get('bannerFailedToLoad')({ code: 2 }); await flush();
    assert.equal(f.events.length, before);
    assert.equal(f.timers.size, 0);
  }
});

test('Yandex failed first load retries at 5/10/20 s, then once per signal after the cooldown', async () => {
  const f = await yandexFixture({ showBanner: failLoad });
  await f.init();
  for (const delay of [5000, 10000, 20000]) assert.equal(await f.tick(), delay);
  assert.equal(f.banners, 4); assert.equal(f.timers.size, 0);
  const count = name => f.events.filter(e => e.name === name).length;
  assert.equal(count('bs_banner_request'), 4);
  assert.equal(count('bs_banner_error'), 4);
  assert.equal(count('bs_banner_retry'), 3);
  assert.equal(count('bs_banner_retry_exhausted'), 1);
  f.online(); f.online();
  assert.equal(f.timers.size, 1);
  const cooldown = await f.tick();
  assert.ok(cooldown > 29000 && cooldown <= 30000);
  assert.equal(f.banners, 5);
});

test('Yandex network return reloads the failed banner once and a load ends recovery', async () => {
  let offline = true;
  const f = await yandexFixture({ showBanner: (fx) => offline ? failLoad(fx) : fx.listeners.get('bannerLoaded')() });
  await f.init();
  assert.equal(f.timers.size, 1);
  offline = false;
  assert.equal(await f.tick(), 5000);
  assert.equal(f.banners, 2); assert.equal(f.timers.size, 0);
  f.visibility('hidden'); f.visibility('visible'); f.online();
  assert.equal(f.timers.size, 0);
  // A refresh failure of a loaded banner stays with the SDK.
  f.listeners.get('bannerFailedToLoad')({ code: 2 });
  assert.equal(f.timers.size, 0); assert.equal(f.banners, 2);
});

test('Yandex background pauses retries; foreground schedules one retry', async () => {
  const f = await yandexFixture({ showBanner: failLoad });
  await f.init();
  f.visibility('hidden');
  assert.equal(f.timers.size, 0);
  f.visibility('visible'); f.visibility('visible');
  assert.equal(await f.tick(), 5000); assert.equal(f.banners, 2);
});

test('Yandex SDK reload of a failed view cancels the pending retry', async () => {
  const f = await yandexFixture({ showBanner: failLoad });
  await f.init();
  f.listeners.get('bannerLoaded')();
  assert.equal(f.timers.size, 0);
  f.online(); assert.equal(f.timers.size, 0); assert.equal(f.banners, 1);
});

test('Yandex removal, privacy reset and late rejections stop recovery', async () => {
  for (const stop of ['hideBanner', 'resetAdsForPrivacy', 'removeBannerIfAvailable', 'owner']) {
    let reject;
    const f = await yandexFixture({ showBanner: () => new Promise((_, r) => { reject = r; }) });
    await f.init();
    if (stop === 'owner') f.removed = true; else await f.adapter[stop]();
    reject(Object.assign(Error('removed'), { code: 'BANNER_REMOVED' })); await flush();
    // An owner's rejection is still current, but ownership blocks every retry.
    f.online(); f.visibility('visible');
    assert.equal(f.timers.size, 0, stop); assert.equal(f.banners, 1, stop);
  }
});

test('Yandex ownership acquired during a load removes the banner without recovery', async () => {
  let removed = 0;
  const f = await yandexFixture({ showBanner: (fx) => { fx.removed = true; } });
  f.sdk.removeBanner = async () => { removed++; };
  await f.init();
  assert.equal(removed, 1); assert.equal(f.timers.size, 0);
  f.online(); assert.equal(f.timers.size, 0);
});
