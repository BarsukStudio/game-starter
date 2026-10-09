import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const gameSource = new URL('../src/js/platform/ads/native-admob.js', import.meta.url);
const source = readFileSync(existsSync(gameSource) ? gameSource :
  new URL('../template/platform/ads/native-admob.js', import.meta.url), 'utf8');
const moduleUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
let sequence = 0;
async function fixture(consent = async () => ({ canRequestAds: true })) {
  const timers = new Map(); const listeners = new Map();
  const f = { telemetry: [], timers, banners: 0, removed: false, preloads: 0, clock: 0 };
  const visibilityListeners = new Set();
  f.document = {
    visibilityState: 'visible',
    addEventListener: (event, callback) => { if (event === 'visibilitychange') visibilityListeners.add(callback); },
    removeEventListener: (event, callback) => { if (event === 'visibilitychange') visibilityListeners.delete(callback); },
  };
  f.visibility = (state) => {
    f.document.visibilityState = state;
    for (const callback of visibilityListeners) callback();
  };
  f.visibilityListeners = visibilityListeners;
  f.sdk = {
    initialize: async () => {}, requestConsentInfo: consent,
    trackingAuthorizationStatus: async () => ({ status: 'authorized' }),
    showBanner: async () => { f.banners++; },
    hideBanner: async () => {}, removeBanner: async () => {},
    addListener: async (event, callback) => { listeners.set(event, callback); return { remove() {} }; },
  };
  f.emit = (event, payload) => listeners.get(event)?.(payload);
  f.tick = async () => {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    return timer.ms;
  };
  globalThis.__adRecoveryFixture = f;
  const stub = moduleUrl(`
    const f = globalThis.__adRecoveryFixture;
    export const beginConsentTelemetry = () => () => {}; export const recordConsentAttempt = () => {};
    export const recordConsentSignalsError = () => {};
    export const createBannerTelemetry = () => ({ request() {}, loaded() {}, failed() {}, retryScheduled() {}, retryExhausted() {}, stop() {} });
    export const FirebaseAnalytics = { logEvent: async event => f.telemetry.push(event) };
    export const isNative = true; export const nativePlatform = 'android';
    export const AdMob = f.sdk;
    export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
    export const BannerAdPluginEvents = { Loaded: 'loaded', FailedToLoad: 'failed', SizeChanged: 'size' };
    export const BannerAdSize = { ADAPTIVE_BANNER: 'adaptive' };
    export const BannerAdPosition = { BOTTOM_CENTER: 'bottom' };
    export const InterstitialAdPluginEvents = { Showed: 'interstitialShown', Dismissed: 'interstitialDismissed', FailedToShow: 'interstitialFailed' }; export const RewardAdPluginEvents = { Showed: 'rewardedShown', Dismissed: 'rewardedDismissed', FailedToShow: 'rewardedFailed' };
    export const APP_CONFIG = { ads: { admob: { android: {} } } };
    export const getNativeKey = () => 'android'; export const debugLog = () => {};
    export const createNativeAdEvents = (events) => events;
    export { createRequestId } from '${new URL('../template/platform/request-id.js', import.meta.url).href}';
    export const bindAdRevenueEvents = async () => {};
    export const readConsentSignals = async () => ({ gdprApplies: false });
    export const showIosConsentForm = async () => { throw Error("unexpected iOS transport"); }; export const showIosPrivacyOptionsForm = async () => { throw Error("unexpected iOS transport"); };
    export const hasYandexConsent = () => true;
    // Each fixture gets its own SDK binding even when imports are cached.
    // ${++sequence}
  `);
  const telemetrySource = readFileSync(new URL('../template/platform/ads/banner-telemetry.js', import.meta.url), 'utf8');
  const telemetryUrl = moduleUrl(telemetrySource.replace(/from '([^']+)'/g, `from ${JSON.stringify(stub)}`));
  const rewritten = source.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === './banner-telemetry.js' ? telemetryUrl : stub)}`);
  f.adapter = await import(moduleUrl(`
    const f = globalThis.__adRecoveryFixture;
    const setTimeout = (fn, ms) => { const id = ++f.clock; f.timers.set(id, { fn, ms }); return id; };
    const window = { addEventListener() {} };
    const document = f.document;
    const clearTimeout = (id) => f.timers.delete(id);
    const console = { warn() {} };
    ${rewritten}
    // ${sequence}
  `));
  delete globalThis.__adRecoveryFixture;
  f.init = () => f.adapter.init({ interstitial: {}, rewarded: {},
    isAdsRemoved: () => f.removed,
    preloadInterstitial: () => f.preloads++, preloadRewarded: () => f.preloads++,
  });
  return f;
}

test('observed banner failures retry at 5/10/20 seconds, coalesce, and stop at the cap', async () => {
  const f = await fixture(); await f.init();
  for (const delay of [5000, 10000, 20000]) {
    f.emit('failed'); f.emit('failed');
    assert.equal(f.timers.size, 1);
    assert.equal(await f.tick(), delay);
  }
  f.emit('failed');
  assert.equal(f.banners, 4); assert.equal(f.timers.size, 0);
  f.visibility('hidden'); f.visibility('visible');
  assert.equal(f.timers.size, 1);
  const cooldown = await f.tick();
  assert.ok(cooldown > 29000 && cooldown <= 30000);
  assert.equal(f.banners, 5);
});
test('a loaded banner cancels retries and healthy visibility changes do not request again', async () => {
  const f = await fixture(); await f.init();
  f.emit('failed'); f.emit('loaded');
  f.visibility('hidden'); f.visibility('visible');
  assert.equal(f.timers.size, 0); assert.equal(f.banners, 1);
  f.emit('failed'); assert.equal(await f.tick(), 5000);
});
test('background pauses failed-banner retries; foreground schedules one retry', async () => {
  const f = await fixture(); await f.init(); f.emit('failed');
  f.visibility('hidden'); assert.equal(f.timers.size, 0);
  f.emit('failed'); assert.equal(f.timers.size, 0);
  f.visibility('visible'); f.visibility('visible');
  assert.equal(await f.tick(), 5000); assert.equal(f.banners, 2);
});
test('banner rejection does not block fullscreen and coalesces with its failure event', async () => {
  const f = await fixture();
  f.sdk.showBanner = async () => { f.banners++; throw Error('no fill'); };
  await f.init(); await new Promise(resolve => setImmediate(resolve));
  f.emit('failed'); assert.equal(f.preloads, 2); assert.equal(f.timers.size, 1);
  assert.equal(await f.tick(), 5000); assert.equal(f.banners, 2);
});
test('late banner rejection after removal cannot schedule recovery', async () => {
  const f = await fixture(); let reject;
  f.sdk.showBanner = () => { f.banners++; return new Promise((_, r) => { reject = r; }); };
  await f.init(); await f.adapter.removeBanner(); reject(Error('late'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.timers.size, 0); assert.equal(f.banners, 1);
});
test('Remove Ads acquired during retry delay prevents a new request', async () => {
  const f = await fixture(); await f.init(); f.emit('failed'); f.removed = true;
  await f.tick(); assert.equal(f.banners, 1); assert.equal(f.timers.size, 0);
});

test('a pending banner promise never blocks fullscreen setup', async () => {
  const f = await fixture();
  f.sdk.showBanner = () => { f.banners++; return new Promise(() => {}); };
  assert.equal(await f.init(), true);
  assert.equal(f.banners, 1);
  assert.equal(f.preloads, 2);
  assert.equal(f.adapter.isRewardedReady(), true);
  assert.equal(f.timers.size, 0);
});

test('ownership suppresses banners and interstitial preload while retaining rewarded', async () => {
  const f = await fixture(); f.removed = true;
  assert.equal(await f.init(), true); assert.equal(f.banners, 0); assert.equal(f.preloads, 1);
});

test('ownership acquired during consent is respected', async () => {
  const f = await fixture(async () => { f.removed = true; return { canRequestAds: true }; });
  await f.init(); assert.equal(f.banners, 0); assert.equal(f.preloads, 1);
});

test('hide and remove do not recreate a failed banner', async () => {
  for (const method of ['hideBanner', 'removeBanner']) {
    const f = await fixture(); await f.init(); await f.adapter[method]();
    f.emit('failed'); f.visibility('hidden'); f.visibility('visible');
    assert.equal(f.banners, 1); assert.equal(f.timers.size, 0);
  }
});

test('only explicit native SDK eligibility recovers a consent error', async () => {
  for (const value of [true, false, undefined, 'true']) {
    const f = await fixture(async () => { throw Object.assign(new Error('UMP unavailable'), { data: { canRequestAds: value } }); });
    assert.equal(await f.init(), value === true); assert.equal(f.banners, value === true ? 1 : 0); assert.equal(f.preloads, value === true ? 2 : 0);
  }
});

test('consent success requires explicit permission and form failures disable ads', async () => {
  for (const value of [true, false, undefined]) {
    const f = await fixture(async () => ({ canRequestAds: value }));
    assert.equal(await f.init(), value === true);
    assert.equal(f.banners, value === true ? 1 : 0);
  }
  const f = await fixture(async () => ({ status: 'REQUIRED', isConsentFormAvailable: true }));
  f.sdk.showConsentForm = async () => { throw new Error('form unavailable'); };
  assert.equal(await f.init(), false); assert.equal(f.banners, 0);
});

// Exercise the actual transport wiring, not only the isolated telemetry helper.
test('banner recovery reports real requests, one error per attempt and the exhausted budget', async () => {
  const f = await fixture(); await f.init();
  for (const delay of [5000, 10000, 20000]) {
    f.emit('failed', { code: 2 }); f.emit('failed', { code: 2 });
    assert.equal(await f.tick(), delay);
  }
  f.emit('failed', { code: 3 }); f.emit('failed', { code: 3 });
  await new Promise(resolve => setImmediate(resolve));
  const count = name => f.telemetry.filter(e => e.name === name).length;
  assert.equal(count('bs_banner_request'), 4);
  assert.equal(count('bs_banner_error'), 4);
  assert.equal(count('bs_banner_retry'), 3);
  assert.equal(count('bs_banner_retry_exhausted'), 1);
  f.adapter.hideBanner(); const before = f.telemetry.length;
  f.emit('loaded'); f.emit('failed', { code: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.telemetry.length, before);
});


for (const format of ['interstitial', 'rewarded']) {
  test(`AdMob ${format} reserves both formats until native termination even after JS timeout`, async () => {
    const f = await fixture();
    let current = true, calls = 0;
    const lifecycle = { captureShow: () => ({ isCurrent: () => current, showStarted() {}, showClosed() {}, showFailed() {}, rewardEarned() {} }) };
    f.sdk.showInterstitial = () => { calls++; return new Promise(() => {}); };
    f.sdk.showRewardVideoAd = f.sdk.showInterstitial;
    await f.adapter.init({ interstitial: lifecycle, rewarded: lifecycle,
      isAdsRemoved: () => false, preloadInterstitial() {}, preloadRewarded() {} });
    void f.adapter[format === 'interstitial' ? 'showInterstitial' : 'showRewarded']();
    for (const stillCurrent of [true, false]) {
      current = stillCurrent;
      await assert.rejects(f.adapter.showInterstitial(), /has not settled/);
      await assert.rejects(f.adapter.showRewarded(), /has not settled/);
      assert.equal(calls, 1);
    }
    f.emit(`${format}Dismissed`);
    current = true;
    assert.equal(await f.adapter.showRewarded(), true);
    assert.equal(calls, 2);
    f.emit('rewardedDismissed');
  });
}
