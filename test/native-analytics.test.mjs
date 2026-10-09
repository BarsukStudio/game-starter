import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportTemplate } from '../tools/export-template.mjs';

// Executes the exported policy module; only the native SDK and environment are
// replaced. The same module is consumed by the game and fresh CAS exports.
const source = fs.readFileSync(new URL('../template/variants/cas/platform/native-analytics.js', import.meta.url), 'utf8');
let serial = 0;
async function fixture({ native = true, enable = () => Promise.resolve(), log = () => Promise.resolve() } = {}) {
  const key = `__analyticsFixture${++serial}`;
  const calls = [], events = [];
  globalThis[key] = { setEnabled(options) { calls.push(options); return enable(options); },
    logEvent(event) { events.push(event); return log(event); } };
  const moduleUrl = 'data:text/javascript,' + encodeURIComponent(source
    .replace("import { FirebaseAnalytics } from '@capacitor-firebase/analytics';", `const FirebaseAnalytics = globalThis.${key};`)
    .replace("import { isNative } from './env.js';", `const isNative = ${native};`));
  const module = await import(moduleUrl);
  delete globalThis[key];
  return { ...module, moduleUrl, calls, events };
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

test('web never calls native Analytics', async () => {
  const transport = await fixture({ native: false });
  transport.logNativeAnalytics({ name: 'bs_consent_start' });
  await drain();
  assert.deepEqual(transport.events, []);
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
