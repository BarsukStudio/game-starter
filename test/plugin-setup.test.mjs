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

function fixture(t, { diagnostics = true, purchasePin } = {}) {
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
  if (purchasePin) pkg.dependencies['capacitor-plugin-cdv-purchase'] = purchasePin;
  for (const [name, pin] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const archive = pin.startsWith('file:') ? manifest.localArchives?.[name] : undefined;
    const version = archive?.version ?? (pin.startsWith('https:') ? '1.0.2' : pin);
    entries[`node_modules/${name}`] = { version, resolved: pin, integrity: archive?.integrity ?? `fixture-${name}` };
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
    '@capacitor-firebase/analytics': ['CapacitorFirebaseAnalytics', 'FirebaseAnalyticsPlugin'],
    ...(diagnostics ? {
      '@capacitor-firebase/app': ['CapacitorFirebaseApp', 'FirebaseAppPlugin'],
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

function casFixture(t) {
  const app = fixture(t);
  const pkg = app.read('package.json');
  const lock = app.read('package-lock.json');
  for (const name of manifest.advertising.cas.replaces) {
    delete pkg.dependencies[name];
    delete lock.packages[`node_modules/${name}`];
  }
  Object.assign(pkg.dependencies, manifest.advertising.cas.dependencies);
  const name = '@barsuk/capacitor-cas';
  const archive = manifest.localArchives[name];
  lock.packages[''] = pkg;
  lock.packages[`node_modules/${name}`] = { ...archive, resolved: pkg.dependencies[name] };
  app.write('package.json', pkg);
  app.write('package-lock.json', lock);
  app.write('node_modules/.package-lock.json', lock);
  app.write(`node_modules/${name}/package.json`, { name, version: archive.version });
  // A synthetic archive must fail the real byte hash; all other CAS checks can
  // still be exercised without embedding the production plugin in this repo.
  app.write(pkg.dependencies[name].slice(5), 'synthetic archive');
  const plugins = {
    '@barsuk/capacitor-cas': ['BarsukCapacitorCas', 'CASAdsPlugin'],
    '@capacitor/app': ['CapacitorApp', 'AppPlugin'],
    '@capacitor/splash-screen': ['CapacitorSplashScreen', 'SplashScreenPlugin'],
    'capacitor-plugin-cdv-purchase': ['CapacitorPluginCdvPurchase', 'PurchasePlugin'],
    ...Object.fromEntries(['app', 'analytics', 'crashlytics', 'performance'].map(key => {
      const names = { app: ['CapacitorFirebaseApp', 'FirebaseAppPlugin'], analytics: ['CapacitorFirebaseAnalytics', 'FirebaseAnalyticsPlugin'],
        crashlytics: ['CapacitorFirebaseCrashlytics', 'FirebaseCrashlyticsPlugin'], performance: ['CapacitorFirebasePerformance', 'FirebasePerformancePlugin'] };
      return [`@capacitor-firebase/${key}`, names[key]];
    })),
  };
  app.write('android/app/capacitor.build.gradle', Object.keys(plugins).map(name => `implementation project(':${name.replace(/^@/, '').replace('/', '-')}')`).join('\n'));
  app.write('android/app/src/main/assets/capacitor.plugins.json', Object.keys(plugins).map(pkg => ({ pkg })));
  app.write('android/build.gradle', Object.entries({ ...manifest.android.classpaths, ...manifest.diagnostics.androidClasspaths,
    'com.cleveradssolutions:gradle-plugin': manifest.advertising.cas.sdkVersion }).map(([name, version]) => `classpath '${name}:${version}'`).join('\n'));
  app.write('android/app/build.gradle', `applicationId 'test.example'
apply plugin: 'com.google.gms.google-services'
apply plugin: 'com.google.firebase.crashlytics'
apply plugin: 'com.google.firebase.firebase-perf'
apply plugin: 'com.cleveradssolutions.gradle-plugin'
includeOptimalAds = true
implementation "com.google.firebase:firebase-analytics:$firebaseAnalyticsVersion"
implementation "com.google.firebase:firebase-crashlytics-ndk:$firebaseCrashlyticsVersion"`);
  app.write('src/js/platform/config.js', "export const config = { ads: { cas: { audience: 'notChildren' } } };");
  app.write('android/app/src/main/AndroidManifest.xml', `<manifest><application android:name=".GameApplication">
${Object.entries({ firebase_analytics_collection_enabled: true, google_analytics_tcf_data_enabled: true,
    google_analytics_default_allow_ad_storage: true, google_analytics_default_allow_ad_user_data: 'eu_consent_policy',
    google_analytics_default_allow_ad_personalization_signals: 'eu_consent_policy' }).map(([key, value]) => `<meta-data android:name="${key}" android:value="${value}"/>`).join('\n')}
</application></manifest>`);
  app.write('android/app/src/main/java/test/example/GameApplication.java', 'class GameApplication extends Application { public void onCreate() { super.onCreate(); FirebaseAnalytics.getInstance(this).setAnalyticsCollectionEnabled(true); } }');
  app.write('ios/App/App/Info.plist', { FIREBASE_ANALYTICS_COLLECTION_ENABLED: true, GOOGLE_ANALYTICS_TCF_DATA_ENABLED: true,
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE: true, GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA: 'eu_consent_policy',
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS: 'eu_consent_policy' });
  app.write('ios/App/App/AppDelegate.swift', 'import FirebaseCore\nimport FirebaseAnalytics\nFirebaseApp.configure()\nAnalytics.setAnalyticsCollectionEnabled(true)');
  app.write('ios/App/Podfile', `source 'https://github.com/cleveradssolutions/CAS-Specs.git'
platform :ios, '${manifest.ios.deploymentTarget}'
${Object.values(plugins).map(([pod]) => `pod '${pod}'`).join('\n')}
pod 'CleverAdsSolutions-SDK/Optimal', '${manifest.advertising.cas.sdkVersion}'`);
  const podLock = `  - CleverAdsSolutions-Base (${manifest.advertising.cas.sdkVersion}):\n` + Object.entries(plugins).map(([name, [pod]]) => `  - ${pod} (${lock.packages[`node_modules/${name}`].version}):`).join('\n')
    + `\n  - FirebaseCrashlytics (${manifest.diagnostics.iosSdkVersion}):\n  - FirebasePerformance (${manifest.diagnostics.iosSdkVersion}):\n`;
  app.write('ios/App/Podfile.lock', podLock); app.write('ios/App/Pods/Manifest.lock', podLock);
  app.write('ios/App/App/capacitor.config.json', { packageClassList: Object.values(plugins).map(([, name]) => name) });
  app.write('src/js/platform/bridge.js', "import './ads/native-cas.js';");
  app.write('src/js/platform/ads/native-cas.js', fs.readFileSync(new URL('../template/variants/cas/platform/ads/native-cas.js', import.meta.url), 'utf8'));
  app.write('src/js/platform/ads/ad-revenue.js', fs.readFileSync(new URL('../template/variants/cas/platform/ads/ad-revenue.js', import.meta.url), 'utf8'));
  app.write('src/js/platform/native-analytics.js', fs.readFileSync(new URL('../template/variants/cas/platform/native-analytics.js', import.meta.url), 'utf8'));
  app.remove('scripts/patch-native-ad-events.mjs');
  return app;
}

test('CAS source baseline passes every check except synthetic archive bytes', (t) => {
  assert.deepEqual(casFixture(t).verify().errors, ['CAS: archive bytes must match the reviewed plugin integrity.']);
});

test('CAS non-child profile rejects global advertising denials and unconditional advertising grants', t => {
  for (const value of [false, true]) {
    const app = casFixture(t);
    const androidPath = 'android/app/src/main/AndroidManifest.xml';
    app.write(androidPath, fs.readFileSync(path.join(app.directory, androidPath), 'utf8')
      .replaceAll('eu_consent_policy', String(value)));
    const info = app.read('ios/App/App/Info.plist');
    info.GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA = value;
    info.GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS = value;
    app.write('ios/App/App/Info.plist', info);
    const errors = app.verify().errors.join('\n');
    assert.match(errors, /google_analytics_default_allow_ad_user_data must be eu_consent_policy/);
    assert.match(errors, /GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA must be eu_consent_policy/);
  }
});

test('CAS child and unspecified audiences retain restrictive defaults', t => {
  for (const audience of ['children', 'undefined']) {
    const app = casFixture(t);
    app.write('src/js/platform/config.js', `export const config = { ads: { cas: { audience: '${audience}' } } };`);
    assert.match(app.verify().errors.join('\n'), /default_allow_ad_storage must be false/);
    const androidPath = 'android/app/src/main/AndroidManifest.xml';
    app.write(androidPath, fs.readFileSync(path.join(app.directory, androidPath), 'utf8')
      .replace('google_analytics_default_allow_ad_storage" android:value="true"', 'google_analytics_default_allow_ad_storage" android:value="false"')
      .replaceAll('eu_consent_policy', 'false'));
    const info = app.read('ios/App/App/Info.plist');
    for (const key of ['GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE', 'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA',
      'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS']) info[key] = false;
    app.write('ios/App/App/Info.plist', info);
    assert.deepEqual(app.verify().errors, ['CAS: archive bytes must match the reviewed plugin integrity.']);
  }
});

test('CAS preflight rejects missing independent collection startup and unsafe defaults', t => {
  const app = casFixture(t);
  app.write('android/app/src/main/java/test/example/GameApplication.java', 'class GameApplication extends Application {}');
  app.write('android/app/src/main/AndroidManifest.xml', '<manifest><application android:name=".GameApplication"/></manifest>');
  app.write('ios/App/App/Info.plist', { FIREBASE_ANALYTICS_COLLECTION_ENABLED: true });
  app.write('ios/App/App/AppDelegate.swift', 'import FirebaseCore\nFirebaseApp.configure()');
  app.write('src/js/platform/native-analytics.js', '// no collection gate');
  const errors = app.verify().errors.join('\n');
  for (const expected of ['event transport differs', 'CAS Android Analytics:', 'registered Application', 'CAS iOS Analytics:', 'enable collection independently of CAS']) {
    assert.ok(errors.includes(expected), errors);
  }
});

test('CAS rejects mixed stacks, SDK drift and collector drift', (t) => {
  const app = casFixture(t);
  const pkg = app.read('package.json'); pkg.dependencies['@capacitor-community/admob'] = '8.1.0'; app.write('package.json', pkg);
  app.write('android/build.gradle', "classpath 'com.cleveradssolutions:gradle-plugin:0.0.0'");
  app.write('ios/App/Podfile', "pod 'CleverAdsSolutions-SDK/Optimal', '0.0.0'");
  app.write('src/js/platform/ads/ad-revenue.js', '// lost collector');
  const errors = app.verify().errors.join('\n');
  for (const expected of ['legacy plugin', 'gradle-plugin:4.8.0', 'CAS iOS', 'collector differs']) assert.ok(errors.includes(expected), errors);
});

test('the reviewed runtime source pin is accepted, unrelated commits remain rejected', (t) => {
  const app = fixture(t);
  const name = '@barsuk/game-runtime';
  const pkg = app.read('package.json'); const lock = app.read('package-lock.json');
  pkg.dependencies[name] = manifest.acceptedPins[name][0];
  lock.packages[''] = pkg; lock.packages[`node_modules/${name}`].resolved = pkg.dependencies[name];
  app.write('package.json', pkg); app.write('package-lock.json', lock); app.write('node_modules/.package-lock.json', lock);
  assert.deepEqual(app.verify().errors, []);
  pkg.dependencies[name] = pkg.dependencies[name].replace('39aba0d', '0000000'); app.write('package.json', pkg);
  assert.ok(app.verify().errors.some(error => error.includes('dependencies must pin')));
});

test('complete baseline passes with installed metadata and both native targets', (t) => {
  assert.deepEqual(fixture(t).verify().errors, []);
});

test('the reviewed iOS 15 purchase archive passes both native targets', (t) => {
  const purchasePin = manifest.acceptedPins['capacitor-plugin-cdv-purchase'][0];
  assert.deepEqual(fixture(t, { purchasePin }).verify().errors, []);
});

test('an unrelated purchase archive is rejected', (t) => {
  const purchasePin = manifest.acceptedPins['capacitor-plugin-cdv-purchase'][0].replace('barsuk.1', 'barsuk.2');
  const errors = fixture(t, { purchasePin }).verify().errors;
  assert.ok(errors.some(error => error.includes('capacitor-plugin-cdv-purchase: dependencies must pin')));
});

for (const mismatch of ['integrity', 'version']) {
  test(`the reviewed purchase archive rejects changed ${mismatch}`, (t) => {
    const name = 'capacitor-plugin-cdv-purchase';
    const app = fixture(t, { purchasePin: manifest.acceptedPins[name][0] });
    const lock = app.read('package-lock.json');
    lock.packages[`node_modules/${name}`][mismatch] = mismatch === 'integrity' ? 'sha512-unreviewed' : '13.18.0';
    app.write('package-lock.json', lock);
    app.write('node_modules/.package-lock.json', lock);
    if (mismatch === 'version') app.write(`node_modules/${name}/package.json`, { name, version: '13.18.0' });
    assert.ok(app.verify().errors.some(error => error.includes(`${name}: local candidate archive must match the reviewed integrity and version.`)));
  });
}

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

function consentFixture(t) {
  const app = fixture(t);
  app.write('src/js/platform/ads/native-admob.js', "import { showIosConsentForm } from '../consent-signals.js';");
  app.write('src/js/platform/consent-signals.js', '// opt in to native consent checks');
  app.write('android/app/src/main/java/test/example/ConsentSignalsPlugin.java',
    fs.readFileSync(new URL('../template/native/android/ConsentSignalsPlugin.java', import.meta.url), 'utf8').replace('YOUR_APPLICATION_PACKAGE', 'test.example'));
  app.write('android/app/src/main/java/test/example/MainActivity.java',
    'class MainActivity { public void onCreate(Bundle state) { registerPlugin(ConsentSignalsPlugin.class); super.onCreate(state); } }');
  app.write('ios/App/App/ConsentSignalsPlugin.swift', fs.readFileSync(new URL('../template/native/ios/ConsentSignalsPlugin.swift', import.meta.url), 'utf8'));
  app.write('ios/App/App/Info.plist', { UIMainStoryboardFile: 'Main' });
  app.write('ios/App/App/Base.lproj/Main.storyboard', '<document initialViewController="main"><viewController id="main" customClass="GameBridgeViewController" customModule="App"/></document>');
  app.write('ios/App/App/PrivacyInfo.xcprivacy', { NSPrivacyAccessedAPITypes: [
    { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
  ] });
  app.project.objects.app.buildPhases.unshift('sources');
  app.project.objects.sources = { isa: 'PBXSourcesBuildPhase', files: ['consentBuild'] };
  for (const [id, name] of [['consent', 'ConsentSignalsPlugin.swift'], ['storyboard', 'Main.storyboard'], ['privacy', 'PrivacyInfo.xcprivacy']]) {
    app.project.objects[`${id}Build`] = { fileRef: `${id}Ref` };
    app.project.objects[`${id}Ref`] = { path: name };
    if (id !== 'consent') app.project.objects.resources.files.push(`${id}Build`);
  }
  app.write('ios/App/App.xcodeproj/project.pbxproj', app.project);
  return app;
}

test('native consent preflight accepts template wiring and preserves optional web consumers', (t) => {
  assert.deepEqual(consentFixture(t).verify().errors, []);
  assert.deepEqual(fixture(t).verify({ targets: ['web'], consent: true }).errors, []);
});

for (const activity of [
  'void onCreate(Bundle state) { /* registerPlugin(ConsentSignalsPlugin.class); */ super.onCreate(state); }',
  'void onCreate(Bundle state) { super.onCreate(state); registerPlugin(ConsentSignalsPlugin.class); }',
  'void other() { registerPlugin(ConsentSignalsPlugin.class); super.onCreate(state); }',
]) test(`native consent rejects invalid Android registration: ${activity}`, (t) => {
  const app = consentFixture(t);
  app.write('android/app/src/main/java/test/example/MainActivity.java', activity);
  assert.ok(app.verify().errors.some(error => error.includes('before super.onCreate')));
});

for (const [phase, id, message] of [
  ['sources', 'consentBuild', 'App Sources'],
  ['resources', 'privacyBuild', 'PrivacyInfo.xcprivacy must be in'],
  ['resources', 'storyboardBuild', 'Main.storyboard must be in'],
]) test(`native consent requires target membership: ${id}`, (t) => {
  const app = consentFixture(t);
  app.project.objects[phase].files = app.project.objects[phase].files.filter(value => value !== id);
  app.write('ios/App/App.xcodeproj/project.pbxproj', app.project);
  assert.ok(app.verify().errors.some(error => error.includes(message)));
});

test('native consent rejects missing privacy reason and wrong initial controller', (t) => {
  const app = consentFixture(t);
  app.write('ios/App/App/PrivacyInfo.xcprivacy', { NSPrivacyAccessedAPITypes: [] });
  app.write('ios/App/App/Base.lproj/Main.storyboard', '<document initialViewController="other"><viewController id="main" customClass="GameBridgeViewController" customModule="App"/></document>');
  const errors = app.verify().errors;
  assert.ok(errors.some(error => error.includes('CA92.1')));
  assert.ok(errors.some(error => error.includes('initial storyboard controller')));
});

test('explicit consent flag detects absent integration even without JS opt-in', (t) => {
  const app = fixture(t);
  const errors = app.verify({ consent: true }).errors;
  assert.ok(errors.some(error => error.includes('MainActivity.java')));
  assert.ok(errors.some(error => error.includes('ConsentSignalsPlugin.swift')));
});


test('revenue preflight rejects collector drift and missing native ILRD transport', (t) => {
  const app = fixture(t);
  const collector = fs.readFileSync(new URL('../template/platform/ads/ad-revenue.js', import.meta.url), 'utf8');
  const nativeFile = 'node_modules/capacitor-plugin-yandex-ads/android/src/main/kotlin/com/barsukstudio/plugins/yandexads/YandexAdsPlugin.kt';
  app.write('src/js/platform/ads/ad-revenue.js', collector);
  for (const provider of ['admob', 'yandex']) {
    const mappings = provider === 'admob'
      ? 'banner: BannerAdPluginEvents.AdPaid, interstitial: InterstitialAdPluginEvents.AdImpression, rewarded: RewardAdPluginEvents.AdImpression'
      : "banner: 'bannerImpression', interstitial: 'interstitialImpression', rewarded: 'rewardedImpression'";
    app.write(`src/js/platform/ads/native-${provider}.js`, `import { bindAdRevenueEvents } from './ad-revenue.js';\nawait bindAdRevenueEvents(plugin, '${provider}', { ${mappings} }, false);`);
  }

  app.write(nativeFile, ['banner', 'interstitial', 'rewarded'].map(format =>
    `notifyRequest("${format}Impression", adEvent(${format}AdUnitId).put("impressionData", impressionData?.rawData))`).join('\n'));
  const iosFile = 'node_modules/capacitor-plugin-yandex-ads/ios/Sources/YandexAdsPlugin/YandexAdsPlugin.swift';
  const iosSource = 'payload["impressionData"] = impressionData.rawData\npayload["impressionData"] = NSNull()\n'
    + ['banner', 'interstitial', 'rewarded'].map(format =>
      `notifyRequest("${format}Impression", call: call, data: impressionEvent(${format}AdUnitID, impressionData))`).join('\n');
  app.write(iosFile, iosSource);
  assert.deepEqual(app.verify().errors, []);
  for (const format of ['banner', 'interstitial', 'rewarded']) {
    app.write(iosFile, iosSource.replace(`impressionEvent(${format}AdUnitID, impressionData)`, `adEvent(${format}AdUnitID)`));
    assert.ok(app.verify().errors.some(error => error.includes(`iOS Yandex ${format} must forward`)));
  }
  app.write(iosFile, iosSource.replace('impressionData.rawData', '""'));
  assert.ok(app.verify().errors.some(error => error.includes('iOS Yandex must forward nullable')));
  app.write(iosFile, iosSource.replace('NSNull()', '0'));
  assert.ok(app.verify().errors.some(error => error.includes('iOS Yandex must forward nullable')));
  app.write(iosFile, iosSource);
  app.write('src/js/platform/ads/native-admob.js', '// collector was copied but not wired');
  assert.ok(app.verify().errors.some(error => error.includes('admob adapter must await')));
  app.write('src/js/platform/ads/ad-revenue.js', collector.replace('schema_revision: 1', 'schema_revision: 2'));
  app.write(nativeFile, '// notifyRequest("bannerImpression", adEvent(bannerAdUnitId).put("impressionData", impressionData?.rawData))');
  const errors = app.verify().errors;
  assert.ok(errors.some(error => error.includes('differs from the shared')));
  for (const format of ['banner', 'interstitial', 'rewarded']) {
    assert.ok(errors.some(error => error.includes(`Yandex ${format} must forward`)));
  }
});


test('unused consent helper does not select the consumer consent policy', t => {
  const app = fixture(t);
  app.write('src/js/platform/consent-signals.js', '// legacy unused helper');
  assert.deepEqual(app.verify().errors, []);
});

test('local runtime candidate rejects a different archive integrity', t => {
  const app = fixture(t);
  const lock = app.read('package-lock.json');
  lock.packages['node_modules/@barsuk/game-runtime'].integrity = 'sha512-wrong';
  app.write('package-lock.json', lock);
  assert.ok(app.verify().errors.some(error => error.includes('reviewed integrity')));
});

for (const call of ['applyConsentStatus(result.consentStatus)', 'applyConsentStatus(result.status)']) {
  test(`CAS preflight rejects disconnected CMP completion: ${call}`, t => {
    const app=casFixture(t);
    const source=fs.readFileSync(new URL('../template/variants/cas/platform/ads/native-cas.js',import.meta.url),'utf8');
    app.write('src/js/platform/ads/native-cas.js',source.replace(call,'false'));
    assert.ok(app.verify().errors.some(error=>error.includes('automatic and manual CMP completion')));
  });
}
