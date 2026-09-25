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
    export const readConsentSignals = async () => ({ gdprApplies: false });
    export const showIosConsentForm = async () => { throw Error('unexpected iOS transport'); };
    export const showIosPrivacyOptionsForm = async () => { throw Error('unexpected iOS transport'); };
    export const hasYandexConsent = () => true;
    // Each fixture gets its own SDK binding even when imports are cached.
    // ${++sequence}
  `);
  const rewritten = source.replace(/from '([^']+)'/g, `from ${JSON.stringify(stub)}`);
  f.adapter = await import(moduleUrl(`
    const f = globalThis.__adRecoveryFixture;
    const setTimeout = (fn, ms) => { const id = ++f.clock; f.timers.set(id, { fn, ms }); return id; };
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

test('banner failures and visibility changes never trigger application retries', async () => {
  const f = await fixture(); assert.equal(await f.init(), true);
  for (let i = 0; i < 10; i++) {
    f.emit('failed', { code: 3 }); f.visibility('hidden'); f.visibility('visible');
  }
  assert.equal(f.banners, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.visibilityListeners.size, 0);
});

test('banner rejection does not block fullscreen setup or start a retry', async () => {
  const f = await fixture();
  f.sdk.showBanner = async () => { f.banners++; throw new Error('no fill'); };
  assert.equal(await f.init(), true);
  assert.equal(f.banners, 1); assert.equal(f.preloads, 2); assert.equal(f.timers.size, 0);
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

test('stock consent errors disable ads without relying on patched error data', async () => {
  for (const value of [true, false, undefined, 'true']) {
    const f = await fixture(async () => { throw Object.assign(new Error('UMP unavailable'), { data: { canRequestAds: value } }); });
    assert.equal(await f.init(), false); assert.equal(f.banners, 0); assert.equal(f.preloads, 0);
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
