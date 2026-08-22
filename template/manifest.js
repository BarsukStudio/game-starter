// What the `platform/` template is allowed to reach for, declared so it can be
// checked rather than reviewed.
//
// A template is only copyable if its edges are known. Every import in
// `template/platform/` must land in one of three places: another template
// module, one of the consumer seams below, or one of the external packages
// below. Anything else is a file the copying game does not have, and it fails at
// its first build rather than here.
//
// This file is starter metadata. It is not part of what a game copies, and no
// template module imports it.

// Where the template's own modules live, relative to this file.
export const TEMPLATE_ROOT = 'platform';

// Modules the template imports but does not carry, with the exact names it uses.
// Keys are resolved paths relative to `TEMPLATE_ROOT`, so the same seam declares
// once no matter how many different relative specifiers reach it.
//
// A game supplies all four. Three sit beside the template; `../debug.js` sits one
// level above it, where the game's own logging already lives.
export const CONSUMER_SEAMS = Object.freeze({
  // Every game-specific value: ids, links, ad units, the product catalogue, and
  // the marker names in `platform`. `config.schema.js` states its shape.
  './config.js': Object.freeze(['APP_CONFIG', 'getMobileStoreKey']),
  // The shared load/show/reward state machine both ad paths report into.
  './ad-lifecycle.js': Object.freeze([
    'AD_LATE_REWARD_GRACE_MS',
    'AD_PRESENTATION_TIMEOUT_MS',
    'createAdLifecycle',
  ]),
  // How a store transaction is identified. The game owns this because what
  // counts as one delivery is its bookkeeping, not the transport's.
  './purchase-delivery.js': Object.freeze([
    'getTransactionDeliveryId',
    'getTransactionProductId',
  ]),
  // The game's own debug logging, used by the two native ad adapters.
  '../debug.js': Object.freeze(['debugLog']),
});

// Two of the seams above are temporary, and saying so here keeps a later move
// from reading as drift: `ad-lifecycle.js` and `purchase-delivery.js` are
// headless logic destined for `@barsuk/game-runtime`, each through its own
// extraction once a second consumer needs it. Until then every game supplies its
// own copy, and the template imports them as seams like any other.
export const SEAMS_AWAITING_EXTRACTION = Object.freeze([
  './ad-lifecycle.js',
  './purchase-delivery.js',
]);

// Packages a consuming game must already depend on. The template names an SDK in
// exactly one module each, so this list is also the list of capabilities it can
// lose by deleting one file.
export const EXTERNAL_PREREQUISITES = Object.freeze([
  '@barsuk/game-runtime/purchase-finish',
  '@capacitor-community/admob',
  '@capacitor/app',
  '@capacitor/core',
  '@capacitor/splash-screen',
  'capacitor-plugin-cdv-purchase',
  'capacitor-plugin-yandex-ads',
]);

// The starter is a devDependency: nothing in a shipped bundle may import it. The
// template is the part most likely to break that rule by accident, because it is
// the part that ships.
export const FORBIDDEN_RUNTIME_IMPORT = '@barsuk/game-starter';
