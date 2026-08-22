// A stand-in for the consumer's `config.js`, carrying only what the purchase
// adapter reads.
//
// The real module is a game's own file: it reads build-time environment through
// its bundler and carries that game's ids. Neither belongs here, and the adapter
// needs neither — it asks config for one thing, the catalogue of the store it is
// registering with.
import { CATALOGUES } from './catalogues.js';

export const APP_CONFIG = {
  // The two catalogues, reached the way the adapter reaches them: by store key.
  purchases: CATALOGUES,
};

export function getMobileStoreKey() {
  return 'ios';
}
