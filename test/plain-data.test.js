// What counts as data a game could have written down itself.
//
// The cheap version of this check — round-tripping through JSON — passes on
// exactly the values worth catching: a live store's methods are dropped in
// silence on the way out, and a method hidden behind a non-enumerable
// descriptor is invisible on both sides of the comparison.
import assert from 'node:assert/strict';
import test from 'node:test';

import { findNonPlainValue, isRecord } from '../contract/plain-data.js';

test('plain readings pass', () => {
  assert.equal(findNonPlainValue({
    removeAdsOwnedByStore: null,
    pendingTransactionIds: ['a', 'b'],
    transactions: [{ productId: 'x', state: 'finished', isPending: false }],
    counts: { open: 0 },
  }), null);
});

test('a function is not data', () => {
  assert.match(findNonPlainValue({ finish: () => {} }), /\$\.finish is a function/);
});

test('a method hidden behind a non-enumerable descriptor is still there', () => {
  const snapshot = { productId: 'x' };
  Object.defineProperty(snapshot, 'finish', { value: () => {}, enumerable: false });
  // The cheap check this replaces would have said yes.
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.match(findNonPlainValue(snapshot), /non-enumerable/);
});

test('an accessor is not data', () => {
  const snapshot = Object.defineProperty({}, 'live', { get: () => ({}), enumerable: true });
  assert.match(findNonPlainValue(snapshot), /is an accessor/);
});

test('a class instance is not data', () => {
  class Store {}
  assert.match(findNonPlainValue({ store: new Store() }), /Store instance/);
});

test('a passenger on an array is caught, and an ordinary array is not', () => {
  const carrier = ['a'];
  Object.defineProperty(carrier, 'sdk', { value: {}, enumerable: false });
  assert.match(findNonPlainValue({ transactions: carrier }), /rides along on an array/);
  assert.equal(findNonPlainValue({ transactions: ['a', 'b'] }), null);
});

// Keys that look like indices to `Number()` and are not.
//
// `String(Number(key)) === key` says yes to every one of these, and an array
// never iterates any of them, so a value parked under one is invisible to
// `entries()`, to `JSON.stringify` and to every other reader that walks the
// array. That was the shape of the hole this check replaced.
for (const key of ['-1', 'NaN', 'Infinity']) {
  test(`an array key of ${key} is not an index`, () => {
    const carrier = ['a'];
    carrier[key] = () => {};
    assert.equal(
      String(Number(key)) === key,
      true,
      'this key is exactly the kind the old check waved through'
    );
    assert.match(findNonPlainValue({ transactions: carrier }), /rides along on an array/);
  });
}

// Not a regression — `String(Number('-0'))` is `'0'`, so even the old check
// rejected this one. Kept as a boundary: `-0` is a number an index could
// plausibly be confused with, and it is still not one.
test('an array key of -0 is not an index either', () => {
  const carrier = ['a'];
  carrier['-0'] = () => {};
  assert.match(findNonPlainValue({ transactions: carrier }), /rides along on an array/);
});

test('a real index is still an index', () => {
  const carrier = [];
  carrier[0] = 'a';
  carrier[1] = 'b';
  assert.equal(findNonPlainValue({ transactions: carrier }), null);
});

test('a hole in an array is not data', () => {
  const sparse = ['a'];
  sparse[3] = 'b';
  assert.match(findNonPlainValue({ transactions: sparse }), /cannot be written down/);
});

test('a symbol key hides a value from every reader', () => {
  const snapshot = { [Symbol('handle')]: {} };
  assert.match(findNonPlainValue(snapshot), /keyed by a symbol/);
});

test('a number that cannot be written down is not data', () => {
  assert.match(findNonPlainValue({ pending: Number.POSITIVE_INFINITY }), /cannot be written down/);
});

test('a record is an object with names, never an array', () => {
  assert.equal(isRecord({ money1: 'id' }), true);
  assert.equal(isRecord(['id']), false, 'an array has no product names in it');
  assert.equal(isRecord(null), false);
  assert.equal(isRecord('id'), false);
});
