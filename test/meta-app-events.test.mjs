import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Executes the template module; only the Meta plugin, the stored UMP choices
// and the environment are replaced. The consent policy is the real one.
const source = fs.readFileSync(new URL('../template/platform/meta-app-events.js', import.meta.url), 'utf8');
const signalsSource = fs.readFileSync(new URL('../template/platform/consent-signals.js', import.meta.url), 'utf8');
const policy = signalsSource.slice(signalsSource.indexOf('export function hasYandexConsent'));
let serial = 0;

async function fixture({ native = true, platform = 'android', signals = [{ gdprApplies: false }], init = () => Promise.resolve(),
  activate = () => Promise.resolve() } = {}) {
  const key = `__metaFixture${++serial}`;
  const calls = [];
  const reads = [...signals];
  globalThis[key] = {
    plugin: {
      initAppEvents() { calls.push('init'); return init(); },
      logEvent({ event }) { calls.push(event); return activate(); },
    },
    read() { calls.push('read'); const next = reads.length > 1 ? reads.shift() : reads[0]; return next instanceof Error ? Promise.reject(next) : Promise.resolve(next); },
  };
  const consent = 'data:text/javascript,' + encodeURIComponent(`export const readConsentSignals = () => globalThis.${key}.read();\n${policy}`);
  const module = await import('data:text/javascript,' + encodeURIComponent(source
    .replace("import { FacebookAnalytics } from '@capgo/capacitor-facebook-analytics';", `const FacebookAnalytics = globalThis.${key}.plugin;`)
    .replace("import { readConsentSignals, hasMetaConsent } from './consent-signals.js';", `import { readConsentSignals, hasMetaConsent } from ${JSON.stringify(consent)};`)
    .replace("import { isNative, nativePlatform } from './env.js';", `const isNative = ${native}; const nativePlatform = '${platform}';`)));
  return { ...module, calls };
}

const warn = console.warn;
test.before(() => { console.warn = () => {}; });
test.after(() => { console.warn = warn; });

test('outside GDPR the SDK starts once per launch', async () => {
  const meta = await fixture();
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'init', 'fb_mobile_activate_app']);
});

test('concurrent calls share one start', async () => {
  const meta = await fixture();
  const results = await Promise.all([meta.startMetaAppEvents(), meta.startMetaAppEvents()]);
  assert.deepEqual(results, [true, true]);
  assert.deepEqual(meta.calls, ['read', 'init', 'fb_mobile_activate_app']);
});

test('the web never touches the SDK or the stored choices', async () => {
  const meta = await fixture({ native: false });
  assert.equal(await meta.startMetaAppEvents(), false);
  assert.deepEqual(meta.calls, []);
});

for (const [name, signals] of [
  ['unknown region', {}],
  ['GDPR without Meta consent', { gdprApplies: true, additionalConsent: '2~1033', purposeConsents: '1' }],
  ['GDPR with storage refused', { gdprApplies: true, additionalConsent: '2~89', purposeConsents: '0' }],
]) test(`${name} keeps the SDK off`, async () => {
  const meta = await fixture({ signals: [signals] });
  assert.equal(await meta.startMetaAppEvents(), false);
  assert.deepEqual(meta.calls, ['read']);
});

test('GDPR with Meta consent starts the SDK', async () => {
  const meta = await fixture({ signals: [{ gdprApplies: true, additionalConsent: '2~89', purposeConsents: '1' }] });
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'init', 'fb_mobile_activate_app']);
});

test('a refusal is not cached: a later call after a retried consent flow checks again', async () => {
  const meta = await fixture({ signals: [{}, { gdprApplies: false }] });
  assert.equal(await meta.startMetaAppEvents(), false);
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'read', 'init', 'fb_mobile_activate_app']);
});

test('signal and SDK failures are contained and retried by the next call', async () => {
  let failInit = true;
  const meta = await fixture({ signals: [Error('no bridge'), { gdprApplies: false }],
    init: () => (failInit ? Promise.reject(Error('sdk')) : Promise.resolve()) });
  assert.equal(await meta.startMetaAppEvents(), false);
  assert.equal(await meta.startMetaAppEvents(), false);
  failInit = false;
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'read', 'init', 'read', 'init', 'fb_mobile_activate_app']);
});

test('iOS starts without a second launch event: FBSDKCoreKit logs its own', async () => {
  const meta = await fixture({ platform: 'ios' });
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'init']);
});

test('a failed Android launch event leaves the started SDK alone', async () => {
  const meta = await fixture({ activate: () => Promise.reject(Error('log')) });
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.equal(await meta.startMetaAppEvents(), true);
  assert.deepEqual(meta.calls, ['read', 'init', 'fb_mobile_activate_app']);
});
