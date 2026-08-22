// The game's single entry into everything platform-specific.
//
// Step 1 of the shared-platform work (`TODO.md`, `GAME_PLAYBOOK.md` §10):
// `main.js` stops importing seventeen free functions and holds one controller
// instead. `bridge.js` still owns every implementation — nothing here decides
// policy, loads an SDK, reshapes a result or adds a capability the game does not
// already ask for. Splitting the bridge by environment is step 2; moving the
// purchase lifecycle behind this boundary is step 3.
//
// The methods are the bridge functions themselves, not wrappers: none of them
// reads `this`, so handing the value over is the same call with one indirection
// less to go wrong. The object literal *is* the boundary — a new bridge export
// reaches the game only by being listed here.
//
// No SDK value crosses this table any more. The purchase methods take and return
// the game's own vocabulary — product ids, prices, a plain debug snapshot — with
// one exception by design: a store transaction travels as an opaque handle the
// game passes back to `verifyPurchaseTransaction` and `finishPurchaseTransaction`
// and hands to its own headless delivery module. It never reads the store
// through it.
import * as bridge from './bridge.js';

export function createPlatformController() {
  return {
    // Startup
    initializePlatformServices: bridge.initializePlatformServices,
    hideNativeStatusBar: bridge.hideNativeStatusBar,
    getPortalLanguage: bridge.getPortalLanguage,

    // Ads
    showInterstitialAd: bridge.showInterstitialAd,
    preloadInterstitialAd: bridge.preloadInterstitialAd,
    showRewardedAd: bridge.showRewardedAd,
    preloadRewardedAd: bridge.preloadRewardedAd,
    setAdsRemovedOwned: bridge.setAdsRemovedOwned,

    // Purchases
    supportsNativePurchases: bridge.supportsNativePurchases,
    supportsRestorePurchases: bridge.supportsRestorePurchases,
    initializePurchaseStore: bridge.initializePurchaseStore,
    verifyPurchaseTransaction: bridge.verifyPurchaseTransaction,
    getPurchaseProducts: bridge.getPurchaseProducts,
    getPurchasePrices: bridge.getPurchasePrices,
    orderPurchase: bridge.orderPurchase,
    isPurchaseProductOwned: bridge.isPurchaseProductOwned,
    finishPurchaseTransaction: bridge.finishPurchaseTransaction,
    isPurchaseTransportAvailable: bridge.isPurchaseTransportAvailable,
    restorePurchases: bridge.restorePurchases,
    getPurchaseDebugSnapshot: bridge.getPurchaseDebugSnapshot,

    // Lifecycle
    bindNativeLifecycle: bridge.bindNativeLifecycle,
    exitNativeApp: bridge.exitNativeApp,

    // Store links
    openDeveloperPage: bridge.openDeveloperPage,
    requestRating: bridge.requestRating,
  };
}
