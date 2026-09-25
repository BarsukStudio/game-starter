import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const moduleUrl = [
  new URL('../src/js/platform/ads/ad-revenue.js', import.meta.url),
  new URL('../platform/ads/ad-revenue.js', import.meta.url),
].find(url => fs.existsSync(url));
assert.ok(moduleUrl, 'Copy the shared collector to src/js/platform/ads before running this test.');
const source = fs.readFileSync(moduleUrl, 'utf8');
function fixture({ native = true, platform = 'android', fail = false } = {}) {
  const calls = [], warnings = [], listeners = new Map();
  const context = {
    isNative: native, nativePlatform: platform,
    crypto: { randomUUID }, console: { warn: (...args) => warnings.push(args) },
    FirebaseAnalytics: { logEvent: async (event) => {
      calls.push(event);
      if (fail) throw new Error('Firebase failed');
    } },
  };
  vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  const plugin = { addListener: async (name, handler) => {
    assert.ok(!listeners.has(name), 'must not register twice');
    listeners.set(name, handler);
    return { remove() {} };
  } };
  return { ...context, calls, warnings, listeners, plugin };
}
const paid = { valueMicros: 12500, currencyCode: 'USD', precision: 1, adUnitId: 'unit', networkName: 'network' };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('AdMob micros become custom amounts; zero and unknown precision remain explicit', () => {
  const f = fixture();
  const result = f.revenueParameters('admob', 'banner', paid, false);
  assert.equal(result.revenue_amount, 0.0125);
  assert.equal(result.revenue_currency, 'USD');
  assert.equal(result.revenue_precision, 'estimated');
  assert.equal(result.test_ads, 0);
  assert.equal(result.value, undefined);
  assert.equal(result.currency, undefined);
  const zero = f.revenueParameters('admob', 'banner', { ...paid, valueMicros: 0, precision: 0 }, true);
  assert.equal(zero.revenue_amount, 0);
  assert.equal(zero.revenue_precision, 'unknown');
  assert.equal(zero.test_ads, 1);
});

test('missing, malformed and unsafe AdMob values are never converted into revenue', () => {
  const f = fixture();
  for (const valueMicros of [undefined, null, '', '12', NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = f.revenueParameters('admob', 'rewarded', { ...paid, valueMicros }, false);
    assert.equal(result.revenue_amount, undefined);
    assert.notEqual(result.revenue_status, 'reported');
  }
  for (const currencyCode of [undefined, '', 'usd', 'US', 123]) {
    assert.equal(f.revenueParameters('admob', 'banner', { ...paid, currencyCode }, false).revenue_status, 'invalid');
  }
});

test('Yandex parses documented decimal ILRD with original currency and precision', () => {
  const f = fixture();
  const result = f.revenueParameters('yandex', 'interstitial', { adUnitId: 'unit', impressionData: JSON.stringify({
    revenue: '0.056', currency: 'RUB', revenueUSD: '0.0007', precision: 'publisher_defined', network: { name: 'network' },
  }) }, false);
  assert.equal(result.revenue_amount, 0.056);
  assert.equal(result.revenue_currency, 'RUB');
  assert.equal(result.revenue_precision, 'publisher_defined');
  assert.equal(result.ad_network, 'network');
});

test('Yandex absent/malformed ILRD is diagnostic, never a zero-revenue impression', () => {
  const f = fixture();
  for (const impressionData of [undefined, null, '', '{', 'null', '[]', '{}', '{"revenue":""}', '{"revenue":null}', '{"revenue":-1}', '{"revenue":"Infinity"}']) {
    const result = f.revenueParameters('yandex', 'banner', { impressionData }, false);
    assert.equal(result.revenue_amount, undefined);
    assert.notEqual(result.revenue_status, 'reported');
  }
});

test('web and iOS do not bind revenue listeners or call Firebase', async () => {
  for (const options of [{ native: false }, { platform: 'ios' }]) {
    const f = fixture(options);
    await f.bindAdRevenueEvents(f.plugin, 'admob', { banner: 'paid' }, false);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.calls.length, 0);
  }
});

test('concurrent initialization binds once; repeated banner response IDs do not drop legitimate callbacks', async () => {
  const f = fixture();
  await Promise.all([1, 2].map(() => f.bindAdRevenueEvents(f.plugin, 'admob', { banner: 'paid' }, true)));
  for (let i = 0; i < 2; i++) f.listeners.get('paid')({ ...paid, impressionId: 'same-response' });
  await flush();
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].params.callback_id, f.calls[1].params.callback_id);
  assert.ok(f.calls.every(event => event.name === 'bs_ad_revenue' && event.params.test_ads === 1));
});

test('delivery failure is consumed without retries; registration failure can recover', async () => {
  const f = fixture({ fail: true });
  const add = f.plugin.addListener;
  f.plugin.addListener = () => { throw new Error('Registration unavailable'); };
  await f.bindAdRevenueEvents(f.plugin, 'admob', { rewarded: 'paid' }, false);
  f.plugin.addListener = add;
  await f.bindAdRevenueEvents(f.plugin, 'admob', { rewarded: 'paid' }, false);
  f.listeners.get('paid')(paid);
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.warnings.length, 2);
});
