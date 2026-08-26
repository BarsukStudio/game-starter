// A stand-in for `capacitor-plugin-yandex-ads`, which the adapter imports
// dynamically.
//
// The plugin handle is a Proxy, not a plain object, because that is what
// `registerPlugin()` returns and because the difference is load-bearing here.
// Capacitor's proxy answers *every* property with a callable native method —
// `then` included — so a handle that reaches the promise resolution procedure
// is treated as a thenable and called as `then(resolve, reject)`. The call
// dispatches natively, finds no such method, and rejects a promise nobody is
// holding; neither `resolve` nor `reject` is ever invoked, so whoever awaited
// the assimilated value waits for the life of the page.
//
// A plain object could not express any of that, and a suite built on one would
// pass while the banner stayed on screen.
import { recordSynthesized, removeBanner } from './banner-probe.js';

const implemented = {
  removeBanner: () => removeBanner('yandex'),
};

export const YandexAds = new Proxy({}, {
  get(_, prop) {
    // Symbols answer undefined. The real proxy synthesizes those too, but the
    // only name this case turns on is `then`, and a callable `Symbol.iterator`
    // or inspect hook would only make failures harder to read.
    if (typeof prop === 'symbol') return undefined;
    const name = prop;
    if (Object.prototype.hasOwnProperty.call(implemented, name)) return implemented[name];
    recordSynthesized(name);
    // Rejected, and silenced: the page only logs an unhandled rejection, while
    // Node would take the whole run down for one.
    const rejected = Promise.reject(
      new Error(`"YandexAds.${name}()" is not implemented on android`),
    );
    rejected.catch(() => {});
    return () => rejected;
  },
});
