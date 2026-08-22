import { execFileSync } from 'node:child_process';

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

run('node', ['scripts/vite-run.mjs', 'build']);
run('node', ['scripts/assert-production-ads.mjs']);

if (platform === 'ios') run('npx', ['cap', 'sync', 'ios']);
else run('node', ['scripts/cap-sync-android.mjs']);

console.log(`Native ${platform} release assets built with production ad units.`);
