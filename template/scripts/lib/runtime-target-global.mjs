// The one place the web build learns what the runtime-target marker is called.
//
// The name belongs to `config.js`, because the shared platform template reads it
// from there: `env.js` looks up `window[APP_CONFIG.platform.runtimeTargetGlobal]`.
// A build script that spelled the name itself would be a second owner, and the
// two can drift in the one direction nothing catches — rename it in config and
// the build keeps emitting the old global, so every portal build silently falls
// back to the generic target while the config test, the portal test and the
// build all stay green.
//
// Read out of the source rather than imported: `config.js` reads
// `import.meta.env`, which exists only inside a Vite build, so importing it from
// a plain Node script throws on its first line. That line is also load-bearing
// for the release proof — `assert-production-ads.mjs` reads the value Vite folds
// into the built asset — so it is not a line to reshape for a build script's
// convenience.
import fs from 'node:fs';

export const CONFIG_SOURCE_PATH = 'src/js/platform/config.js';

const DECLARATION = /runtimeTargetGlobal:\s*'([^']+)'/;

// Throws rather than falling back. A build that guessed the name would produce
// exactly the artifact this module exists to prevent.
export function readRuntimeTargetGlobal(source = fs.readFileSync(CONFIG_SOURCE_PATH, 'utf8')) {
  const match = DECLARATION.exec(source);
  if (!match) {
    throw new Error(
      `${CONFIG_SOURCE_PATH} must declare platform.runtimeTargetGlobal: the web build has no other source for the marker name.`,
    );
  }
  return match[1];
}

// The companion flag, derived from the same name so it cannot be renamed apart
// from it. Nothing reads this global today; it is emitted because the build
// always has, and keeping its name derived is cheaper than keeping a second
// declaration honest.
export function readRuntimeReadyGlobal(source) {
  return `${readRuntimeTargetGlobal(source).replace(/_+$/, '')}_READY__`;
}
