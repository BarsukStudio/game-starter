// The platform contract itself: what a game may ask its platform for, and what
// the platform may call back.
//
// This file is the canonical owner. Until step 5 the list lived as a literal
// inside Muscle Clicker's own `scripts/platform-facade-contract-test.mjs`, which
// said outright that gym was its provisional owner; a second game copying that
// file would have copied the contract with it, and a copied contract drifts
// exactly the way a copied test does. Consumers now import these names instead
// of restating them, and conformance is checked against this artifact.
//
// Nothing here is executable policy. It is a list of names and the version they
// were frozen at — the behaviour behind them is proven by the conformance suite
// (step 5c), and the transport behind *that* is the consumer's own adapter.

// Bumped when a name is added, removed or renamed, or when a documented
// semantic changes. Deliberately independent of the package version in
// `package.json`: the template and the scripts will move without these names
// moving, and one field cannot honestly report both. `test/manifest.test.js`
// keeps them from being derived from each other.
//
// It does not become `1.0.0` before a second consumer has been through it —
// step 6 may still find a breaking problem.
export const CONTRACT_VERSION = '0.6.0';

// Every method `createPlatformController()` hands the game, and nothing else.
// Sorted so a diff over this array is a diff over the contract rather than over
// somebody's grouping preference; the readable grouping lives in
// `CAPABILITY_GROUPS` below, over the same names.
export const PLATFORM_CONTRACT = Object.freeze([
  'bindNativeLifecycle',
  'describePurchaseTransaction',
  'exitNativeApp',
  'finishPurchaseTransaction',
  'getPortalLanguage',
  'getPrivacyOptionsState',
  'getPurchaseDebugSnapshot',
  'getPurchasePrices',
  'getPurchaseProducts',
  'hideNativeStatusBar',
  'initializePlatformServices',
  'initializePurchaseStore',
  'isPurchaseProductOwned',
  'isPurchaseTransportAvailable',
  'openDeveloperPage',
  'orderPurchase',
  'preloadInterstitialAd',
  'preloadRewardedAd',
  'requestRating',
  'restorePurchases',
  'setAdsRemovedOwned',
  'showInterstitialAd',
  'showPrivacyOptions',
  'showRewardedAd',
  'supportsNativePurchases',
  'supportsRestorePurchases',
  'verifyPurchaseTransaction',
]);

// The same names, grouped by the capability they belong to. A game that ships
// without a capability still exposes its methods — a controller with a hole in
// it would make every call site ask whether the method exists — so a group is a
// reading aid and a unit for the conformance suite, never a switch.
export const CAPABILITY_GROUPS = Object.freeze({
  startup: Object.freeze([
    'initializePlatformServices',
    'hideNativeStatusBar',
    'getPortalLanguage',
  ]),
  ads: Object.freeze([
    'showInterstitialAd',
    'preloadInterstitialAd',
    // Optional onRewardConfirmed callback is request-bound and may run after
    // UI finalization. It fires at most once and replaces onRewardedComplete.
    'showRewardedAd',
    'preloadRewardedAd',
    'setAdsRemovedOwned',
  ]),
  // Unavailable platforms return { available: false, busy: false } and false.
  // A successful form retires ads prepared under old choices. The adapter may
  // rebuild inventory, or require the caller to preserve state and reload.
  privacy: Object.freeze([
    'getPrivacyOptionsState',
    'showPrivacyOptions',
  ]),
  purchases: Object.freeze([
    'supportsNativePurchases',
    'supportsRestorePurchases',
    'initializePurchaseStore',
    'verifyPurchaseTransaction',
    // describePurchaseTransaction(handle) is synchronous, has no store side
    // effects, and returns only { productId: string, transactionId: string,
    // pending: boolean }. IDs are stable delivery identity; absent identity
    // is an empty string. An absent handle returns empty IDs and pending=false.
    // Description does not verify, grant, finish, or authorize delivery.
    'describePurchaseTransaction',
    'getPurchaseProducts',
    'getPurchasePrices',
    'orderPurchase',
    'isPurchaseProductOwned',
    'finishPurchaseTransaction',
    'isPurchaseTransportAvailable',
    'restorePurchases',
    'getPurchaseDebugSnapshot',
  ]),
  // onPause/onResume carry 'app-state' or 'native-pause'. Each source must
  // release only itself; DOM visibility remains the consumer's independent input.
  lifecycle: Object.freeze([
    'bindNativeLifecycle',
    'exitNativeApp',
  ]),
  storeLinks: Object.freeze([
    'openDeveloperPage',
    'requestRating',
  ]),
});

// The other direction: what the platform calls on the game.
//
// A method list alone cannot describe an ad. `showInterstitialAd()` returns a
// boolean about the attempt, while the outcome that decides what the game does
// next — presented, failed, closed, rewarded — arrives later, on the callback
// bag the game handed to the initializer. A fullscreen ad covers the app for
// tens of seconds; the promise is not where its result lives. So the terminal
// outcomes are contract, and they are named here.
//
// Show return values describe dispatch, never a reward or a displayed impression.
// `false` means this invocation was refused or failed. A failure callback may
// already have run before the Promise settles; some refusals (e.g. a duplicate
// while busy) emit none. Callers must not wait for a callback after `false`.
// Finalize their own request idempotently by its captured id, so callback then
// false cannot finalize a newer request. A refused duplicate must not terminate
// the accepted in-flight attempt. `true` is not proof of presentation or reward:
// those are confirmed only by the callbacks (including a bound reward handler).
//
// Keyed by the initializer that receives them, because the two bags are not
// interchangeable and a flat list would lose which method owns which name.
//
// Deliberately absent: the *values* a callback is handed. `onEntitlementMaybeChanged`
// gets a reason string, and the contract stops there — the particular reasons a
// store emits belong to that store's plugin, and pinning them here would make
// the starter quietly prescribe one.
export const PLATFORM_CALLBACKS = Object.freeze({
  initializePlatformServices: Object.freeze([
    // Optional: { format, reason: 'unresolved-presentation' } and no payload.
    'onAdUnavailable',
    'onAdAvailable',
    'onInterstitialLoaded',
    'onInterstitialLoadFailed',
    'onInterstitialShown',
    'onInterstitialShowFailed',
    'onInterstitialClosed',
    'onRewardedLoaded',
    'onRewardedLoadFailed',
    'onRewardedShown',
    'onRewardedShowFailed',
    'onRewardedClosed',
    'onRewardedComplete',
  ]),
  initializePurchaseStore: Object.freeze([
    'onPricesUpdated',
    'onEntitlementMaybeChanged',
    'onReceiptsReady',
    'onTransactionApproved',
    'onTransactionsVerified',
    'onTransactionsUnverified',
    'onWarn',
  ]),
});

// The non-callback fields that travel in the same bags. They are inputs, not
// outcomes, so they are not callbacks — but they are still arguments the
// platform reads, which makes them contract: a game that stops passing `locale`
// changes which ad provider it gets.
export const PLATFORM_INITIALIZER_INPUTS = Object.freeze({
  initializePlatformServices: Object.freeze([
    'locale',
    'removeAdsFlag',
  ]),
  initializePurchaseStore: Object.freeze([
    'verbose',
  ]),
});
