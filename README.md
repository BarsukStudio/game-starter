# @barsuk/game-starter

The versioned platform contract and the starter template shared by Barsuk Studio
games. Plain ES modules, no build step, no dependencies.

**Status: pre-alpha.** The contract manifest and its conformance suite are
canonical, and Muscle Clicker runs against them. `template/` carries two trees
cut from that game — `platform/`, the transport layer a game bundles, and
`scripts/`, the build, sync and release scripts it runs under Node — plus
`schemas/`, which states what a consumer's two config files must provide and is
imported from this package rather than copied. Nothing here has been
consumed by a second game yet, which is exactly why `CONTRACT_VERSION` is `0.1.0`
and not `1.0.0`: the shape is proven to work, not proven to transfer.

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
| `fixtures/`, `test/` | miniature consumers and the suite's own tests |

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

## Rules

The full contract for contributors is in `AGENTS.md`. The short version:

- No game is identifiable in here — no ids, no keys, no marker globals, no UI.
- Canonical cases run against the consumer's real `createPlatformController()`,
  never against an SDK.
- Product meaning is not the contract.
- `CONTRACT_VERSION` and the package version are separate fields on purpose.

## Licence

MIT.
