#!/usr/bin/env node
// Read-only three-way inventory. Never overwrite consumer policy automatically.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CAS_EXCLUDED_FILES } from './export-template.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, baseline: { type: 'string' }, 'native-stack': { type: 'string' } } });
const nativeStack = values['native-stack'] ?? 'admob';
if (!['admob', 'cas'].includes(nativeStack)) throw new Error('Expected --native-stack admob or cas.');
if (!values.root || !values.baseline) throw new Error('Usage: barsuk-compare-template --root <game> --baseline <previous-starter-package>');
const candidate = fileURLToPath(new URL('../template/', import.meta.url));
const baseline = path.resolve(values.baseline, 'template');
if (!fs.statSync(baseline).isDirectory()) throw new Error('Baseline must contain template/.');
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
function files(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(root, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
}
for (const [tree, destination] of [['platform', 'src/js/platform'], ['scripts', 'scripts']]) {
  const overlay = root => path.join(root, 'variants/cas', tree);
  for (const file of [...new Set([...files(path.join(candidate, tree)), ...files(path.join(baseline, tree)),
    ...(nativeStack === 'cas' ? [...files(overlay(candidate)), ...files(overlay(baseline))] : [])])].sort()) {
    if (nativeStack === 'cas' && CAS_EXCLUDED_FILES.includes(`${tree}/${file}`)) continue;
    const selected = root => nativeStack === 'cas' && fs.existsSync(path.join(overlay(root), file))
      ? path.join(overlay(root), file) : path.join(root, tree, file);
    const next = read(selected(candidate));
    const old = read(selected(baseline));
    const current = read(path.resolve(values.root, destination, file));
    const status = current === next ? 'current' : current === null ? 'not-copied'
      : next === old ? 'consumer-change' : current === old ? 'template-update' : 'review-both';
    console.log(`${status.padEnd(16)} ${destination}/${file}`);
  }
}
