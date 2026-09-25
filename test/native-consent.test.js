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
async function fixture({ platform = 'ios', info = { canRequestAds: true, status: 'OBTAINED', privacyOptionsRequirementStatus: 'REQUIRED' }, signals = { gdprApplies: true, additionalConsent: '2~~dv.1033', purposeConsents: '0' }, umpError = false, formError = false, signalsError = false } = {}) {
  const calls = [];
  let initialized = false;
  const completeForm = async () => { calls.push('form'); if (formError) throw Error('form failed'); return { ...info, status: 'OBTAINED', canRequestAds: true }; };
  const nativeConsent = {
    read: async () => { if (signalsError) throw Error('no bridge'); return signals; },
    showConsentForm: completeForm,
    showPrivacyOptionsForm: async () => { calls.push('privacy'); },
  };
  const sdk = {
    requestConsentInfo: async () => { calls.push('ump'); if (umpError) throw Error('UMP failed'); return info; },
    showConsentForm: async () => { if (platform === 'ios' && !initialized) throw Error('No ViewController'); return completeForm(); },
    showPrivacyOptionsForm: async () => { if (platform === 'ios' && !initialized) throw Error('No ViewController'); calls.push('privacy'); },
    trackingAuthorizationStatus: async () => { calls.push('att'); return { status: 'denied' }; },
    initialize: async options => { initialized = true; calls.push(['initialize', options]); },
    setUserConsent: async options => { calls.push(['yandex-consent', options.value]); },
    addListener: async () => ({ remove() {} }), showBanner: async () => {},
  };
  globalThis.__consentFixture = { sdk, nativeConsent, platform };
  const stub = url(`
    const f = globalThis.__consentFixture;
    export const AdMob = f.sdk; export const YandexAds = f.sdk;
    export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
    export const BannerAdPluginEvents = {}; export const InterstitialAdPluginEvents = {}; export const RewardAdPluginEvents = {};
    export const BannerAdSize = {}; export const BannerAdPosition = {};
    export const APP_CONFIG = { ads: { nativeTestMode: true, admob: { ios: {}, android: {} }, yandex: { test: {} } } };
    export const getNativeKey = () => f.platform; export const debugLog = () => {};
    export const createNativeAdEvents = x => x;
    export const registerPlugin = () => f.nativeConsent;
    // ${++sequence}
  `);
  const signalsUrl = url(signalsSource.replace("from '@capacitor/core'", `from ${JSON.stringify(stub)}`));
  const admobUrl = url(admobSource.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === '../consent-signals.js' ? signalsUrl : stub)}`));
  const admob = await import(admobUrl);
  const yandex = await import(url(yandexSource.replace(/from '([^']+)'/g, (_, spec) => `from ${JSON.stringify(spec === './native-admob.js' ? admobUrl : stub)}`).replace("import('capacitor-plugin-yandex-ads')", `import(${JSON.stringify(stub)})`)));
  const deps = { interstitial: {}, rewarded: {}, isAdsRemoved: () => true, preloadInterstitial() {}, preloadRewarded() {} };
  return { calls, sdk, admob, yandex, deps };
}

test('Yandex reject uses false; UMP and ATT precede initialization, and fallback shares UMP', async () => {
  const f = await fixture();
  assert.equal(await f.yandex.init(f.deps), true);
  assert.deepEqual(f.calls.slice(0,2), ['ump','att']);
  assert.equal(f.calls[2][1].userConsent, false);
  assert.deepEqual(f.calls[3], ['yandex-consent', false]);
  assert.equal(await f.admob.init(f.deps), true);
  assert.equal(f.calls.filter(x => x === 'ump').length, 1);
});
test('Yandex gets explicit additional consent, independent of denied ATT', async () => {
  const f = await fixture({ signals: { gdprApplies: true, additionalConsent: '2~1033', purposeConsents: '1' } });
  await f.yandex.init(f.deps);
  assert.equal(f.calls[2][1].userConsent, true);
});
test('UMP failure blocks both SDKs, with no second consent attempt', async () => {
  const f = await fixture({ umpError: true });
  assert.equal(await f.yandex.init(f.deps), false);
  assert.equal(await f.admob.init(f.deps), false);
  assert.deepEqual(f.calls, ['ump']);
});
for (const platform of ['ios', 'android']) test(`${platform} required form completes before ATT and SDKs`, async () => {
  const f = await fixture({ platform, info: { status: 'REQUIRED', isConsentFormAvailable: true } });
  await f.admob.init(f.deps);
  assert.deepEqual(f.calls.slice(0, platform === 'ios' ? 3 : 2), platform === 'ios' ? ['ump','form','att'] : ['ump','form']);
  assert.ok(f.calls.findIndex(x => Array.isArray(x) && x[0] === 'initialize') > f.calls.indexOf('form'));
});
test('form failure cannot initialize either SDK', async () => {
  const f = await fixture({ info: { status: 'REQUIRED', isConsentFormAvailable: true }, formError: true });
  assert.equal(await f.yandex.init(f.deps), false);
  assert.equal(await f.admob.init(f.deps), false);
  assert.deepEqual(f.calls, ['ump','form']);
});
test('native preference read failure does not fabricate Yandex consent', async () => {
  const f = await fixture({ signalsError: true });
  await f.yandex.init(f.deps);
  assert.equal(f.calls[2][1].userConsent, false);
});
for (const platform of ['ios', 'android']) test(`${platform} privacy form works without initializing AdMob (Yandex route)`, async () => {
  const f = await fixture({ platform });
  await Promise.all([f.admob.prepareNativeConsent(), f.admob.prepareNativeConsent()]);
  assert.equal(f.calls.filter(x=>x==='ump').length, 1);
  assert.equal(f.admob.getNativeConsentInfo().privacyOptionsRequired, true);
  await f.admob.showNativePrivacyOptions();
  assert.equal(f.calls.at(-1), 'privacy');
});

const bridgeSource = readFileSync(new URL('../template/platform/bridge.js', import.meta.url), 'utf8');
const privacySource = bridgeSource.slice(bridgeSource.indexOf('let adsInitializing'), bridgeSource.indexOf('async function initializeAds'))
  .replaceAll('export ', '');
function privacyFixture({ cleanup = async () => {}, active = false, error = false, available = true } = {}) {
  const calls = [];
  let complete;
  const timers = new Map();
  let timerId = 0;
  const context = { state: {}, isNative: true,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), console: { warn() {} },
    nativeAdmob: { getNativeConsentInfo: () => ({privacyOptionsRequired: available}), hasPresentation: () => active,
      removeBanner: async () => { calls.push('remove-admob'); await cleanup(); },
      showNativePrivacyOptions: () => { calls.push('form'); return error ? Promise.reject(Error('form')) : new Promise(r => {complete=r;}); } },
    nativeYandex: { hasPresentation: () => false, removeBannerIfAvailable: async () => calls.push('remove-yandex') },
  };
  vm.createContext(context);
  vm.runInContext(privacySource + '\nglobalThis.open = showPrivacyOptions; globalThis.stopped = () => Boolean(state.privacyAdsStopped);', context);
  return { context, calls, expire: () => { for (const callback of [...timers.values()]) callback(); }, finish: () => complete() };
}
test('privacy form blocks ads before banner removal; duplicate request is refused', async () => {
  const f=privacyFixture(); const first=f.context.open();
  assert.equal(f.context.stopped(),true);
  assert.equal(await f.context.open(),false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls,['remove-admob','remove-yandex','form']);
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
