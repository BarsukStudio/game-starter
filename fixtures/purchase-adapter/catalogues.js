// Two catalogues that agree about nothing.
//
// The adapter is supposed to have no opinion about how many products a game
// sells, what they are called or which of them can be owned. A single catalogue
// cannot show that: an adapter with one product key written into it passes every
// assertion as long as the fixture happens to use the same key.
//
// So these two differ on all three axes at once — three products against four,
// no key in common, one non-consumable against two. Any value the adapter
// remembers about one of them is wrong about the other.
//
// They are reached through the store key rather than a flag of their own, which
// also keeps `getNativeKey()` routing under test: the adapter must read the
// catalogue of the store it is registering with, not the first one it finds.
export const EMPTY_STORE_KEY = 'empty';

// The two that actually sell something. Every case written against a product
// loops over these; the empty one has its own cases.
export const SELLING_STORE_KEYS = Object.freeze(['ios', 'android']);

export const CATALOGUES = Object.freeze({
  ios: Object.freeze({
    coins: Object.freeze({ id: 'fixture.ios.coins', consumable: true }),
    gems: Object.freeze({ id: 'fixture.ios.gems', consumable: true }),
    noAds: Object.freeze({ id: 'fixture.ios.no_ads', consumable: false }),
  }),
  android: Object.freeze({
    starterPack: Object.freeze({ id: 'fixture.android.starter_pack', consumable: true }),
    energy: Object.freeze({ id: 'fixture.android.energy', consumable: true }),
    premium: Object.freeze({ id: 'fixture.android.premium', consumable: false }),
    seasonPass: Object.freeze({ id: 'fixture.android.season_pass', consumable: false }),
  }),
  // A game that ships with purchases switched off. Not an error state and not a
  // store key any platform reports — a third catalogue whose only property is
  // that it sells nothing, kept here so the adapter meets it the same way it
  // meets the other two.
  [EMPTY_STORE_KEY]: Object.freeze({}),
});

export function keysOf(storeKey) {
  return Object.keys(CATALOGUES[storeKey]);
}

export function entriesOf(storeKey) {
  return Object.entries(CATALOGUES[storeKey]);
}

export function nonConsumableKeysOf(storeKey) {
  return entriesOf(storeKey).filter(([, product]) => !product.consumable).map(([key]) => key);
}

export function idOf(storeKey, key) {
  return CATALOGUES[storeKey][key].id;
}
