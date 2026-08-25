// A stand-in for `@barsuk/game-runtime/purchase-finish`. The purchase adapter
// imports it; nothing on the QA-switch path calls it.
export function isSettledStoreTransaction() {
  return false;
}

export function createPurchaseFinishCoordinator() {
  return { dispose() {}, finish: (transaction) => Promise.resolve(transaction) };
}
