import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../template/platform/bridge.js', import.meta.url), 'utf8');
const recovery = bridge.slice(bridge.indexOf('let adsInitializing'), bridge.indexOf('async function initializeAds'))
  .replaceAll('export ', '');
const drain = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const listeners = new Map();
  let retryable = true, release;
  const state = { provider: 'none', privacyAdsStopped: false };
  const f = { calls: 0, callbacks: { removeAdsFlag: false } };
  const context = vm.createContext({ state, console,
    document: { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn) },
    window: { addEventListener: (name, fn) => listeners.set(name, fn) },
    createAdAdapterDeps: () => f.callbacks,
    initializeAds: async () => {},
    nativeAdmob: { canRetryInitialization: () => retryable,
      init: deps => { assert.equal(deps, f.callbacks); f.calls++; return new Promise(resolve => { release = resolve; }); } },
  });
  vm.runInContext(recovery + '\nbindAdmobRecovery(); bindAdmobRecovery();', context);
  return { ...f, state, context, listeners, calls: () => f.calls,
    signal: name => listeners.get(name)(),
    finish: async ready => { retryable = !ready; release(ready); await drain(); } };
}

test('online and foreground coalesce without replacing controller callbacks or replaying provider selection', async () => {
  const f = fixture();
  assert.equal(f.listeners.size, 2);
  f.signal('online'); f.signal('visibilitychange'); f.signal('online');
  assert.equal(f.calls(), 1);
  await f.finish(true);
  assert.equal(f.calls(), 1); assert.equal(f.state.provider, 'admob-native');
  f.signal('online'); assert.equal(f.calls(), 1);
});

test('a signal during a pending failure gets one follow-up; no new signal means no polling', async () => {
  const f = fixture();
  f.signal('online'); f.signal('online');
  await f.finish(false); assert.equal(f.calls(), 2);
  await f.finish(false); assert.equal(f.calls(), 2); assert.equal(f.state.provider, 'none');
});

test('background and privacy cleanup block recovery', async () => {
  const f = fixture();
  f.context.document.visibilityState = 'hidden'; f.signal('online'); assert.equal(f.calls(), 0);
  f.context.document.visibilityState = 'visible'; f.state.privacyAdsStopped = true;
  f.signal('visibilitychange'); assert.equal(f.calls(), 0);
});
