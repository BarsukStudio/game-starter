// Which cases a consumer is held to.
//
// A capability a game does not have is not a breach of contract, and the suite
// has to say so per capability rather than per subject. Restoring is the case in
// point: a platform may refuse new purchases and still owe a player everything
// they already bought, so gating restore behind the ability to buy would skip it
// on exactly the consumer that needs it. Gym cannot catch that regression — it
// has both capabilities or neither — so it is pinned here instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT_VERSION } from '../contract/manifest.js';
import { REQUIRED_NODE, runConformance } from '../contract/runner.mjs';
import { cases } from '../contract/cases/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const consumerRoot = path.join(here, '..', 'fixtures', 'capabilities');
const needsHooks = {
  skip: typeof nodeModule.registerHooks === 'function' ? false : `needs Node >= ${REQUIRED_NODE}`,
};

const RESTORE = 'restore-delegates-to-the-store-and-answers-a-promise';
const restoreCase = cases.filter(({ name }) => name === RESTORE);

function fixtures(capabilities) {
  const recorder = { capabilities, asked: [] };
  return {
    fixtures: {
      contractVersion: CONTRACT_VERSION,
      consumerRoot,
      controllerModule: 'index.js',
      environments: {
        'native-store': {
          overrides: {},
          setup: () => ({
            globals: { __conformanceStore: recorder },
            controls: { store: { restoreCount: () => recorder.asked.filter((a) => a === 'restore').length } },
          }),
        },
      },
    },
    recorder,
  };
}

test('the canonical restore case is still named what this test gates on', () => {
  assert.equal(restoreCase.length, 1, `${RESTORE} must exist for this test to mean anything`);
});

test('a platform that cannot buy but can restore still has to restore', needsHooks, async () => {
  const { fixtures: f, recorder } = fixtures({ buy: false, restore: true });
  const { passed, failed, skipped } = await runConformance(f, restoreCase, () => {});
  assert.deepEqual(failed, []);
  assert.deepEqual(skipped, [], 'restore is gated on restoring, not on buying');
  assert.equal(passed, 1);
  assert.ok(recorder.asked.includes('restore'), 'and the case actually drove it');
});

test('a platform that cannot restore steps aside', needsHooks, async () => {
  const { fixtures: f, recorder } = fixtures({ buy: true, restore: false });
  const { passed, failed, skipped } = await runConformance(f, restoreCase, () => {});
  assert.deepEqual(failed, []);
  assert.equal(passed, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /nothing to restore/);
  assert.deepEqual(recorder.asked, [], 'a skipped case drives nothing');
});
