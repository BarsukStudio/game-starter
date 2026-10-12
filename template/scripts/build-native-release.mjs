import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// The one supported way to produce native release web assets. It forces
// production ad units, proves it against the built bundle, and only then syncs
// into the native project — so an Archive or a signed AAB can never pick up the
// demo ads that every other build path deliberately defaults to.

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') {
  throw new Error('build-native-release: expected "ios" or "android".');
}

if (process.env.VITE_ADMOB_MEDIATION_QA === 'true') {
  throw new Error(
    'build-native-release: mediation QA is a device-QA mode; unset VITE_ADMOB_MEDIATION_QA for a release build.',
  );
}

const env = {
  ...process.env,
  VITE_NATIVE_ADS_TEST_MODE: 'false',
  VITE_ADMOB_TEST_DEVICE_IDS: '',
};

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', env });

// The bundle API check runs from the pinned starter, never through npx: a pin
// without the tool must stop here, before any asset changes, rather than let
// npx look the command up on the public registry.
const starterRoot = path.dirname(createRequire(import.meta.url).resolve('@barsuk/game-starter/package.json'));
const webCompat = path.join(starterRoot, 'tools/verify-web-compat.mjs');
if (!fs.existsSync(webCompat)) {
  throw new Error('build-native-release: the pinned @barsuk/game-starter has no tools/verify-web-compat.mjs; repin to 0.1.0-alpha.27 or later.');
}

// Consumer-owned mandatory gates run before any release asset mutation.
run('npm', ['run', 'verify:js']);
run('npm', ['run', 'verify:native', '--', platform]);

// Verify before generating any release assets, including the direct Vite path.
run('node', ['scripts/patch-native-ad-events.mjs', '--check']);
run('node', ['scripts/vite-run.mjs', 'build']);
run('node', ['scripts/assert-production-ads.mjs']);
// es2020 lowers syntax only; an API newer than the oldest supported WebView
// would ship untouched and throw there.
run('node', [webCompat]);

if (platform === 'ios') run('npx', ['cap', 'sync', 'ios']);
else run('node', ['scripts/cap-sync-android.mjs']);

console.log(`Native ${platform} release assets built with production ad units.`);
