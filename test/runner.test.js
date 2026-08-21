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
    plain: { setup: () => ({}), overrides: {} },
    overridden: { setup: () => ({}), overrides: { './env.js': fakeEnv } },
    // A world whose handles the case is supposed to receive.
    'with-controls': {
      setup: ({ name }) => {
        const opened = [];
        return {
          globals: {},
          controls: { builtFor: name, open: (what) => opened.push(what), opened: () => opened },
        };
      },
      overrides: {},
    },
    'with-globals': {
      setup: ({ name }) => ({
        globals: {
          __conformanceProbe: `case-${name}`,
          navigator: { userAgent: 'conformance-probe' },
        },
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
  assert.deepEqual(seen, ['case-reads its globals', 'conformance-probe']);
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

// `controls` is the only way a case reaches the outside world without naming an
// SDK, so a runner that dropped them would leave every ad and purchase case
// silently driving nothing — and most of those cases assert that something did
// *not* happen, which is exactly what an inert control surface produces.
test('the controls a setup returns are handed to the case', needsHooks, async () => {
  let received;
  const { failed } = await runConformance(
    fixtures(),
    one('uses its controls', 'with-controls', ({ controls }) => {
      assert.equal(typeof controls.open, 'function', 'the case must receive the controls setup() built');
      controls.open('door');
      received = controls.opened();
      assert.equal(controls.builtFor, 'uses its controls', 'setup() is told which case it is building for');
    }),
    silent
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(received, ['door'], 'and they must be the ones built for this case');
});

test('a case whose environment offers no controls still runs', needsHooks, async () => {
  const seen = [];
  const { failed } = await runConformance(
    fixtures(),
    one('has no controls', 'plain', ({ controls }) => seen.push(typeof controls)),
    silent
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(seen, ['object'], 'controls default to an empty object rather than undefined');
});

// The narrow door a fixture gets instead of the case's own address book.
//
// Given the raw token a fixture could import the controller here — before the
// hook is armed — and hand every later case a graph that was already warm and
// never redirected. The door serves the stand-ins this environment declared and
// refuses everything else, so the worst a fixture can reach for is its own fake.
test('a fixture may import the stand-ins it declared', needsHooks, async () => {
  let flavour;
  const { failed } = await runConformance(
    {
      ...fixtures(),
      environments: {
        gated: {
          overrides: { './env.js': fakeEnv },
          async setup({ importOverride }) {
            flavour = (await importOverride('./env.js')).flavour;
            return {};
          },
        },
      },
    },
    one('needs its fake', 'gated', ({ createController }) => createController().flavourName()),
    silent
  );
  assert.deepEqual(failed, []);
  assert.equal(flavour, 'fake', 'and it is the instance the case was given, not a second copy');
});

test('a fixture may not import anything else through that door', needsHooks, async () => {
  const refused = [];
  const environment = (specifier) => ({
    overrides: { './env.js': fakeEnv },
    async setup({ importOverride }) {
      await importOverride(specifier).catch((error) => refused.push(error.message));
      return {};
    },
  });
  for (const specifier of ['./index.js', './bridge.js', 'node:fs']) {
    // eslint-disable-next-line no-await-in-loop
    await runConformance(
      { ...fixtures(), environments: { gated: environment(specifier) } },
      one('probe', 'gated', () => {}),
      silent
    );
  }
  assert.equal(refused.length, 3, 'the controller, its composition and any other module are all refused');
  for (const message of refused) assert.match(message, /may only import the stand-ins it declared/);
});

// A capability a consumer does not have is not a breach of contract: the suite
// has to stay usable by a game that sells nothing, or it stops being a contract
// and becomes a description of the games that already pass it.
test('a case may step aside instead of failing', needsHooks, async () => {
  const { passed, failed, skipped } = await runConformance(fixtures(), [
    { name: 'not applicable', environment: 'plain', run: ({ skip }) => skip('nothing to test here') },
    { name: 'applicable', environment: 'plain', run: () => {} },
  ], silent);
  assert.deepEqual(failed, []);
  assert.equal(passed, 1);
  assert.deepEqual(skipped, [{ name: 'not applicable', reason: 'nothing to test here' }]);
});
