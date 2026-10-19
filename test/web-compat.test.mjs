import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadParser, verifyWebCompat } from '../tools/verify-web-compat.mjs';

const tool = fileURLToPath(new URL('../tools/verify-web-compat.mjs', import.meta.url));

// The checker parses with the consuming game's Vite, and the starter installs
// none. Point BARSUK_VITE_ROOT at a project with Vite 8+ installed (a game root)
// to run the parsing cases; without it they are reported as skipped.
const viteRoot = process.env.BARSUK_VITE_ROOT && path.resolve(process.env.BARSUK_VITE_ROOT);
const parse = viteRoot ? await loadParser(viteRoot) : null;
const parsing = { skip: parse ? false : 'set BARSUK_VITE_ROOT to a project with Vite 8+ installed' };

function dist(t, bundles) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-web-compat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'assets'));
  for (const [name, source] of Object.entries(bundles)) fs.writeFileSync(path.join(directory, 'assets', name), source);
  return directory;
}

const check = (dir, options = {}) => verifyWebCompat({ dir, parse, ...options });
const errorsFor = async (t, source) => (await check(dist(t, { 'main.js': source }))).errors;

// gym2 2.3.16 shipped this shape; it threw on WebViews older than Chrome 93.
test('an unguarded Object.hasOwn call fails with its file and line', parsing, async (t) => {
  const { errors } = await check(dist(t, { 'index.js': 'const a = 1;\nif (Object.hasOwn(values, key)) save(key);\n' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^assets\/index\.js:2: Object\.hasOwn needs Chrome 93; the minimum is 80\./);
});

test('the template request id generator passes: its randomUUID call is feature-tested', parsing, async (t) => {
  const source = fs.readFileSync(new URL('../template/platform/request-id.js', import.meta.url), 'utf8');
  assert.deepEqual(await errorsFor(t, source), []);
});

for (const [label, source] of [
  ['a feature test in a comment', '// typeof Object.hasOwn === "function"\nObject.hasOwn(obj, key);\n'],
  ['a negative test', "if (typeof Object.hasOwn === 'undefined') {\n  Object.hasOwn(obj, key);\n}\n"],
  ['a test whose statement already ended', "if (typeof Object.hasOwn === 'function') log('supported');\nObject.hasOwn(obj, key);\n"],
  ['an else branch', "if (typeof Object.hasOwn === 'function') a(); else Object.hasOwn(obj, key);\n"],
  ['a test of another API with the same member', "if (typeof Promise.any === 'function') AbortSignal.any([signal]);\n"],
  ['a test joined by ||', "if (typeof Object.hasOwn === 'function' || legacy) Object.hasOwn(obj, key);\n"],
  ['a test passed to a function', "if (check(typeof Object.hasOwn === 'function')) Object.hasOwn(obj, key);\n"],
  ['a test far from the call', `const ok = typeof crypto.randomUUID === 'function';\n${'x();\n'.repeat(100)}crypto.randomUUID();\n`],
  ['a test compared with false', "if ((typeof Object.hasOwn === 'function') === false) {\n  Object.hasOwn({}, 'x');\n}\n"],
  ['a test before a comma', "if (typeof Object.hasOwn === 'function', true) Object.hasOwn({}, 'x');\n"],
  ['a test compared with false before &&', "typeof Object.hasOwn === 'function' === false && Object.hasOwn({}, 'x');\n"],
  ['a test in another template substitution', 'const x = `${typeof Object.hasOwn === "function" && ""}${Object.hasOwn({}, "x")}`;\n'],
  ['a test outside a callback', "if (typeof Object.hasOwn === 'function') later(() => Object.hasOwn({}, 'x'));\n"],
  ['an optional call of a bare global (ReferenceError)', 'structuredClone?.({});\n'],
  ['an optional step after .call (TypeError)', "Object.hasOwn.call?.(Object, {}, 'x');\n"],
  ['an optional call whose owner may be missing', 'scheduler.postTask?.(task);\n'],
  ['an optional receiver before a missing method', 'list?.at(-1);\n'],
  ['a parenthesized optional .call', "(Object.hasOwn?.call)(Object, {}, 'x');\n"],
  ['a parenthesized optional .apply', "(Object.hasOwn?.apply)(Object, [{}, 'x']);\n"],
  ['a parenthesized optional .bind', "(Object.hasOwn?.bind)(Object)({}, 'x');\n"],
  ['a test that itself throws when the owner is absent', "if (typeof scheduler.postTask === 'function') scheduler.postTask(task);\n"],
  ['a template with a substitution', 'if (typeof Object.hasOwn == `func${tion}`) Object.hasOwn(obj, key);\n'],
]) {
  test(`${label} does not guard the call`, parsing, async (t) => {
    assert.equal((await errorsFor(t, source)).length, 1);
  });
}

for (const [label, source] of [
  ['an if statement', "function id() {\n  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();\n}\n"],
  ['an if block', "if (typeof Object.hasOwn == \"function\" && ready) {\n  a();\n  Object.hasOwn(obj, key);\n}\n"],
  ['&&', "typeof structuredClone !== 'undefined' && structuredClone(value);\n"],
  ['a parenthesized test before &&', "(typeof Object.hasOwn === 'function') && Object.hasOwn({}, 'x');\n"],
  ['a ternary', "const copy = typeof globalThis.structuredClone === 'function' ? structuredClone(value) : clone(value);\n"],
  ['an in-check', "if ('structuredClone' in globalThis) copy = structuredClone(value);\n"],
  ['a construction test', "const ref = typeof WeakRef === 'function' ? new WeakRef(target) : null;\n"],
  ['an optional call', 'const id = crypto.randomUUID?.();\n'],
  ['an optional call through the global object', 'globalThis.structuredClone?.({});\n'],
  ['an optional .call', "Object.hasOwn?.call(Object, {}, 'x');\n"],
  // Bakery Tumble's minified Vite 8 bundle wrote both strings as templates.
  ['a template string', 'function id(e) {\n  if (typeof e.randomUUID == `function`) return e.randomUUID();\n}\n'],
  ['a template string in a ternary', 'const s = typeof Intl?.Segmenter == `function` ? new Intl.Segmenter() : null;\n'],
  ['a template undefined test', 'typeof structuredClone != `undefined` && structuredClone(value);\n'],
]) {
  test(`a positive feature test guards the call: ${label}`, parsing, async (t) => {
    assert.deepEqual(await errorsFor(t, source), []);
  });
}

test('calls through the global object or call/apply are found', parsing, async (t) => {
  assert.equal((await errorsFor(t, 'globalThis.structuredClone(value);\nnew window.WeakRef(target);\nObject.hasOwn.call(null, a, b);\n')).length, 3);
});

test('strings, templates, regexes and comments are not calls', parsing, async (t) => {
  const source = [
    "throw new Error('Object.hasOwn(obj, key) is unsupported');",
    'const text = `use structuredClone(x) when ${ready ? "Object.hasOwn" : name}`;',
    'const pattern = /Object.hasOwn\\(a\\)/g; const ratio = a / b / c;',
    'if (ok) /Object.hasOwn(x)/.test(text);',
    '/* crypto.randomUUID() */',
  ].join('\n');
  assert.deepEqual(await errorsFor(t, source), []);
});

test('code inside a template substitution is still checked', parsing, async (t) => {
  assert.equal((await errorsFor(t, 'const id = `item-${crypto.randomUUID()}`;\n')).length, 1);
});

test('a division is not mistaken for a regex that hides the call', parsing, async (t) => {
  for (const source of ["let n = 1;\nn++ / 2; Object.hasOwn({}, 'x');\n", "const x = {} / 2; Object.hasOwn({}, 'x');\n"]) {
    assert.equal((await errorsFor(t, source)).length, 1, source);
  }
});

test('a bundle that cannot be parsed fails instead of passing', parsing, async (t) => {
  const [error] = await errorsFor(t, 'Object.hasOwn(a, b\n');
  assert.match(error, /^assets\/main\.js: cannot be parsed/);
});

test('APIs at or below the minimum are allowed', parsing, async (t) => {
  const dir = dist(t, { 'main.js': 'name.replaceAll("-", "_");\nObject.hasOwn(a, b);\n' });
  assert.equal((await check(dir)).errors.length, 2);
  assert.equal((await check(dir, { minChrome: 85 })).errors.length, 1);
  assert.deepEqual((await check(dir, { minChrome: 93 })).errors, []);
});

test('a missing build or one without JavaScript is an error, not a pass', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-web-compat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.match((await verifyWebCompat({ dir: directory })).errors[0], /No built assets/);
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(path.join(directory, 'assets', 'index.css'), 'body {}');
  assert.match((await verifyWebCompat({ dir: directory })).errors[0], /No JavaScript bundles/);
});

test('a project without Vite stops the check with a readable error', async (t) => {
  const bad = dist(t, { 'main.js': 'Object.hasOwn(a, b);\n' });
  fs.writeFileSync(path.join(bad, 'package.json'), '{}');
  const result = spawnSync(process.execPath, [tool, '--dir', bad, '--root', bad], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No Vite installed in .*parses with the game's Vite 8 or later/);
  assert.doesNotMatch(result.stdout, /PASSED/);
});

test('the command exits non-zero on a finding and zero on a clean bundle', parsing, (t) => {
  const bad = dist(t, { 'main.js': 'list.findLast(x => x);\n' });
  const failed = spawnSync(process.execPath, [tool, '--dir', bad, '--root', viteRoot], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /FAIL: assets\/main\.js:1: Array\.prototype\.findLast needs Chrome 97/);
  const passed = spawnSync(process.execPath, [tool, '--dir', bad, '--root', viteRoot, '--min-chrome', '97'], { encoding: 'utf8' });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /^PASSED: 1 bundle files against Chrome 97/);
});
