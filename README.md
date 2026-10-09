# @barsuk/game-starter

The versioned platform contract and the starter template shared by Barsuk Studio
games. Plain ES modules, no build step, no dependencies.

**Status: pre-alpha.** The contract manifest and its conformance suite are
canonical. `template/` carries two trees cut from Muscle Clicker — `platform/`,
the transport layer a game bundles, and `scripts/`, the build, sync and release
scripts it runs under Node — plus `schemas/`, which states what a consumer's two
config files must provide and is imported from this package rather than copied.

Current contract: **0.6.0**; package: **0.1.0-alpha.22** (local candidate).
Contract 0.6 defines refusal semantics in `contract/manifest.js` and runs the same
ad cases in `portal-ads`, `native-admob-ads` and `native-yandex-ads`. Native fixtures
must retain the real controller and adapters; `testing/native-ads.mjs` provides
optional SDK stand-ins shared by consumers. Native cases also check exclusion of
both fullscreen formats through JS timeout until the native terminal event.
The template includes Yandex recovery without provider fallback, Yandex banner
telemetry, privacy telemetry and AdMob cross-format presentation exclusion.
AdMob/Yandex custom revenue collection supports Android and iOS; the reviewed native
patch forwards nullable Yandex iOS impression data for all three ad formats.
Contract 0.5 adds the synchronous, side-effect-free `describePurchaseTransaction(handle)`
method. Its plain `{ productId, transactionId, pending }` result identifies delivery
without exposing SDK fields or verifying/finishing the transaction. Missing identity
is an empty string; an absent handle returns empty IDs and `pending: false`.
Ad conformance waits one event-loop turn after driven SDK outcomes, so synchronous
and Promise-delivered callbacks meet the same assertions.
Contract 0.4 permits privacy inventory refresh without a WebView reload; old-choice
ads must always be retired. Contract 0.3 added optional ad-availability callbacks, request-bound late reward
confirmation, and independent native lifecycle source identities. Consumer fixtures
must expose `controls.lifecycle.appState(bool)`, `pause()` and `resume()` in
`native-store`. Run the canonical suite against the real controller before repinning.
Consumer rollout and device evidence live in each game's status document.

## The layer this owns

```
game        gameplay, engine, economy, UI, saves, ids, placement policy
   |
versioned platform contract     <- this repository
   |                               createPlatformController + capabilities
environment adapters               + machine-checked conformance
   |                               Capacitor / AdMob / Yandex / purchases / portals
@barsuk/game-runtime            headless logic only: no SDK, no window, no storage
```

The contract is the method list, the callback bags, the arguments, the terminal
outcomes, a version, and a conformance suite. It is checked by a machine, because
a copied file with a version constant in it is not protected from drift by the
constant.

The implementation behind the contract — the local `platform/` directory, the
adapters, the SDK wiring — may be copied into each game and may diverge. The
required *result* may not.

## Contents

| Path | What it is |
| --- | --- |
| `contract/manifest.js` | the canonical method list, capability groups, callback bags and `CONTRACT_VERSION` |
| `contract/runner.mjs` | runs the cases against a consumer's real controller: redirection, per-case isolation, skips |
| `contract/fixtures-schema.js` | what a consumer must supply, and what it may never substitute |
| `contract/cases/` | the canonical cases — surface, startup, ads, purchases, lifecycle and links |
| `contract/plain-data.js` | whether a value is something a game could have written down itself |
| `fixtures/`, `test/` | miniature consumers, the seam stand-ins the template's own suites run against, and the tests |
| `LEGACY_AUDIT_PROMPT.md` | read-only inventory workflow for already published legacy games |

A consumer supplies fixtures — the environment, the SDKs, the external events —
and the runner imports that consumer's real `createPlatformController()`. It may
not supply a controller or the module composing one; the schema refuses a fixture
that tries, however the substitution is dressed up.

A case that does not apply to a consumer is skipped rather than failed: a game
that sells nothing is not in breach of a purchase contract.

## Plugin setup

[PLUGINS.md](PLUGINS.md) is the installation and verification recipe for new
consumers, including optional Firebase diagnostics. It distinguishes package
requirements from runtime feature flags and local checks from device acceptance.

## Install

```json
"devDependencies": {
  "@barsuk/game-starter": "https://github.com/BarsukStudio/game-starter/archive/<sha>.tar.gz"
}
```

Pinned by exact SHA, as a devDependency. Nothing in a shipped bundle may import
this package — consumers assert that in their own contract tests.

## Updating a consumer

Preserve the previous installed starter package before installing a candidate.
Run `barsuk-compare-template --root /path/to/game --baseline /path/to/previous-starter`.
Pass `--native-stack cas` for a CAS consumer; comparison uses the selected overlay.
The report distinguishes unchanged files, consumer-only changes, template updates,
and files changed on both sides. It never overwrites game policy or native settings.
Review `review-both` files and missing optional modules explicitly; copying the
whole platform tree is not an update strategy. Native patch changes travel with
their adapters and regression tests.

Runtime 0.2.2 adds SDK inventory availability without resetting presentations or
rewards. Runtime 0.2.1 fixes confirmation deadlines and dispatch-attempt identity in
`purchase-finish`. The local Gym candidate consumes npm archives under `vendor/`
with lockfile integrity. Published consumers keep their existing exact SHA until
an explicit release and migration; do not fabricate a future SHA or a device pass.

The native release script requires consumer `verify:js` and `verify:native --
<ios|android>` scripts. They must fail before build/sync if a mandatory check fails.
Local development builds remain independent of this release gate.

Reward placements are consumer-owned values. The template coordinator accepts an
opaque placement and snapshotted payload. Pass its `captureReward()` callback to
`showRewardedAd(callback)`; late confirmation may pay that original request after
UI finalization. Call `invalidate()` after a successful progress reset.
`onAdUnavailable({format, reason: 'unresolved-presentation'})` and `onAdAvailable()`
report native presentation availability; they never authorize a second concurrent
native show. SDK-specific request identities and patch policy live in [PLUGINS.md](PLUGINS.md).

## Rules

The full contract for contributors is in `AGENTS.md`. The short version:

- No game is identifiable in here — no ids, no keys, no marker globals, no UI.
- Canonical cases run against the consumer's real `createPlatformController()`,
  never against an SDK.
- Product meaning is not the contract.
- `CONTRACT_VERSION` and the package version are separate fields on purpose.

## Licence

MIT.

## Native advertising variants

Select the native stack explicitly when creating a project:

```bash
barsuk-export-template --native-stack cas --out /path/to/empty-seed
# Or --native-stack admob for the existing AdMob/Yandex routing.
```

Both variants share this package and canonical contract. CAS overlays the provider
bridge, revenue/consent telemetry and release scripts; portals, purchases, runtime
and shell stay shared. The export omits the other native stack and its patches.
Consumer config sets `ads.nativeStack` to the same selection. Existing consumers
without that field retain the AdMob/Yandex schema. Export refuses nonempty output.

The seed needs consumer config/debug/build seams, npm pins from
`template/plugins-manifest.json`, native configuration from [PLUGINS.md](PLUGINS.md),
and consumer `verify:js` / `verify:native` release gates. It does not install SDKs,
sync native projects or overwrite existing game policy. The CAS overlay was
extracted from Gym2; device and account acceptance stays consumer-owned.

Both advertising variants include Firebase Analytics revenue binding. Starter
tests execute the freshly exported AdMob wiring check and the CAS Android release
preflight/sync script with external native commands mocked. They verify the
exported code path; native builds and device delivery remain separate checks.

When Ruby and `xcodeproj` are available, the iOS preparation tests also execute
the exported wrapper against real temporary Xcode projects. Same-path CAS JSON
references are collapsed after configuration refresh; distinct configuration
files stop preparation. Repeated preparation preserves linker flags and resources.
