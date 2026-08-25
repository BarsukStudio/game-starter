// A stand-in for the template's `env.js`.
//
// The real module asks `@capacitor/core` what this platform is, and under Node
// the answer is always "web" — which is the one answer that makes the QA switch
// refuse to install itself. Declared here instead, the way the purchase-adapter
// fixtures declare theirs.
export const isNative = true;
export const nativePlatform = 'android';

export function getNativeKey() {
  return 'android';
}

export function getStoreKey() {
  return 'android';
}

export const runtimeTarget = Object.freeze({
  target: 'capacitor',
  ads: true,
  payments: true,
  sdk: null,
});
