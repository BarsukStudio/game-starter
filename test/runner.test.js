// The runner itself, driven against a miniature consumer that keeps
// module-level state.
//
// The two properties under test are the ones a one-off probe against a real
// game can demonstrate but not defend: that every case gets its own module
// graph, and that nothing a case installs survives it. Both are invisible while
// they work and silently corrupt every result when they stop.
//
// `fixtures/stateful` stands in for a platform: `index.js` is the facade,
// `bridge.js` holds the state a second case must not inherit, `env.js` is the
// module an override replaces.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nodeModule from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONTRACT_VERSION } from '../contract/manifest.js';
import { REQUIRED_NODE, assertRunnableHere, runConformance } from '../contract/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const consumerRoot = path.join(here, '..', 'fixtures', 'stateful');
const fakeEnv = pathToFileURL(path.join(consumerRoot, 'fake-env.js')).href;

// The suite cannot run below its own floor, so the cases below are skipped
// rather than failed there — and the floor itself is asserted either way.
const runnable = typeof nodeModule.registerHooks === 'function';
const needsHooks = { skip: runnable ? false : `needs Node >= ${REQUIRED_NODE}` };

const fixtures = (overrides = {}) => ({
  contractVersion: CONTRACT_VERSION,
  consumerRoot,
  environments: {
    plain: { globals: () => ({}), overrides: {} },
    overridden: { globals: () => ({}), overrides: { './env.js': fakeEnv } },
    'with-globals': {
      globals: ({ id }) => ({
        __conformanceProbe: `case-${id}`,
        navigator: { userAgent: 'conformance-probe' },
      }),
      overrides: {},
    },
    ...overrides,
  },
  controllerModule: 'index.js',
});

const silent = () => {};
const one = (name, environment, run) => [{ name, environment, run }];

test('the Node floor is reported by a sentence, never by a link-time error', () => {
  if (runnable) {
    assert.doesNotThrow(assertRunnableHere);
    return;
  }
  assert.throws(assertRunnableHere, new RegExp(`needs Node >= ${REQUIRED_NODE}`));
});

test('every case gets its own module graph', needsHooks, async () => {
  const seen = [];
  const { failed } = await runConformance(fixtures(), [
    {
      name: 'poison the state',
      environment: 'plain',
      run({ createController }) {
        const controller = createController();
        controller.bump();
        controller.bump();
        seen.push(controller.count());
      },
    },
    {
      name: 'a fresh graph must not inherit it',
      environment: 'plain',
      run({ createController }) {
        seen.push(createController().count());
      },
    },
  ], silent);
  assert.deepEqual(failed, []);
  assert.deepEqual(seen, [2, 0], 'the second case must start from an unused graph');
});

test('an override replaces a consumer module for the case that asks for it', needsHooks, async () => {
  const seen = [];
  const { failed } = await runConformance(fixtures(), [
    { name: 'overridden', environment: 'overridden', run: ({ createController }) => seen.push(createController().flavourName()) },
    { name: 'plain', environment: 'plain', run: ({ createController }) => seen.push(createController().flavourName()) },
  ], silent);
  assert.deepEqual(failed, []);
  assert.deepEqual(seen, ['fake', 'real'], 'an override must not leak into a case that did not ask for it');
});

test('globals are installed for the case and taken away afterwards', needsHooks, async () => {
  const before = globalThis.__conformanceProbe;
  const seen = [];
  const { failed } = await runConformance(
    fixtures(),
    one('reads its globals', 'with-globals', ({ createController }) => {
      const controller = createController();
      seen.push(controller.globalProbe(), controller.userAgent());
    }),
    silent
  );
  assert.deepEqual(failed, []);
  // navigator is read-only on globalThis; an assignment would not have taken.
  assert.deepEqual(seen, ['case-1', 'conformance-probe']);
  assert.equal(globalThis.__conformanceProbe, before, 'a global installed for a case must not outlive it');
  assert.notEqual(globalThis.navigator?.userAgent, 'conformance-probe', 'navigator must be given back');
});

// What a consumer actually feels: an import taken after the run sees its own
// modules rather than a case's fixtures. That the hook was handed back is a
// separate claim, checked below.
test('the redirection does not outlive the run', needsHooks, async () => {
  await runConformance(
    fixtures(),
    one('uses the override', 'overridden', ({ createController }) => createController().flavourName()),
    silent
  );
  const { createPlatformController } = await import(pathToFileURL(path.join(consumerRoot, 'index.js')).href);
  assert.equal(
    createPlatformController().flavourName(),
    'real',
    'an import after the run must not still be redirected'
  );
});

test('a failing case is reported without stopping the ones after it', needsHooks, async () => {
  const seen = [];
  const { passed, failed } = await runConformance(fixtures(), [
    { name: 'fails', environment: 'plain', run: () => assert.fail('deliberate') },
    { name: 'still runs', environment: 'plain', run: () => seen.push('ran') },
  ], silent);
  assert.equal(passed, 1);
  assert.deepEqual(failed.map(({ name }) => name), ['fails']);
  assert.deepEqual(seen, ['ran']);
});

test('a suite that would run nothing is refused', needsHooks, async () => {
  await assert.rejects(
    () => runConformance(fixtures(), [], silent),
    /at least one case/,
    'an empty registry reporting 0/0 passed is the most expensive kind of green'
  );
});

test('a malformed registry is refused', needsHooks, async () => {
  const cases = (...entries) => runConformance(fixtures(), entries, silent);
  await assert.rejects(
    () => cases({ name: 'a', environment: 'plain', run: () => {} }, { name: 'a', environment: 'plain', run: () => {} }),
    /two cases are named a/
  );
  await assert.rejects(() => cases({ name: '  ', environment: 'plain', run: () => {} }), /must carry a name/);
  await assert.rejects(() => cases({ name: 'a', environment: 'plain' }), /must carry a run\(\)/);
  await assert.rejects(() => cases({ name: 'a', environment: 'nowhere', run: () => {} }), /does not declare/);
});

// A leaked hook is behaviourally invisible — it consults a run-scoped variable
// the runner clears in the same `finally`, and Node exposes no count of
// registered hooks — so the call itself is what gets observed. The probe wraps
// `registerHooks` on the builtin and counts deregistrations across a run that
// passed and a run that threw. It runs in its own process, because patching a
// builtin is not something to leave behind for the other test files.
test('the resolve hook is handed back after every run', needsHooks, () => {
  const probe = path.join(here, '..', 'fixtures', 'deregister-probe.cjs');
  const output = execFileSync(process.execPath, [probe], { encoding: 'utf8' });
  assert.match(output, /deregister called: 2/);
});
