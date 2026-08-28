// The template's purchase adapter, executed against two catalogues that agree
// about nothing.
//
// The consuming game proves this adapter against its own store and its own five
// products. What that cannot prove is the property the template depends on: that
// the adapter has no opinion about the catalogue at all. A key written into the
// adapter passes every assertion a single-catalogue suite can make, and fails the
// first game that names its products differently — which is the one thing this
// repository exists to prevent.
//
// So both catalogues run the same assertions, and every expectation is derived
// from the catalogue data rather than written out. An adapter that remembered
// anything about one of them is wrong about the other.
//
// Requires Node >= 22.15 for `module.registerHooks()`: the seams this adapter
// imports — the game's config, env and delivery modules — do not exist in this
// repository, so they are supplied by resolution rather than by an injection
// seam that only a test would use. Below that floor the cases skip and the floor
// itself is still asserted.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REQUIRED_NODE } from '../contract/runner.mjs';
import {
  CATALOGUES,
  EMPTY_STORE_KEY,
  SELLING_STORE_KEYS,
  entriesOf,
  keysOf,
  nonConsumableKeysOf,
} from '../fixtures/purchase-adapter/catalogues.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateHref = pathToFileURL(path.join(here, '..', 'template', path.sep)).href;
const adapterHref = pathToFileURL(
  path.join(here, '..', 'template', 'platform', 'purchases', 'cdv-purchase.js'),
).href;

const fixture = (name) => pathToFileURL(path.join(here, '..', 'fixtures', 'purchase-adapter', name)).href;

// Probed through the namespace, never as a named import: on Node 20 a static
// named import of an export a builtin does not have is a link-time error, and
// the reader gets a SyntaxError instead of the sentence in the skip.
const runnable = typeof nodeModule.registerHooks === 'function';
const needsHooks = { skip: runnable ? false : `needs Node >= ${REQUIRED_NODE}` };

const STORE_KEYS = SELLING_STORE_KEYS;

// What the adapter's seams resolve to here. Matched on the specifier with the
// importer checked, not on the resolved URL: the modules these stand in for are
// the consuming game's and do not exist in this repository, so there is nothing
// to resolve first.
const SEAM_FIXTURES = new Map([
  ['config.js', 'config.js'],
  ['env.js', 'env.js'],
  ['@barsuk/game-runtime/purchase-delivery', 'purchase-delivery.js'],
  ['@barsuk/game-runtime/purchase-finish', 'purchase-finish.js'],
  ['capacitor-plugin-cdv-purchase', 'cdv-purchase-sdk.js'],
]);

let scenario = { id: 0, key: 'ios' };
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL ?? '';
      if (parent.startsWith(templateHref)) {
        const key = specifier.startsWith('.') ? specifier.split('/').pop() : specifier;
        const target = SEAM_FIXTURES.get(key);
        if (target) {
          // The scenario travels in the query string: a resolve hook is called by
          // the loader, not by this file, and the fixtures have no other way to
          // learn which store key is under test. It also defeats the ESM cache,
          // which the adapter's remembered namespace depends on.
          return {
            url: `${fixture(target)}?scenario=${scenario.id}&key=${scenario.key}`,
            shortCircuit: true,
          };
        }
      }
      return next(specifier, context);
    },
  });
}

// The finish coordinator takes its timers from the adapter, which wraps
// `window`'s. Nothing here waits on one, but the adapter reads them while it
// builds the coordinator.
globalThis.window = {
  setTimeout: () => 0,
  clearTimeout: () => {},
};

function freshProbe() {
  globalThis.__storeProbe = {
    registered: [],
    subscriptions: {},
    initializedWith: [],
    prices: {},
    owned: {},
    ownedAsked: [],
    settledAsked: [],
    finished: [],
  };
  return globalThis.__storeProbe;
}

// A fresh adapter per case. The adapter remembers its namespace for the lifetime
// of the module, which is deliberate, so a case reusing one would inherit the
// previous case's store.
async function loadAdapter(storeKey) {
  installHooks();
  scenario = { id: scenario.id + 1, key: storeKey };
  const probe = freshProbe();
  const adapter = await import(`${adapterHref}?i=${scenario.id}`);
  return { adapter, probe };
}

async function startedStore(storeKey, callbacks = {}) {
  const { adapter, probe } = await loadAdapter(storeKey);
  await adapter.initializeStore(callbacks);
  return { adapter, probe };
}

test('the conformance floor is stated whether or not the cases run', () => {
  // Asserted unskipped on purpose: a suite that skipped everything below its
  // floor, including the reason, would report a green run on a Node that cannot
  // execute a single one of its cases.
  assert.match(REQUIRED_NODE, /^\d+\.\d+/, 'the runner must name the Node it needs');
  assert.equal(
    runnable,
    typeof nodeModule.registerHooks === 'function',
    'the skip gate must follow the API it gates on',
  );
});

for (const storeKey of STORE_KEYS) {
  const keys = keysOf(storeKey);
  const entries = entriesOf(storeKey);
  const nonConsumables = nonConsumableKeysOf(storeKey);

  test(`[${storeKey}] the price map carries every key the catalogue sells, and nothing else`, needsHooks, async () => {
    const { adapter } = await loadAdapter(storeKey);
    const prices = adapter.getPrices();
    assert.deepEqual(Object.keys(prices).sort(), [...keys].sort());
    assert.deepEqual(
      Object.values(prices),
      keys.map(() => null),
      'nothing is priced before the store has answered',
    );
  });

  test(`[${storeKey}] a confirmed price reaches the game under the game's own key`, needsHooks, async () => {
    const { adapter, probe } = await loadAdapter(storeKey);
    // Exactly one product priced, so a map that answered the same value for
    // every key would fail rather than pass by coincidence.
    const [pricedKey, pricedProduct] = entries[0];
    probe.prices[pricedProduct.id] = '$1.99';
    await adapter.initializeStore({});

    const prices = adapter.getPrices();
    assert.equal(prices[pricedKey], '$1.99');
    for (const key of keys) {
      if (key !== pricedKey) assert.equal(prices[key], null, `${key} was never priced`);
    }
  });

  test(`[${storeKey}] the ids handed to the game are the catalogue's, by key`, needsHooks, async () => {
    const { adapter } = await loadAdapter(storeKey);
    assert.deepEqual(adapter.getProductIds(), Object.fromEntries(
      entries.map(([key, product]) => [key, product.id]),
    ));
  });

  test(`[${storeKey}] registration takes its ids and its types from the catalogue`, needsHooks, async () => {
    const { probe } = await startedStore(storeKey);
    assert.deepEqual(
      probe.registered.map(({ id, type }) => ({ id, type })).sort((a, b) => a.id.localeCompare(b.id)),
      entries
        .map(([, product]) => ({
          id: product.id,
          type: product.consumable ? 'consumable' : 'non-consumable',
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  test(`[${storeKey}] the ownership snapshot carries the non-consumables and only those`, needsHooks, async () => {
    const { adapter, probe } = await startedStore(storeKey);
    for (const key of nonConsumables) probe.owned[CATALOGUES[storeKey][key].id] = true;

    const owned = adapter.getDebugSnapshot().ownedNonConsumablesByKey;
    assert.deepEqual(Object.keys(owned).sort(), [...nonConsumables].sort());
    assert.deepEqual(Object.values(owned), nonConsumables.map(() => true));

    // A consumable is bought to be spent, so the store is never asked about one.
    const consumableIds = entries.filter(([, p]) => p.consumable).map(([, p]) => p.id);
    for (const id of consumableIds) {
      assert.ok(!probe.ownedAsked.includes(id), `${id} is a consumable and must not be asked about`);
    }
  });

  test(`[${storeKey}] a store that never loaded answers null, not a map of false`, needsHooks, async () => {
    const { adapter } = await loadAdapter(storeKey);
    assert.equal(
      adapter.getDebugSnapshot().ownedNonConsumablesByKey,
      null,
      '"the store says no" and "there was no store" must not read alike',
    );
  });

  // The catalogue is read three times over, by three different decisions, and
  // each reading has to be proven on its own. Registration is the visible one;
  // the two below are not, and an adapter that got either of them from a
  // remembered key rather than from config passes every other case here.
  test(`[${storeKey}] finishing classifies a transaction by its catalogue type`, needsHooks, async () => {
    const { adapter, probe } = await startedStore(storeKey);
    for (const [, product] of entries) {
      await adapter.finishTransaction({
        products: [{ id: product.id }],
        transactionId: `t-${product.id}`,
        state: 'approved',
      });
    }
    assert.deepEqual(
      probe.settledAsked,
      entries.map(([, product]) => ({ productId: product.id, consumable: product.consumable })),
      'the finish path must take each product\'s type from the catalogue',
    );

    // Non-consumable is the classification with the shortcut — an acknowledged
    // one is settled and never reaches a real finish — so anything the catalogue
    // does not name must take the consumable path, where acknowledgement proves
    // nothing.
    probe.settledAsked.length = 0;
    await adapter.finishTransaction({
      products: [{ id: 'fixture.absent.product' }],
      transactionId: 't-absent',
      state: 'approved',
    });
    assert.deepEqual(probe.settledAsked, [{ productId: 'fixture.absent.product', consumable: true }]);
  });

  test(`[${storeKey}] only a product this catalogue sells is tracked for delivery`, needsHooks, async () => {
    const approvals = [];
    const { adapter, probe } = await startedStore(storeKey, {
      onTransactionApproved: (transaction, { tracked }) => {
        approvals.push({ id: transaction.products[0].id, tracked });
      },
    });

    const approve = (id) => probe.subscriptions.approved({
      products: [{ id }],
      transactionId: `a-${id}`,
      isPending: false,
    });
    for (const [, product] of entries) approve(product.id);
    // A product of the *other* catalogue, not merely an invented id: an adapter
    // that registered whatever config held rather than this store's half would
    // track it, and no assertion above would notice.
    const foreign = Object.values(CATALOGUES[STORE_KEYS.find((k) => k !== storeKey)])[0];
    approve(foreign.id);
    approve('fixture.absent.product');

    assert.deepEqual(
      approvals,
      [
        ...entries.map(([, product]) => ({ id: product.id, tracked: true })),
        { id: foreign.id, tracked: false },
        { id: 'fixture.absent.product', tracked: false },
      ],
      'membership in this store\'s catalogue is what decides tracking',
    );
    // Refused on purpose, not dropped: an untracked transaction is left
    // unfinished so the store replays it.
    assert.deepEqual(
      adapter.getDebugSnapshot().pendingTransactionIds,
      entries.map(([, product]) => `a-${product.id}`),
      'only the tracked transactions may be held',
    );
  });

  test(`[${storeKey}] only a non-consumable price update is an entitlement change`, needsHooks, async () => {
    const reasons = [];
    const { probe } = await startedStore(storeKey, {
      onEntitlementMaybeChanged: (reason) => reasons.push(reason),
    });

    for (const [, product] of entries) {
      reasons.length = 0;
      probe.subscriptions.productUpdated({ id: product.id });
      assert.equal(
        reasons.includes('product-updated'),
        !product.consumable,
        `${product.id} is ${product.consumable ? 'a consumable and owns nothing' : 'ownable'}`,
      );
    }
  });
}

// A game that ships with purchases switched off. The contract calls an empty
// catalogue the honest answer for it, and the schema now accepts one — so the
// adapter has to survive it without inventing a product, and without claiming a
// capability it cannot honour.
test('[empty] a catalogue that sells nothing answers an empty map, not a missing one', needsHooks, async () => {
  const { adapter } = await loadAdapter(EMPTY_STORE_KEY);
  assert.deepEqual(adapter.getPrices(), {}, 'a price map with no products is still a map');
  assert.deepEqual(adapter.getProductIds(), {});
});

test('[empty] nothing is registered with the store when there is nothing to sell', needsHooks, async () => {
  const { adapter, probe } = await startedStore(EMPTY_STORE_KEY);
  assert.deepEqual(probe.registered, []);
  assert.deepEqual(
    adapter.getDebugSnapshot().ownedNonConsumablesByKey,
    {},
    'a store with nothing to own answers an empty map, not null — null means there was no store',
  );
});

test('a build only claims it can sell when its catalogue says what', needsHooks, async () => {
  // The capability the facade reports is built on this. A platform answering
  // `supportsNativePurchases()` true owes the game a list of what it sells, so
  // the answer has to follow the catalogue rather than the operating system.
  for (const storeKey of STORE_KEYS) {
    const { adapter } = await loadAdapter(storeKey);
    assert.equal(adapter.hasProducts(), true, `${storeKey} sells something`);
  }
  const { adapter } = await loadAdapter(EMPTY_STORE_KEY);
  assert.equal(adapter.hasProducts(), false, 'a game with purchases switched off sells nothing');
});
