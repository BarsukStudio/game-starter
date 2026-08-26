// The QA provider switch, driven against native banner removals that misbehave.
//
// `debugAdsProvider()` writes the override, takes both native banners down, and
// reloads the page. The write is the easy part; the reload is the part that has
// to be unconditional. A switch that persists the override and then never
// reloads leaves the page serving the provider it had before and reporting that
// one as current — which reads as "the override was ignored" rather than "the
// switch is stuck", and sends whoever is looking at the wrong half of it.
//
// What makes that reachable is that a native call can answer neither way. A
// Capacitor plugin that never resolves and never rejects leaves the promise
// pending for the life of the page, and `Promise.allSettled` waits for exactly
// as long as its slowest member. So the cases below hold one removal open and
// require the reload anyway, and require it again when a removal rejects.
//
// Requires Node >= 22.15 for `module.registerHooks()`, like the purchase adapter
// suite next door and for the same reason: the bridge's seams are the consuming
// game's files and do not exist in this repository.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REQUIRED_NODE } from '../contract/runner.mjs';
import { HANGS, REJECTS, SETTLES, beginCase } from '../fixtures/debug-ads-switch/banner-probe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateHref = pathToFileURL(path.join(here, '..', 'template', path.sep)).href;
const bridgeHref = pathToFileURL(path.join(here, '..', 'template', 'platform', 'bridge.js')).href;
const fixture = (name) => pathToFileURL(path.join(here, '..', 'fixtures', 'debug-ads-switch', name)).href;

const runnable = typeof nodeModule.registerHooks === 'function';
const needsHooks = { skip: runnable ? false : `needs Node >= ${REQUIRED_NODE}` };

// What the bridge's seams and SDKs resolve to here. Matched on the specifier
// with the importer checked: the seams stand in for a game's own files, so
// there is nothing to resolve first.
const SEAM_FIXTURES = new Map([
  ['config.js', 'config.js'],
  ['env.js', 'env.js'],
  ['debug.js', 'debug.js'],
  ['ad-lifecycle.js', 'ad-lifecycle.js'],
  ['purchase-delivery.js', 'purchase-delivery.js'],
  ['@barsuk/game-runtime/purchase-finish', 'purchase-finish.js'],
  ['@capacitor-community/admob', 'admob-sdk.js'],
  ['@capacitor/app', 'capacitor-app.js'],
  ['@capacitor/core', 'capacitor-core.js'],
  ['@capacitor/splash-screen', 'splash-screen.js'],
  ['capacitor-plugin-yandex-ads', 'yandex-ads-sdk.js'],
]);

let caseId = 0;
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL ?? '';
      if (!parent.startsWith(templateHref)) return next(specifier, context);
      const key = specifier.startsWith('.') ? specifier.split('/').pop() : specifier;
      const target = SEAM_FIXTURES.get(key);
      // The case id travels in the query string on both branches: a bridge
      // reloaded on its own would keep the previous case's module-scope
      // provider state and the previous case's SDK stand-ins.
      if (target) {
        return { url: `${fixture(target)}?case=${caseId}`, shortCircuit: true };
      }
      const resolved = next(specifier, context);
      return { ...resolved, url: `${resolved.url}?case=${caseId}` };
    },
  });
}

// A clock the case advances by hand. Both waits under test are timers — the
// removal's bound and the reload's own short delay — and a suite that spent
// real seconds on them would be a suite nobody runs.
function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { at: now + (Number(ms) || 0), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending() {
      return timers.size;
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await drain();
      }
      now = until;
      await drain();
    },
  };
}

// Enough turns for the promise chains the bridge builds between two timers.
async function drain() {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

// A real-time backstop, on the real timer rather than the case's. The defect
// under test is a promise that never settles: without this, a regression would
// hang the suite instead of failing it.
async function settlesWithin(promise, message) {
  let guard = null;
  const deadline = new Promise((_, reject) => {
    guard = setTimeout(() => reject(new Error(message)), 2000);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(guard);
  }
}

async function loadSwitch(behaviour) {
  installHooks();
  caseId += 1;
  const probe = beginCase(behaviour);
  const clock = createClock();
  const store = new Map();
  const world = {
    clock,
    probe,
    reloads: 0,
    stored: (key) => store.get(key) ?? null,
  };
  globalThis.window = {
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    location: {
      reload: () => {
        world.reloads += 1;
      },
    },
  };
  await import(`${bridgeHref}?case=${caseId}`);
  world.debugAdsProvider = globalThis.window.debugAdsProvider;
  assert.equal(typeof world.debugAdsProvider, 'function', 'the QA switch must install itself');
  return world;
}

const OVERRIDE_KEY = 'fixture:debug-ads-provider';
// Far past any bound the switch could reasonably hold. The point is that a
// bound exists, not what it was set to — a test that named the constant would
// pass an unbounded wait the moment someone raised it.
const LONGER_THAN_ANY_BOUND_MS = 60_000;

test('the conformance floor is stated whether or not the cases run', () => {
  assert.match(REQUIRED_NODE, /^\d+\.\d+/, 'the runner must name the Node it needs');
  assert.equal(
    runnable,
    typeof nodeModule.registerHooks === 'function',
    'the skip gate must follow the API it gates on',
  );
});

test('both banners come down and the page reloads', needsHooks, async () => {
  const world = await loadSwitch({ admob: SETTLES, yandex: SETTLES });

  const switched = world.debugAdsProvider('yandex');
  const status = await settlesWithin(switched, 'the switch never answered');

  assert.equal(status.debugOverride, 'yandex');
  assert.equal(status.reloading, true);
  assert.equal(world.stored(OVERRIDE_KEY), 'yandex');
  assert.deepEqual([...world.probe.removed].sort(), ['admob', 'yandex']);

  assert.equal(world.reloads, 0, 'the reload is scheduled, not immediate');
  await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
  assert.equal(world.reloads, 1);
});

for (const stuck of ['admob', 'yandex']) {
  test(`[${stuck}] a removal that never settles still reaches the reload`, needsHooks, async () => {
    const world = await loadSwitch({ [stuck]: HANGS });

    const switched = world.debugAdsProvider('admob');
    await drain();
    assert.equal(
      world.reloads,
      0,
      'the switch still waits for the banners it can get an answer from',
    );
    assert.equal(
      world.stored(OVERRIDE_KEY),
      'admob',
      'the override is written before the removal, so the reload picks it up',
    );

    await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
    const status = await settlesWithin(switched, `a stuck ${stuck} removal stranded the switch`);

    assert.equal(status.debugOverride, 'admob');
    assert.equal(world.reloads, 1, 'the reload is not conditional on the banners coming down');
  });

  test(`[${stuck}] a removal that rejects still reaches the reload`, needsHooks, async () => {
    const world = await loadSwitch({ [stuck]: REJECTS });

    const switched = world.debugAdsProvider('off');
    await settlesWithin(switched, `a rejected ${stuck} removal stranded the switch`);

    await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
    assert.equal(world.reloads, 1);
    assert.equal(world.stored(OVERRIDE_KEY), 'off');
  });
}

test('the Yandex removal reaches the SDK instead of the promise machinery', needsHooks, async () => {
  const world = await loadSwitch({});

  const switched = world.debugAdsProvider('admob');
  await settlesWithin(switched, 'the switch never answered');

  // The reload is deliberately not what this case turns on. A handle that got
  // assimilated leaves its await pending forever, the bound above expires, and
  // the page reloads on time looking entirely healthy — while the banner the
  // switch was escaping is still on screen, now under the new provider's one.
  // So this pins the call itself.
  assert.ok(
    world.probe.removed.includes('yandex'),
    'the Yandex banner removal must reach the SDK, not merely be attempted',
  );
  assert.deepEqual(
    world.probe.synthesized,
    [],
    'a name synthesized on the plugin handle means something read a property off '
      + 'the proxy that no plugin implements — `then` above all',
  );
});

test('the reload does not depend on the rest of the switch succeeding', needsHooks, async () => {
  const world = await loadSwitch({});

  // A fault injected at the one call in that block that reaches outside the
  // module. The claim is not that `console.log` is expected to throw — it is
  // that once the override is in storage, nothing left in the block may decide
  // whether the page reloads. Without the `finally` this case ends with the
  // override persisted and the page still running the previous provider — the
  // half-applied state the rest of this file exists to rule out.
  const realLog = console.log;
  console.log = () => {
    throw new Error('console is broken');
  };
  try {
    const switched = world.debugAdsProvider('yandex');
    await assert.rejects(
      settlesWithin(switched, 'the switch never answered'),
      /console is broken/,
    );
  } finally {
    console.log = realLog;
  }

  assert.equal(world.stored(OVERRIDE_KEY), 'yandex', 'the override survives the throw');
  await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
  assert.equal(world.reloads, 1, 'a throw after the storage write still reloads');
});

test('a value the switch does not accept changes nothing and reloads nothing', needsHooks, async () => {
  const world = await loadSwitch({});

  await assert.rejects(world.debugAdsProvider('admo'), /debugAdsProvider/);

  assert.equal(world.stored(OVERRIDE_KEY), null);
  assert.deepEqual(world.probe.removed, [], 'a rejected argument takes no banner down');
  await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
  assert.equal(world.reloads, 0, 'a typo must not reload the page');
});

test('asking without an argument reports, and does not reload', needsHooks, async () => {
  const world = await loadSwitch({});

  const status = await settlesWithin(world.debugAdsProvider(), 'the status read never answered');

  assert.equal(status.provider, 'unresolved');
  assert.equal(status.debugOverride, 'auto');
  assert.equal(status.reloading, undefined);
  await world.clock.advance(LONGER_THAN_ANY_BOUND_MS);
  assert.equal(world.reloads, 0);
});
