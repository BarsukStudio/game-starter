#!/usr/bin/env node
// Read-only check of the built bundle for browser APIs newer than the oldest
// WebView a game still runs on. A `build.target` like es2020 lowers syntax only;
// it never adds a missing API, so `Object.hasOwn` reached Android WebViews older
// than Chrome 93 and threw on every progress write. It reads `dist/`, not the
// source, because dependencies ship there too.
//
// The bundle is parsed with `parseSync` from the game's own Vite (8 or later),
// resolved from the game root. The starter keeps no dependencies, and a lexer of
// its own proved unable to tell a division from a regex or a guard from a
// negated one.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// es2020 output keeps optional chaining and `??`, which already need Chrome 80:
// an older WebView cannot parse the bundle at all, so APIs below it are moot.
export const DEFAULT_MIN_CHROME = 80;

// Chrome / Android WebView versions from MDN. `static` and `global` match the
// whole callee (a `globalThis.` / `window.` / `self.` prefix included), `method`
// any receiver, `new` a construction.
export const APIS = [
  { name: 'Object.hasOwn', chrome: 93, kind: 'static', path: ['Object', 'hasOwn'] },
  { name: 'String.prototype.replaceAll', chrome: 85, kind: 'method', members: ['replaceAll'] },
  { name: 'Array/String.prototype.at', chrome: 92, kind: 'method', members: ['at'] },
  { name: 'structuredClone', chrome: 98, kind: 'global', path: ['structuredClone'] },
  { name: 'Array.prototype.findLast', chrome: 97, kind: 'method', members: ['findLast', 'findLastIndex'] },
  { name: 'Array.prototype.toSorted / toReversed / toSpliced', chrome: 110, kind: 'method', members: ['toSorted', 'toReversed', 'toSpliced'] },
  { name: 'Object.groupBy', chrome: 117, kind: 'static', path: ['Object', 'groupBy'] },
  { name: 'Map.groupBy', chrome: 117, kind: 'static', path: ['Map', 'groupBy'] },
  { name: 'Promise.any', chrome: 85, kind: 'static', path: ['Promise', 'any'] },
  { name: 'AggregateError', chrome: 85, kind: 'new', path: ['AggregateError'] },
  { name: 'WeakRef', chrome: 84, kind: 'new', path: ['WeakRef'] },
  { name: 'FinalizationRegistry', chrome: 84, kind: 'new', path: ['FinalizationRegistry'] },
  { name: 'crypto.randomUUID', chrome: 92, kind: 'method', members: ['randomUUID'] },
  { name: 'Intl.Segmenter', chrome: 87, kind: 'new', path: ['Intl', 'Segmenter'] },
  { name: 'Element.replaceChildren', chrome: 86, kind: 'method', members: ['replaceChildren'] },
  // `scheduler` itself is absent before Chrome 94, so `scheduler.postTask?.()` still throws.
  { name: 'scheduler.postTask', chrome: 94, kind: 'static', path: ['scheduler', 'postTask'], ownerMayBeMissing: true },
  { name: 'AbortSignal.timeout', chrome: 103, kind: 'static', path: ['AbortSignal', 'timeout'] },
  { name: 'Element.checkVisibility', chrome: 105, kind: 'method', members: ['checkVisibility'] },
  { name: 'String.prototype.isWellFormed / toWellFormed', chrome: 111, kind: 'method', members: ['isWellFormed', 'toWellFormed'] },
  { name: 'AbortSignal.any', chrome: 116, kind: 'static', path: ['AbortSignal', 'any'] },
  { name: 'Promise.withResolvers', chrome: 119, kind: 'static', path: ['Promise', 'withResolvers'] },
  { name: 'URL.canParse', chrome: 120, kind: 'static', path: ['URL', 'canParse'] },
  { name: 'Array.fromAsync', chrome: 121, kind: 'static', path: ['Array', 'fromAsync'] },
  { name: 'Set methods (union, intersection, ...)', chrome: 122, kind: 'method', members: ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom'] },
];

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// The game's Vite, resolved the way the game itself would import it.
export async function loadParser(root) {
  let entry;
  try {
    entry = createRequire(path.join(root, 'package.json')).resolve('vite');
  } catch {
    throw new Error(`No Vite installed in ${root}; the bundle API check parses with the game's Vite 8 or later.`);
  }
  const vite = await import(pathToFileURL(entry).href);
  if (typeof vite.parseSync !== 'function') {
    throw new Error(`The Vite in ${root} (${vite.version ?? 'unknown version'}) has no parseSync; the bundle API check needs Vite 8 or later.`);
  }
  return vite.parseSync;
}

const stripParens = (node) => (node?.type === 'ParenthesizedExpression' ? stripParens(node.expression) : node);
const unwrap = (node) => (node?.type === 'ParenthesizedExpression' || node?.type === 'ChainExpression' ? unwrap(node.expression) : node);

// `a.b.c` as ['a', 'b', 'c']; null for anything a feature test could not name.
function chainOf(node) {
  node = unwrap(node);
  if (node?.type === 'Identifier') return [node.name];
  if (node?.type !== 'MemberExpression') return null;
  const property = !node.computed && node.property.type === 'Identifier' ? node.property.name
    : node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : null;
  const object = chainOf(node.object);
  return property !== null && object ? [...object, property] : null;
}

function stripGlobals(chain) {
  let start = 0;
  while (start < chain.length - 1 && GLOBAL_OBJECTS.has(chain[start])) start++;
  return chain.slice(start);
}

const same = (a, b) => Boolean(a && b) && a.length === b.length && a.every((part, index) => part === b[index]);

// The API a call or construction uses, and the callee a feature test must name.
// `fn.call(...)` / `fn.apply(...)` / `fn.bind(...)` count as uses of `fn`.
function apiUse(node, apis) {
  // `value` is the expression that evaluates to the API itself; `next` is the
  // step that consumes it: the call, or `.call` / `.apply` / `.bind`.
  let value = unwrap(node.callee);
  let next = node;
  // A parenthesized optional chain ends at its parenthesis: `(X?.call)(...)`
  // yields undefined and then calls it, so no `?.` inside protects this call.
  const chainEnded = stripParens(node.callee)?.type === 'ChainExpression';
  if (node.type === 'CallExpression' && value?.type === 'MemberExpression' && !value.computed
    && ['call', 'apply', 'bind'].includes(value.property.name)) {
    next = value;
    value = unwrap(value.object);
  }
  // `?.` on that very step yields undefined for a missing property. It does not
  // help a bare identifier (ReferenceError), an owner that may itself be absent,
  // or a later step: `X.call?.()` still reads `.call` of undefined.
  const chain = chainOf(value);
  const stripped = chain && stripGlobals(chain);
  const member = value?.type === 'MemberExpression'
    ? (!value.computed ? value.property.name : typeof value.property.value === 'string' ? value.property.value : null) : null;
  for (const api of apis) {
    const hit = api.kind === 'method' ? node.type === 'CallExpression' && api.members.includes(member)
      : api.kind === 'new' ? node.type === 'NewExpression' && same(stripped, api.path)
        : node.type === 'CallExpression' && same(stripped, api.path);
    if (!hit) continue;
    if (next.optional && !chainEnded && value.type === 'MemberExpression' && !api.ownerMayBeMissing) return null;
    return { api, callee: stripped };
  }
  return null;
}

const isString = (node, value) => node?.type === 'Literal' && node.value === value;

// True only when `test` being truthy proves the callee exists: `typeof X ===
// 'function'`, `typeof X !== 'undefined'`, `'name' in owner`, or an `&&` of
// tests one of which is that. Comparisons with booleans, commas and negations
// prove nothing.
function provesCallee(test, callee) {
  test = unwrap(test);
  if (!callee || !test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') return provesCallee(test.left, callee) || provesCallee(test.right, callee);
  if (test.type !== 'BinaryExpression') return false;
  if (test.operator === 'in') {
    const owner = chainOf(test.right);
    return isString(unwrap(test.left), callee.at(-1)) && Boolean(owner)
      && (callee.length > 1 ? same(stripGlobals(owner), callee.slice(0, -1)) : owner.length === 1 && GLOBAL_OBJECTS.has(owner[0]));
  }
  const [left, right] = [unwrap(test.left), unwrap(test.right)];
  for (const [typeOf, literal] of [[left, right], [right, left]]) {
    if (typeOf?.type !== 'UnaryExpression' || typeOf.operator !== 'typeof') continue;
    const chain = chainOf(typeOf.argument);
    if (!chain || !same(stripGlobals(chain), callee)) continue;
    if (['===', '=='].includes(test.operator) && isString(literal, 'function')) return true;
    if (['!==', '!='].includes(test.operator) && isString(literal, 'undefined')) return true;
  }
  return false;
}

// A use is guarded when an enclosing `if` / `?:` consequent or `&&` right side
// is conditioned on a test proving the callee exists. The walk stops at a
// function boundary: a callback may run long after the test. A use after an
// early `return` on the negated test is not recognised.
function isGuarded(ancestors, callee) {
  for (let i = ancestors.length - 1; i > 0; i--) {
    const { node: parent } = ancestors[i - 1];
    const { key } = ancestors[i];
    if (FUNCTIONS.has(ancestors[i].node.type)) return false;
    if ((parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') && key === 'consequent' && provesCallee(parent.test, callee)) return true;
    if (parent.type === 'LogicalExpression' && parent.operator === '&&' && key === 'right' && provesCallee(parent.left, callee)) return true;
  }
  return false;
}

function findUnguardedUses(program, apis) {
  const found = [];
  const ancestors = [];
  const visit = (node, key) => {
    ancestors.push({ node, key });
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const use = apiUse(node, apis);
      // `typeof scheduler.postTask` itself throws when `scheduler` is absent, so
      // no recognised test covers an API whose owner may be missing.
      if (use && (use.api.ownerMayBeMissing || !isGuarded(ancestors, use.callee))) found.push({ api: use.api, start: node.start });
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') visit(item, childKey);
      } else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value, childKey);
    }
    ancestors.pop();
  };
  visit(program, null);
  return found;
}

function lineAt(source, offset) {
  let line = 1;
  for (let i = source.indexOf('\n'); i >= 0 && i < offset; i = source.indexOf('\n', i + 1)) line++;
  return line;
}

export async function verifyWebCompat({ dir, root = process.cwd(), minChrome = DEFAULT_MIN_CHROME, parse }) {
  const assets = path.join(dir, 'assets');
  if (!fs.existsSync(assets)) return { errors: [`No built assets at ${assets}; run the build first.`], files: 0 };
  const files = fs.readdirSync(assets).filter((file) => file.endsWith('.js')).sort();
  if (!files.length) return { errors: [`No JavaScript bundles in ${assets}; nothing was checked.`], files: 0 };
  const parseSync = parse ?? await loadParser(root);
  const apis = APIS.filter(({ chrome }) => chrome > minChrome);
  const errors = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(assets, file), 'utf8');
    const result = parseSync(file, source, { lang: 'js', sourceType: 'module' });
    if (result.errors?.length) {
      errors.push(`assets/${file}: cannot be parsed (${result.errors[0].message}); nothing in it was checked.`);
      continue;
    }
    for (const use of findUnguardedUses(result.program, apis)) {
      errors.push(`assets/${file}:${lineAt(source, use.start)}: ${use.api.name} needs Chrome ${use.api.chrome}; the minimum is ${minChrome}. Use an older API or guard the call with a positive feature test.`);
    }
  }
  return { errors, files: files.length };
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string', default: 'dist' }, root: { type: 'string', default: '.' }, 'min-chrome': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log(`Usage: barsuk-verify-web-compat [--dir dist] [--root .] [--min-chrome ${DEFAULT_MIN_CHROME}]\nRun from the game root after the web build; --root is where the game's Vite 8+ is installed. Read-only; checks a known API list, not every API, and runs nothing on a device.`);
    return;
  }
  const minChrome = Number(values['min-chrome'] ?? DEFAULT_MIN_CHROME);
  if (!Number.isInteger(minChrome) || minChrome < 1) throw new Error('--min-chrome must be a positive integer.');
  const result = await verifyWebCompat({ dir: path.resolve(values.dir), root: path.resolve(values.root), minChrome });
  for (const error of result.errors) console.error(`FAIL: ${error}`);
  console.log(`${result.errors.length ? 'FAILED' : 'PASSED'}: ${result.files} bundle files against Chrome ${minChrome}, ${result.errors.length} errors. Only the listed APIs are checked; no WebView ran the bundle.`);
  process.exitCode = result.errors.length ? 1 : 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
