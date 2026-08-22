// Whether the build-config schema rejects what it claims to reject.
//
// Same discipline as `config-schema.test.js`: every rule is proven by breaking
// exactly one field of an otherwise valid config, because a validator nobody
// runs against a broken input reads like a guarantee it has never given.
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBuildConfig } from '../template/schemas/build.config.schema.mjs';

function validConfig() {
  return {
    web: {
      outDir: 'dist-web',
      targets: {
        plain: {
          dir: 'plain',
          platform: { target: 'plain', ads: false, payments: false, sdk: null },
          ready: false,
          scriptSrc: [],
          head: ['<meta name="platform-target" content="plain">'],
          bodyEnd: [],
        },
        portal: {
          dir: 'portal',
          platform: { target: 'portal', ads: true, payments: true, sdk: 'portal' },
          ready: true,
          scriptSrc: ['https://sdk.example.invalid'],
          head: ['<script src="https://sdk.example.invalid/sdk.js"></script>'],
          bodyEnd: ['<div id="banner"></div>'],
        },
      },
    },
    android: {
      appId: 'invalid.example.game',
      preSyncHooks: ['scripts/patch-example.sh'],
      rootGradleClasspaths: { anchor: "        classpath 'a:b:1'\n", lines: ['classpath "c:d:2"'] },
      rootGradleRepositories: { anchor: '        mavenCentral()\n    }\n}', lines: ['maven { url "https://example.invalid/" }'] },
      moduleGradleDependencies: {
        anchor: "    implementation project(':example')\n",
        lines: ['implementation "com.example.ads:adapter:1.0.0"'],
      },
    },
  };
}

function broken(mutate) {
  const config = validConfig();
  mutate(config);
  return validateBuildConfig(config);
}

function assertNames(problems, path) {
  assert.ok(problems.length, `${path} must be reported`);
  assert.ok(
    problems.some((problem) => problem.startsWith(`${path}:`)),
    `a problem must name the path a game has to fix; got ${JSON.stringify(problems)}`,
  );
}

test('a complete build config has nothing to report', () => {
  assert.deepEqual(validateBuildConfig(validConfig()), []);
});

test('a game with no portal SDK and no native patches is valid', () => {
  // Both lists are empty for a game that ships one plain web build and patches
  // nothing — `GAME_PLAYBOOK.md` §10 names the native patches as the place two
  // games are supposed to differ, so having none cannot be a failure.
  const config = validConfig();
  config.web.targets.portal.scriptSrc = [];
  config.web.targets.portal.head = [];
  config.web.targets.portal.bodyEnd = [];
  config.android.preSyncHooks = [];
  assert.deepEqual(validateBuildConfig(config), []);
});

test('a game that injects nothing into gradle needs no anchors', () => {
  // An anchor exists to say where a line goes. A game with no lines to inject
  // has nowhere for one to go, and demanding a fictional anchor would make the
  // schema teach a lie.
  const config = validConfig();
  for (const key of ['rootGradleClasspaths', 'rootGradleRepositories', 'moduleGradleDependencies']) {
    config.android[key] = { lines: [] };
  }
  assert.deepEqual(validateBuildConfig(config), []);
});

test('a build with no web target at all is reported', () => {
  assertNames(broken((c) => { c.web.targets = {}; }), 'buildConfig.web.targets');
});

test('the marker descriptor must be the shape the runtime reads', () => {
  assertNames(broken((c) => { delete c.web.targets.plain.platform.ads; }), 'buildConfig.web.targets.plain.platform.ads');
  assertNames(broken((c) => { c.web.targets.portal.platform.sdk = ''; }), 'buildConfig.web.targets.portal.platform.sdk');
  assertNames(broken((c) => { c.web.targets.plain.ready = 'no'; }), 'buildConfig.web.targets.plain.ready');
  assertNames(broken((c) => { c.web.targets.plain.dir = ''; }), 'buildConfig.web.targets.plain.dir');
});

test('a target\'s policy and markup must be lists of strings', () => {
  assertNames(broken((c) => { c.web.targets.portal.scriptSrc = 'https://one'; }), 'buildConfig.web.targets.portal.scriptSrc');
  assertNames(broken((c) => { c.web.targets.portal.head = [null]; }), 'buildConfig.web.targets.portal.head[0]');
});

test('the Android side must name its id, its hooks and its injections', () => {
  assertNames(broken((c) => { delete c.android.appId; }), 'buildConfig.android.appId');
  assertNames(broken((c) => { c.android.preSyncHooks = 'scripts/one.sh'; }), 'buildConfig.android.preSyncHooks');
  assertNames(broken((c) => { delete c.android.moduleGradleDependencies.anchor; }), 'buildConfig.android.moduleGradleDependencies.anchor');
  assertNames(broken((c) => { c.android.rootGradleRepositories.lines = [42]; }), 'buildConfig.android.rootGradleRepositories.lines[0]');
});

test('problems are collected, not raised one at a time', () => {
  const problems = broken((config) => {
    delete config.android.appId;
    config.web.outDir = '';
    config.web.targets.plain.ready = 'no';
  });
  assert.equal(problems.length, 3, JSON.stringify(problems));
});

test('a config that is not an object is reported once and not walked', () => {
  for (const value of [null, undefined, 'config', 42, []]) {
    const problems = validateBuildConfig(value);
    assert.equal(problems.length, 1, `${JSON.stringify(value)} must be one problem`);
    assert.ok(problems[0].startsWith('buildConfig:'));
  }
});
