#!/usr/bin/env node
// Strict drift check: every copied template file is either identical to the
// pinned starter's template or a reviewed, recorded divergence.
//
// `barsuk-compare-template` is an inventory for planning an upgrade; nothing
// fails on it. Copies therefore drifted silently: a guard added to one game's
// adapter never reached the template, so the next game cut from it shipped
// without the guard. This check fails instead.
//
// A divergence is pinned to the exact contents on both sides. Recording a whole
// file as "allowed to differ" would hide every later edit to it; with both
// hashes recorded, an edit to the game's copy or a template update to the same
// file fails again until someone has looked at it and recorded the new pair.
//
// <root>/template-divergence.json:
//   { "<consumer path>": { "reason": "...", "template": "<sha256>",
//                          "consumer": "<sha256> | null (deliberately absent)" } }
//
// Covers the AdMob template only; a CAS consumer's overlay files would all read
// as drift here, so CAS games keep the inventory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const TREES = [['platform', 'src/js/platform'], ['scripts', 'scripts']];
const DIVERGENCE_FILE = 'template-divergence.json';

const hash = (file) => fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  : null;

function files(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(root, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
}

export function verifyTemplate({ root, template = fileURLToPath(new URL('../template/', import.meta.url)) }) {
  const divergencePath = path.join(root, DIVERGENCE_FILE);
  const divergence = fs.existsSync(divergencePath) ? JSON.parse(fs.readFileSync(divergencePath, 'utf8')) : {};
  const problems = [];
  const seen = new Set();
  let current = 0;
  for (const [tree, destination] of TREES) {
    for (const file of files(path.join(template, tree)).sort()) {
      const target = `${destination}/${file}`;
      seen.add(target);
      const expected = hash(path.join(template, tree, file));
      const actual = hash(path.join(root, target));
      const entry = divergence[target];
      if (!entry) {
        if (actual === expected) current++;
        else problems.push(`${target}: ${actual === null ? 'missing' : 'differs from the template'}; copy the template file, or record a divergence with template ${expected} and consumer ${actual}`);
        continue;
      }
      if (actual === expected) {
        problems.push(`${target}: matches the template again; remove its divergence entry`);
        continue;
      }
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push(`${target}: a divergence needs a reason`);
      if (entry.template !== expected) problems.push(`${target}: the template changed since this divergence was reviewed; merge the update, then record template ${expected}`);
      if (entry.consumer !== actual) problems.push(`${target}: the copy changed since this divergence was reviewed; review it, then record consumer ${actual}`);
    }
  }
  for (const target of Object.keys(divergence)) {
    if (!seen.has(target)) problems.push(`${target}: not a template file; remove its divergence entry`);
  }
  return { problems, current, divergent: Object.keys(divergence).length };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const root = path.resolve(values.root ?? process.cwd());
  const { problems, current, divergent } = verifyTemplate({ root });
  for (const problem of problems) console.error(problem);
  if (problems.length) {
    console.error(`template drift: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`template: ${current} file(s) current, ${divergent} recorded divergence(s)`);
}
