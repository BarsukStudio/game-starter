// The release gate reads the built bundle, so it has to recognise every shape a
// bundler may give the config markers. Vite keeps `const nativeAdsMode = "..."`
// in some builds and inlines it into the config object in others; Muscle
// Clicker and Muscle Clicker 2 met the inlined form first and fixed their copies,
// while the template still only knew the declaration and failed closed on it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../template/scripts/assert-production-ads.mjs', import.meta.url));

function runGate(t, bundle) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-ads-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'assets', 'index.js'), bundle);
  return spawnSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
}

const declared = (mode, devices) => [
  `const nativeAdsMode = "${mode}";`,
  `const admobTestingDevices = String("${devices}");`,
].join('\n');

const inlined = (mode, devices) => (
  `const APP_CONFIG = { ads: { nativeAdsMode: "${mode}", admob: { testingDevices: String("${devices}").split(",") } } };`
);

for (const [shape, bundle] of [['declared', declared], ['inlined', inlined]]) {
  test(`${shape} markers: a production build passes`, (t) => {
    const result = runGate(t, bundle('production', ''));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Production ad units confirmed/);
  });

  test(`${shape} markers: demo ads are refused`, (t) => {
    const result = runGate(t, bundle('test', ''));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /was built with "test" ads/);
  });

  test(`${shape} markers: registered test devices are refused`, (t) => {
    const result = runGate(t, bundle('production', 'device-a,device-b'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /carries AdMob test devices/);
  });
}

test('a bundle without the marker fails closed', (t) => {
  const result = runGate(t, 'const unrelated = 1;');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected exactly one ad-mode marker in the bundle, found 0/);
});
