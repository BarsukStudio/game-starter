// Observing that the runner gives its resolve hook back.
//
// A leaked hook is behaviourally invisible — it consults a run-scoped variable
// the runner clears in the same `finally`, so it resolves exactly what the
// default resolver would — and Node exposes no count of registered hooks. What
// can be observed is the call itself: wrap `registerHooks` on the builtin, run
// `syncBuiltinESMExports()` so the ESM namespace the runner imports sees the
// wrapper, and count how often the returned handle is asked to deregister.
//
// A separate process on purpose. Patching a builtin is not something to leave
// behind for the other test files in the run.
const nodeModule = require('node:module');
const path = require('node:path');

const real = nodeModule.registerHooks;
if (typeof real !== 'function') {
  console.log('skipped: this runtime has no module.registerHooks');
  process.exit(0);
}

let deregistered = 0;
nodeModule.registerHooks = (...args) => {
  const handle = real(...args);
  return {
    ...handle,
    deregister: (...rest) => {
      deregistered += 1;
      return handle.deregister(...rest);
    },
  };
};
nodeModule.syncBuiltinESMExports();

(async () => {
  const root = path.join(__dirname, '..');
  const { runConformance } = await import(path.join(root, 'contract', 'runner.mjs'));
  const { CONTRACT_VERSION } = await import(path.join(root, 'contract', 'manifest.js'));
  const consumerRoot = path.join(root, 'fixtures', 'stateful');
  const environments = {
    plain: { setup: () => ({}), overrides: {} },
    // Thrown from where the runner has already registered its hook but has not
    // yet entered the per-case try. A case that throws would not do: the runner
    // catches that and turns it into a reported failure, so the loop still ends
    // normally and only the ordinary path gets exercised.
    hostile: {
      setup: () => {
        throw new Error('deliberate: an environment that cannot be built');
      },
      overrides: {},
    },
  };
  const fixtures = { contractVersion: CONTRACT_VERSION, consumerRoot, controllerModule: 'index.js', environments };
  const probe = (environment) => [
    { name: 'probe', environment, run: ({ createController }) => createController().count() },
  ];

  await runConformance(fixtures, probe('plain'), () => {});

  // The hook has to come back on the way out as well, and a `finally` is easy
  // to lose to a refactor that moves the call after the loop instead.
  let threw = false;
  try {
    await runConformance(fixtures, probe('hostile'), () => {});
  } catch {
    threw = true;
  }
  if (!threw) {
    console.error('the hostile environment was expected to abort the run');
    process.exit(3);
  }

  console.log(`deregister called: ${deregistered}`);
  process.exit(deregistered === 2 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
