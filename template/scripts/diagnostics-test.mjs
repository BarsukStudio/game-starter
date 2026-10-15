import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Both documented layouts: run in the starter, or copy beside a game's scripts.
const moduleUrl = [
  new URL('../platform/diagnostics.js', import.meta.url),
  new URL('../src/js/platform/diagnostics.js', import.meta.url),
].find((url) => fs.existsSync(url));
assert.ok(moduleUrl, 'Copy diagnostics.js to src/js/platform before running this test.');
const source = fs.readFileSync(moduleUrl, 'utf8');

function setup({ native = true, fail = false } = {}) {
  const calls = [];
  const listeners = new Map();
  const sdk = (name) => new Proxy({}, {
    get: (_, method) => async (options) => {
      calls.push({ sdk: name, method, options });
      if (fail) throw new Error('SDK unavailable');
    },
  });
  const context = {
    FirebaseCrashlytics: sdk('crash'),
    isNative: native, nativePlatform: 'android',
    console: { warn() {} },
    window: { addEventListener: (name, listener) => listeners.set(name, listener) },
  };
  // Run the production module with only its SDK/environment imports replaced.
  vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return { ...context, calls, listeners };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('web and portals do not install handlers or call native diagnostics', () => {
  const app = setup({ native: false });
  app.initializeDiagnostics();
  app.markSplashHidden();
  assert.equal(app.calls.length, 0);
  assert.equal(app.listeners.size, 0);
});

test('native initialization is idempotent and reports both WebView stack formats', () => {
  const app = setup();
  app.initializeDiagnostics();
  app.initializeDiagnostics();
  app.listeners.get('error')({ error: {
    message: 'broken save', stack: 'Error: broken save\n    at restore (https://localhost/assets/main.js:123:9)',
  } });
  app.listeners.get('unhandledrejection')({ reason: {
    message: 'failed init', stack: 'initialize@capacitor://localhost/assets/main.js:45:7',
  } });
  const reports = app.calls.filter((call) => call.method === 'recordException');
  assert.equal(reports.length, 2);
  assert.equal(reports[0].options.stacktrace[0].lineNumber, 123);
  assert.equal(reports[0].options.stacktrace[0].functionName, 'restore');
  assert.equal(reports[1].options.stacktrace[0].fileName, 'capacitor://localhost/assets/main.js');
  assert.equal(reports[1].options.stacktrace[0].functionName, 'initialize');
  assert.equal(app.calls.filter((call) => call.method === 'setCustomKey').length, 2);
});

test('error events without a stack retain location; string rejections are supported', () => {
  const app = setup();
  app.initializeDiagnostics();
  app.listeners.get('error')({ message: 'SyntaxError', filename: 'https://localhost/main.js?token=private', lineno: 12 });
  app.listeners.get('unhandledrejection')({ reason: 'request failed' });
  const reports = app.calls.filter((call) => call.method === 'recordException');
  assert.equal(reports[0].options.stacktrace[0].fileName, 'https://localhost/main.js');
  assert.equal(reports[0].options.stacktrace[0].lineNumber, 12);
  assert.match(reports[1].options.message, /request failed/);
});

test('repeated errors are deduplicated and distinct reports are bounded', () => {
  const app = setup();
  app.initializeDiagnostics();
  for (let i = 0; i < 20; i++) app.listeners.get('error')({ message: 'same error' });
  assert.equal(app.calls.filter((call) => call.method === 'recordException').length, 1);
  for (let i = 0; i < 20; i++) app.listeners.get('unhandledrejection')({ reason: `error ${i}` });
  assert.equal(app.calls.filter((call) => call.method === 'recordException').length, 8);
});

test('splash hiding moves the crash stage exactly once, only after initialization', () => {
  const app = setup();
  app.markSplashHidden();
  assert.equal(app.calls.length, 0);
  app.initializeDiagnostics();
  app.markSplashHidden();
  app.markSplashHidden();
  const stages = app.calls.filter((call) => call.options?.key === 'game_stage').map((call) => call.options.value);
  assert.deepEqual(stages, ['js_bootstrap', 'splash_hidden']);
});

test('SDK failures are consumed without blocking startup or creating unhandled rejections', async () => {
  const app = setup({ fail: true });
  app.initializeDiagnostics();
  app.listeners.get('unhandledrejection')({ reason: 'game failure' });
  app.markSplashHidden();
  await flush();
  assert.equal(app.calls.filter((call) => call.method === 'recordException').length, 1);
});
