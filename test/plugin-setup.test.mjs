import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyPluginSetup } from '../tools/verify-plugin-setup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL('../template/plugins-manifest.json', import.meta.url), 'utf8'));

function fixture(t, { diagnostics = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-plugin-setup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, contents) => {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };
  const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const groups = [manifest.platform, manifest.android, manifest.ios, ...(diagnostics ? [manifest.diagnostics] : [])];
  const pkg = {
    dependencies: Object.assign({}, ...groups.map((group) => group.dependencies)),
    devDependencies: Object.assign({}, ...groups.map((group) => group.devDependencies)),
  };
  const entries = { '': pkg };
  for (const [name, pin] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const version = pin.startsWith('https:') ? '1.0.2' : pin;
    entries[`node_modules/${name}`] = { version, resolved: pin, integrity: `fixture-${name}` };
    write(`node_modules/${name}/package.json`, { name, version });
  }
  write('package.json', pkg);
  write('package-lock.json', { packages: entries });
  write('node_modules/.package-lock.json', { packages: entries });
  const plugins = {
    '@capacitor/app': ['CapacitorApp', 'AppPlugin'],
    '@capacitor/splash-screen': ['CapacitorSplashScreen', 'SplashScreenPlugin'],
    '@capacitor-community/admob': ['CapacitorCommunityAdmob', 'AdMobPlugin'],
    'capacitor-plugin-yandex-ads': ['CapacitorPluginYandexAds', 'YandexAdsPlugin'],
    'capacitor-plugin-cdv-purchase': ['CapacitorPluginCdvPurchase', 'PurchasePlugin'],
    ...(diagnostics ? {
      '@capacitor-firebase/app': ['CapacitorFirebaseApp', 'FirebaseAppPlugin'],
      '@capacitor-firebase/analytics': ['CapacitorFirebaseAnalytics', 'FirebaseAnalyticsPlugin'],
      '@capacitor-firebase/crashlytics': ['CapacitorFirebaseCrashlytics', 'FirebaseCrashlyticsPlugin'],
      '@capacitor-firebase/performance': ['CapacitorFirebasePerformance', 'FirebasePerformancePlugin'],
    } : {}),
  };
  write('android/build.gradle', Object.entries({ ...manifest.android.classpaths, ...(diagnostics ? manifest.diagnostics.androidClasspaths : {}) })
    .map(([name, version]) => `classpath '${name}:${version}'`).join('\n'));
  write('android/variables.gradle', Object.entries({ ...manifest.android.variables, ...(diagnostics ? manifest.diagnostics.androidVariables : {}) })
    .map(([name, version]) => `${name} = '${version}'`).join('\n'));
  write('android/app/build.gradle', `applicationId 'test.example'
apply plugin: 'com.google.gms.google-services'
apply plugin: 'com.google.firebase.crashlytics'
apply plugin: 'com.google.firebase.firebase-perf'
implementation "com.google.firebase:firebase-crashlytics-ndk:$firebaseCrashlyticsVersion"
`);
  write('android/app/capacitor.build.gradle', Object.keys(plugins).map((name) => `implementation project(':${name.replace(/^@/, '').replace('/', '-')}')`).join('\n'));
  write('android/app/src/main/assets/capacitor.plugins.json', Object.keys(plugins).map((pkg) => ({ pkg })));
  write('android/app/src/main/AndroidManifest.xml', '<manifest><application/></manifest>');
  write('android/app/google-services.json', { project_info: { project_id: 'test' }, client: [{ client_info: { mobilesdk_app_id: '1:1:android:test', android_client_info: { package_name: 'test.example' } } }] });
  write('ios/App/Podfile', `platform :ios, '${manifest.ios.deploymentTarget}'\n${Object.values(plugins).map(([pod]) => `pod '${pod}'`).join('\n')}`);
  const lock = Object.entries(plugins).map(([name, [pod]]) => `  - ${pod} (${entries[`node_modules/${name}`].version}):`).join('\n')
    + `\n  - FirebaseCrashlytics (${manifest.diagnostics.iosSdkVersion}):\n  - FirebasePerformance (${manifest.diagnostics.iosSdkVersion}):\n`;
  write('ios/App/Podfile.lock', lock);
  write('ios/App/Pods/Manifest.lock', lock);
  write('ios/App/App/capacitor.config.json', { packageClassList: Object.values(plugins).map(([, name]) => name) });
  write('ios/App/App/AppDelegate.swift', 'import FirebaseCore\nFirebaseApp.configure()');
  write('ios/App/App/GoogleService-Info.plist', { BUNDLE_ID: 'test.example', GOOGLE_APP_ID: '1:1:ios:test', PROJECT_ID: 'test' });
  write('ios/App/App/Info.plist', {});
  const project = {
    rootObject: 'project',
    objects: {
      project: { isa: 'PBXProject', buildConfigurationList: 'projectConfigs' },
      projectConfigs: { buildConfigurations: ['debug'] },
      debug: { name: 'Debug', buildSettings: { DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym' } },
      app: { isa: 'PBXNativeTarget', name: 'App', buildConfigurationList: 'configs', buildPhases: ['resources', 'crashlytics'] },
      configs: { buildConfigurations: ['appDebug'] },
      appDebug: { name: 'Debug', buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: 'test.example' } },
      resources: { isa: 'PBXResourcesBuildPhase', files: ['firebaseBuildFile'] },
      firebaseBuildFile: { fileRef: 'firebaseRef' },
      firebaseRef: { path: 'GoogleService-Info.plist' },
      crashlytics: {
        isa: 'PBXShellScriptBuildPhase', runOnlyForDeploymentPostprocessing: 0,
        shellScript: '"${PODS_ROOT}/FirebaseCrashlytics/run"',
        inputPaths: [
          '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}',
          '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}',
          '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Info.plist',
          '$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/GoogleService-Info.plist',
          '$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)',
        ],
      },
    },
  };
  write('ios/App/App.xcodeproj/project.pbxproj', project);
  write('scripts/patch-native-ad-events.mjs', 'process.exit(0);');
  write('src/js/platform/diagnostics.js', '// fixture transport');
  write('src/js/platform/index.js', "import { initializeDiagnostics } from './diagnostics.js';\ninitializeDiagnostics();");
  write('src/js/platform/native-shell.js', "import { finishBootstrapTrace } from './diagnostics.js';\nawait SplashScreen.hide();\nfinishBootstrapTrace();");
  const run = (command, args, options) => command === 'plutil'
    ? { status: 0, stdout: fs.readFileSync(args.at(-1), 'utf8') }
    : spawnSync(command, args, options);
  return {
    directory, write, read, project,
    verify: (options = {}) => verifyPluginSetup({ root: directory, targets: ['android', 'ios'], diagnostics, run, ...options }),
    remove: (file) => fs.rmSync(path.join(directory, file), { recursive: true }),
  };
}

test('complete baseline passes with installed metadata and both native targets', (t) => {
  assert.deepEqual(fixture(t).verify().errors, []);
});

for (const file of ['package-lock.json', 'node_modules/.package-lock.json', 'android/build.gradle', 'android/variables.gradle',
  'android/app/build.gradle', 'android/app/google-services.json', 'ios/App/Podfile', 'ios/App/Pods/Manifest.lock',
  'ios/App/App/AppDelegate.swift', 'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/GoogleService-Info.plist',
  'scripts/patch-native-ad-events.mjs', 'src/js/platform/diagnostics.js']) {
  test(`missing required file fails: ${file}`, (t) => {
    const app = fixture(t); app.remove(file);
    assert.ok(app.verify().errors.some((error) => error.includes(file)));
  });
}

test('declared, locked and installed versions are all checked', (t) => {
  const app = fixture(t);
  const pkg = app.read('package.json'); pkg.dependencies['@capacitor/core'] = '0.0.0'; app.write('package.json', pkg);
  const lock = app.read('package-lock.json'); lock.packages['node_modules/@capacitor/core'].version = '0.0.0'; app.write('package-lock.json', lock);
  app.write('node_modules/@capacitor/core/package.json', { version: '0.0.0' });
  const errors = app.verify().errors;
  assert.ok(errors.some((error) => error.includes('dependencies must pin')));
  assert.ok(errors.some((error) => error.includes('resolved lockfile entry')));
  assert.ok(errors.some((error) => error.includes('installed metadata')));
});

test('an npm declaration without an installed plugin fails', (t) => {
  const app = fixture(t); app.remove('node_modules/@capacitor-firebase/crashlytics/package.json');
  assert.ok(app.verify().errors.some((error) => error.includes('@capacitor-firebase/crashlytics')));
});

test('missing or commented Performance setup fails on Android and iOS', (t) => {
  const app = fixture(t);
  app.write('android/build.gradle', '// classpath "com.google.firebase:perf-plugin:2.0.2"');
  app.write('android/app/build.gradle', "// apply plugin: 'com.google.firebase.firebase-perf'");
  app.write('ios/App/Podfile', "# pod 'CapacitorFirebasePerformance'");
  const errors = app.verify().errors;
  assert.ok(errors.some((error) => error.includes('perf-plugin')));
  assert.ok(errors.some((error) => error.includes('firebase-perf is not applied')));
  assert.ok(errors.some((error) => error.includes('CapacitorFirebasePerformance missing')));
});

test('a failed patch check is fatal, including at the CLI exit boundary', (t) => {
  const app = fixture(t); app.write('scripts/patch-native-ad-events.mjs', 'process.exit(1);');
  assert.ok(app.verify().errors.some((error) => error.includes('Native ad patches')));
  const result = spawnSync(process.execPath, [path.join(root, 'tools/verify-plugin-setup.mjs'), '--targets', 'android', '--diagnostics'], { cwd: app.directory, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Native ad patches/);
});

test('Firebase files must match native app identity', (t) => {
  const app = fixture(t);
  app.write('android/app/google-services.json', { client: [] });
  app.write('ios/App/App/GoogleService-Info.plist', { BUNDLE_ID: 'wrong', GOOGLE_APP_ID: '1:1:ios:test', PROJECT_ID: 'test' });
  const errors = app.verify().errors;
  assert.ok(errors.some((error) => error.includes('matching applicationId')));
  assert.ok(errors.some((error) => error.includes('App bundle identifier')));
});

for (const [name, mutate, expected] of [
  ['unbundled Firebase plist', (p) => { p.objects.resources.files = []; }, /Copy Bundle Resources/],
  ['detached dSYM phase', (p) => { p.objects.app.buildPhases = ['resources']; }, /final App build phase/],
  ['dSYM phase before resources', (p) => { p.objects.app.buildPhases.reverse(); }, /final App build phase/],
  ['commented upload command', (p) => { p.objects.crashlytics.shellScript = '# "${PODS_ROOT}/FirebaseCrashlytics/run"'; }, /final App build phase/],
  ['no dSYM generation', (p) => { p.objects.appDebug.buildSettings.DEBUG_INFORMATION_FORMAT = 'dwarf'; }, /generate DWARF with dSYM/],
  ['missing dSYM inputs', (p) => { p.objects.crashlytics.inputPaths = []; }, /Crashlytics input missing/],
]) {
  test(`iOS rejects ${name}`, (t) => {
    const app = fixture(t); mutate(app.project); app.write('ios/App/App.xcodeproj/project.pbxproj', app.project);
    assert.ok(app.verify().errors.some((error) => expected.test(error)));
  });
}

test('skipped native sync is detected through generated registrations', (t) => {
  const app = fixture(t);
  app.write('android/app/src/main/assets/capacitor.plugins.json', []);
  app.write('ios/App/App/capacitor.config.json', {});
  assert.ok(app.verify().errors.filter((error) => error.includes('registration') || error.includes('registry')).length >= 2);
});

test('missing JS lifecycle wiring does not report a ready diagnostics installation', (t) => {
  const app = fixture(t); app.write('src/js/platform/index.js', '// initializeDiagnostics()');
  app.write('src/js/platform/native-shell.js', '// finishBootstrapTrace()');
  assert.equal(app.verify().errors.filter((error) => error.startsWith('Diagnostics:')).length, 2);
});

test('web validation without Firebase does not require native targets or diagnostic packages', (t) => {
  const app = fixture(t, { diagnostics: false });
  app.remove('android'); app.remove('ios'); app.remove('src'); app.remove('scripts');
  assert.deepEqual(app.verify({ targets: ['web'] }).errors, []);
  assert.ok(app.verify({ targets: ['web'], diagnostics: true }).errors.length > 0);
});

test('targets must be explicit so an absent native folder cannot silently skip its checks', (t) => {
  const app = fixture(t);
  assert.ok(app.verify({ targets: [] }).errors.length > 0);
  assert.ok(app.verify({ targets: ['typo'] }).errors.length > 0);
});

test('base template entrypoints do not import optional diagnostics', () => {
  for (const name of ['index.js', 'native-shell.js', 'bridge.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'template/platform', name), 'utf8'), /from ['"].*diagnostics/);
  }
});

test('the npm bin symlink executes the verifier and preserves failures', (t) => {
  const app = fixture(t);
  const bin = path.join(app.directory, 'verify-plugins');
  fs.symlinkSync(path.join(root, 'tools/verify-plugin-setup.mjs'), bin);
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: barsuk-verify-plugins/);
  const invalid = spawnSync(process.execPath, [bin], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Specify --targets/);
});

test('the distributable carries the guide, reference versions and executable verifier', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map((file) => file.path);
  for (const file of ['PLUGINS.md', 'tools/verify-plugin-setup.mjs', 'template/plugins-manifest.json', 'template/platform/diagnostics.js']) assert.ok(files.includes(file), file);
});
