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
  const f = { timers, banners: 0, removed: false, preloads: 0, clock: 0 };
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
    await Promise.resolve(); await Promise.resolve();
    return timer.ms;
  };
  globalThis.__adRecoveryFixture = f;
  const stub = moduleUrl(`
    const f = globalThis.__adRecoveryFixture;
    export const AdMob = f.sdk;
    export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
    export const BannerAdPluginEvents = { Loaded: 'loaded', FailedToLoad: 'failed', SizeChanged: 'size' };
    export const BannerAdSize = { ADAPTIVE_BANNER: 'adaptive' };
    export const BannerAdPosition = { BOTTOM_CENTER: 'bottom' };
    export const InterstitialAdPluginEvents = {}; export const RewardAdPluginEvents = {};
    export const APP_CONFIG = { ads: { admob: { android: {} } } };
    export const getNativeKey = () => 'android'; export const debugLog = () => {};
    export const createNativeAdEvents = (events) => events;
    // Each fixture gets its own SDK binding even when imports are cached.
    // ${++sequence}
  `);
  const rewritten = source.replace(/from '([^']+)'/g, `from ${JSON.stringify(stub)}`);
  f.adapter = await import(moduleUrl(`
    const f = globalThis.__adRecoveryFixture;
    const setTimeout = (fn, ms) => { const id = ++f.clock; f.timers.set(id, { fn, ms }); return id; };
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

test('banner failure retries once, backs off to 64s, and a load resets recovery', async () => {
  const f = await fixture(); await f.init(); assert.equal(f.banners, 1);
  for (const delay of [2000, 4000, 8000, 16000, 32000, 64000, 64000]) {
    f.emit('failed', new Error('no fill')); f.emit('failed', new Error('duplicate'));
    assert.equal(await f.tick(), delay);
  }
  assert.equal(f.banners, 8);
  f.emit('failed'); f.emit('loaded'); assert.equal(f.timers.size, 0);
  f.emit('failed'); assert.equal(await f.tick(), 2000);
});

test('banner bridge rejection also retries without stopping fullscreen preloads', async () => {
  const f = await fixture();
  f.sdk.showBanner = async () => { f.banners++; throw new Error('bridge failed'); };
  assert.equal(await f.init(), true); assert.equal(f.preloads, 2);
  f.emit('failed'); assert.equal(await f.tick(), 2000);
  assert.equal(f.banners, 2); assert.equal(f.timers.size, 1);
  await f.adapter.removeBanner(); assert.equal(f.timers.size, 0);
});

test('hide/remove cancel banner retries and ignore late failures', async () => {
  for (const method of ['hideBanner', 'removeBanner']) {
    const f = await fixture(); await f.init(); f.emit('failed');
    await f.adapter[method](); f.emit('failed');
    assert.equal(f.timers.size, 0); assert.equal(f.banners, 1);
  }
});

test('ownership blocks a queued banner retry and initial banner creation', async () => {
  const f = await fixture(); await f.init(); f.emit('failed'); f.removed = true;
  await f.tick(); assert.equal(f.banners, 1); assert.equal(f.timers.size, 0);
  const owner = await fixture(); owner.removed = true; await owner.init();
  assert.equal(owner.banners, 0);
});

test('provider teardown during a pending banner call blocks its late rejection', async () => {
  const f = await fixture(); let reject;
  f.sdk.showBanner = () => new Promise((_, fail) => { reject = fail; });
  const init = f.init();
  for (let i = 0; !reject && i < 20; i++) await Promise.resolve();
  assert.ok(reject); await f.adapter.removeBanner(); reject(new Error('late failure'));
  await init; assert.equal(f.timers.size, 0);
});

test('consent errors permit ads only with an explicit native UMP true', async () => {
  for (const value of [true, false, undefined, 'true']) {
    const f = await fixture(async () => { throw Object.assign(new Error('UMP unavailable'), { data: { canRequestAds: value } }); });
    assert.equal(await f.init(), value === true);
    assert.equal(f.banners, value === true ? 1 : 0);
    assert.equal(f.preloads, value === true ? 2 : 0);
  }
});

test('consent success without permission stays disabled; form errors use current native permission', async () => {
  const denied = await fixture(async () => ({ canRequestAds: false }));
  assert.equal(await denied.init(), false); assert.equal(denied.banners, 0);
  for (const value of [true, false]) {
    const f = await fixture(async () => ({ status: 'REQUIRED', isConsentFormAvailable: true }));
    f.sdk.showConsentForm = async () => { throw Object.assign(new Error('form unavailable'), { data: { canRequestAds: value } }); };
    assert.equal(await f.init(), value); assert.equal(f.banners, value ? 1 : 0);
  }
});
