#!/usr/bin/env node
// Read-only three-way inventory. Never overwrite consumer policy automatically.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: { root: { type: 'string' }, baseline: { type: 'string' } } });
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
  for (const file of [...new Set([...files(path.join(candidate, tree)), ...files(path.join(baseline, tree))])].sort()) {
    const next = read(path.join(candidate, tree, file));
    const old = read(path.join(baseline, tree, file));
    const current = read(path.resolve(values.root, destination, file));
    const status = current === next ? 'current' : current === null ? 'not-copied'
      : next === old ? 'consumer-change' : current === old ? 'template-update' : 'review-both';
    console.log(`${status.padEnd(16)} ${destination}/${file}`);
  }
}
