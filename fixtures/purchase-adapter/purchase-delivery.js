// A stand-in for the consumer's `purchase-delivery.js`, carrying only the two
// readers the adapter imports.
//
// Kept identical to the shape the seam declares rather than simplified: the
// adapter decides what a transaction is about from these two answers, so a fake
// that read a different field would test an adapter nobody ships.
export function getTransactionProductId(transaction) {
  return String(transaction?.products?.[0]?.id ?? '').trim();
}

export function getTransactionDeliveryId(transaction) {
  return String(transaction?.transactionId ?? '').trim();
}
