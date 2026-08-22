// What `build.config.mjs` must provide, and why a game has two config files.
//
// `config.js` is a Vite module: it reads `import.meta.env`, and the bundle it
// ends up in is what the runtime reads. A build script runs under plain Node,
// where that module cannot even be imported — so the values only the build needs
// live here instead, in a module Node can read directly.
//
// The split is by *who reads the value*, not by subject:
//
//   config.js         everything the running game reads — ad units, products,
//                     store links, and the name of the runtime-target global.
//   build.config.mjs  everything only the build reads — the web targets and
//                     their CSP, the Android application id, the gradle
//                     injections, and the hooks that run before a sync.
//
// The runtime-target global belongs to `config.js` and is deliberately *not*
// repeated here. `lib/runtime-target-global.mjs` reads it out of that source for
// the build, which keeps one owner for a name that both worlds need.
//
// Nothing here carries a value. Every id, host and version lives in the game's
// own `build.config.mjs`.

function fail(problems, path, expected, value) {
  problems.push(`${path}: expected ${expected}, got ${describe(value)}`);
}

function describe(value) {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  return typeof value;
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkString(problems, path, value) {
  if (!isFilledString(value)) fail(problems, path, 'a non-empty string', value);
}

function checkBoolean(problems, path, value) {
  if (typeof value !== 'boolean') fail(problems, path, 'a boolean', value);
}

function checkRecord(problems, path, value) {
  const ok = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!ok) fail(problems, path, 'an object', value);
  return ok;
}

// An array of strings that may be empty. Emptiness is a real answer here: a game
// with no portal SDK widens no policy, and a game with no native patches runs no
// hooks.
function checkStringList(problems, path, value) {
  if (!Array.isArray(value)) {
    fail(problems, path, 'an array', value);
    return;
  }
  value.forEach((entry, index) => checkString(problems, `${path}[${index}]`, entry));
}

function checkWebTarget(problems, path, target) {
  if (!checkRecord(problems, path, target)) return;
  checkString(problems, `${path}.dir`, target.dir);
  // The descriptor the marker file carries into the page. Its shape is the
  // runtime's — `env.js` reads exactly these four — so it is checked here rather
  // than left to fail on a device.
  if (checkRecord(problems, `${path}.platform`, target.platform)) {
    checkString(problems, `${path}.platform.target`, target.platform.target);
    checkBoolean(problems, `${path}.platform.ads`, target.platform.ads);
    checkBoolean(problems, `${path}.platform.payments`, target.platform.payments);
    const sdk = target.platform.sdk;
    if (sdk !== null && !isFilledString(sdk)) {
      fail(problems, `${path}.platform.sdk`, 'a non-empty string or null', sdk);
    }
  }
  checkBoolean(problems, `${path}.ready`, target.ready);
  checkStringList(problems, `${path}.scriptSrc`, target.scriptSrc);
  checkStringList(problems, `${path}.head`, target.head);
  checkStringList(problems, `${path}.bodyEnd`, target.bodyEnd);
}

function checkGradleInjection(problems, path, injection) {
  if (!checkRecord(problems, path, injection)) return;
  checkStringList(problems, `${path}.lines`, injection.lines);
  // Anchored injection, not appending: a generated gradle file changes shape
  // when a plugin is added or removed, and an anchor that stopped matching has
  // to fail loudly rather than drop the block.
  //
  // Required only when there is something to inject. A game that needs no gradle
  // additions declares empty lines and no anchor, rather than inventing one that
  // nothing will ever be inserted after.
  if (Array.isArray(injection.lines) && !injection.lines.length) {
    if (injection.anchor !== undefined) {
      checkString(problems, `${path}.anchor`, injection.anchor);
    }
    return;
  }
  checkString(problems, `${path}.anchor`, injection.anchor);
}

export function validateBuildConfig(config) {
  const problems = [];
  if (!checkRecord(problems, 'buildConfig', config)) return problems;

  if (checkRecord(problems, 'buildConfig.web', config.web)) {
    checkString(problems, 'buildConfig.web.outDir', config.web.outDir);
    if (checkRecord(problems, 'buildConfig.web.targets', config.web.targets)) {
      const names = Object.keys(config.web.targets);
      if (!names.length) {
        problems.push('buildConfig.web.targets: a web build must have at least one target');
      }
      for (const name of names) {
        checkWebTarget(problems, `buildConfig.web.targets.${name}`, config.web.targets[name]);
      }
    }
  }

  if (checkRecord(problems, 'buildConfig.android', config.android)) {
    checkString(problems, 'buildConfig.android.appId', config.android.appId);
    // Consumer hooks, and an empty list is the expected answer for a game with
    // no native patches of its own. `GAME_PLAYBOOK.md` §10 names these as the
    // place two games are *supposed* to differ.
    checkStringList(problems, 'buildConfig.android.preSyncHooks', config.android.preSyncHooks);
    checkGradleInjection(problems, 'buildConfig.android.rootGradleClasspaths', config.android.rootGradleClasspaths);
    checkGradleInjection(problems, 'buildConfig.android.rootGradleRepositories', config.android.rootGradleRepositories);
    checkGradleInjection(problems, 'buildConfig.android.moduleGradleDependencies', config.android.moduleGradleDependencies);
  }

  return problems;
}
