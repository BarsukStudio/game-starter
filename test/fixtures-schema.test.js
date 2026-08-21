// The rule that keeps the suite honest: a consumer supplies the environment, the
// SDK and external events, never the thing under test.
//
// Proven against a miniature consumer rather than a real game, so the assertions
// are about the rule and not about anyone's platform. `index.js` imports
// `bridge.js` the way a facade imports its composition; `env.js` is the kind of
// module a fixture legitimately replaces.
//
// It lives in `fixtures/`, not under `test/`: `node --test` treats every `.js`
// file below a `test/` directory as a test file, so a miniature consumer parked
// there would be imported and counted as three empty passing suites.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONTRACT_VERSION } from '../contract/manifest.js';
import { resolveFixtures } from '../contract/fixtures-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const consumerRoot = path.join(here, '..', 'fixtures', 'consumer');
const replacement = pathToFileURL(path.join(consumerRoot, 'env.js')).href;

const fixtures = (overrides = {}, extra = {}) => ({
  contractVersion: CONTRACT_VERSION,
  consumerRoot,
  controllerModule: 'index.js',
  environments: { probe: { globals: () => ({}), overrides } },
  ...extra,
});

test('a well-formed fixture resolves', () => {
  const resolved = resolveFixtures(fixtures({ './env.js': replacement }), { contractVersion: CONTRACT_VERSION });
  assert.equal(resolved.controllerExport, 'createPlatformController');
  assert.ok(resolved.environments.get('probe'));
});

test('the controller itself may not be replaced', () => {
  assert.throws(
    () => resolveFixtures(fixtures({ './index.js': replacement }), { contractVersion: CONTRACT_VERSION }),
    /composes the controller and may not be replaced/
  );
});

test('the module composing the controller may not be replaced', () => {
  assert.throws(
    () => resolveFixtures(fixtures({ './bridge.js': replacement }), { contractVersion: CONTRACT_VERSION }),
    /composes the controller and may not be replaced/
  );
});

test('the controller must live inside the consumer', () => {
  assert.throws(
    () => resolveFixtures(
      fixtures({}, { controllerModule: '../../contract/manifest.js' }),
      { contractVersion: CONTRACT_VERSION }
    ),
    /must live inside the consumer/
  );
});

test('a consumer targeting another contract version is refused', () => {
  assert.throws(
    () => resolveFixtures(fixtures({}, { contractVersion: '9.9.9' }), { contractVersion: CONTRACT_VERSION }),
    /the consumer targets contract 9\.9\.9/
  );
});

test('an override of a module that does not exist is refused', () => {
  assert.throws(
    () => resolveFixtures(fixtures({ './nope.js': replacement }), { contractVersion: CONTRACT_VERSION }),
    /does not exist/
  );
});

test('a bare specifier is an external package and may be redirected', () => {
  const resolved = resolveFixtures(
    fixtures({ 'some-native-plugin': replacement }),
    { contractVersion: CONTRACT_VERSION }
  );
  assert.equal(resolved.environments.get('probe').overrides.get('some-native-plugin'), replacement);
});

test('at least one environment must be declared', () => {
  assert.throws(
    () => resolveFixtures(
      { contractVersion: CONTRACT_VERSION, consumerRoot, controllerModule: 'index.js', environments: {} },
      { contractVersion: CONTRACT_VERSION }
    ),
    /at least one environment/
  );
});

// The composition set and the override targets have to name a file the same way
// or the rule above stops holding. They are both canonicalised now; before that
// a controller importing its bridge through a symlinked directory landed in the
// set under the aliased path while an override of the same file realpathed to
// the true one, the two missed each other, and the bridge became replaceable.
//
// Built in a temporary directory rather than checked in: a symlink in a git
// repository is a portability question nobody needs to answer to run this.
// A specifier is a URL, not a path. `./bridge.js?probe=1` and `./bridge.js#frag`
// both load plain `bridge.js`, while resolving them as filesystem paths yields a
// file that does not exist — which the rule would then protect instead of the
// module Node actually imports, leaving the real bridge free to be replaced.
for (const suffix of ['?probe=1', '#frag']) {
  test(`a specifier carrying ${suffix} cannot smuggle the bridge past the rule`, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'starter-specifier-')));
    try {
      fs.writeFileSync(path.join(root, 'bridge.js'), 'export const ping = () => "real";\n');
      fs.writeFileSync(path.join(root, 'env.js'), 'export const isNative = false;\n');
      fs.writeFileSync(
        path.join(root, 'index.js'),
        `import { ping } from "./bridge.js${suffix}";\nexport function createPlatformController() { return { ping }; }\n`
      );

      assert.throws(
        () => resolveFixtures(
          {
            contractVersion: CONTRACT_VERSION,
            consumerRoot: root,
            controllerModule: 'index.js',
            environments: {
              probe: {
                globals: () => ({}),
                overrides: { './bridge.js': pathToFileURL(path.join(root, 'env.js')).href },
              },
            },
          },
          { contractVersion: CONTRACT_VERSION }
        ),
        /composes the controller and may not be replaced/
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('a symlinked import path cannot smuggle the bridge past the rule', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'starter-symlink-')));
  try {
    fs.writeFileSync(path.join(root, 'bridge.js'), 'export const ping = () => "real";\n');
    fs.writeFileSync(path.join(root, 'env.js'), 'export const isNative = false;\n');
    fs.symlinkSync('.', path.join(root, 'alias'));
    // The controller reaches its own bridge through the alias.
    fs.writeFileSync(
      path.join(root, 'index.js'),
      'import { ping } from "./alias/bridge.js";\nexport function createPlatformController() { return { ping }; }\n'
    );

    assert.throws(
      () => resolveFixtures(
        {
          contractVersion: CONTRACT_VERSION,
          consumerRoot: root,
          controllerModule: 'index.js',
          environments: {
            probe: {
              globals: () => ({}),
              overrides: { './bridge.js': pathToFileURL(path.join(root, 'env.js')).href },
            },
          },
        },
        { contractVersion: CONTRACT_VERSION }
      ),
      /composes the controller and may not be replaced/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
