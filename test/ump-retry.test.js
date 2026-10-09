import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../template/platform/ads/native-admob.js', import.meta.url), 'utf8');
const telemetry = readFileSync(new URL('../template/platform/consent-telemetry.js', import.meta.url), 'utf8');
const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
const flush = () => new Promise(resolve => setImmediate(resolve));
let sequence = 0;
const failure = (code, allowed = false) => ({ error: { code, data: { canRequestAds: allowed } } });
async function fixture({ platform = 'android', responses = [{ canRequestAds: true }], formError, analyticsFails = false } = {}) {
  const timers = new Map(), visibilityListeners = new Set(), sdkListeners = new Map();
  const f = { now: 0, requests: 0, forms: 0, initializes: 0, banners: 0, interstitials: 0, rewards: 0,
    owned: false, events: [], timers };
  let id = 0;
  f.setTimeout = (fn, delay) => { timers.set(++id, { fn, at: f.now + delay }); return id; };
  f.clearTimeout = id => timers.delete(id);
  f.document = { visibilityState: 'visible',
    addEventListener: (name, fn) => visibilityListeners.add(fn),
    removeEventListener: (name, fn) => visibilityListeners.delete(fn) };
  f.visibility = state => { f.document.visibilityState = state; for (const fn of [...visibilityListeners]) fn(); };
  f.visibilityListeners = visibilityListeners;
  f.advance = async ms => {
    const target = f.now + ms;
    for (;;) {
      const due = [...timers].sort((a,b) => a[1].at-b[1].at).find(([,t]) => t.at <= target);
      if (!due) break;
      const [key, t] = due; f.now = t.at; timers.delete(key); t.fn(); await flush();
    }
    f.now = target; await flush();
  };
  f.sdk = {
    initialize: async () => { f.initializes++; },
    requestConsentInfo: async () => {
      const result = responses[Math.min(f.requests++, responses.length - 1)];
      if (typeof result === 'function') return result();
      if (result.error) throw result.error;
      return result;
    },
    showConsentForm: async () => { f.forms++; if (formError) throw formError; return { canRequestAds: true }; },
    trackingAuthorizationStatus: async () => ({ status: 'authorized' }),
    addListener: async (name, fn) => { sdkListeners.set(name, fn); return { remove() {} }; },
    showBanner: async () => { f.banners++; }, hideBanner: async () => {}, removeBanner: async () => {},
  };
  f.platform = platform;
  f.analyticsFails = analyticsFails;
  globalThis.__umpRetry = f;
  const stub = url(`
    const f = globalThis.__umpRetry;
    export const FirebaseAnalytics = { logEvent: async event => { f.events.push(event); if (f.analyticsFails) throw Error('Firebase unavailable'); } };
    export const isNative = true; export const nativePlatform = f.platform;
    export const AdMob = f.sdk;
    export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
    export const BannerAdPluginEvents = { Loaded: 'loaded', FailedToLoad: 'failed' };
    export const BannerAdPosition = {}; export const BannerAdSize = {};
    export const InterstitialAdPluginEvents = {}; export const RewardAdPluginEvents = {};
    export const APP_CONFIG = { ads: { nativeTestMode: true, admob: { android: {}, ios: {} } } };
    export const getNativeKey = () => f.platform; export const debugLog = () => {};
    export const bindAdRevenueEvents = async () => {};
    export const createBannerTelemetry = () => ({ request() {}, loaded() {}, failed() {}, retryScheduled() {}, retryExhausted() {}, stop() {} });
    // ${++sequence}
  `);
  const telemetryUrl = url(telemetry.replace(/from '[^']+'/g, `from ${JSON.stringify(stub)}`));
  f.adapter = await import(url(`
    const f = globalThis.__umpRetry;
    const window = { addEventListener() {} };
    const document = f.document, performance = { now: () => f.now };
    const setTimeout = f.setTimeout, clearTimeout = f.clearTimeout;
    const console = { warn() {} };
    ${source.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === '../consent-telemetry.js' ? telemetryUrl : stub)}`)}
    // ${sequence}
  `));
  delete globalThis.__umpRetry;
  f.deps = { interstitial: {}, rewarded: {}, isAdsRemoved: () => f.owned,
    preloadInterstitial: () => f.interstitials++, preloadRewarded: () => f.rewards++ };
  f.init = () => f.adapter.init(f.deps);
  return f;
}
for (const [platform, code] of [['android',2],['android','4'],['ios',3]]) {
  test(`${platform} transient ${code}: 5/15 seconds, one SDK init, one set of ad loads`, async () => {
    const f = await fixture({ platform, responses: [failure(code), failure(code), { canRequestAds: true }] });
    const pending = f.init(); assert.equal(f.init(), pending); await flush();
    assert.equal(f.requests, 1); assert.equal(f.banners, 0);
    await f.advance(4999); assert.equal(f.requests, 1);
    await f.advance(1); assert.equal(f.requests, 2);
    await f.advance(14999); assert.equal(f.requests, 2);
    await f.advance(1); assert.equal(await pending, true);
    await f.init(); await flush();
    assert.equal(f.requests, 3); assert.equal(f.initializes, 1);
    assert.equal(f.banners, 1); assert.equal(f.interstitials, 1); assert.equal(f.rewards, 1);
    const attempts = f.events.filter(e => e.name === 'bs_consent_attempt');
    assert.deepEqual(attempts.map(e => e.params.attempt), [1,2,3]);
    assert.deepEqual(attempts.map(e => e.params.will_retry), [1,1,0]);
    assert.equal(f.events.filter(e => e.name === 'bs_consent_start').length, 1);
    assert.equal(f.events.filter(e => e.name === 'bs_consent_complete').length, 1);
    assert.equal(f.events.find(e => e.name === 'bs_consent_complete').params.attempt_count, 3);
    assert.equal(f.timers.size, 0);
  });
}
test('persistent network error stops at three attempts and never starts ads', async () => {
  const f = await fixture({ responses: [failure('2')] }); const pending = f.init(); await flush();
  await f.advance(5000); await f.advance(15000);
  assert.equal(await pending, false); assert.equal(f.requests, 3); assert.equal(f.banners + f.rewards, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.visibilityListeners.size, 0);
  assert.equal(f.events.filter(e => e.name === 'bs_consent_error').length, 1);
  assert.equal(f.events.at(-1).params.attempt_count, 3);
});
test('background pauses remaining delay without consuming a retry', async () => {
  const f = await fixture({ responses: [failure(2), { canRequestAds: false }] }); const pending = f.init(); await flush();
  await f.advance(2000); f.visibility('hidden'); await f.advance(60000);
  assert.equal(f.requests, 1); assert.equal(f.timers.size, 0);
  f.visibility('visible'); f.visibility('visible');
  await f.advance(2999); assert.equal(f.requests, 1);
  await f.advance(1); assert.equal(await pending, false); assert.equal(f.requests, 2);
  assert.equal(f.visibilityListeners.size, 0);
});
test('network failure while hidden schedules nothing until foreground', async () => {
  const f = await fixture({ responses: [failure(2), { canRequestAds: false }] });
  f.visibility('hidden'); const pending = f.init(); await flush();
  assert.equal(f.timers.size, 0); f.visibility('visible'); await f.advance(5000);
  assert.equal(await pending, false); assert.equal(f.requests, 2);
});
test('SDK eligibility true bypasses retries; successful ineligible response is never retried', async () => {
  for (const response of [failure(2, true), { canRequestAds: false }]) {
    const f = await fixture({ responses: [response] });
    assert.equal(await f.init(), !!response.error); await flush();
    assert.equal(f.requests, 1); assert.equal(f.timers.size, 0);
  }
});
test('invalid/unknown errors and platform-mismatched numeric codes never retry', async () => {
  for (const [platform, code] of [['ios',2],['ios',4],['ios',1],['android',3],['android',1],['android',undefined],['android','network']]) {
    const f = await fixture({ platform, responses: [failure(code)] });
    assert.equal(await f.init(), false); assert.equal(f.requests, 1); assert.equal(f.timers.size, 0);
  }
});
test('required form after recovery appears once; form errors never trigger retries', async () => {
  for (const formError of [undefined, { code: 2 }]) {
    const f = await fixture({ responses: [failure(2), { status: 'REQUIRED', isConsentFormAvailable: true }], formError });
    const pending = f.init(); await flush(); await f.advance(5000);
    assert.equal(await pending, !formError); assert.equal(f.forms, 1); assert.equal(f.requests, 2);
    assert.equal(f.timers.size, 0);
  }
});
test('response arriving in background cannot open required form until foreground', async () => {
  let resolveInfo;
  const f = await fixture({ responses: [() => new Promise(resolve => { resolveInfo = resolve; })] });
  const pending = f.init(); await flush(); f.visibility('hidden');
  resolveInfo({ status: 'REQUIRED', isConsentFormAvailable: true }); await flush();
  assert.equal(f.forms, 0); f.visibility('visible'); assert.equal(await pending, true);
  assert.equal(f.forms, 1);
});
test('Remove Ads acquired during retry prevents banner/interstitial, preserves rewarded', async () => {
  const f = await fixture({ responses: [failure(2), { canRequestAds: true }] });
  const pending = f.init(); await flush(); f.owned = true; await f.advance(5000);
  assert.equal(await pending, true); assert.equal(f.banners, 0); assert.equal(f.interstitials, 0); assert.equal(f.rewards, 1);
});

test('failed Analytics delivery cannot stop consent retry or successful ad initialization', async () => {
  const f = await fixture({ analyticsFails: true, responses: [failure(2), { canRequestAds: true }] });
  const pending = f.init(); await flush(); await f.advance(5000);
  assert.equal(await pending, true); assert.equal(f.requests, 2); assert.equal(f.banners, 1);
  assert.equal(f.interstitials, 1); assert.equal(f.rewards, 1);
});

test('exhausted network flow recovers after a signal, honors cooldown and reuses SDK/listeners', async () => {
  const f = await fixture({ responses: [failure(2), failure(2), failure(2), { canRequestAds: true }] });
  const first = f.init(); await flush(); await f.advance(5000); await f.advance(15000);
  assert.equal(await first, false);
  assert.equal(f.adapter.canRetryInitialization(), true);
  const retry = f.init(); assert.equal(f.init(), retry); await flush();
  await f.advance(29999); assert.equal(f.requests, 3);
  await f.advance(1); assert.equal(await retry, true);
  assert.equal(f.initializes, 1); assert.equal(f.banners, 1); assert.equal(f.rewards, 1);
  assert.equal(f.adapter.canRetryInitialization(), false);
  assert.equal(f.events.filter(e => e.name === 'bs_consent_start').length, 2);
  assert.equal(f.events.filter(e => e.name === 'bs_consent_error').length, 1);
  assert.equal(f.events.filter(e => e.name === 'bs_consent_complete').length, 1);
});

test('a successful ineligible decision is cached and cannot be retried as a network failure', async () => {
  const f = await fixture({ responses: [{ canRequestAds: false }, { canRequestAds: true }] });
  assert.equal(await f.init(), false);
  assert.equal(f.adapter.canRetryInitialization(), false);
  await f.advance(60000); assert.equal(await f.init(), false);
  assert.equal(f.requests, 1); assert.equal(f.initializes, 1);
});

test('technical SDK failure can retry; Remove Ads restored during cooldown suppresses forced ads', async () => {
  const f = await fixture();
  f.sdk.initialize = async () => { if (++f.initializes === 1) throw Error('bridge unavailable'); };
  assert.equal(await f.init(), false);
  const retry = f.init(); await flush(); f.owned = true;
  await f.advance(30000); assert.equal(await retry, true);
  assert.equal(f.initializes, 2); assert.equal(f.banners, 0); assert.equal(f.interstitials, 0); assert.equal(f.rewards, 1);
});

test('required but unavailable form is retryable readiness, not a cached refusal', async () => {
  const f = await fixture({ responses: [{ status: 'REQUIRED', isConsentFormAvailable: false, canRequestAds: false }, { canRequestAds: true }] });
  assert.equal(await f.init(), false); assert.equal(f.adapter.canRetryInitialization(), true);
  const retry = f.init(); await flush(); await f.advance(30000);
  assert.equal(await retry, true); assert.equal(f.initializes, 1);
});
