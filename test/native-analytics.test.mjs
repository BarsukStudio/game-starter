import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportTemplate } from '../tools/export-template.mjs';

// Executes the exported transport module; only the native SDK and environment
// are replaced. Both native stacks export the same module.
const source = fs.readFileSync(new URL('../template/platform/native-analytics.js', import.meta.url), 'utf8');
let serial = 0;
async function fixture({ native = true, enable = () => Promise.resolve(), log = () => Promise.resolve() } = {}) {
  const key = `__analyticsFixture${++serial}`;
  const calls = [], events = [], properties = [];
  globalThis[key] = { setEnabled(options) { calls.push(options); return enable(options); },
    logEvent(event) { events.push(event); return log(event); },
    setUserProperty(property) { properties.push(property); return log(property); } };
  const moduleUrl = 'data:text/javascript,' + encodeURIComponent(source
    .replace("import { FirebaseAnalytics } from '@capacitor-firebase/analytics';", `const FirebaseAnalytics = globalThis.${key};`)
    .replace("import { isNative } from './env.js';", `const isNative = ${native};`));
  const module = await import(moduleUrl);
  delete globalThis[key];
  return { ...module, moduleUrl, calls, events, properties };
}
const drain = () => new Promise(resolve => setImmediate(resolve));

test('native events are delivered immediately without collection or consent mutations', async () => {
  const transport = await fixture();
  for (let i = 0; i < 100; i++) transport.logNativeAnalytics({ name: 'bs_cas_load', params: { index: i } });
  await drain();
  assert.equal(transport.events.length, 100);
  assert.deepEqual(transport.calls, []);
});

test('synchronous and asynchronous bridge failures are contained', async () => {
  for (const log of [() => { throw Error('bridge'); }, () => Promise.reject(Error('delivery'))]) {
    const transport = await fixture({ log });
    transport.logNativeAnalytics({ name: 'bs_consent_start' });
    await drain();
    assert.equal(transport.events.length, 1);
  }
});

test('user properties share the contract: immediate, contained, native only', async () => {
  for (const log of [() => Promise.resolve(), () => { throw Error('bridge'); }, () => Promise.reject(Error('delivery'))]) {
    const transport = await fixture({ log });
    transport.setNativeUserProperty('bs_ad_provider', 'yandex');
    await drain();
    assert.deepEqual(transport.properties, [{ key: 'bs_ad_provider', value: 'yandex' }]);
    assert.deepEqual(transport.calls, []);
  }
});

test('web never calls native Analytics', async () => {
  const transport = await fixture({ native: false });
  transport.logNativeAnalytics({ name: 'bs_consent_start' });
  transport.setNativeUserProperty('bs_ad_provider', 'admob');
  await drain();
  assert.deepEqual(transport.events, []);
  assert.deepEqual(transport.properties, []);
  assert.deepEqual(transport.calls, []);
});

test('fresh CAS export has no Analytics dependency on automatic or manual consent', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barsuk-cas-analytics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  exportTemplate({ nativeStack: 'cas', out: dir });
  const adapter = fs.readFileSync(path.join(dir, 'src/js/platform/ads/native-cas.js'), 'utf8');
  assert.doesNotMatch(adapter, /activateNativeAnalytics|setEnabled|setConsent/);
  assert.equal(fs.readFileSync(path.join(dir, 'src/js/platform/native-analytics.js'), 'utf8'), source);
});

test('both native stacks export the shared transport and the game event channel', t => {
  for (const nativeStack of ['admob', 'cas']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barsuk-analytics-export-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    exportTemplate({ nativeStack, out: dir });
    assert.equal(fs.readFileSync(path.join(dir, 'src/js/platform/native-analytics.js'), 'utf8'), source, nativeStack);
    assert.ok(fs.existsSync(path.join(dir, 'src/js/platform/game-event-channel.js')), nativeStack);
  }
});

test('the device time zone is recorded as a user property on each launch', async () => {
  const zoneSource = fs.readFileSync(new URL('../template/platform/device-time-zone.js', import.meta.url), 'utf8');
  for (const [zone, expected] of [['Europe/Kyiv', [['bs_time_zone', 'Europe/Kyiv']]], ['', []], [null, []]]) {
    const recorded = [];
    globalThis.__zoneFixture = (key, value) => recorded.push([key, value]);
    const realFormat = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: zone }) }; };
    try {
      const module = await import('data:text/javascript,' + encodeURIComponent(zoneSource.replace(
        "import { setNativeUserProperty } from './native-analytics.js';",
        'const setNativeUserProperty = (...args) => globalThis.__zoneFixture(...args);') + `\n// ${++serial}`));
      module.recordDeviceTimeZone();
    } finally {
      Intl.DateTimeFormat = realFormat;
      delete globalThis.__zoneFixture;
    }
    assert.deepEqual(recorded, expected, String(zone));
  }
});
