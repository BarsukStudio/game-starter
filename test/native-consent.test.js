import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
const originalWarn = console.warn;
before(() => { console.warn = () => {}; });
after(() => { console.warn = originalWarn; });
import vm from 'node:vm';

const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
const signalsSource = readFileSync(new URL('../template/platform/consent-signals.js', import.meta.url), 'utf8');
const policySource = signalsSource.slice(signalsSource.indexOf('export function hasYandexConsent'));
const { hasYandexConsent } = await import(url(policySource));

for (const [name, signals, expected] of [
  ['outside GDPR', { gdprApplies: false }, true],
  ['unknown region', {}, false],
  ['unknown region with stale consent', { additionalConsent: '2~1033', purposeConsents: '1' }, false],
  ['ACv2 consent', { gdprApplies: true, additionalConsent: '2~42.1033~dv.7', purposeConsents: '1' }, true],
  ['ACv1 consent', { gdprApplies: true, additionalConsent: '1~1033', purposeConsents: '1' }, true],
  ['disclosed only', { gdprApplies: true, additionalConsent: '2~~dv.1033', purposeConsents: '1' }, false],
  ['reject all', { gdprApplies: true, additionalConsent: '2~', purposeConsents: '0' }, false],
  ['storage refused', { gdprApplies: true, additionalConsent: '2~1033', purposeConsents: '0' }, false],
  ['wrong vendor', { gdprApplies: true, additionalConsent: '2~11033', purposeConsents: '1' }, false],
  ['unknown version', { gdprApplies: true, additionalConsent: '3~1033', purposeConsents: '1' }, false],
  ['missing choices', { gdprApplies: true }, false],
]) test(name, () => assert.equal(hasYandexConsent(signals), expected));

const admobSource = readFileSync(new URL('../template/platform/ads/native-admob.js', import.meta.url), 'utf8');
const yandexSource = readFileSync(new URL('../template/platform/ads/native-yandex.js', import.meta.url), 'utf8');
let sequence = 0;
async function fixture({ platform = 'ios', info = { canRequestAds: true, status: 'OBTAINED', privacyOptionsRequirementStatus: 'REQUIRED' }, signals = { gdprApplies: true, additionalConsent: '2~~dv.1033', purposeConsents: '0' }, umpError = false, formError = false, signalsError = false, attStatus = 'denied', attError = false, yandexError = false, initializeError = false } = {}) {
  const calls = [];
  let initialized = false;
  const completeForm = async () => { calls.push('form'); if (formError) throw Error('form failed'); return { ...info, status: 'OBTAINED', canRequestAds: true }; };
  const nativeConsent = {
    read: async () => { calls.push('signals'); if (signalsError) throw Error('no bridge'); return signals; },
    showConsentForm: completeForm,
    showPrivacyOptionsForm: async () => { calls.push('privacy'); },
  };
  const sdk = {
    requestConsentInfo: async () => { calls.push('ump'); if (umpError) throw Error('UMP failed'); return info; },
    showConsentForm: async () => { if (platform === 'ios' && !initialized) throw Error('No ViewController'); return completeForm(); },
    showPrivacyOptionsForm: async () => { if (platform === 'ios' && !initialized) throw Error('No ViewController'); calls.push('privacy'); },
    trackingAuthorizationStatus: async () => { calls.push('att'); if (attError) throw Error('ATT failed'); return { status: attStatus }; },
    requestTrackingAuthorization: async () => { calls.push('att-form'); return { status: 'denied' }; },
    initialize: async options => { calls.push(['initialize', options]); if (initializeError) throw Error('initialize failed'); initialized = true; },
    setUserConsent: async options => { calls.push(['yandex-consent', options.value]); },
    resetAds: async () => {}, addListener: async () => ({ remove() {} }), showBanner: async () => {},
  };
  const yandexSdk = { ...sdk, initialize: async options => {
    calls.push(['yandex-initialize', options]);
    if (yandexError) throw Error('Yandex unavailable');
  } };
  const timers = new Map(), visibilityListeners = new Set();
  let timerId = 0;
  const document = { visibilityState: 'visible',
    addEventListener: (_, fn) => visibilityListeners.add(fn),
    removeEventListener: (_, fn) => visibilityListeners.delete(fn),
  };
  const clock = { sdk, yandexSdk, nativeConsent, platform, clock: 0, document,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  globalThis.__consentFixture = clock;
  const stub = url(`
    const f = globalThis.__consentFixture;
    export const beginConsentTelemetry = () => () => {};
    export const recordConsentAttempt = () => {};
    export const createBannerTelemetry = () => ({ request() {}, loaded() {}, failed() {}, retryScheduled() {}, retryExhausted() {}, stop() {} });
    export const AdMob = f.sdk; export const YandexAds = f.yandexSdk;
    export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
    export const BannerAdPluginEvents = {}; export const InterstitialAdPluginEvents = {}; export const RewardAdPluginEvents = {};
    export const BannerAdSize = {}; export const BannerAdPosition = {};
    export const APP_CONFIG = { ads: { nativeTestMode: true, admob: { ios: {}, android: {} }, yandex: { test: {} } } };
    export const getNativeKey = () => f.platform; export const debugLog = () => {};
    export const createNativeAdEvents = x => x;
    export { createRequestId } from '${new URL('../template/platform/request-id.js', import.meta.url).href}';
    export const bindAdRevenueEvents = async () => {};
    export const registerPlugin = () => f.nativeConsent;
    // ${++sequence}
  `);
  const signalsUrl = url(signalsSource.replace("from '@capacitor/core'", `from ${JSON.stringify(stub)}`));
  const environment = `const fixture = globalThis.__consentFixture;
    const document = fixture.document;
    const performance = { now: () => fixture.clock };
    const setTimeout = fixture.setTimeout, clearTimeout = fixture.clearTimeout;\n`;
  const admobUrl = url(environment + admobSource.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === '../consent-signals.js' ? signalsUrl : stub)}`));
  const admob = await import(admobUrl);
  const yandex = await import(url(environment + yandexSource.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === './native-admob.js' ? admobUrl : stub)}`).replace("import('capacitor-plugin-yandex-ads')", `import(${JSON.stringify(stub)})`)));
  const deps = { interstitial: {}, rewarded: {}, isAdsRemoved: () => true,
    preloadInterstitial() { calls.push('preload-interstitial'); }, preloadRewarded() { calls.push('preload-rewarded'); } };
  return { calls, sdk, yandexSdk, admob, yandex, deps, clock, timers,
    visibility: value => { document.visibilityState = value; for (const fn of [...visibilityListeners]) fn(); },
    tick: async () => {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); clock.clock += timer.ms; timer.fn();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

for (const platform of ['ios', 'android']) {
  for (const input of [{}, { umpError: true }, { info: { canRequestAds: false } }, { signalsError: true }]) {
    test(`${platform}: Yandex consent stays true independently of UMP ${JSON.stringify(input)}`, async () => {
      const f = await fixture({ platform, ...input });
      assert.equal(await f.yandex.init(f.deps), true);
      assert.deepEqual(f.calls.map(call => Array.isArray(call) ? call[0] : call),
        platform === 'ios' ? ['att', 'yandex-initialize', 'yandex-consent', 'preload-rewarded']
          : ['yandex-initialize', 'yandex-consent', 'preload-rewarded']);
      const options = f.calls.find(call => Array.isArray(call) && call[0] === 'yandex-initialize')[1];
      assert.equal(options.userConsent, true);
      assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === 'yandex-consent' && call[1] === true));
      assert.equal(f.admob.getNativeConsentInfo().privacyOptionsRequired, false);
    });
  }

  test(`${platform}: stock AdMob initializes before UMP and requests ads after the required form`, async () => {
    const f = await fixture({ platform, info: { status: 'REQUIRED', isConsentFormAvailable: true } });
    assert.equal(await f.admob.init(f.deps), true);
    assert.deepEqual(f.calls.map(call => Array.isArray(call) ? call[0] : call),
      platform === 'ios' ? ['initialize', 'ump', 'form', 'att', 'preload-rewarded']
        : ['initialize', 'ump', 'form', 'preload-rewarded']);
  });

  for (const input of [{ umpError: true }, { info: { canRequestAds: false } },
    { info: { status: 'REQUIRED', isConsentFormAvailable: true }, formError: true }]) {
    test(`${platform}: failed or ineligible UMP blocks AdMob preloads ${JSON.stringify(input)}`, async () => {
      const f = await fixture({ platform, ...input });
      assert.equal(await f.admob.init(f.deps), false);
      assert.equal(f.calls[0][0], 'initialize');
      assert.equal(f.calls.includes('att'), false);
      assert.equal(f.calls.includes('preload-rewarded'), false);
      assert.equal(f.calls.includes('preload-interstitial'), false);
      assert.equal(await f.yandex.init(f.deps), true);
    });
  }

  test(`${platform}: unavailable Yandex stays retryable without starting UMP`, async () => {
    const f = await fixture({ platform, yandexError: true });
    assert.equal(await f.yandex.init(f.deps), false);
    assert.equal(f.yandex.canRetryInitialization(), true);
    assert.equal(f.calls.includes('ump'), false);
    assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'initialize'), false);
  });

  test(`${platform}: AdMob privacy uses its initialized stock plugin and cached UMP result`, async () => {
    const f = await fixture({ platform });
    assert.equal(await f.admob.init(f.deps), true);
    await Promise.all([f.admob.prepareNativeConsent(), f.admob.prepareNativeConsent()]);
    assert.equal(f.calls.filter(call => call === 'ump').length, 1);
    assert.equal(f.admob.getNativeConsentInfo().privacyOptionsRequired, true);
    await f.admob.showNativePrivacyOptions();
    assert.equal(f.calls.at(-1), 'privacy');
    assert.equal(f.calls.includes('signals'), false);
  });
}

test('failed AdMob initialization cannot open a consent form or request ads', async () => {
  const f = await fixture({ initializeError: true });
  assert.equal(await f.admob.init(f.deps), false);
  assert.deepEqual(f.calls.map(call => Array.isArray(call) ? call[0] : call), ['initialize']);
});

for (const provider of ['admob', 'yandex']) {
  test(`${provider}: iOS requests undecided ATT and can continue after refusal`, async () => {
    const f = await fixture({ attStatus: 'notDetermined' });
    assert.equal(await f[provider].init(f.deps), true);
    assert.equal(f.calls.filter(call => call === 'att-form').length, 1);
    assert.ok(f.calls.includes('preload-rewarded'));
  });
  test(`${provider}: an ATT bridge failure does not block advertising initialization`, async () => {
    const f = await fixture({ attError: true });
    assert.equal(await f[provider].init(f.deps), true);
    assert.ok(f.calls.includes('preload-rewarded'));
  });
}

const bridgeSource = readFileSync(new URL('../template/platform/bridge.js', import.meta.url), 'utf8');
const privacySource = bridgeSource.slice(bridgeSource.indexOf('let adsInitializing'), bridgeSource.indexOf('async function initializeAds'))
  .replaceAll('export ', '');
function privacyFixture({ cleanup = async () => {}, active = false, error = false, available = true } = {}) {
  const calls = [];
  let complete;
  const timers = new Map();
  let timerId = 0;
  const telemetry = [];
  const context = { state: {}, isNative: true,
    beginConsentTelemetry: flow => { telemetry.push({ flow }); return result => telemetry.push(result); },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), console: { warn() {} },
    nativeAdmob: { getNativeConsentInfo: () => ({privacyOptionsRequired: available}), hasPresentation: () => active,
      removeBanner: async () => { calls.push('remove-admob'); await cleanup(); },
      showNativePrivacyOptions: () => { calls.push('form'); return error ? Promise.reject(Error('form')) : new Promise(r => {complete=r;}); } },
    nativeYandex: { hasPresentation: () => false, resetAdsForPrivacy: async () => calls.push('reset-yandex') },
  };
  vm.createContext(context);
  vm.runInContext(privacySource + '\nglobalThis.open = showPrivacyOptions; globalThis.stopped = () => Boolean(state.privacyAdsStopped);', context);
  return { context, calls, telemetry, expire: () => { for (const callback of [...timers.values()]) callback(); }, finish: () => complete() };
}
test('privacy form blocks ads before banner removal; duplicate request is refused', async () => {
  const f=privacyFixture(); const first=f.context.open();
  assert.equal(f.context.stopped(),true);
  assert.equal(await f.context.open(),false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls,['remove-admob','reset-yandex','form']);
  f.finish(); assert.equal(await first,true);
  assert.equal(f.context.stopped(),true, 'old ads remain blocked until caller reloads');
});
test('active fullscreen or unavailable privacy never opens a form', async () => {
  for (const input of [{active:true},{available:false}]) {
    const f=privacyFixture(input); assert.equal(await f.context.open(),false);
    assert.deepEqual(f.calls,[]); assert.equal(f.context.stopped(),false);
  }
});
test('privacy error leaves old ads blocked and permits another form attempt', async () => {
  const f=privacyFixture({error:true}); assert.equal(await f.context.open(),false);
  assert.equal(f.context.stopped(),true); assert.equal(await f.context.open(),false);
  assert.equal(f.calls.filter(x=>x==='form').length,2);
});


for (const [name, callback] of [['showInterstitialAd', 'onInterstitialShowFailed'], ['showRewardedAd', 'onRewardedShowFailed']]) {
  test(`${name} reports failure after privacy changes instead of stranding the game`, async () => {
    const start = bridgeSource.indexOf(`export async function ${name}(`);
    const body = bridgeSource.slice(start, bridgeSource.indexOf('\n}', start) + 2).replace('export ', '');
    const failures = [];
    const context = { state: { privacyAdsStopped: true, callbacks: {[callback]: error => failures.push(error)} } };
    vm.createContext(context); vm.runInContext(body, context);
    assert.equal(await context[name](), false);
    assert.equal(failures.length, 1);
  });
}


test('privacy cleanup timeout releases busy state and ignores late completion during a retry', async () => {
  let release;
  let calls = 0;
  const delayed = new Promise(resolve => { release = resolve; });
  const f = privacyFixture({ cleanup: () => ++calls === 1 ? delayed : Promise.resolve() });
  const first = f.context.open();
  f.expire();
  assert.equal(await first, false);
  assert.equal(f.context.getPrivacyOptionsState().busy, false);
  assert.equal(f.context.stopped(), true);
  assert.equal(f.calls.includes('form'), false);
  const retry = f.context.open();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call === 'form').length, 1);
  assert.equal(f.context.getPrivacyOptionsState().busy, true);
  assert.equal(await f.context.open(), false);
  f.finish();
  assert.equal(await retry, true);
  assert.equal(f.context.stopped(), true);
});

test('rejected banner cleanup permits a new privacy attempt without resuming ads', async () => {
  let calls = 0;
  const f = privacyFixture({ cleanup: async () => { if (++calls === 1) throw Error('cleanup rejected'); } });
  assert.equal(await f.context.open(), false);
  assert.equal(f.context.getPrivacyOptionsState().busy, false);
  assert.equal(f.context.stopped(), true);
  const retry = f.context.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call === 'form').length, 1);
  f.finish(); assert.equal(await retry, true);
});

test('Yandex serializes concurrent initialization and never repeats a successful SDK/listener setup', async () => {
  const f = await fixture({ platform: 'android' });
  let release, starts = 0, listeners = 0, resets = 0;
  f.yandexSdk.initialize = () => { starts++; return new Promise(resolve => { release = resolve; }); };
  f.yandexSdk.resetAds = async () => { resets++; };
  f.yandexSdk.addListener = async () => { listeners++; return { remove() {} }; };
  const first = f.yandex.init(f.deps), second = f.yandex.init(f.deps);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1); release();
  assert.equal(await first, true); assert.equal(await second, true);
  const count = listeners;
  assert.equal(await f.yandex.init(f.deps), true);
  assert.equal(starts, 1); assert.equal(listeners, count); assert.equal(resets, 1);
});

test('Yandex technical initialization failure recovers after cooldown without a WebView reload', async () => {
  const f = await fixture({ platform: 'android' }); let starts = 0;
  f.yandexSdk.initialize = async () => { if (++starts === 1) throw Error('temporary native window failure'); };
  assert.equal(await f.yandex.init(f.deps), false); assert.equal(f.yandex.canRetryInitialization(), true);
  f.clock.clock = 10000;
  const recovery = f.yandex.init(f.deps);
  assert.equal(f.yandex.init(f.deps), recovery);
  assert.equal(starts, 1); assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 20000);
  await f.tick();
  assert.equal(await recovery, true); assert.equal(starts, 2);
  assert.equal(f.timers.size, 0);
  assert.equal(f.yandex.canRetryInitialization(), false);
});

test('Yandex listener failure removes partial listeners and retries without initializing the successful SDK again', async () => {
  const f = await fixture({ platform: 'android' }); let starts = 0, registrations = 0, removed = 0;
  f.yandexSdk.initialize = async () => { starts++; };
  f.yandexSdk.addListener = async () => { if (++registrations === 2) throw Error('listener unavailable'); return { remove: async () => { removed++; } }; };
  assert.equal(await f.yandex.init(f.deps), false);
  assert.equal(removed, registrations - 1);
  globalThis.__consentFixture.clock = 30001;
  assert.equal(await f.yandex.init(f.deps), true);
  assert.equal(starts, 1);
});


test('Yandex recovery pauses in background and respects ownership restored during cooldown', async () => {
  const f = await fixture({ platform: 'android' }); let starts = 0, banners = 0, forced = 0, rewards = 0;
  let owned = false;
  f.deps.isAdsRemoved = () => owned;
  f.deps.preloadInterstitial = () => forced++;
  f.deps.preloadRewarded = () => rewards++;
  f.yandexSdk.showBanner = async () => { banners++; };
  f.yandexSdk.initialize = async () => { if (++starts === 1) throw Error('temporary setup failure'); };
  assert.equal(await f.yandex.init(f.deps), false);
  const recovery = f.yandex.init(f.deps);
  f.clock.clock += 10000; f.visibility('hidden');
  assert.equal(f.timers.size, 0);
  f.clock.clock += 60000; owned = true;
  assert.equal(starts, 1);
  f.visibility('visible');
  assert.equal([...f.timers.values()][0].ms, 20000);
  await f.tick(); assert.equal(await recovery, true);
  assert.equal(starts, 2); assert.equal(banners, 0); assert.equal(forced, 0); assert.equal(rewards, 1);
});

test('Yandex failed recovery waits for a new signal instead of polling', async () => {
  const f = await fixture({ platform: 'android' }); let starts = 0;
  f.yandexSdk.initialize = async () => { starts++; throw Error('still unavailable'); };
  assert.equal(await f.yandex.init(f.deps), false);
  const recovery = f.yandex.init(f.deps);
  await f.tick(); assert.equal(await recovery, false);
  assert.equal(starts, 2); assert.equal(f.timers.size, 0);
  assert.equal(f.yandex.canRetryInitialization(), true);
});


for (const source of ['locale', 'debug']) {
  test(`Yandex ${source} selection recovers on network/foreground signals without switching to AdMob`, async () => {
    const bridge = readFileSync(new URL('../template/platform/bridge.js', import.meta.url), 'utf8');
    const recovery = bridge.slice(bridge.indexOf('let yandexRecoveryBound'), bridge.indexOf('async function initializeAds(callbacks)'));
    const initialize = bridge.slice(bridge.indexOf('async function initializeAds(callbacks)'), bridge.indexOf('// Native *and* selling'));
    const network = [], visibility = [];
    let attempts = 0, admobAttempts = 0;
    const document = { visibilityState: 'visible', addEventListener: (_, fn) => visibility.push(fn) };
    const state = { callbacks: {}, provider: 'none', removeAdsFlag: false };
    const context = {
      state, document, isNative: true, adsInitializing: false, privacyOpen: false,
      window: { addEventListener: (_, fn) => network.push(fn) },
      resolveNativeAdProvider: () => ({ provider: 'yandex', source }),
      nativeYandex: { init: async () => ++attempts > 1, canRetryInitialization: () => attempts === 1 },
      nativeAdmob: { init: async () => { admobAttempts++; return true; } },
      createAdAdapterDeps: () => ({}), bindAdmobRecovery() {}, console,
    };
    const api = vm.runInNewContext(`${recovery}\n${initialize}\n({ initializeAds });`, context);
    await api.initializeAds({ locale: 'ru-RU' });
    assert.equal(attempts, 1); assert.equal(admobAttempts, 0); assert.equal(state.provider, 'none');
    document.visibilityState = 'hidden'; network[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 1, 'background network events cannot restart advertising');
    document.visibilityState = 'visible'; visibility[0](); network[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2, 'foreground and network signals coalesce into one recovery');
    assert.equal(admobAttempts, 0); assert.equal(state.provider, 'yandex-native');
    assert.equal(state.providerSource, source);
  });
}


test('Yandex recovery retains a signal received during initial setup and handles native resume', async () => {
  const bridge = readFileSync(new URL('../template/platform/bridge.js', import.meta.url), 'utf8');
  const startup = bridge.slice(bridge.indexOf('let adsInitializing'), bridge.indexOf('export function getPrivacyOptionsState'));
  const recovery = bridge.slice(bridge.indexOf('let yandexRecoveryBound'), bridge.indexOf('async function initializeAds(callbacks)'));
  const initialize = bridge.slice(bridge.indexOf('async function initializeAds(callbacks)'), bridge.indexOf('// Native *and* selling'));
  const lifecycle = bridge.slice(bridge.indexOf('export async function bindNativeLifecycle'), bridge.indexOf('export async function exitNativeApp'));
  let release, attempts = 0, retryable = false, nativeHandlers;
  const network = [], visibility = [];
  const state = { callbacks: {}, provider: 'none', removeAdsFlag: false };
  const context = {
    state, isNative: true, admobRecoveryRequested: false, recoverAdmobOnResume() {},
    document: { visibilityState: 'visible', addEventListener: (_, fn) => visibility.push(fn) },
    window: { addEventListener: (_, fn) => network.push(fn) },
    resolveNativeAdProvider: () => ({ provider: 'yandex', source: 'locale' }),
    nativeYandex: {
      init: async () => { attempts++; if (attempts === 1) return new Promise(resolve => { release = () => { retryable = true; resolve(false); }; }); retryable = false; return true; },
      canRetryInitialization: () => retryable,
    },
    nativeAdmob: { init: async () => { throw Error('Yandex must not switch to AdMob'); } },
    createAdAdapterDeps: () => ({}), bindAdmobRecovery() {},
    nativeShell: { bindNativeLifecycle: async handlers => { nativeHandlers = handlers; } }, console,
  };
  const api = vm.runInNewContext(`${startup}\n${recovery}\n${initialize}\n${lifecycle}`.replaceAll('export ', '') + '\n({ initializePlatformServices, bindNativeLifecycle });', context);
  const initial = api.initializePlatformServices({ locale: 'ru-RU' });
  network[0](); release(); await initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2, 'the only signal arriving before the first failure must not be lost');
  assert.equal(state.provider, 'yandex-native');
  await api.bindNativeLifecycle({ onResume() {} });
  retryable = true; nativeHandlers.onResume('app-state');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 3, 'native resume must also trigger Yandex recovery');
});


test('privacy telemetry records accepted opens and distinguishes cleanup from form errors', async () => {
  const success = privacyFixture();
  const pending = success.context.open();
  assert.equal(await success.context.open(), false);
  await new Promise(resolve => setImmediate(resolve));
  success.finish(); await pending;
  assert.equal(success.telemetry.length, 2);
  assert.equal(success.telemetry[0].flow, 'privacy');
  assert.equal(success.telemetry[1].stage, 'privacy_form');
  for (const stage of ['cleanup', 'form']) {
    const f = privacyFixture(stage === 'cleanup'
      ? { cleanup: async () => { throw Error('cleanup'); } } : { error: true });
    assert.equal(await f.context.open(), false);
    assert.equal(f.telemetry.length, 2);
    assert.equal(f.telemetry[1].stage, stage === 'cleanup' ? 'ads_cleanup' : 'privacy_form');
    assert.equal(f.telemetry[1].failed, true);
  }
});
