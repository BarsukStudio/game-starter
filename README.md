# @barsuk/game-starter

The versioned platform contract and the starter template shared by Barsuk Studio
games. Plain ES modules, no build step, no dependencies.

**Status: pre-alpha.** The contract manifest and its conformance suite are
canonical. `template/` carries two trees cut from Muscle Clicker — `platform/`,
the transport layer a game bundles, and `scripts/`, the build, sync and release
scripts it runs under Node — plus `schemas/`, which states what a consumer's two
config files must provide and is imported from this package rather than copied.

Two games run against it now: Muscle Clicker, which it was cut from, and Muscle
Clicker 2, which took the template as it stands and passes the same conformance
run. That settles the first question a shared layer has to settle — whether the
shape transfers, or only ever fitted the game it came from. It settles nothing
about the second. `CONTRACT_VERSION` stays `0.1.0` because `1.0.0` is a promise
not to move these names, and that promise has not been made: a transfer that
worked twice is evidence, not a commitment. The package version moves with every
batch that ships; the contract version does not follow it.

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

## Install

```json
"devDependencies": {
  "@barsuk/game-starter": "https://github.com/BarsukStudio/game-starter/archive/<sha>.tar.gz"
}
```

Pinned by exact SHA, as a devDependency. Nothing in a shipped bundle may import
this package — consumers assert that in their own contract tests.

The legacy migration baseline remains `10aa559`. Adding
`LEGACY_AUDIT_PROMPT.md` is documentation-only: `CONTRACT_VERSION` and the
template did not move, so consumers must not be repinned for this commit. Read
the prompt from the working checkout, not from a pinned consumer's
`node_modules`.

Package `0.1.0-alpha.6` updates the ad adapters from Gym's scoped-request fix.
Copying these template changes requires runtime `0.2.0` at
`468a29ebfe8607631e262ede5491f807096957ab` (the `ad-attempt-scope` export).
The game-facing contract remains `0.1.0`. Captured callbacks and Promise
replies cannot settle a later attempt; untagged global native SDK events remain
a transport limitation. Re-run consumer conformance, ad regression tests and
the affected builds, then verify timeout/retry flows on device and in portals.

## Rules

The full contract for contributors is in `AGENTS.md`. The short version:

- No game is identifiable in here — no ids, no keys, no marker globals, no UI.
- Canonical cases run against the consumer's real `createPlatformController()`,
  never against an SDK.
- Product meaning is not the contract.
- `CONTRACT_VERSION` and the package version are separate fields on purpose.

## Licence

MIT.
