import { assertCasBuildPolicy } from './cas-build-policy.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAdLifecycle } from '@barsuk/game-runtime/ad-lifecycle';
assert.equal(typeof createAdLifecycle({
  name: 'CAS inventory', callbacks: {}, setTimeoutFn() {}, clearTimeoutFn() {},
}).setAvailability, 'function', 'CAS requires the SDK availability API from runtime 0.2.2 or later');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const name of ['@capacitor-community/admob', 'capacitor-plugin-yandex-ads']) {
  assert.ok(!pkg.dependencies[name] && !lock.packages[`node_modules/${name}`], `Legacy plugin remains: ${name}`);
}
const pin = pkg.dependencies['@barsuk/capacitor-cas'];
assert.match(pin, /^file:vendor\/barsuk-capacitor-cas-[\d.]+\.tgz$/);
assert.ok(fs.existsSync(pin.slice(5)), 'CAS archive missing');
for (const name of ['@barsuk/capacitor-cas', '@barsuk/game-starter', '@barsuk/game-runtime']) {
  const pin = pkg.dependencies[name] || pkg.devDependencies[name];
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(entry.resolved, pin, `${name} lockfile source differs from package.json`);
  if (pin.startsWith('file:')) {
    const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(pin.slice(5))).digest('base64');
    assert.equal(entry.integrity, integrity, `${name} archive differs from lockfile`);
  } else {
    assert.match(pin, /^https:\/\/github\.com\/BarsukStudio\/game-(?:starter|runtime)\/archive\/[a-f0-9]{40}\.tar\.gz$/);
  }
  const installed = JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf8'));
  assert.equal(installed.version, entry.version, `${name} installed version differs from lockfile`);
}
const bridge = fs.readFileSync('src/js/platform/bridge.js', 'utf8');
assert.ok(bridge.includes('./ads/native-cas.js'));
assert.doesNotMatch(bridge, /native-admob|native-yandex|debugAdsProvider/);
assertCasBuildPolicy(process.env, { release: process.argv.includes('--production') });
console.log('CAS-only source/dependency checks passed.');
