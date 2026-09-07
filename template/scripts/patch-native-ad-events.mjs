#!/usr/bin/env node
// Native callbacks must echo the JS request identity. Fail on unsupported SDK
// source changes rather than silently producing an unprotected native build.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const patch = fileURLToPath(new URL('./patches/native-ad-request-ids.patch', import.meta.url));
function apply(args) {
  return spawnSync('git', ['apply', ...args, patch], { encoding: 'utf8' });
}
if (apply(['--reverse', '--check']).status === 0) {
  console.log('Native ad request identity patch is already applied.');
} else {
  if (process.argv.includes('--check')) throw new Error('Native ad request identity patch is missing or has drifted. Run postinstall before native builds.');
  const check = apply(['--check']);
  if (check.status !== 0) throw new Error(`Native ad request identity patch does not match installed SDKs: ${check.stderr}`);
  const result = apply([]);
  if (result.status !== 0) throw new Error(`Native ad request identity patch failed: ${result.stderr}`);
  console.log('Applied native ad request identity patch.');
}
