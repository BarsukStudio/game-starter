// What a consumer has to hand the conformance runner, and what it may never
// hand it.
//
// The suite runs against the consumer's *real* `createPlatformController()`.
// Everything a controller cannot have under Node — the native bridge, the store
// plugin, the portal SDK, `window` — arrives as a fixture. Everything the
// controller *is* stays the consumer's production code, because a fixture that
// supplied its own controller would pass this suite without the shipped code
// ever running, and the suite would be measuring itself.
//
// So the boundary is drawn mechanically rather than asked for politely: the
// controller module and every module it statically imports are off limits to the
// override map. In practice that is the facade and the bridge behind it — the
// two files a substitute would have to replace to fake a pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STATIC_IMPORT = /(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function realpath(target, what) {
  try {
    return fs.realpathSync(target);
  } catch {
    throw new Error(`${what} does not exist: ${target}`);
  }
}

// Where a specifier actually lands, named the way the resolve hook will name it.
//
// Resolved as a URL and not as a filesystem path, because that is what Node
// does: `./bridge.js?probe=1` and `./bridge.js#frag` both load `bridge.js`,
// while `path.resolve` produces a path with the query still glued on — a file
// that does not exist, which the rules below would then dutifully protect
// instead of the module Node imports. Canonicalised afterwards so a symlink
// cannot make the same file answer to two names.
function locate(specifier, fromFile) {
  const target = fileURLToPath(new URL(specifier, pathToFileURL(fromFile)));
  return fs.existsSync(target) ? fs.realpathSync(target) : target;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Validate a consumer's fixture module and resolve it into the shape the runner
 * drives. Throws on the first violation — a suite that started on a malformed
 * fixture would report a contract failure for a fixture bug.
 */
export function resolveFixtures(fixtures, { contractVersion }) {
  assert.ok(fixtures && typeof fixtures === 'object', 'the fixture module must export an object');
  assert.equal(
    fixtures.contractVersion,
    contractVersion,
    `the consumer targets contract ${fixtures.contractVersion}, this artifact carries ${contractVersion}`
  );

  const consumerRoot = realpath(fixtures.consumerRoot, 'consumerRoot');
  const controller = realpath(
    path.resolve(consumerRoot, fixtures.controllerModule),
    'controllerModule'
  );
  assert.ok(
    inside(consumerRoot, controller),
    'controllerModule must live inside the consumer, not in a fixture directory'
  );

  // The controller's own direct imports. A consumer that could redirect one of
  // these could hand the suite a hollow facade over a fake bridge.
  //
  // Both sides of the comparison below have to name a file the same way, or the
  // rule stops holding. Two ways they could differ, both of them exploitable:
  // a controller importing `./alias/bridge.js` through a symlinked directory,
  // and one importing `./bridge.js?probe=1`, which Node loads as plain
  // `bridge.js`. `locate()` answers with the module Node would actually import.
  const source = fs.readFileSync(controller, 'utf8');
  const composition = new Set([controller]);
  for (const [, named, bare] of source.matchAll(STATIC_IMPORT)) {
    const specifier = named ?? bare;
    if (!specifier.startsWith('.')) continue;
    composition.add(locate(specifier, controller));
  }

  const environments = new Map();
  for (const [name, environment] of Object.entries(fixtures.environments ?? {})) {
    const overrides = new Map();
    for (const [target, replacement] of Object.entries(environment.overrides ?? {})) {
      // A bare specifier is an external package: there is nothing of the
      // consumer's own to protect, and redirecting one is the entire point.
      if (target.startsWith('.') || path.isAbsolute(target)) {
        const located = locate(target, path.join(consumerRoot, 'package.json'));
        const resolved = realpath(located, `override target ${target}`);
        assert.ok(
          !composition.has(resolved),
          `${target} composes the controller and may not be replaced — the suite must run the real one`
        );
        assert.ok(
          inside(consumerRoot, resolved),
          `override target ${target} must be a module of the consumer`
        );
        overrides.set(resolved, replacement);
      } else {
        overrides.set(target, replacement);
      }
    }
    // One factory per case, producing both the world and the handles that drive
    // it. Separate `globals()` and `controls()` would have to agree with each
    // other about which case they belong to, through an id passed to both —
    // exactly the hidden coupling a fixture should not have to maintain.
    assert.equal(
      typeof environment.setup,
      'function',
      `environment ${name} must provide setup()`
    );
    environments.set(name, { overrides, setup: environment.setup });
  }
  assert.ok(environments.size, 'at least one environment must be declared');

  return {
    consumerRoot,
    controller,
    controllerExport: fixtures.controllerExport ?? 'createPlatformController',
    environments,
  };
}
