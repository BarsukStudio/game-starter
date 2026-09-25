import assert from 'node:assert/strict';
import test from 'node:test';
import { startGame } from '../template/platform/startup.js';

// The same copied module runs in Gym2 and Miner; UI stays consumer-owned.
// Node has no browser frame scheduler. Each test replaces this explicit seam.
globalThis.requestAnimationFrame = () => {};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('local module completion and a foreground frame release the screen', async (t) => {
  const frames = [], calls = [];
  t.mock.method(globalThis, 'requestAnimationFrame', callback => frames.push(callback));
  let ready;
  const boot = startGame(() => new Promise(resolve => { ready = resolve; }),
    () => calls.push('screen'), () => assert.fail('unexpected load failure'));
  await flush();
  assert.equal(frames.length, 0);
  ready(); await flush();
  assert.deepEqual(calls, []);
  frames.shift()(); await boot;
  assert.deepEqual(calls, ['screen']);
});

test('load failure reaches consumer error UI before the screen is revealed', async (t) => {
  const frames = [], calls = [], error = new Error('Failed dynamic import');
  t.mock.method(globalThis, 'requestAnimationFrame', callback => frames.push(callback));
  const boot = startGame(() => Promise.reject(error), () => calls.push('screen'), e => calls.push(e));
  await flush(); assert.deepEqual(calls, [error]);
  frames.shift()(); await boot; assert.deepEqual(calls, [error, 'screen']);
});

test('native splash rejection is reported without an unhandled rejection', async (t) => {
  t.mock.method(globalThis, 'requestAnimationFrame', callback => callback());
  const warn = t.mock.method(console, 'warn', () => {});
  const error = new Error('Splash unavailable');
  await startGame(async () => {}, () => Promise.reject(error), () => assert.fail());
  assert.equal(warn.mock.calls[0].arguments[1], error);
});
