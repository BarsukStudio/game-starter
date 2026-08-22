import fs from 'node:fs';
import path from 'node:path';

// Release gate for the native artifacts. Native builds default to demo ads on
// purpose, so the only thing standing between a forgotten environment variable
// and a store build that earns nothing is this check. It reads the built bundle
// rather than the source, because Xcode's Archive step does not rebuild the web
// assets — whatever is already in `dist/` is what ships.

const root = process.cwd();
const distDir = path.join(root, process.argv[2] || 'dist');
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  throw new Error(`assert-production-ads: no built assets at ${assetsDir}; run the build first.`);
}

const bundles = fs
  .readdirSync(assetsDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, source: fs.readFileSync(path.join(assetsDir, file), 'utf8') }));

// A missing marker means `src/js/platform/config.js` changed shape and this gate
// silently stopped proving anything. Fail loudly instead, the same way
// cap-sync-android.mjs fails on a moved anchor.
const modeMatches = bundles.flatMap(({ file, source }) => {
  return [...source.matchAll(/const nativeAdsMode = "([^"]*)"/g)].map((match) => ({
    file,
    mode: match[1],
  }));
});

if (modeMatches.length !== 1) {
  throw new Error(
    `assert-production-ads: expected exactly one ad-mode marker in the bundle, found ${modeMatches.length}. `
    + 'The marker in src/js/platform/config.js moved — fix this gate before releasing.',
  );
}

const [{ file: bundleFile, mode }] = modeMatches;
if (mode !== 'production') {
  throw new Error(
    `assert-production-ads: ${bundleFile} was built with "${mode}" ads. `
    + 'A release artifact must be built with VITE_NATIVE_ADS_TEST_MODE=false.',
  );
}

// Mediation QA bakes registered test-device ids into the bundle. Those devices
// keep receiving test traffic against the real ad units, so they must never
// reach a store artifact.
const deviceMatches = bundles.flatMap(({ file, source }) => {
  return [...source.matchAll(/const admobTestingDevices = String\("([^"]*)"\)/g)].map((match) => ({
    file,
    ids: match[1],
  }));
});

if (deviceMatches.length !== 1) {
  throw new Error(
    `assert-production-ads: expected exactly one AdMob test-device marker, found ${deviceMatches.length}. `
    + 'The marker in src/js/platform/config.js moved — fix this gate before releasing.',
  );
}

if (deviceMatches[0].ids.trim()) {
  throw new Error(
    `assert-production-ads: ${deviceMatches[0].file} carries AdMob test devices ("${deviceMatches[0].ids}"). `
    + 'Rebuild without VITE_ADMOB_TEST_DEVICE_IDS before releasing.',
  );
}

console.log(`Production ad units confirmed in ${bundleFile}.`);
