#!/usr/bin/env node
// Apply only the approved consent-error metadata patch before verifying AdMob.
import './patch-yandex-sdk.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const consentPatch = fileURLToPath(new URL('./patches/native-ad-consent-errors.patch', import.meta.url));
const consentApplied = spawnSync('git', ['apply', '--reverse', '--check', consentPatch], { encoding: 'utf8' });
if (consentApplied.status !== 0) {
  if (process.argv.includes('--check')) throw new Error('AdMob consent-error patch missing or drifted. Run postinstall.');
  const check = spawnSync('git', ['apply', '--check', consentPatch], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`AdMob consent patch baseline changed: ${check.stderr}`);
  const result = spawnSync('git', ['apply', consentPatch], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`AdMob consent patch failed: ${result.stderr}`);
}
await import('./verify-admob.mjs');

const patch = fileURLToPath(new URL('./patches/native-ad-request-ids.patch', import.meta.url));
const apply = (args) => spawnSync('git', ['apply', ...args, patch], { encoding: 'utf8' });
if (apply(['--reverse', '--check']).status === 0) {
  console.log('Yandex request-identity and Android/iOS ILRD patch is applied.');
} else {
  if (process.argv.includes('--check')) throw new Error('Yandex native ad patch missing or drifted. Run postinstall.');
  const check = apply(['--check']);
  if (check.status !== 0) throw new Error(`Yandex patch does not match installed SDK. When upgrading an older patch, reinstall locked dependencies first: ${check.stderr}`);
  const result = apply([]);
  if (result.status !== 0) throw new Error(`Yandex patch failed: ${result.stderr}`);
}
