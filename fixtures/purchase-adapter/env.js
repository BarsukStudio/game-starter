// A stand-in for the template's `env.js`.
//
// The real module asks `@capacitor/core` which platform this is, and under Node
// the answer is always "web" — so an adapter running against it could only ever
// exercise the off-native branch. The answers are declared in the URL instead.
//
// Declared, never derived: a fake that re-implemented `getNativeKey()` could
// agree with itself while disagreeing with the module it stands in for.
const params = new URL(import.meta.url).searchParams;

export const isNative = params.get('native') !== '0';
export const nativePlatform = params.get('key') ?? 'ios';

export function getNativeKey() {
  return params.get('key') ?? 'ios';
}

export function getStoreKey() {
  return getNativeKey();
}

export const runtimeTarget = Object.freeze({
  target: 'generic',
  ads: false,
  payments: false,
  sdk: null,
});
