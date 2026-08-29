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
  FORBIDDEN_RUNTIME_IMPORT,
  TEMPLATE_TREES,
} from '../template/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.join(here, '..', 'template');
const platformRoot = path.join(templateRoot, 'platform');

// Node builtins are not prerequisites: every consuming game already has them,
// and listing them would turn the declaration into an inventory of Node.
const isBuiltin = (specifier) => specifier.startsWith('node:');

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
    // Both extensions: the platform tree is `.js` inside a bundler, the script
    // tree is `.mjs` under plain Node.
    const isModule = entry.name.endsWith('.js') || entry.name.endsWith('.mjs');
    return entry.isFile() && isModule ? [full] : [];
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

// Every regular-expression literal in a module. Crude on purpose: it only has to
// separate "this token is what the code matches on" from "this token appears in
// a message about the code".
function readRegexLiterals(code) {
  return code.match(/\/(?:[^/\\\n[]|\\.|\[[^\]\n]*\])+\/[gimsuy]*/g) ?? [];
}

// Where a relative specifier actually lands, named the way the declaration names
// it: relative to the template root, so one seam has one name however many
// different `../` chains reach it.
function resolveSeamKey(treeRoot, fromFile, specifier) {
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(treeRoot, resolved);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

// Every tree, read once. A tree that walked to nothing would pass every
// assertion below while proving nothing at all, so the count is asserted too.
const trees = Object.entries(TEMPLATE_TREES).map(([name, declaration]) => {
  const treeRoot = path.join(templateRoot, name);
  const modules = listModules(treeRoot);
  return {
    name,
    treeRoot,
    declaration,
    modules,
    sources: new Map(modules.map((file) => [file, fs.readFileSync(file, 'utf8')])),
  };
});

const allSources = new Map(trees.flatMap((tree) => [...tree.sources]));

test('every tree carries modules to check', () => {
  assert.deepEqual(
    trees.map(({ name }) => name).sort(),
    Object.keys(TEMPLATE_TREES).sort(),
    'every declared tree must exist on disk',
  );
  for (const { name, modules } of trees) {
    assert.ok(modules.length, `the ${name} tree walked to nothing`);
  }
});

for (const { name, treeRoot, declaration, sources } of trees) {
  const { seams, prerequisites } = declaration;

  test(`[${name}] every relative import stays inside the tree or is a declared seam`, () => {
    const seen = new Set();
    for (const [file, source] of sources) {
      for (const specifier of readImports(source)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (resolved.startsWith(`${treeRoot}${path.sep}`) && fs.existsSync(resolved)) continue;
        const key = resolveSeamKey(treeRoot, file, specifier);
        assert.ok(
          Object.hasOwn(seams, key),
          `${path.relative(templateRoot, file)} imports ${specifier} (${key}), which is neither a module of this tree nor a declared consumer seam`,
        );
        seen.add(key);
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      Object.keys(seams).sort(),
      'every declared seam must still be imported, or the declaration is describing a template that no longer exists',
    );
  });

  test(`[${name}] each seam is used through exactly the exports it declares`, () => {
    for (const [seam, declared] of Object.entries(seams)) {
      const used = new Set();
      for (const [file, source] of sources) {
        for (const specifier of readImports(source)) {
          if (!specifier.startsWith('.')) continue;
          if (resolveSeamKey(treeRoot, file, specifier) !== seam) continue;
          const names = readNamedBindings(source, specifier);
          assert.ok(names, `${seam} is imported as a namespace; its surface cannot be checked`);
          for (const name of names) used.add(name);
        }
      }
      assert.deepEqual([...used].sort(), [...declared].sort(), `the declared exports of ${seam}`);
    }
  });

  test(`[${name}] every bare import is a declared prerequisite, and every prerequisite is imported`, () => {
    const seen = new Set();
    for (const [file, source] of sources) {
      for (const specifier of readImports(source)) {
        if (specifier.startsWith('.') || isBuiltin(specifier)) continue;
        assert.ok(
          prerequisites.includes(specifier),
          `${path.relative(templateRoot, file)} imports ${specifier}, which is not a declared prerequisite`,
        );
        seen.add(specifier);
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      [...prerequisites].sort(),
      'a prerequisite nobody imports is a dependency a game would install for nothing',
    );
  });
}

test('every declared source dependency is real and still looked for', () => {
  // The closure above covers imports. These two read consumer *text*, so nothing
  // resolves and nothing fails at load — the declaration is the only record that
  // the dependency exists, and it is worth only as much as its agreement with
  // the code.
  for (const { name, treeRoot, declaration, sources } of trees) {
    for (const { reader, needs } of declaration.sourceDependencies ?? []) {
      const file = path.join(treeRoot, reader);
      assert.ok(sources.has(file), `[${name}] ${reader} is declared to read consumer text but is not in the tree`);
      // Inside a pattern, not merely present in the file. Both readers name the
      // token in an error message too, so "the string appears somewhere" passes
      // just as well for a reader that has stopped looking for it — which is the
      // one state this test exists to catch.
      const patterns = readRegexLiterals(stripComments(sources.get(file)));
      for (const token of needs) {
        assert.ok(
          patterns.some((pattern) => pattern.includes(token)),
          `[${name}] ${reader} declares it needs ${token}, but no pattern in it looks for one`,
        );
      }
    }
  }
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
  for (const [file, source] of allSources) {
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
  for (const [file, source] of allSources) {
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

test('the native banner is adaptive, and says so in code rather than in prose', () => {
  // A literal, pinned for the same reason the capability above is: the size the
  // banner is requested at is template policy, and nothing downstream notices
  // when it changes. It changed once already — a game whose own bridge asked for
  // an adaptive banner was cut over to this template, which asked for a smart
  // one, and nothing objected: AdMob serves both, so the build, the tests and the
  // logs all stayed green while the banner got smaller.
  //
  // Read with the comments stripped, because the prose beside the literal names
  // the size it replaced.
  const admob = stripComments(
    fs.readFileSync(path.join(platformRoot, 'ads', 'native-admob.js'), 'utf8'),
  );
  assert.match(
    admob,
    /adSize: BannerAdSize\.ADAPTIVE_BANNER/,
    'the native banner must be requested at the adaptive size',
  );
  assert.doesNotMatch(
    admob,
    /SMART_BANNER/,
    'SMART_BANNER is a fixed 320x50 on phones; it may not come back by a re-sync',
  );
});
