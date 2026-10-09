import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { exportTemplate } from '../tools/export-template.mjs';

function seed(t, nativeStack) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-variant-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  return exportTemplate({ nativeStack, out });
}

test('fresh AdMob export binds Android and iOS revenue formats through its shipped wiring check', (t) => {
  const out = seed(t, 'admob');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', 'scripts/ad-revenue-wiring-check.mjs'], { cwd: out, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pass 4\b/);
});

for (const [platform, failure] of [['android', null], ['ios', null], ['ios', 'update'],
  ['ios', 'verification'], ['ios', 'script'], ['ios', 'config'], ['ios', 'runtime']]) {
 test(`fresh CAS ${platform} release ${failure ? `stops before assets on ${failure} failure` : 'executes its actual scripts before native command mocks'}`, (t) => {
  const out = seed(t, 'cas');
  const write = (file, value) => {
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const dependencies = { '@barsuk/capacitor-cas': 'file:vendor/barsuk-capacitor-cas-0.1.3.tgz',
    '@barsuk/game-runtime': 'file:vendor/barsuk-game-runtime-0.2.2.tgz' };
  const devDependencies = { '@barsuk/game-starter': 'file:vendor/barsuk-game-starter-0.1.0-alpha.13.tgz' };
  const packages = { '': { dependencies, devDependencies } };
  for (const [name, pin] of Object.entries({ ...dependencies, ...devDependencies })) {
    const bytes = `test archive for ${name}`;
    write(pin.slice(5), bytes);
    const version = name.endsWith('cas') ? '0.1.3' : name.endsWith('runtime') ? '0.2.2' : '0.1.0-alpha.13';
    packages[`node_modules/${name}`] = { resolved: pin, version, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
    write(`node_modules/${name}/package.json`, name.endsWith('runtime')
      ? { version, type: 'module', exports: { './ad-lifecycle': './ad-lifecycle.js' } } : { version });
  }
  write('node_modules/@barsuk/game-runtime/ad-lifecycle.js', 'export const createAdLifecycle = () => ({setAvailability() {}});');
  write('src/js/platform/config.js', `export const APP_CONFIG = { ads: { cas: { ios: { casId: '123456' } } } };`);
  write('ios/App/App.xcodeproj/project.pbxproj', 'native project fixture');
  write('package.json', { type: 'module', dependencies, devDependencies });
  write('package-lock.json', { packages });
  write('scripts/build.config.mjs', `export const BUILD_CONFIG = { android: {
    appId: 'test.example', preSyncHooks: [], rootGradleClasspaths: { lines: [] },
    rootGradleRepositories: { lines: [] }, moduleGradleDependencies: { lines: [] }
  } };`);
  write('android/app/src/main/assets/capacitor.config.json', {});
  // Run the real release/verification/sync scripts. External tools and the Vite
  // asset phases are command mocks, so this never installs or syncs an SDK.
  write('command-mocks.cjs', `const fs = require('node:fs');
    const cp = require('node:child_process');
    const original = cp.execFileSync;
    cp.execFileSync = function(command, args, options) {
      fs.appendFileSync('commands.jsonl', JSON.stringify({ command, args }) + '\\n');
      if (command === 'node' && ['scripts/verify-cas.mjs', 'scripts/cap-sync-android.mjs', 'scripts/prepare-cas-ios.mjs'].includes(args[0])) {
        return original(process.execPath, args, options);
      }
      if (command === 'node') {
        if (!fs.existsSync(args[0])) throw Error('Missing executable script: ' + args[0]);
        return Buffer.alloc(0);
      }
      if (command === 'ruby' && process.env.CAS_TEST_FAILURE === 'update') return Buffer.from('Vendor exited without configuration');
      if (command === 'ruby' && args[0] === '-e' && process.env.CAS_TEST_FAILURE === 'verification') throw Error('CAS: resource missing or stale');
      if (command === 'ruby') return Buffer.from(args[0] === '-e'
        ? 'CAS iOS configuration and Xcode resource verified.'
        : '- Config file is up-to-date\\nXCode project configuration script version 2.2\\n');
      if (command === 'npm' || command === 'npx') return Buffer.alloc(0);
      throw Error('Unexpected command: ' + command);
    };
    require('node:module').syncBuiltinESMExports();`);
  if (failure === 'script') write('ios/App/casconfig.rb', 'unreviewed executable');
  if (failure === 'runtime') write('node_modules/@barsuk/game-runtime/ad-lifecycle.js', 'export const createAdLifecycle = () => ({});');
  if (failure === 'config') write('src/js/platform/config.js', 'export const APP_CONFIG = {};');
  const result = spawnSync(process.execPath, ['scripts/build-native-release.mjs', platform], {
    cwd: out, encoding: 'utf8', env: { ...process.env, CAS_TEST_FAILURE: failure || '', NODE_OPTIONS: `--require ${path.join(out, 'command-mocks.cjs')}` },
  });
  if (!failure) assert.equal(result.status, 0, result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const commands = fs.readFileSync(path.join(out, 'commands.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(commands.slice(0, 3).map(({ command, args }) => [command, ...args]), [
    ['npm', 'run', 'verify:js'], ['npm', 'run', 'verify:native', '--', platform],
    ['node', 'scripts/verify-cas.mjs', '--production'],
  ]);
  if (failure) {
    assert.ok(!commands.some(({ args }) => args[0] === 'scripts/vite-run.mjs'));
    assert.ok(!commands.some(({ command }) => command === 'npx'));
    assert.match(result.stderr, /configuration did not complete|resource missing or stale|reviewed casconfig|numeric literal|SDK availability API/);
    return;
  }
  assert.ok(commands.some(({ command, args }) => command === 'npx' && args.join(' ') === `cap sync ${platform}`));
  assert.ok(!commands.some(({ args }) => args[0] === 'scripts/patch-native-ad-events.mjs'));
  if (platform === 'android') {
    assert.ok(commands.some(({ args }) => args[0] === 'scripts/cap-sync-android.mjs'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'android/app/src/main/assets/capacitor.config.json'))).appId, 'test.example');
    assert.ok(!commands.some(({ command }) => command === 'ruby'));
  } else {
    const prepare = commands.findIndex(({ args }) => args[0] === 'scripts/prepare-cas-ios.mjs');
    const assets = commands.findIndex(({ args }) => args[0] === 'scripts/vite-run.mjs');
    const sync = commands.findIndex(({ command }) => command === 'npx');
    assert.ok(prepare > 2 && prepare < assets && assets < sync);
    assert.equal(commands.filter(({ command }) => command === 'ruby').length, 2);
    assert.equal(fs.readFileSync(path.join(out, 'ios/App/casconfig.rb'), 'utf8'),
      fs.readFileSync(path.join(out, 'native/ios/casconfig.rb'), 'utf8'));
  }
});
}

test('native stack selection is explicit and existing consumer files are protected', (t) => {
  assert.throws(() => exportTemplate({ out: '/unused' }), /explicitly/);
  const out = seed(t, 'cas');
  const before = fs.readFileSync(path.join(out, 'src/js/platform/bridge.js'), 'utf8');
  assert.throws(() => exportTemplate({ nativeStack: 'admob', out }), /empty/);
  assert.equal(fs.readFileSync(path.join(out, 'src/js/platform/bridge.js'), 'utf8'), before);
});

test('template comparison uses the CAS overlay without proposing legacy adapters', (t) => {
  const out = seed(t, 'cas');
  const result = spawnSync(process.execPath, ['tools/compare-template.mjs', '--root', out,
    '--baseline', '.', '--native-stack', 'cas'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /current\s+src\/js\/platform\/ads\/native-cas.js/);
  assert.ok(!result.stdout.includes('native-admob.js'));
  assert.ok(!result.stdout.includes('native-yandex.js'));
});

for (const stack of ['admob', 'cas']) {
  test(`${stack}: assembled template closes relative imports and includes only its native stack`, (t) => {
    const out = seed(t, stack);
    function files(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    }
    for (const file of files(out).filter(file => /\.(js|mjs|ts)$/.test(file))) {
      const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!source.includes("from '@barsuk/game-starter"), 'starter cannot enter a shipped module');
      for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        if (fs.existsSync(target)) continue;
        assert.ok(['config.js', 'debug.js', 'build.config.mjs'].includes(path.basename(target)), `${file} has an undeclared edge: ${specifier}`);
      }
    }
    const bridge = fs.readFileSync(path.join(out, 'src/js/platform/bridge.js'), 'utf8');
    assert.equal(bridge.includes('./ads/native-cas.js'), stack === 'cas');
    for (const file of ['native-admob.js', 'native-yandex.js', 'native-ad-events.js']) {
      assert.equal(fs.existsSync(path.join(out, 'src/js/platform/ads', file)), stack === 'admob');
    }
    assert.equal(fs.existsSync(path.join(out, 'scripts/patch-native-ad-events.mjs')), stack === 'admob');
    assert.ok(fs.existsSync(path.join(out, 'src/js/platform/purchases/cdv-purchase.js')));
    assert.ok(fs.existsSync(path.join(out, 'src/js/platform/ads/yandex-web.js')));
  });
}

test('CAS collector preserves revenue quality and deduplicates callbacks on both native platforms', async () => {
  const source = fs.readFileSync(new URL('../template/variants/cas/platform/ads/ad-revenue.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const events = [];
  const context = vm.createContext({ isNative: true, logNativeAnalytics: event => events.push(event), console });
  vm.runInContext(source, context);
  const event = { type: 'impression', eventId: 'impression-1', format: 'rewarded', testMode: false,
    revenue: 0, revenueTotal: 100, currency: 'USD', revenuePrecision: 'precise' };
  context.recordCasImpression(event); context.recordCasImpression(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'bs_ad_revenue');
  assert.equal(events[0].params.revenue_amount, 0);
  assert.equal(events[0].params.ad_provider, 'cas');
  for (const revenue of [null, undefined]) assert.equal(context.revenueParameters({ ...event, revenue }).revenue_status, 'missing');
  for (const revenue of [-1, NaN, Infinity]) assert.equal(context.revenueParameters({ ...event, revenue }).revenue_status, 'invalid');
  const invalid = context.revenueParameters({ ...event, revenue: null, revenueStatus: 'invalid' });
  assert.equal(invalid.revenue_status, 'invalid');
  assert.equal(invalid.revenue_amount, undefined);
});
