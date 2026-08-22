// The native store's transport: cordova-plugin-purchase, wrapped for Capacitor
// by `capacitor-plugin-cdv-purchase`.
//
// Hard rule 1 gives this file the SDK, the same way each `ads/*.js` owns exactly
// one ad SDK: it is the only module under `src/js/` allowed to name the plugin.
// `bridge.js` imports and composes this adapter instead of the SDK. Step 3 of the
// shared-platform work moved the store here one capability at a time
// (`TODO.md`): the namespace and platform selection, prices and ordering,
// ownership, the confirmed finish, restore, and finally the store's own
// lifecycle — registration, the subscriptions, `initialize()`, and finally the
// transaction routing: which transactions belong to a receipt, and the App
// Store's own service entry.
//
// Nothing here decides policy. It does not know what a product is worth, what
// the shop shows, or which purchase the player already owns — those stay in the
// game, and the later substeps of step 3 keep them there.
import {
  createPurchaseFinishCoordinator,
  isSettledStoreTransaction,
} from '@barsuk/game-runtime/purchase-finish';

import { APP_CONFIG } from '../config.js';
import { getNativeKey, isNative } from '../env.js';
import {
  getTransactionDeliveryId,
  getTransactionProductId,
} from '../purchase-delivery.js';

// The plugin is an ES module that owns the CdvPurchase namespace, not a global
// the page waits for, so it is imported once and kept. A failed import stays
// null rather than being remembered as a failure: the next caller is allowed to
// try again, which is what the bridge did before this file existed.
let namespace = null;

// Turns "finish dispatched" into "finish confirmed by the store".
let finishCoordinator = null;

// Whether `store.initialize()` has answered.
let offersReady = false;

// The store's own transactions, by id, from `approved` until they are settled.
// Raw plugin objects on purpose: they carry `verify()` and `finish()`, and the
// game holds them as opaque handles. Who *owns* one — which restore session was
// running when it arrived — is the game's bookkeeping, not this map.
const pendingTransactions = new Map();

export async function loadNamespace() {
  if (!isNative) return null;
  if (namespace) return namespace;
  try {
    const module = await import('capacitor-plugin-cdv-purchase');
    namespace = module.CdvPurchase ?? null;
  } catch (error) {
    console.warn('Purchase plugin load failed', error);
    namespace = null;
  }
  if (namespace) createFinishCoordinator();
  return namespace;
}

// Built the moment the namespace exists, before anything can be finished: it
// subscribes to the store's own FINISHED event, and a subscription made later
// would miss whatever the store reported in between.
//
// Disposed first, so a second load could never leave two subscriptions on one
// store. That is the shape the game had before this moved here.
function createFinishCoordinator() {
  finishCoordinator?.dispose?.();
  finishCoordinator = createPurchaseFinishCoordinator({
    store: namespace.store,
    finishedState: namespace.TransactionState.FINISHED,
    setTimeoutFn: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeoutFn: (handle) => window.clearTimeout(handle),
  });
}

// Which store this build's transactions belong to. No longer handed a namespace:
// nothing outside this file holds one.
function getPlatform() {
  if (getNativeKey() === 'android') return namespace.Platform.GOOGLE_PLAY;
  return namespace.Platform.APPLE_APPSTORE;
}

// The catalogue this build sells: the game's own product keys, each carrying the
// store id and the type that decides its finish path. `config.js` stays the only
// place these exist; the adapter reads them rather than being handed them,
// because it is what registers exactly this set with the store.
//
// How many products there are and what they are called is the game's business.
// Nothing below may name one.
function getCatalogue() {
  return APP_CONFIG.purchases[getNativeKey()];
}

// Whether this build sells anything at all.
//
// An empty catalogue is a valid configuration — a game may ship with purchases
// switched off — but it is not the same as a platform that can sell. The
// contract holds a platform answering `supportsNativePurchases()` true to naming
// what it sells, so the capability has to follow the catalogue rather than the
// operating system.
//
// Restoring is deliberately *not* gated on this: a platform may refuse new
// purchases and still owe a player everything they already bought.
export function hasProducts() {
  return Object.keys(getCatalogue()).length > 0;
}

// The store ids by the game's own key — the vocabulary the game speaks, and what
// the facade hands it. Exported rather than re-derived a second time next to the
// facade: a second derivation could disagree with the set this file registered.
export function getProductIds() {
  return Object.fromEntries(
    Object.entries(getCatalogue()).map(([key, product]) => [key, product.id]),
  );
}

function getProduct(productId) {
  const store = namespace?.store;
  if (!store || !productId) return null;
  return store.get(productId, getPlatform()) ?? null;
}

// A price the store actually confirmed. Everything else — no product, no offer,
// a blank string — answers null, so the shop can tell "not answered yet" apart
// from a real price instead of showing a placeholder that looks like an offer.
function readOfferPrice(product) {
  const price = product?.offers?.[0]?.pricingPhases?.[0]?.price;
  return typeof price === 'string' && price.trim() ? price : null;
}

// Every key the game sells, all unanswered. The shape is the same whether or not
// the store came up, so the shop reads one map and never has to tell a missing
// key apart from an unanswered price.
function noPrices() {
  return Object.fromEntries(Object.keys(getCatalogue()).map((key) => [key, null]));
}

// Nothing is readable until `store.initialize()` has answered: a product can
// carry a price before that — `productUpdated` fires while the store is still
// coming up — and putting it on screen would offer something the store has not
// confirmed it can sell.
//
// Pull, not push. The game repaints from one read of this whenever the store
// says something changed, which is the shape `refreshPurchasePrices()` already
// had — and it is the only shape that also answers after a store that never
// loaded, where there is no event to push.
export function getPrices() {
  if (!offersReady) return noPrices();
  return Object.fromEntries(
    Object.entries(getCatalogue()).map(
      ([key, product]) => [key, readOfferPrice(getProduct(product.id))],
    ),
  );
}

// Hands the purchase to the store's own flow. An id the store does not know and
// a product with no offer are both no-ops — and since this file is what
// registered the catalogue, `store.get()` answering nothing *is* "not one of our
// products".
//
// Deliberately fire-and-forget, and deliberately without a `.catch`. The plugin
// resolves this promise with an error object instead of rejecting, and a real
// rejection has never been handled on this path — normalizing one into a warning
// would be hardening, not the move this substep claims to be.
export function order(productId) {
  const store = namespace?.store;
  if (!store) return;
  const product = getProduct(productId);
  const offer = product?.getOffer?.() ?? product?.offers?.[0];
  if (!offer) return;
  void store.order(offer).then((error) => {
    if (error && error.code !== namespace.ErrorCode.PAYMENT_CANCELLED) {
      console.warn('Purchase order failed', error);
    }
  });
}

// Whether the store says this player owns the product.
//
// The comparison is strict and lives here, once. The plugin's public `owned()`
// already answers a boolean, so `false` is the shape production actually
// produces; the strictness guards everything else an adapter, a mock or a later
// wrapper could return, because anything falsy mistaken for ownership would hand
// out a paid entitlement, and anything truthy-but-not-true is not an answer the
// game may act on either.
//
// What this must never become is authoritative in the other direction: `false`
// here means "the store did not say yes", which is not the same as "the player
// does not own it" — see `syncRemoveAdsEntitlementFromStore()` in the game.
export function isOwned(productId) {
  const store = namespace?.store;
  if (!store || !productId) return false;
  return store.owned(productId) === true;
}

// The catalogue as this file uses it, and the only place a product's type is
// read. `register()` below takes its types from here and so do the finish
// shortcut and the entitlement test, so a product can never be a consumable in
// one half of this file and a non-consumable in the other.
//
// Projected field by field rather than handed through: these two are everything
// the adapter is allowed to know about a product, and a config that grew a third
// field must not start reaching the store by accident.
function getProductCatalogue() {
  return Object.values(getCatalogue()).map(({ id, consumable }) => ({ id, consumable }));
}

// Whether this id is one the game can own. Only a non-consumable carries an
// entitlement — a consumable is bought to be spent — so a price update on one is
// never an ownership change.
function isEntitlementProductId(productId) {
  return getProductCatalogue().some((entry) => entry.id === productId && !entry.consumable);
}

// Only a product this build registered may be treated as a non-consumable, and
// that matters because non-consumable is the classification with the shortcut:
// an acknowledged one is considered settled and never reaches `finish()`.
// Anything else — an unknown id, a transaction with no product at all, the
// App Store's own `appstore.application` service entry — takes the consumable
// path, where acknowledgement proves nothing and only real consumption or the
// FINISHED state ends it.
function isConsumableTransaction(transaction) {
  const productId = getTransactionProductId(transaction);
  const product = getProductCatalogue().find((entry) => entry.id === productId);
  return product ? product.consumable : true;
}

// Resolves once the store itself reports the transaction settled, not when the
// plugin has dispatched the call: `transaction.finish()` resolves on dispatch,
// and delivery that trusted it would report success on an open purchase.
export function finishTransaction(transaction) {
  const settled = isSettledStoreTransaction(transaction, {
    finishedState: namespace?.TransactionState?.FINISHED,
    consumable: isConsumableTransaction(transaction),
  });
  if (settled) {
    releasePendingTransaction(transaction);
    return Promise.resolve(transaction);
  }
  if (!finishCoordinator) {
    return Promise.reject(new Error('Purchase finish coordinator is unavailable.'));
  }
  // Released on the store's confirmation and nowhere else: a reject or a
  // confirmation timeout leaves the transaction tracked, because it is still
  // open and the store will replay it.
  return finishCoordinator.finish(transaction).then((finished) => {
    releasePendingTransaction(transaction);
    return finished;
  });
}

// Whether the store's transport ever came up.
//
// Read off the namespace this file kept, never off the value a caller received.
// A coordinator that throws while being built leaves `loadNamespace()` without a
// return, so the game holds nothing — but the transport is up, and a restore
// refused on that basis would stay refused for the life of the process.
export function isTransportAvailable() {
  return Boolean(namespace);
}

// Asks the store to replay what this player already bought. Whatever comes back
// is left exactly as it comes: the plugin resolves this with an error object
// about as readily as it rejects, and turning either into a result is the
// restore session's decision, not this file's.
export function restore() {
  const store = namespace?.store;
  if (!store) return Promise.resolve();
  return store.restorePurchases([getPlatform()]);
}

// Ownership as the store answers it, by the game's own product key.
//
// Non-consumables only. `store.owned()` on a consumable answers about a purchase
// that was meant to be spent, so a map including them would invite reading
// "already bought" off a product the player is supposed to buy again.
function readOwnedNonConsumables(store) {
  return Object.fromEntries(
    Object.entries(getCatalogue())
      .filter(([, product]) => !product.consumable)
      .map(([key, product]) => [key, store.owned(product.id) === true]),
  );
}

// What only the store can answer, as plain data — the store's half of whatever
// snapshot the game exposes to its own console.
//
// Never the store itself, never a transaction, never a function. This lands
// somewhere a console can reach it, and a live transaction there is one
// `finish()` away from settling a purchase that was never delivered.
//
// `ownedNonConsumablesByKey` stays `null` rather than a map of `false` when there
// is nothing to ask, and the null belongs to the whole map rather than to each
// entry. On a device that distinction is the point: "the store says no" and
// "there was no store" read identically as a boolean, and they are the
// difference between a lost entitlement and a store that never loaded.
export function getDebugSnapshot() {
  const store = namespace?.store;
  return {
    ownedNonConsumablesByKey: store ? readOwnedNonConsumables(store) : null,
    pendingTransactionIds: Array.from(pendingTransactions.keys()),
    transactions: (store?.localTransactions ?? []).map((transaction) => ({
      productId: getTransactionProductId(transaction),
      transactionId: getTransactionDeliveryId(transaction),
      state: transaction?.state ?? null,
      isPending: transaction?.isPending ?? null,
      isAcknowledged: transaction?.isAcknowledged ?? null,
      isConsumed: transaction?.isConsumed ?? null,
    })),
  };
}

// The store's lifecycle: register the catalogue, subscribe, and only then bring
// the store up. That order is the contract — a subscription made after
// `initialize()` would miss whatever the store replayed on the way up, and a
// product not registered by then is not in the catalogue it fetches.
//
// The callbacks are the game's, and none of them is bookkeeping this file could
// do instead: what a price means, what an entitlement change is worth, and what
// happens to an approved transaction are all decisions it does not get to make.
//
// No receipt ever crosses the boundary. The game is handed the transactions of
// one receipt, already correlated against what this file tracks; a transaction
// itself stays an opaque handle it passes back to `verify`, `finish` and its own
// delivery module.
export async function initializeStore(callbacks = {}) {
  const store = (await loadNamespace())?.store;
  if (!store) {
    console.warn('Purchase namespace unavailable; the store stays offline.');
    return;
  }

  const platform = getPlatform();

  store.verbosity = callbacks.verbose
    ? namespace.LogLevel.DEBUG
    : (namespace.LogLevel.ERROR ?? namespace.LogLevel.QUIET ?? 0);

  store.register(getProductCatalogue().map(({ id, consumable }) => ({
    id,
    type: consumable ? namespace.ProductType.CONSUMABLE : namespace.ProductType.NON_CONSUMABLE,
    platform,
  })));

  store.when().productUpdated((product) => {
    // A signal, never the product: the game pulls what it needs with
    // `getPrices()`, and handing over the plugin's own Product would put an SDK
    // shape back in the game after everything else stopped crossing.
    callbacks.onPricesUpdated?.();
    // Only a non-consumable can carry an entitlement; a consumable owns nothing,
    // so a price update on one is not an ownership change.
    if (isEntitlementProductId(product.id)) callbacks.onEntitlementMaybeChanged?.('product-updated');
  });
  store.when().receiptUpdated(() => {
    callbacks.onEntitlementMaybeChanged?.('receipt-updated');
  });
  // The flag first, the entitlement signal second. A running restore reads that
  // flag while deciding what this event means, so a sync arriving before it was
  // set would decide on the previous answer.
  store.when().receiptsReady(() => {
    callbacks.onReceiptsReady?.();
    callbacks.onEntitlementMaybeChanged?.('receipts-ready');
  });
  // Reported for every approval, tracked or not. A transaction this file will
  // not track still has to be verified — refusing to track it is a decision
  // about delivery, not about whether the store should look at the receipt.
  store.when().approved((transaction) => {
    const tracked = trackApprovedTransaction(transaction);
    callbacks.onTransactionApproved?.(transaction, { tracked });
  });
  store.when().verified((verifiedReceipt) => {
    const sourceReceipt = verifiedReceipt?.sourceReceipt;
    const transactions = correlateTransactions(sourceReceipt);
    // Awaited: the service entry of this receipt may only be finished once the
    // game is done with the real purchases in it. An error the game handled per
    // transaction never reaches here, so it cannot block that — but a throw out
    // of the whole callback does, deliberately: something went wrong nobody
    // accounted for, and settling anything on top of it is guesswork.
    void (async () => {
      try {
        await callbacks.onTransactionsVerified?.(transactions);
      } catch (error) {
        callbacks.onWarn?.(
          'Verified purchase delivery failed; transaction remains recoverable.',
          error,
        );
        return;
      }
      await finishServiceTransactions(sourceReceipt);
    })();
  });
  store.when().unverified((unverifiedReceipt) => {
    callbacks.onTransactionsUnverified?.(
      correlateTransactions(unverifiedReceipt?.receipt),
      new Error('Receipt verification failed.'),
    );
    console.warn('Receipt verification failed; nothing granted.', unverifiedReceipt?.payload);
  });

  await store.initialize([platform]).then((error) => {
    // The plugin reports a non-fatal startup problem by resolving with an error
    // object rather than rejecting. It goes down the same reporting channel as
    // everything else here; it is not a result the game acts on.
    if (error) callbacks.onWarn?.('Purchase store initialization reported an error.', error);
    // The catalogue is readable from here, and not one line earlier.
    offersReady = true;
    // The same two signals every other store event sends. A store that just came
    // up has a catalogue to show and an entitlement worth re-reading, and neither
    // of those needs a callback of its own.
    callbacks.onPricesUpdated?.();
    callbacks.onEntitlementMaybeChanged?.('store-initialized');
  }).catch((error) => {
    console.error('store.initialize error', error);
  });
}

// Asks the store to verify the receipt this transaction belongs to; nothing is
// granted before it answers. The promise is handed straight back — the brackets
// around it, and what a failure means to a running restore, are the game's.
export function verifyTransaction(transaction) {
  return Promise.resolve(transaction.verify());
}

// StoreKit adds a service entry to the receipt that is not a product and cannot
// be delivered. It must not block finishing the real purchases around it.
const APP_STORE_APPLICATION_TRANSACTION_ID = 'appstore.application';

// The gate on what this file will track. Everything it refuses is left
// unfinished on purpose, so the store replays it later.
function trackApprovedTransaction(transaction) {
  if (!transaction || transaction.isPending) return false;
  const productId = getTransactionProductId(transaction);
  if (!getProductCatalogue().some((entry) => entry.id === productId)) return false;
  const transactionId = getTransactionDeliveryId(transaction);
  if (!transactionId) {
    console.warn(`Approved purchase ${productId} has no transaction id; leaving it recoverable.`);
    return false;
  }
  pendingTransactions.set(transactionId, transaction);
  return true;
}

// Dropped only once the store has settled it, and only when the map still holds
// this exact object. A re-approval can put a new transaction under the same id
// while the old one is still being finished, and the service entry below is
// never in the map at all — deleting by id alone would take the wrong one out.
function releasePendingTransaction(transaction) {
  const transactionId = getTransactionDeliveryId(transaction);
  if (transactionId && pendingTransactions.get(transactionId) === transaction) {
    pendingTransactions.delete(transactionId);
  }
}

// Which tracked transactions belong to this receipt. Three predicates, and all
// three are load-bearing: the plugin identifies a transaction's receipt by
// object identity, by membership in the receipt's own list, and — after a replay
// rebuilt the objects — by id alone. Dropping any one of them silently loses a
// paid delivery.
function correlateTransactions(sourceReceipt) {
  if (!sourceReceipt) return [];
  const sourceTransactions = sourceReceipt.transactions ?? [];
  const sourceTransactionIds = new Set(sourceTransactions.map(getTransactionDeliveryId).filter(Boolean));
  return Array.from(pendingTransactions.values()).filter((transaction) => (
    transaction.parentReceipt === sourceReceipt
    || sourceTransactions.includes(transaction)
    || sourceTransactionIds.has(getTransactionDeliveryId(transaction))
  ));
}

// The service entry, finished after the game is done with the real purchases of
// the same receipt. It is not a product, so it belongs to no restore session and
// its failure is reported to the log alone.
async function finishServiceTransactions(sourceReceipt) {
  const serviceTransactions = (sourceReceipt?.transactions ?? []).filter(
    (transaction) => getTransactionDeliveryId(transaction) === APP_STORE_APPLICATION_TRANSACTION_ID,
  );
  for (const transaction of serviceTransactions) {
    if (typeof transaction.finish !== 'function') continue;
    try {
      await finishTransaction(transaction);
    } catch (error) {
      console.error('App Store application transaction could not be finished.', error);
    }
  }
}
