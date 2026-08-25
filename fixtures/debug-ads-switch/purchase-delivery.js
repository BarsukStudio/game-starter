// A stand-in for the consumer's `purchase-delivery.js`. Imported by the purchase
// adapter the bridge pulls in; unused on the QA-switch path.
export function getTransactionProductId(transaction) {
  return String(transaction?.products?.[0]?.id ?? '').trim();
}

export function getTransactionDeliveryId(transaction) {
  return String(transaction?.transactionId ?? '').trim();
}
