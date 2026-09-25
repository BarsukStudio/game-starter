import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../template/platform/ads/native-yandex.js', import.meta.url), 'utf8');
const router = new URL('../template/platform/ads/native-ad-events.js', import.meta.url).href;
const url = text => `data:text/javascript,${encodeURIComponent(text)}`;
let sequence = 0;

for (const format of ['interstitial', 'rewarded']) for (const boundDismissal of [false, true]) {
  test(`Yandex ${format}: boundDismissal=${boundDismissal} isolates later shows`, async () => {
    const listeners = new Map(), calls = [], events = [];
    const sdk = {
      initialize: async () => {}, setUserConsent: async () => {},
      addListener: async (name, callback) => { listeners.set(name, callback); },
    };
    for (const method of ['showInterstitial', 'showRewarded']) {
      sdk[method] = options => new Promise(resolve => calls.push({ options, resolve }));
    }
    globalThis.__yandexPresentationTest = sdk;
    const stub = url(`
      export const prepareNativeConsent = async () => ({canRequestAds: true, yandexConsent: false});
      export const requestIosTrackingAuthorization = async () => {};
      export const YandexAds = globalThis.__yandexPresentationTest;
      export const APP_CONFIG = { ads: {} };
      export const debugLog = () => {};
      export const getNativeKey = () => 'android';
      // ${++sequence}
    `);
    const rewritten = source.replace(/from '([^']+)'/g, (_, name) =>
      `from ${JSON.stringify(name === './native-ad-events.js' ? router : stub)}`)
      .replace("import('capacitor-plugin-yandex-ads')", `import(${JSON.stringify(stub)})`);
    const adapter = await import(url(rewritten));
    delete globalThis.__yandexPresentationTest;
    let current;
    const lifecycle = {
      captureShow() {
        const scope = { valid: true, rewardConfirmationBound: boundDismissal, isCurrent() { return scope.valid; },
          showStarted() {}, showFailed() {},
          showClosed() { if (scope.valid) { events.push('closed'); scope.valid = false; } },
          rewardEarned() { if (scope.valid) events.push('reward'); },
        };
        current = scope;
        return scope;
      },
    };
    await adapter.init({ interstitial: lifecycle, rewarded: lifecycle,
      isAdsRemoved: () => true, preloadRewarded() {},
      onPresentationSettled: () => events.push('available'),
    });
    const show = format === 'rewarded' ? 'showRewarded' : 'showInterstitial';
    const a = adapter[show](); const old = calls.at(-1);
    await assert.rejects(adapter.showInterstitial(), /has not settled/);
    await assert.rejects(adapter.showRewarded(), /has not settled/);
    if (!boundDismissal) current.valid = false;
    assert.equal(adapter.isPresentationUnresolved(format), !boundDismissal);
    for (const payload of [{}, { requestId: 'old' }]) {
      listeners.get(`${format}Dismissed`)(payload);
      assert.equal(adapter.hasPresentation(), true);
    }
    listeners.get(`${format}Dismissed`)({ requestId: old.options.requestId });
    assert.deepEqual(events, boundDismissal ? ['closed'] : ['available']);
    const b = adapter.showRewarded(); const next = calls.at(-1);
    old.resolve({ presented: true, rewarded: true }); await a;
    listeners.get(`${format}Dismissed`)({ requestId: old.options.requestId });
    assert.equal(adapter.hasPresentation(), true);
    assert.deepEqual(events, boundDismissal ? ['closed'] : ['available']);
    next.resolve({ presented: true, rewarded: true }); await b;
    assert.deepEqual(events, [boundDismissal ? 'closed' : 'available', 'reward', 'closed']);
    assert.equal(adapter.hasPresentation(), false);
  });
}
