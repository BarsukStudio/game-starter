#!/usr/bin/env node
// Only Yandex needs patched request identities. AdMob uses the official API.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './verify-admob.mjs';

const patch = fileURLToPath(new URL('./patches/native-ad-request-ids.patch', import.meta.url));
const apply = (args) => spawnSync('git', ['apply', ...args, patch], { encoding: 'utf8' });
if (apply(['--reverse', '--check']).status === 0) {
  console.log('Yandex request-identity patch is applied.');
} else {
  if (process.argv.includes('--check')) throw new Error('Yandex native ad patch missing or drifted. Run postinstall.');
  const check = apply(['--check']);
  if (check.status !== 0) throw new Error(`Yandex patch does not match installed SDK: ${check.stderr}`);
  const result = apply([]);
  if (result.status !== 0) throw new Error(`Yandex patch failed: ${result.stderr}`);
}
