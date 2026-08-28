// A stand-in for `@barsuk/game-runtime/purchase-delivery`, carrying only the two
// readers the adapter imports.
//
// Kept identical to how the runtime's readers behave rather than simplified: the
// adapter decides what a transaction is about from these two answers, and both
// read the plugin's contract fields only — `products[0].id` and `transactionId`,
// trimmed, or an empty string. A fake that reached for a different field, or
// answered for one the real readers refuse, would test an adapter nobody ships.
export function getTransactionProductId(transaction) {
  return String(transaction?.products?.[0]?.id ?? '').trim();
}

export function getTransactionDeliveryId(transaction) {
  return String(transaction?.transactionId ?? '').trim();
}
