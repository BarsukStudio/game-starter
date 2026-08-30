// A stand-in for `capacitor-plugin-cdv-purchase`.
//
// The real plugin reaches for `window` while it evaluates and cannot be imported
// under Node at all, and the starter has no dependencies to install it from. What
// the adapter needs from it is small and entirely observable: a namespace of
// enums, and a store that records what it was registered with and answers what
// the fixture told it to.
//
// Records into `globalThis.__storeProbe` rather than exporting state. The adapter
// is loaded once per scenario through a fresh module URL, so a module-level
// recorder here would be a fresh one each time and the test could never read it.
function probe() {
  return globalThis.__storeProbe;
}

const subscriptions = {};

function when() {
  const chain = {};
  for (const event of [
    'productUpdated',
    'receiptUpdated',
    'receiptsReady',
    'approved',
    'verified',
    'unverified',
  ]) {
    chain[event] = (callback) => {
      subscriptions[event] = callback;
      probe().subscriptions[event] = callback;
      return chain;
    };
  }
  return chain;
}

const store = {
  verbosity: null,
  localTransactions: [],
  register(products) {
    probe().registered.push(...products);
  },
  get(id) {
    const price = probe().prices[id];
    return price === undefined ? null : { id, offers: [{ pricingPhases: [{ price }] }] };
  },
  owned(id) {
    probe().ownedAsked.push(id);
    return probe().owned[id] === true;
  },
  when,
  // `Promise<IError[]>`, as the plugin declares it (`www/store.d.ts`): a clean
  // startup resolves an *empty array*, not nothing. The distinction is the whole
  // reason this fake states the shape — an empty array is truthy, so an adapter
  // testing the result for existence rather than emptiness warns on every
  // successful launch, and a fake resolving `undefined` never shows it.
  initialize(platforms) {
    probe().initializedWith.push(...platforms);
    return Promise.resolve(probe().initializeResult);
  },
  order() {
    return Promise.resolve(undefined);
  },
  restorePurchases() {
    return Promise.resolve(undefined);
  },
};

export const CdvPurchase = {
  store,
  Platform: { GOOGLE_PLAY: 'google-play', APPLE_APPSTORE: 'apple-appstore' },
  ProductType: { CONSUMABLE: 'consumable', NON_CONSUMABLE: 'non-consumable' },
  LogLevel: { DEBUG: 4, ERROR: 1, QUIET: 0 },
  TransactionState: { FINISHED: 'finished' },
  ErrorCode: { PAYMENT_CANCELLED: 6777006 },
};
