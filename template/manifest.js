// What the template is allowed to reach for, declared so it can be checked
// rather than reviewed.
//
// A template is only copyable if its edges are known. Every *import* in a
// template tree must land in one of three places: another module of the same
// tree, one of that tree's consumer seams, or one of its external packages.
// Anything else is a file the copying game does not have, and it fails at its
// first build rather than here.
//
// Imports are not the only edge. Two build scripts read consumer *text* — one
// the game's config source, one the built bundle — and a text read resolves
// nothing, so it breaks with no import error anywhere. Those are declared
// separately, under `sourceDependencies`, and the closure guarantee covers
// module resolution only.
//
// This file is starter metadata. It is not part of what a game copies, and no
// template module imports it.

// Two trees, because they run in two different worlds. `platform/` is bundled
// and runs in the page; `scripts/` runs under plain Node and never ships. They
// are declared separately because their seams and prerequisites have nothing in
// common — and because a script importing a runtime module, or the reverse,
// would be a mistake worth catching.
export const TEMPLATE_TREES = Object.freeze({
  platform: Object.freeze({
    // Modules the tree imports but does not carry, with the exact names it uses.
    // Keys are resolved paths relative to the tree's own root, so one seam
    // declares once no matter how many different relative specifiers reach it.
    seams: Object.freeze({
      // Every game-specific value the runtime reads: ids, links, ad units, the
      // product catalogue, and the marker names in `platform`.
      // `../schemas/config.schema.js` states its shape, and a game imports it from
      // this package rather than copying it.
      './config.js': Object.freeze(['APP_CONFIG', 'getMobileStoreKey']),
      // The game's own debug logging, used by the two native ad adapters.
      '../debug.js': Object.freeze(['debugLog']),
    }),
    // Packages a consuming game must already depend on. The tree names an SDK in
    // exactly one module each, so this is also the list of capabilities it can
    // lose by deleting one file.
    prerequisites: Object.freeze([
      '@barsuk/game-runtime/ad-lifecycle',
      '@barsuk/game-runtime/ad-attempt-scope',
      '@barsuk/game-runtime/purchase-delivery',
      '@barsuk/game-runtime/purchase-finish',
      '@capacitor-community/admob',
      '@capacitor/app',
      '@capacitor/core',
      '@capacitor/splash-screen',
      // Only the opt-in diagnostics module imports these.
      '@capacitor-firebase/crashlytics',
      '@capacitor-firebase/performance',
      'capacitor-plugin-cdv-purchase',
      'capacitor-plugin-yandex-ads',
    ]),
  }),
  scripts: Object.freeze({
    seams: Object.freeze({
      // Everything only the build reads: the web targets, the Android
      // application id, the gradle injections and the pre-sync hooks.
      // `../schemas/build.config.schema.mjs` states its shape, and a game imports it
      // from this package rather than copying it.
      //
      // The runtime-target global is deliberately absent: it belongs to the
      // game's `config.js`, and `lib/runtime-target-global.mjs` reads it out of
      // that source so one name keeps one owner across the two worlds.
      './build.config.mjs': Object.freeze(['BUILD_CONFIG']),
    }),
    prerequisites: Object.freeze(['vite']),
    // Consumer text these scripts depend on, which no import declares.
    //
    // Neither is covered by the config schemas, and one of them cannot be: the
    // release gate reads two *module-level* declarations of `config.js` after
    // Vite has folded them into string literals, and a validator that receives
    // `APP_CONFIG` never sees them. Both scripts already fail loudly when what
    // they look for is missing; what was absent until now is any record that the
    // dependency exists at all.
    sourceDependencies: Object.freeze([
      Object.freeze({
        reader: 'lib/runtime-target-global.mjs',
        reads: "the consumer's config.js, as source",
        needs: Object.freeze(['runtimeTargetGlobal']),
      }),
      Object.freeze({
        reader: 'assert-production-ads.mjs',
        reads: 'the built bundle, for literals Vite folded out of config.js',
        needs: Object.freeze(['nativeAdsMode', 'admobTestingDevices']),
      }),
    ]),
  }),
});

// The starter is a devDependency: nothing in a shipped bundle may import it. The
// template is the part most likely to break that rule by accident, because it is
// the part that ships.
export const FORBIDDEN_RUNTIME_IMPORT = '@barsuk/game-starter';
