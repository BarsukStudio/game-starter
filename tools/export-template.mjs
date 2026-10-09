#!/usr/bin/env node
// Export a selected native stack into an empty directory; never overwrite a game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const template = fileURLToPath(new URL('../template/', import.meta.url));
export const CAS_EXCLUDED_FILES = Object.freeze([
  'platform/ads/native-admob.js', 'platform/ads/native-yandex.js',
  'platform/ads/native-ad-events.js', 'platform/consent-signals.js',
  'scripts/admob-files.json', 'scripts/verify-admob.mjs',
  'scripts/patch-native-ad-events.mjs', 'scripts/patches/native-ad-request-ids.patch',
  'scripts/ad-revenue-test.mjs', 'scripts/ad-revenue-wiring-check.mjs',
  'native/android/ConsentSignalsPlugin.java', 'native/ios/ConsentSignalsPlugin.swift',
]);
const casExcluded = new Set(CAS_EXCLUDED_FILES);

/** Copy shared modules plus the selected advertising overlay to a new project seed. */
export function exportTemplate({ nativeStack, out }) {
  if (!['admob', 'cas'].includes(nativeStack)) throw new Error('Choose --native-stack admob or cas explicitly.');
  if (!out) throw new Error('Specify --out <empty-directory>.');
  const destination = path.resolve(out);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) {
    throw new Error('Template output must be empty; review existing consumer changes separately.');
  }
  function copy(source, prefix = '') {
    if (!fs.existsSync(source)) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (nativeStack === 'cas' && casExcluded.has(relative)) continue;
      if (entry.isDirectory()) copy(path.join(source, entry.name), `${relative}/`);
      else {
        const target = path.join(destination, relative.startsWith('platform/') ? `src/js/${relative}` : relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(source, entry.name), target);
      }
    }
  }
  for (const tree of ['platform', 'scripts', 'native']) copy(path.join(template, tree), `${tree}/`);
  if (nativeStack === 'cas') {
    for (const tree of ['platform', 'scripts', 'native']) copy(path.join(template, 'variants/cas', tree), `${tree}/`);
  }
  if (nativeStack === 'cas') fs.copyFileSync(path.join(template, 'variants/cas/vite.config.ts'), path.join(destination, 'vite.config.ts'));
  return destination;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'native-stack': { type: 'string' }, out: { type: 'string' } } });
  console.log(exportTemplate({ nativeStack: values['native-stack'], out: values.out }));
}
