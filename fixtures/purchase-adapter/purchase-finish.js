// A stand-in for `@barsuk/game-runtime/purchase-finish`.
//
// That package is headless logic with its own tests; what matters here is the one
// question the adapter asks it — whether a transaction is settled — because the
// answer depends on the `consumable` flag the adapter read out of the catalogue.
// Recording that flag is how a catalogue-driven classification becomes visible
// from outside.
function probe() {
  return globalThis.__storeProbe;
}

export function isSettledStoreTransaction(transaction, { finishedState, consumable }) {
  probe().settledAsked.push({
    productId: transaction?.products?.[0]?.id ?? null,
    consumable,
  });
  // An acknowledged non-consumable is settled; everything else has to reach a
  // real finish. The real module says the same, and the adapter's own tests in
  // the consuming game pin the rest of it.
  if (!consumable && transaction?.isAcknowledged === true) return true;
  return transaction?.state === finishedState;
}

export function createPurchaseFinishCoordinator() {
  return {
    dispose() {},
    finish(transaction) {
      probe().finished.push(transaction?.products?.[0]?.id ?? null);
      return Promise.resolve(transaction);
    },
  };
}
