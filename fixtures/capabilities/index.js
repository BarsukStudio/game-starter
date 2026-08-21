// A miniature consumer whose purchase capabilities the test sets.
//
// Enough of the contract to run the purchase cases that gate on a capability,
// and nothing more: what is under test is which cases the suite decides to run,
// not what this controller does with them.
import { ask, can } from './store.js';

export function createPlatformController() {
  return {
    supportsNativePurchases: () => can('buy'),
    supportsRestorePurchases: () => can('restore'),
    async initializePurchaseStore() {
      ask('initialize');
    },
    restorePurchases() {
      ask('restore');
      return Promise.resolve();
    },
  };
}
