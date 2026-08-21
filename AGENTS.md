# Repository Guidelines

`@barsuk/game-starter` — the versioned platform contract, its conformance suite,
and the starter template Barsuk Studio games are cut from. Plain ES modules, no
build step, no runtime dependencies, no dev dependencies. This file is the
contract for every agent and contributor working here.

Strategy lives in `GAME_PLAYBOOK.md` §10 of the game-dev-playbook repository —
the three layers, who owns the contract, the order across projects. Do not
restate it here.

## What this repository is, and is not

Two things live here and they are not the same kind of thing:

- **The contract** (`contract/`) — canonical, single-owner, machine-checked.
  Consumers import these names; they never restate them. A copied contract
  drifts exactly the way a copied test does, which is the whole reason this
  package exists.
- **The template** (`template/`) — a starting point. Games copy it and are
  *allowed to diverge*: a project-specific native policy may differ, the
  required result may not. Two games patching the same AdMob banner file in
  opposite directions is correct when one keeps the navigation bar and the other
  runs fullscreen immersive.

It is **not** `@barsuk/game-runtime`. That package is headless logic — no SDK, no
`window`, no storage — proven by extraction from a game that already carried it.
This one owns the transport boundary instead. A module that belongs in the
runtime does not get to arrive here by being swept up in a template copy; it
earns its own extraction cycle through a second consumer that genuinely needs it.

## Hard rules

1. **No game may be identifiable in here.** No product, ad or app ids, no
   storage keys, no marker globals, no reward amounts, no UI, no translations.
   Where the template needs one, it reads it from consumer config.
2. **The contract is names and versions, never behaviour of one plugin.**
   Canonical cases are written against the consumer's real
   `createPlatformController()`. A rule that only makes sense for
   cordova-plugin-purchase, or for one ad SDK's callback order, belongs in that
   game's own suite — otherwise the starter quietly prescribes one plugin and
   "adapters may diverge" dies.
3. **Product meaning is not the contract.** A price map is
   `Record<configuredProductKey, string | null>`. How many products a game sells,
   what they are called and what they grant is the game's business.
4. **Two version fields, on purpose.** `CONTRACT_VERSION` in
   `contract/manifest.js` moves when the names or their documented semantics
   move; the `package.json` version moves when anything here ships. Neither is
   derived from the other.
5. **The conformance suite may not accept a substitute controller.** A consumer
   supplies fixtures for the environment, the SDK and external events. A fixture
   that supplied its own controller or bridge would pass the suite without the
   production code ever running.
6. **Evidence discipline.** Never write "verified on device" in code, comments,
   tests or commit messages. Device behaviour is verified by Oleg on real
   hardware and recorded in the consuming game's `PROJECT_STATUS.md`.

## Commands

```bash
npm test              # node --test autodiscovery, Node >= 20
npm pack --dry-run    # the `files` whitelist
```

`engines.node` is `>=20` and stays there: the manifest and the template are
plain data and plain modules. Only the conformance runner needs
`module.registerHooks()`, which arrived in Node 22.15 — it checks for the API
itself and fails with a readable message rather than making the whole package
uninstallable on Node 20. Probe it through a namespace import; a static named
import of a missing builtin export is a link-time error, not a message.

Keep the test script on autodiscovery: a quoted glob positional argument only
works from Node 22 on. Verify against Node 20 and the current release before
reporting a change.

## Consumption

Games pin an exact commit as a tarball URL, as a **devDependency**:

```json
"@barsuk/game-starter": "https://github.com/BarsukStudio/game-starter/archive/<sha>.tar.gz"
```

Not `github:owner/repo#sha`: that is recorded in the lockfile as `git+ssh://`, so
the install needs git and leans on the machine's ssh-to-https fallback, and npm
skips the integrity check for a git dependency.

A devDependency and never a runtime one: nothing in a shipped bundle may import
the starter. Consumers assert that themselves.

The repository is public so the archive URL resolves without credentials;
`private: true` stays, because the package is consumed by SHA and never from the
registry. A tag names a proven commit — it is not an install target.

## Style

ES modules, semicolons, single quotes, trailing commas in multiline structures,
two-space indentation. `camelCase` for functions and variables,
`UPPER_SNAKE_CASE` for constants. Code, names and comments in English.

Comments explain *why* a rule exists — the race it closes, the drift it catches,
the decision it records. A rule that arrived from a game keeps the reasoning it
came with; drop only what was specific to that one game.

## Commits

Short, capitalized, imperative summaries. One coherent change per commit. Commit
and push only when asked. State which game a template file came from when it is
a copy.
