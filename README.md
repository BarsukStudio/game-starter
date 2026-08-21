# @barsuk/game-starter

The versioned platform contract and the starter template shared by Barsuk Studio
games. Plain ES modules, no build step, no dependencies.

**Status: pre-alpha.** `contract/manifest.js` exists and is canonical; the
conformance runner, the `platform/` template and the templated build scripts are
still being cut from Muscle Clicker. Nothing here has been consumed by a second
game yet, which is exactly why `CONTRACT_VERSION` is `0.1.0` and not `1.0.0`.

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
| `test/manifest.test.js` | the shape rules that keep the manifest from rotting |

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
