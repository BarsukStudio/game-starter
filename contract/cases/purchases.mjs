// Buying things, judged at the boundary the game actually uses.
//
// Everything here is deliberately about *shape and delivery*, never about what
// a product means. How many products a game sells, what they are called and
// what they grant is the game's business — a price map is
// `Record<configuredProductKey, string | null>` and the suite may not know a
// single one of those keys.
//
// Two things a platform's own tests must keep, because they are one plugin's
// wiring rather than the contract: the order in which a store's subscriptions
// are registered, and the rule that a transaction is verified before it is
// finished. The facade delegates verify and finish independently; whatever
// sequences them lives in the game, next to its delivery ledger.
import assert from 'node:assert/strict';

import { findNonPlainValue, isRecord } from '../plain-data.js';
import { declaredInputs, recordCallbacks } from './startup.mjs';

const isNullOrString = (value) => value === null || typeof value === 'string';

// Everything below this line needs a store to talk to. A game that sells
// nothing is not in breach of a purchase contract — §10 keeps room for a
// project with purchases switched off — so those cases step aside instead of
// failing, and the suite stays transferable to the games it was written for.
function requireStore(controller, skip) {
  if (!controller.supportsNativePurchases()) skip('this platform sells nothing');
}

// Restoring is its own capability. A platform may refuse new purchases and
// still owe a player everything they already bought — gating restore behind the
// ability to buy would skip the case on exactly the consumer that needs it.
function requireRestore(controller, skip) {
  if (!controller.supportsRestorePurchases()) skip('this platform has nothing to restore from');
}

// Let whatever the initializer queued reach the store.
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function storeStarted({ createController, controls, skip }, { hold = false, verbose, require = requireStore } = {}) {
  const controller = createController();
  require(controller, skip);
  if (hold) controls.store.holdStartup();
  const inputs = declaredInputs('initializePurchaseStore', verbose === undefined ? {} : { verbose });
  const recorder = recordCallbacks('initializePurchaseStore', inputs);
  const starting = controller.initializePurchaseStore(recorder.bag);
  starting.catch(() => {});
  if (hold) await settle();
  else await starting;
  return { controller, store: controls.store, starting, ...recorder };
}

export const cases = [
  {
    name: 'purchase-capabilities-answer-before-the-store-is-up',
    environment: 'native-store',
    run({ createController }) {
      const controller = createController();
      for (const name of ['supportsNativePurchases', 'supportsRestorePurchases', 'isPurchaseTransportAvailable']) {
        assert.equal(typeof controller[name](), 'boolean', `${name}() must answer a boolean, always`);
      }
    },
  },
  {
    // Capability-gated on purpose: a game may ship with purchases switched off
    // entirely, and an empty catalogue is the honest answer for it rather than a
    // failure (`GAME_PLAYBOOK.md` §10).
    name: 'products-are-a-map-of-configured-keys-to-store-ids',
    environment: 'native-store',
    run({ createController }) {
      const controller = createController();
      const products = controller.getPurchaseProducts();
      assert.ok(
        isRecord(products),
        'a catalogue is a record keyed by the game\'s own product names — an array has no names in it'
      );
      for (const [key, id] of Object.entries(products)) {
        assert.ok(key.trim(), 'a product key must be a name');
        assert.ok(typeof id === 'string' && id.trim(), `${key} must map to a store id`);
      }
      if (controller.supportsNativePurchases()) {
        assert.ok(Object.keys(products).length, 'a platform that sells things must say what');
      }
    },
  },
  {
    // A product carrying a price is not the same as a store that has confirmed
    // it can sell one: catalogues arrive while the store is still coming up.
    // The case prices a product *and does not settle the startup*, because
    // asking about prices before anything has a price at all would pass against
    // a platform that reads them straight through.
    name: 'prices-answer-null-for-every-product-until-the-store-does',
    environment: 'native-store',
    async run(harness) {
      const { controller, store } = await storeStarted(harness, { hold: true });
      const [firstKey] = Object.keys(controller.getPurchaseProducts());
      store.priceProduct(controller.getPurchaseProducts()[firstKey], '$1.99');

      const prices = controller.getPurchasePrices();
      assert.deepEqual(
        Object.keys(prices).sort(),
        Object.keys(controller.getPurchaseProducts()).sort(),
        'the price map is keyed by the configured products, whatever they are'
      );
      for (const [key, price] of Object.entries(prices)) {
        assert.equal(price, null, `${key} is not confirmed for sale yet and must say so with null`);
      }
    },
  },
  {
    name: 'prices-become-strings-once-the-store-has-answered',
    environment: 'native-store',
    async run(harness) {
      const { controller, store, starting } = await storeStarted(harness, { hold: true });
      const products = controller.getPurchaseProducts();
      const [firstKey] = Object.keys(products);
      store.priceProduct(products[firstKey], '$1.99');
      store.completeStartup();
      await starting;

      const prices = controller.getPurchasePrices();
      assert.deepEqual(
        Object.keys(prices).sort(),
        Object.keys(products).sort(),
        'answering one price must not change which products exist'
      );
      assert.equal(prices[firstKey], '$1.99');
      for (const [key, price] of Object.entries(prices)) {
        assert.ok(isNullOrString(price), `${key} must be a price string or null, got ${typeof price}`);
      }
    },
  },
  {
    name: 'ordering-reaches-the-store-with-the-configured-id',
    environment: 'native-store',
    async run(harness) {
      const { controller, store } = await storeStarted(harness);
      const products = controller.getPurchaseProducts();
      const [firstKey] = Object.keys(products);
      store.priceProduct(products[firstKey], '$1.99');

      controller.orderPurchase(products[firstKey]);
      assert.deepEqual(
        store.ordered(),
        [products[firstKey]],
        'the game names a product and the store is asked for that one'
      );
    },
  },
  {
    name: 'an-approved-transaction-reaches-the-game-as-an-opaque-handle',
    environment: 'native-store',
    async run(harness) {
      const { controller, store, log } = await storeStarted(harness);
      const products = controller.getPurchaseProducts();
      const [firstKey] = Object.keys(products);
      const product = products[firstKey];
      const transaction = store.approve(product);

      const approved = log.filter(({ name }) => name === 'onTransactionApproved');
      assert.equal(approved.length, 1, 'the game hears about a purchase it has to deliver');
      const [handle] = approved[0].args;
      // Not truthiness: an opaque token is allowed to be `0`, and the routing
      // check below is what actually proves the game was given something usable.
      assert.notEqual(handle, undefined, 'and it is given something to hand back');

      // Opaque means opaque: the handle may be the store's own transaction or a
      // token the adapter minted for it, and the contract cannot tell — it only
      // requires that handing it back reaches the purchase it stands for.
      controller.verifyPurchaseTransaction(handle);
      assert.deepEqual(
        store.verifiedFor(),
        [product],
        'the handle the game was given routes back to the purchase it came from'
      );
      void transaction;
    },
  },
  {
    name: 'verify-and-finish-are-independent-delegations',
    environment: 'native-store',
    async run(harness) {
      const { controller, store, log } = await storeStarted(harness);
      const products = controller.getPurchaseProducts();
      const keys = Object.keys(products);
      if (keys.length < 2) {
        harness.skip('this platform sells a single product, so there is no second purchase to keep apart');
      }
      const [toVerify, toFinish] = keys.map((key) => products[key]);

      store.approve(toVerify);
      store.approve(toFinish);
      const handles = log
        .filter(({ name }) => name === 'onTransactionApproved')
        .map(({ args }) => args[0]);
      assert.equal(handles.length, 2);

      // One purchase is only verified and the other is only finished. Doing
      // both to one purchase, in that order, would pass just as happily against
      // a platform that refuses to finish anything it has not verified — and
      // sequencing is the game's, not the contract's: the game owns the
      // delivery ledger that decides when finishing is allowed at all.
      controller.verifyPurchaseTransaction(handles[0]);
      const finishing = controller.finishPurchaseTransaction(handles[1]);
      finishing.catch(() => {});
      assert.equal(typeof finishing?.then, 'function', 'finishing answers a promise');

      assert.deepEqual(store.verifiedFor(), [toVerify], 'verification reached exactly the purchase it named');
      assert.deepEqual(store.finishedFor(), [toFinish], 'and finishing reached the other one, unverified');
    },
  },
  {
    // No timeout, no status: gym's answer to a store that never replies lives in
    // a headless module of its own, and a platform that has no such module is
    // not in breach. What crosses the facade is the store's own answer.
    name: 'restore-delegates-to-the-store-and-answers-a-promise',
    environment: 'native-store',
    async run(harness) {
      const { controller, store } = await storeStarted(harness, { require: requireRestore });
      const restoring = controller.restorePurchases();
      assert.equal(typeof restoring?.then, 'function');
      restoring.catch(() => {});
      assert.equal(store.restoreCount(), 1, 'the store is the one asked to replay a purchase');
    },
  },
  {
    name: 'ownership-answers-a-boolean-for-a-configured-product',
    environment: 'native-store',
    async run(harness) {
      const { controller, store } = await storeStarted(harness);
      const products = controller.getPurchaseProducts();
      const [firstKey] = Object.keys(products);

      assert.equal(controller.isPurchaseProductOwned(products[firstKey]), false);
      store.own(products[firstKey]);
      assert.equal(controller.isPurchaseProductOwned(products[firstKey]), true);
    },
  },
  {
    // The fields are the game's — how many transactions it lists, what it calls
    // its entitlement — so the contract asks only that the snapshot is plain
    // data. A snapshot carrying a live store object would leak the SDK back
    // through the one door that exists to keep it out.
    name: 'the-purchase-debug-snapshot-is-plain-data',
    environment: 'native-store',
    async run(harness) {
      const { controller } = await storeStarted(harness);
      const snapshot = controller.getPurchaseDebugSnapshot();
      assert.ok(isRecord(snapshot), 'a snapshot is an object of named readings');

      // Walked rather than serialized. A live store handed back here survives
      // `JSON.stringify` happily — its methods are dropped in silence — and a
      // method hidden behind a non-enumerable descriptor survives a round-trip
      // comparison too, because neither side can see it.
      assert.equal(
        findNonPlainValue(snapshot, 'snapshot'),
        null,
        'a debug snapshot is plain data; anything else is an SDK leaking back through the one door built to keep it out'
      );
    },
  },
  {
    // `verbose` is a declared input, so a platform that ignored it entirely
    // would otherwise pass every case here while the flag did nothing.
    //
    // One initialization per case, in its own graph. Initializing the same
    // store twice to compare the two answers would demand a second
    // `initialize()` the contract never promised, and an adapter that refuses
    // one is not in breach — so the two directions are two cases instead.
    name: 'verbose-is-honoured-when-the-game-asks-for-it',
    environment: 'native-store',
    async run(harness) {
      const { store } = await storeStarted(harness, { verbose: true });
      assert.equal(store.verboseReached(), true, 'asking a store to be verbose has to reach it');
    },
  },
  {
    name: 'verbose-is-not-assumed-when-the-game-does-not-ask',
    environment: 'native-store',
    async run(harness) {
      const { store } = await storeStarted(harness, { verbose: false });
      assert.equal(store.verboseReached(), false, 'and not asking has to reach it too');
    },
  },
];
