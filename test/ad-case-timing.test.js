// Test the canonical assertions themselves with synchronous and Promise-driven
// outcomes. These harnesses are not consumer conformance or SDK evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from '../contract/cases/ads.mjs';

function harness({ deferred, rewardCount = 1, close = true, payOnClose = false }) {
  let callbacks;
  let confirmed;
  let completed = false;
  let closed = false;
  const dispatch = (fn) => {
    if (deferred) Promise.resolve().then(() => Promise.resolve()).then(fn);
    else fn();
  };
  const finishUI = () => {
    if (closed || !close) return;
    closed = true;
    if (payOnClose && !completed) {
      if (confirmed) confirmed();
      else callbacks.onRewardedComplete();
    }
    callbacks.onRewardedClosed();
  };
  return {
    createController: () => ({
      async initializePlatformServices(bag) { callbacks = bag; },
      preloadRewardedAd() {},
      async showRewardedAd(onConfirmed) { confirmed = onConfirmed; },
    }),
    controls: {
      clock: { runAll: () => dispatch(finishUI) },
      ads: {
        available() {},
        rewarded: {
          present: () => dispatch(() => callbacks.onRewardedShown()),
          complete: () => dispatch(() => {
            if (completed) return;
            completed = true;
            for (let i = 0; i < rewardCount; i++) {
              if (confirmed) confirmed();
              else callbacks.onRewardedComplete();
            }
            finishUI();
          }),
        },
      },
    },
  };
}

for (const deferred of [false, true]) {
  for (const name of [
    'rewarded-success-reports-shown-then-closed',
    'rewarded-completes-at-most-once-per-show',
    'bound-reward-survives-ui-timeout-and-is-confirmed-once',
    'rewarded-closed-without-confirmation-pays-nothing',
  ]) {
    test(`${name} accepts ${deferred ? 'Promise-driven' : 'synchronous'} callbacks`, async () => {
      await cases.find(c => c.name === name).run(harness({ deferred }));
    });
  }
  test(`reward assertions still reject missing and duplicate rewards (deferred=${deferred})`, async () => {
    const testCase = cases.find(c => c.name === 'rewarded-completes-at-most-once-per-show');
    for (const rewardCount of [0, 2]) {
      await assert.rejects(testCase.run(harness({ deferred, rewardCount })), { code: 'ERR_ASSERTION' });
    }
  });
  test(`terminal assertions still reject a missing close (deferred=${deferred})`, async () => {
    const testCase = cases.find(c => c.name === 'rewarded-success-reports-shown-then-closed');
    await assert.rejects(testCase.run(harness({ deferred, close: false })), { code: 'ERR_ASSERTION' });
  });
  test(`close assertions still reject a reward paid on close (deferred=${deferred})`, async () => {
    const testCase = cases.find(c => c.name === 'rewarded-closed-without-confirmation-pays-nothing');
    await assert.rejects(testCase.run(harness({ deferred, payOnClose: true })), { code: 'ERR_ASSERTION' });
  });
  test(`bound assertions still reject a confirmation paid on close (deferred=${deferred})`, async () => {
    const testCase = cases.find(c => c.name === 'bound-reward-survives-ui-timeout-and-is-confirmed-once');
    await assert.rejects(
      testCase.run(harness({ deferred, payOnClose: true })),
      { code: 'ERR_ASSERTION', message: /closing the UI is not a confirmed view/ },
    );
  });
}
