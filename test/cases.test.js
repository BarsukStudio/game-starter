// The registry of canonical cases.
//
// The runner refuses a malformed registry at run time; this pins the registry
// itself, so a case cannot quietly leave. Deleting one is a decision about what
// the contract still guarantees — the kind of decision that should show up in a
// diff of this file, not only in a suite that got shorter.
import assert from 'node:assert/strict';
import test from 'node:test';

import { cases } from '../contract/cases/index.mjs';

// Frozen at contract 0.1.0. Adding a case is an edit here; so is removing one.
const CANONICAL = [
    'a-show-attempt-always-ends-in-a-terminal-callback',
    'ads-removed-suppresses-the-interstitial',
    'an-approved-transaction-reaches-the-game-as-an-opaque-handle',
    'binding-the-native-lifecycle-accepts-no-handlers-at-all',
    'binding-the-native-lifecycle-is-safe-off-native',
    'controller-exposes-exactly-the-manifest',
    'every-contract-method-is-callable',
    'exiting-the-app-is-safe-off-native',
    'generic-web-privacy-options-are-unavailable',
    'hide-native-status-bar-is-safe-off-native',
    'initialize-accepts-the-contract-bag-and-resolves',
    'initialize-honours-the-remove-ads-flag-it-was-given',
    'initialize-survives-an-adapter-that-fails-to-come-up',
    'interstitial-failure-before-presentation-reports-only-show-failed',
    'interstitial-reports-show-failed-when-the-sdk-goes-silent',
    'interstitial-success-reports-shown-then-closed',
    'late-or-repeated-sdk-signals-do-not-duplicate-a-callback',
    'ordering-reaches-the-store-with-the-configured-id',
    'ownership-answers-a-boolean-for-a-configured-product',
    'portal-language-answers-a-string-or-null-off-portal',
    'preload-is-safe-before-initialize',
    'prices-answer-null-for-every-product-until-the-store-does',
    'prices-become-strings-once-the-store-has-answered',
    'products-are-a-map-of-configured-keys-to-store-ids',
    'purchase-capabilities-answer-before-the-store-is-up',
    'restore-delegates-to-the-store-and-answers-a-promise',
    'rewarded-completes-at-most-once-per-show',
    'rewarded-failure-before-presentation-reports-only-show-failed',
    'rewarded-success-reports-shown-then-closed',
    'the-purchase-debug-snapshot-is-plain-data',
    'the-store-links-answer-without-throwing',
    'verbose-is-honoured-when-the-game-asks-for-it',
    'verbose-is-not-assumed-when-the-game-does-not-ask',
    'verify-and-finish-are-independent-delegations',
];

test('the canonical cases are exactly these', () => {
    assert.deepEqual(
        cases.map(({ name }) => name).sort(),
        CANONICAL,
        'a case joining or leaving the contract is an edit to this list'
    );
});

test('every case is runnable', () => {
    for (const testCase of cases) {
        assert.equal(typeof testCase.run, 'function', `${testCase.name} must carry a run()`);
        assert.ok(
            typeof testCase.environment === 'string' && testCase.environment.trim(),
            `${testCase.name} must name the environment it needs`
        );
    }
});

// A consumer declares environments by name, so the set of names the suite asks
// for is part of what it has to supply. Left as a check on the registry rather
// than a list to maintain: it is the cases that decide, not this file.
test('the suite asks for a small, stable set of environments', () => {
    const asked = [...new Set(cases.map(({ environment }) => environment))].sort();
    assert.deepEqual(asked, ['generic-web', 'native-store', 'portal-ads', 'portal-refusing']);
});
