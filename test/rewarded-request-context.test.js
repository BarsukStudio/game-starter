import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRewardedRequestCoordinator } from '../template/platform/rewarded-request-context.js';

test('a confirmed reward retains its original request after UI finalization', () => {
  const paid = [], finalized = [];
  const requests = createRewardedRequestCoordinator({
    onRewardEarned: (request) => paid.push(request.payload.amount),
    onFinalize: (request) => finalized.push(request.requestId),
  });
  const a = requests.begin({ placement: 'money', payload: { amount: 100 } });
  const confirmA = requests.captureReward();
  requests.finalize();
  assert.deepEqual(paid, []);
  const b = requests.begin({ placement: 'money', payload: { amount: 200 } });
  assert.equal(confirmA(), true);
  assert.equal(confirmA(), false);
  assert.deepEqual(paid, [100]);
  assert.equal(requests.getActive(), b);
  assert.deepEqual(finalized, [a.requestId]);
  const confirmB = requests.captureReward();
  requests.invalidate();
  assert.equal(confirmB(), false);
  assert.deepEqual(paid, [100]);
});

for (const callback of ['captureReward', 'rewardEarned']) {
  test(`${callback} retries a refused durable grant and rejects reentrant delivery`, () => {
    let calls = 0, paid = 0;
    const requests = createRewardedRequestCoordinator({
      onRewardEarned: () => {
        calls += 1;
        assert.equal(confirm(), false, 'an in-progress grant cannot enter twice');
        if (calls === 1) return false;
        paid += 1;
      },
    });
    const request = requests.begin({ placement: 'shop_offer' });
    const confirm = callback === 'captureReward'
      ? requests.captureReward() : () => requests.rewardEarned(request.requestId);
    assert.equal(confirm(), false);
    assert.equal(request.rewardGranted, false);
    assert.equal(confirm(), true);
    assert.equal(request.rewardGranted, true);
    assert.equal(confirm(), false);
    assert.equal(paid, 1);
    assert.equal(calls, 2);
  });
}
