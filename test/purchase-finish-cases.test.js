// Test the canonical finish-settlement assertions themselves against model
// controllers. These harnesses are not consumer conformance or store evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from '../contract/cases/purchases.mjs';

const PRODUCT = 'store.product';

// `finish` is how the model platform answers the game's finish call, given the
// store's dispatch, its settlement signal and the case's timers.
function harness(finish) {
  let callbacks;
  const finished = [];
  const settlements = new Map();
  const timers = [];
  return {
    createController: () => ({
      supportsNativePurchases: () => true,
      getPurchaseProducts: () => ({ product: PRODUCT }),
      async initializePurchaseStore(bag) { callbacks = bag; },
      finishPurchaseTransaction: (handle) => finish({
        dispatch: () => finished.push(handle.productId),
        settled: () => new Promise((resolve) => settlements.set(handle.productId, resolve)),
        setTimeout: (fn) => timers.push(fn),
      }),
    }),
    skip: (reason) => { throw new Error(`unexpected skip: ${reason}`); },
    controls: {
      clock: { runAll: () => timers.splice(0).forEach((fn) => fn()) },
      store: {
        approve: (productId) => callbacks.onTransactionApproved({ productId }),
        finishedFor: () => [...finished],
        settleFinished: (productId) => settlements.get(productId)?.(),
      },
    },
  };
}

const confirmed = ({ dispatch, settled, setTimeout }) => {
  dispatch();
  return new Promise((resolve, reject) => {
    settled().then(resolve);
    setTimeout(() => reject(new Error('settlement not confirmed')));
  });
};
const onDispatch = ({ dispatch }) => { dispatch(); return Promise.resolve(); };
const unbounded = ({ dispatch, settled }) => { dispatch(); return settled(); };
const undispatched = ({ settled, setTimeout }) => new Promise((resolve, reject) => {
  settled().then(resolve);
  setTimeout(() => reject(new Error('settlement not confirmed')));
});

const run = (name, finish) => cases.find((c) => c.name === name).run(harness(finish));
const SETTLES = 'finishing-resolves-on-the-store-settlement-not-on-dispatch';
const REJECTS = 'finishing-without-the-store-settlement-rejects';

test('a finish confirmed by the store and bounded in time passes both cases', async () => {
  await run(SETTLES, confirmed);
  await run(REJECTS, confirmed);
});

test('a finish that resolves on dispatch fails both cases', async () => {
  for (const name of [SETTLES, REJECTS]) {
    await assert.rejects(run(name, onDispatch), { code: 'ERR_ASSERTION', message: /not a settled purchase/ });
  }
});

test('a finish that never gives up on the store fails the rejection case', async () => {
  await run(SETTLES, unbounded);
  await assert.rejects(run(REJECTS, unbounded), { code: 'ERR_ASSERTION', message: /ends as a rejection/ });
});

test('a finish that never reaches the store fails both cases', async () => {
  for (const name of [SETTLES, REJECTS]) {
    await assert.rejects(run(name, undispatched), { code: 'ERR_ASSERTION', message: /reached the store/ });
  }
});
