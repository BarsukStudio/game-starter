// Whether the template's edges are where `template/manifest.js` says they are.
//
// A template is copyable only if a game can know, before copying it, what it
// will have to supply. Reviewing imports by eye does not survive the third
// consumer: a new relative import into the game that cut the template reads as
// ordinary code right up until a second game copies the file and the build
// cannot resolve it.
//
// So the declaration is the contract and this walks the source against it, in
// both directions: nothing may be imported that is not declared, and nothing may
// be declared that is no longer imported.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONSUMER_SEAMS,
  EXTERNAL_PREREQUISITES,
  FORBIDDEN_RUNTIME_IMPORT,
  TEMPLATE_ROOT,
} from '../template/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.join(here, '..', 'template');
const platformRoot = path.join(templateRoot, TEMPLATE_ROOT);

// Comments are removed before anything is matched, and that is load-bearing
// rather than tidiness: prose in this template contains the words `apart from
// "no receipt was loaded"`, which a bare search for a specifier after `from`
// reads as an import of a module named after half an English sentence. The
// guard against `:` keeps a `https://` inside a string from starting a comment.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, '$1');
}

function listModules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listModules(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

// Static `from '…'`, bare side-effect `import '…'`, and dynamic `import('…')`.
// All three, because a dynamic import is exactly how the two lazily loaded SDKs
// enter this template, and a check that only read static ones would declare the
// template closed while two packages were still required at runtime.
function readImports(source) {
  const code = stripComments(source);
  const found = [];
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

// Every static import as (clause, specifier). `[^;]` rather than `[\s\S]`: an
// import statement ends at its semicolon, and a clause allowed to cross one
// would start at the previous import and swallow everything between the two.
const STATIC_IMPORT = /\bimport\s+([^;]*?)\s+from\s*['"]([^'"]+)['"]/g;

// The named bindings taken from one specifier, so the declared export list can
// be checked and not merely written down. A namespace import answers null: what
// it reaches for cannot be read off the import.
function readNamedBindings(source, specifier) {
  const code = stripComments(source);
  const names = [];
  for (const match of code.matchAll(STATIC_IMPORT)) {
    if (match[2] !== specifier) continue;
    const bindings = match[1].trim();
    if (bindings.startsWith('*')) return null;
    const braced = /^\{([\s\S]*)\}$/.exec(bindings);
    if (!braced) continue;
    for (const part of braced[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

// Where a relative specifier actually lands, named the way the declaration names
// it: relative to the template root, so one seam has one name however many
// different `../` chains reach it.
function resolveSeamKey(fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(platformRoot, resolved);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

const modules = listModules(platformRoot);
const sources = new Map(modules.map((file) => [file, fs.readFileSync(file, 'utf8')]));

test('the template carries modules to check', () => {
  // A walk that found nothing would pass every assertion below while proving
  // nothing at all.
  assert.ok(modules.length >= 9, `expected the template's modules, found ${modules.length}`);
});

test('every relative import stays inside the template or is a declared seam', () => {
  const seen = new Set();
  for (const [file, source] of sources) {
    for (const specifier of readImports(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (resolved.startsWith(`${platformRoot}${path.sep}`) && fs.existsSync(resolved)) continue;
      const key = resolveSeamKey(file, specifier);
      assert.ok(
        Object.hasOwn(CONSUMER_SEAMS, key),
        `${path.relative(templateRoot, file)} imports ${specifier} (${key}), which is neither a template module nor a declared consumer seam`,
      );
      seen.add(key);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    Object.keys(CONSUMER_SEAMS).sort(),
    'every declared seam must still be imported, or the declaration is describing a template that no longer exists',
  );
});

test('each seam is used through exactly the exports it declares', () => {
  for (const [seam, declared] of Object.entries(CONSUMER_SEAMS)) {
    const used = new Set();
    for (const [file, source] of sources) {
      for (const specifier of readImports(source)) {
        if (!specifier.startsWith('.')) continue;
        if (resolveSeamKey(file, specifier) !== seam) continue;
        const names = readNamedBindings(source, specifier);
        assert.ok(names, `${seam} is imported as a namespace; its surface cannot be checked`);
        for (const name of names) used.add(name);
      }
    }
    assert.deepEqual([...used].sort(), [...declared].sort(), `the declared exports of ${seam}`);
  }
});

test('every bare import is a declared prerequisite, and every prerequisite is imported', () => {
  const seen = new Set();
  for (const [file, source] of sources) {
    for (const specifier of readImports(source)) {
      if (specifier.startsWith('.')) continue;
      assert.ok(
        EXTERNAL_PREREQUISITES.includes(specifier),
        `${path.relative(templateRoot, file)} imports ${specifier}, which is not a declared prerequisite`,
      );
      seen.add(specifier);
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    [...EXTERNAL_PREREQUISITES].sort(),
    'a prerequisite nobody imports is a dependency a game would install for nothing',
  );
});

test('a dynamic import must name its module as a literal', () => {
  // Everything above reads specifiers out of the source, so a specifier the
  // source does not contain is a specifier no declaration can cover.
  // `import(chosenAtRuntime)` would leave the template importing something this
  // suite reports as closed — which is worse than an undeclared import, because
  // it reads as proven.
  //
  // Forbidden rather than tolerated: nothing in a transport layer needs to
  // choose its SDK by computation, and a game that one day does can declare a
  // seam for it.
  for (const [file, source] of sources) {
    const code = stripComments(source);
    for (const match of code.matchAll(/\bimport\s*\(/g)) {
      assert.match(
        code.slice(match.index),
        /^\bimport\s*\(\s*['"]/,
        `${path.relative(templateRoot, file)} imports a module it names at runtime; a declared closure cannot cover one`,
      );
    }
  }
});

test('the template never imports the starter', () => {
  // The starter is a devDependency. A template module importing it would put it
  // in the shipped bundle of every game cut from this one.
  for (const [file, source] of sources) {
    for (const specifier of readImports(source)) {
      assert.ok(
        specifier !== FORBIDDEN_RUNTIME_IMPORT && !specifier.startsWith(`${FORBIDDEN_RUNTIME_IMPORT}/`),
        `${path.relative(templateRoot, file)} imports ${specifier}; nothing shipped may import the starter`,
      );
    }
  }
});

test('the purchase capability is gated on the catalogue, not on the shell', () => {
  // Read as source, deliberately. Evaluating `bridge.js` here would mean
  // stubbing four ad SDKs and the app-shell plugins to reach one boolean, and
  // what that boolean must be built from is a template rule, not a plugin's
  // behaviour. The consuming game proves the running answer: its conformance run
  // holds a platform that says it can sell to naming what it sells.
  const bridge = fs.readFileSync(path.join(platformRoot, 'bridge.js'), 'utf8');
  const body = /export function supportsNativePurchases\(\) \{([\s\S]*?)\n\}/.exec(bridge);
  assert.ok(body, 'the facade must declare the capability');
  assert.match(
    body[1],
    /isNative && cdvPurchase\.hasProducts\(\)/,
    'a build with an empty catalogue is valid, but it may not claim it can sell',
  );
});
