// The conformance runner: it drives a consumer's real platform controller
// through the canonical cases and reports which ones its platform honours.
//
// Two things make this possible under Node, and both are the runner's job
// rather than the consumer's:
//
// **Redirection.** A controller reaches for Capacitor, a store plugin and a
// portal SDK, none of which evaluate outside a WebView. A module resolve hook
// swaps them for the consumer's fixtures before the graph is imported.
//
// **Isolation.** Almost everything behind a platform facade keeps module-level
// state — the provider a bridge selected, the SDK namespace an adapter cached,
// an ad lifecycle created at import time, an ownership flag that only moves one
// way. Twenty-odd cases sharing one import of that graph would be twenty-odd
// cases sharing one set of those, and the result would depend on their order.
// So every case gets its own graph: the hook appends the case's id to every URL
// inside the consumer, and ESM keys its cache by URL, so the whole tree is
// evaluated again rather than served from the previous case.
//
// Requires Node >= 22.15 for `module.registerHooks()`. That floor is checked
// here rather than declared in `package.json`, because the manifest and the
// template are plain modules that run on Node 20 and making the whole package
// uninstallable there would be a lie about what it needs.
import * as nodeModule from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONTRACT_VERSION } from './manifest.js';
import { resolveFixtures } from './fixtures-schema.js';

export const REQUIRED_NODE = '22.15.0';

// The ESM cache is per process, while a case id is only unique inside one run.
// Two runs in one process would otherwise collide on `?__case=1` and the second
// one would be served the first one's graph — with the first one's overrides,
// or without the overrides it asked for. Numbering the runs as well keeps the
// key unique for as long as the cache is.
let runs = 0;

// Probed through the namespace, never as a named import: on Node 20 a static
// named import of an export a builtin does not have is a link-time error, and
// the reader gets a SyntaxError instead of the sentence below.
export function assertRunnableHere() {
  if (typeof nodeModule.registerHooks !== 'function') {
    throw new Error(
      `The platform conformance runner needs Node >= ${REQUIRED_NODE} for module.registerHooks(); this is ${process.version}.`
    );
  }
}

// A suite that runs nothing has to fail, not pass quietly. `0/0 cases passed`
// and an exit code of zero is the most expensive kind of green: it reports that
// a platform honours the contract when nothing about the contract was checked.
// The same applies to a registry that is merely malformed — a case with no `run`
// or a name repeated twice silently covers less than it appears to.
function assertRegistry(cases, resolved) {
  assert.ok(Array.isArray(cases) && cases.length, 'the conformance suite must carry at least one case');
  const names = new Set();
  for (const testCase of cases) {
    assert.ok(
      typeof testCase?.name === 'string' && testCase.name.trim(),
      'every case must carry a name'
    );
    assert.ok(!names.has(testCase.name), `two cases are named ${testCase.name}`);
    names.add(testCase.name);
    assert.equal(typeof testCase.run, 'function', `case ${testCase.name} must carry a run()`);
    assert.ok(
      resolved.environments.has(testCase.environment),
      `case ${testCase.name} asks for environment ${testCase.environment}, which the consumer does not declare`
    );
  }
}

function installGlobals(values) {
  const restore = [];
  for (const [name, value] of Object.entries(values)) {
    const existing = Object.getOwnPropertyDescriptor(globalThis, name);
    restore.push(() => {
      if (existing) Object.defineProperty(globalThis, name, existing);
      else delete globalThis[name];
    });
    // Defined rather than assigned: Node ships a read-only `navigator`, and an
    // assignment to it fails silently in sloppy contexts and throws in strict.
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
  return () => {
    for (const undo of restore.reverse()) undo();
  };
}

/**
 * Run the canonical cases against one consumer.
 *
 * @param {object} fixtures the consumer's fixture module (its default export)
 * @param {object[]} cases the canonical cases to run
 * @param {(line: string) => void} [log]
 * @returns {Promise<{passed: number, failed: {name: string, error: Error}[]}>}
 */
export async function runConformance(fixtures, cases, log = console.log) {
  assertRunnableHere();
  const resolved = resolveFixtures(fixtures, { contractVersion: CONTRACT_VERSION });
  assertRegistry(cases, resolved);

  // One hook for the whole run. Registering per case would leave the previous
  // one installed — `registerHooks` returns a deregister handle, not a
  // replacement — and the redirections would stack.
  let active = null;
  const hook = nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (!active) return next(specifier, context);

      const override = active.overrides.get(specifier);
      if (override !== undefined) {
        return { url: `${withCase(override, active.id)}`, shortCircuit: true };
      }

      const result = next(specifier, context);
      if (!result.url.startsWith('file:')) return result;

      let target;
      try {
        target = fs.realpathSync(fileURLToPath(result.url));
      } catch {
        return result;
      }

      const replacement = active.overrides.get(target);
      if (replacement !== undefined) {
        return { ...result, url: withCase(replacement, active.id), shortCircuit: true };
      }

      // Everything of the consumer's own is cache-busted per case; node_modules
      // and the runner itself are left alone, so a fresh consumer graph does not
      // drag a fresh copy of Capacitor along with it.
      const relative = path.relative(resolved.consumerRoot, target);
      const isConsumers = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        && !relative.split(path.sep).includes('node_modules');
      return isConsumers ? { ...result, url: withCase(result.url, active.id) } : result;
    },
  });

  const run = ++runs;
  const failed = [];
  let passed = 0;
  try {
    for (const [index, testCase] of cases.entries()) {
      const environment = resolved.environments.get(testCase.environment);
      const id = `${run}.${index + 1}`;
      const restoreGlobals = installGlobals(environment.globals({ id: index + 1 }));
      active = { id, overrides: environment.overrides };
      try {
        // Imported after the globals are in place: a platform module reads the
        // environment while it evaluates, so a graph imported first would have
        // read the wrong one and cached the answer.
        const module = await import(withCase(pathToFileURL(resolved.controller).href, id));
        const factory = module[resolved.controllerExport];
        assert.equal(
          typeof factory,
          'function',
          `${resolved.controllerExport} must be exported by ${resolved.controller}`
        );
        await testCase.run({ createController: factory, caseId: id });
        passed += 1;
        log(`  ok   ${testCase.name}`);
      } catch (error) {
        failed.push({ name: testCase.name, error });
        log(`  FAIL ${testCase.name}: ${error.message}`);
      } finally {
        active = null;
        restoreGlobals();
      }
    }
  } finally {
    hook.deregister();
  }

  log(`contract ${CONTRACT_VERSION}: ${passed}/${cases.length} cases passed`);
  return { passed, failed };
}

// The case id travels as a query parameter, which is enough to defeat the ESM
// cache and keeps the mechanism out of every module's own API. Built through
// URL rather than by concatenation so a fixture path that already carries a
// query keeps it.
function withCase(target, id) {
  const url = new URL(target, pathToFileURL(`${process.cwd()}/`));
  url.searchParams.set('__case', String(id));
  return url.href;
}
