import { execFileSync } from 'node:child_process';

// The one supported way to produce native release web assets. It forces
// production ad units, proves it against the built bundle, and only then syncs
// into the native project — so an Archive or a signed AAB can never pick up the
// demo ads that every other build path deliberately defaults to.

const platform = process.argv[2];
if (platform !== 'ios' && platform !== 'android') {
  throw new Error('build-native-release: expected "ios" or "android".');
}

const env = {
  ...process.env,
  VITE_NATIVE_ADS_TEST_MODE: 'false',
  CAS_RELEASE_BUILD: '1',
};

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', env });

// Consumer gates run before generating assets or changing the native project.
run('npm', ['run', 'verify:js']);
run('npm', ['run', 'verify:native', '--', platform]);

// Verify before generating any release assets, including the direct Vite path.
run('node', ['scripts/verify-cas.mjs', '--production']);
if (platform === 'ios') run('node', ['scripts/prepare-cas-ios.mjs']);
run('node', ['scripts/vite-run.mjs', 'build']);
run('node', ['scripts/assert-production-ads.mjs']);

if (platform === 'ios') run('npx', ['cap', 'sync', 'ios']);
else run('node', ['scripts/cap-sync-android.mjs']);

console.log(`Native ${platform} release assets built with production ad units.`);
