#!/usr/bin/env node
// Read-only preflight for the documented Groovy / CocoaPods App layout.
// It checks declared source settings and installed metadata, never native behavior.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const manifest = JSON.parse(fs.readFileSync(new URL('../template/plugins-manifest.json', import.meta.url), 'utf8'));
const nativePlugins = {
  '@capacitor/app': ['CapacitorApp', 'AppPlugin'],
  '@capacitor/splash-screen': ['CapacitorSplashScreen', 'SplashScreenPlugin'],
  '@capacitor-community/admob': ['CapacitorCommunityAdmob', 'AdMobPlugin'],
  'capacitor-plugin-yandex-ads': ['CapacitorPluginYandexAds', 'YandexAdsPlugin'],
  'capacitor-plugin-cdv-purchase': ['CapacitorPluginCdvPurchase', 'PurchasePlugin'],
};
const firebasePlugins = {
  '@capacitor-firebase/app': ['CapacitorFirebaseApp', 'FirebaseAppPlugin'],
  '@capacitor-firebase/analytics': ['CapacitorFirebaseAnalytics', 'FirebaseAnalyticsPlugin'],
  '@capacitor-firebase/crashlytics': ['CapacitorFirebaseCrashlytics', 'FirebaseCrashlyticsPlugin'],
  '@capacitor-firebase/performance': ['CapacitorFirebasePerformance', 'FirebasePerformancePlugin'],
};
const dsymInputs = [
  '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}',
  '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}',
  '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Info.plist',
  '${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist',
  '${TARGET_BUILD_DIR}/${EXECUTABLE_PATH}',
];
const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|#).*$/gm, '');
const normalizePath = (value) => value.replace(/\$\((\w+)\)/g, '${$1}');

export function verifyPluginSetup({ root, targets, diagnostics = false, run = spawnSync }) {
  const errors = [];
  let checks = 0;
  function check(ok, message) {
    checks++;
    if (!ok) errors.push(message);
  }
  if (!Array.isArray(targets) || !targets.length || targets.some((target) => !['web', 'android', 'ios'].includes(target))) {
    return { errors: ['Specify --targets web, android, ios, or a comma-separated combination.'], checks };
  }
  function read(file) {
    try { return fs.readFileSync(path.join(root, file), 'utf8'); }
    catch { check(false, `Missing or unreadable file: ${file}`); return ''; }
  }
  function json(file) {
    try { return JSON.parse(read(file)); }
    catch { check(false, `Invalid JSON: ${file}`); return {}; }
  }
  function plist(file) {
    if (!read(file)) return {};
    const result = run('plutil', ['-convert', 'json', '-o', '-', '--', path.join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) {
      check(false, `Cannot parse ${file} with plutil (iOS checks require macOS).`);
      return {};
    }
    try { return JSON.parse(result.stdout); }
    catch { check(false, `Invalid plutil output for ${file}`); return {}; }
  }

  const pkg = json('package.json');
  const lock = json('package-lock.json');
  const installedLock = json('node_modules/.package-lock.json');
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  diagnostics ||= Boolean(declared['@capacitor-firebase/crashlytics'] || declared['@capacitor-firebase/performance']);
  const groups = [manifest.platform, ...targets.filter((target) => target !== 'web').map((target) => manifest[target])];
  if (diagnostics) groups.push(manifest.diagnostics);
  for (const section of ['dependencies', 'devDependencies']) {
    const expected = Object.assign({}, ...groups.map((group) => group[section]));
    for (const [name, version] of Object.entries(expected)) {
      const key = `node_modules/${name}`;
      const entry = lock.packages?.[key];
      const installed = installedLock.packages?.[key];
      const actual = json(`${key}/package.json`);
      check(pkg[section]?.[name] === version, `${name}: ${section} must pin ${version}; found ${pkg[section]?.[name] ?? 'missing'}.`);
      check(lock.packages?.['']?.[section]?.[name] === version, `${name}: root lockfile pin differs from the baseline.`);
      check(version.startsWith('https:') ? entry?.resolved === version : entry?.version === version, `${name}: resolved lockfile entry differs from the baseline.`);
      check(Boolean(entry?.integrity) && installed?.integrity === entry.integrity && installed?.resolved === entry.resolved
        && installed?.version === entry.version && actual.version === entry.version, `${name}: installed metadata differs from package-lock.json; reinstall the declared dependencies.`);
    }
  }
  const plugins = { ...nativePlugins, ...(diagnostics ? firebasePlugins : {}) };
  if (diagnostics) {
    read('src/js/platform/diagnostics.js');
    const controller = code(read('src/js/platform/index.js'));
    const shell = code(read('src/js/platform/native-shell.js'));
    check(/import\s*\{\s*initializeDiagnostics\s*\}\s*from\s*['"]\.\/diagnostics\.js['"]/.test(controller)
      && /initializeDiagnostics\(\)/.test(controller), 'Diagnostics: initializeDiagnostics must be imported and called by the controller.');
    check(/import\s*\{\s*finishBootstrapTrace\s*\}\s*from\s*['"]\.\/diagnostics\.js['"]/.test(shell)
      && /await SplashScreen\.hide\(\);\s*finishBootstrapTrace\(\)/.test(shell), 'Diagnostics: finishBootstrapTrace must run after SplashScreen.hide succeeds.');
  }

  if (targets.includes('android')) {
    const rootGradle = code(read('android/build.gradle'));
    const appGradle = code(read('android/app/build.gradle'));
    const variables = code(read('android/variables.gradle'));
    const generated = code(read('android/app/capacitor.build.gradle'));
    const registry = json('android/app/src/main/assets/capacitor.plugins.json');
    const classpaths = { ...manifest.android.classpaths, ...(diagnostics ? manifest.diagnostics.androidClasspaths : {}) };
    for (const [coordinate, version] of Object.entries(classpaths)) {
      check(new RegExp(`\\bclasspath\\s+['"]${escape(coordinate)}:${escape(version)}['"]`).test(rootGradle), `Android: missing active classpath ${coordinate}:${version}.`);
    }
    for (const [key, value] of Object.entries({ ...manifest.android.variables, ...(diagnostics ? manifest.diagnostics.androidVariables : {}) })) {
      check(new RegExp(`^\\s*${key}\\s*=\\s*['"]?${escape(value)}['"]?\\s*;?\\s*$`, 'm').test(variables), `Android: ${key} must be ${value} in variables.gradle.`);
    }
    for (const name of Object.keys(plugins)) {
      const project = name.replace(/^@/, '').replace('/', '-');
      check(new RegExp(`implementation\\s+project\\(['"]:${escape(project)}['"]\\)`).test(generated), `Android: ${name} missing from generated dependencies; run cap:sync:android.`);
      check(Array.isArray(registry) && registry.some((plugin) => plugin.pkg === name), `Android: ${name} missing from the generated plugin registry.`);
    }
    if (diagnostics) {
      for (const plugin of ['com.google.gms.google-services', 'com.google.firebase.crashlytics', 'com.google.firebase.firebase-perf']) {
        check(new RegExp(`^\\s*apply plugin:\\s*['"]${escape(plugin)}['"]`, 'm').test(appGradle), `Android: ${plugin} is not applied.`);
      }
      check(/implementation\s+["']com\.google\.firebase:firebase-crashlytics-ndk:\$firebaseCrashlyticsVersion["']/.test(appGradle), 'Android: NDK capture must use the same firebaseCrashlyticsVersion as Crashlytics.');
      const appId = appGradle.match(/\bapplicationId\s*=?\s*['"]([^'"]+)['"]/)?.[1];
      const firebase = json('android/app/google-services.json');
      check(Boolean(appId) && Boolean(firebase.project_info?.project_id)
        && Array.isArray(firebase.client) && firebase.client.some((client) => client.client_info?.android_client_info?.package_name === appId
          && client.client_info?.mobilesdk_app_id?.includes(':android:')), 'Android: google-services.json must contain a Firebase client matching applicationId.');
      const androidManifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
      for (const key of ['firebase_crashlytics_collection_enabled', 'firebase_performance_collection_enabled', 'firebase_performance_collection_deactivated']) {
        const tag = [...androidManifest.matchAll(/<meta-data\b[^>]*>/g)].map(([value]) => value).find((value) => value.includes(`"${key}"`));
        check(!tag || !tag.includes(`android:value="${key.endsWith('deactivated') ? 'true' : 'false'}"`), `Android: ${key} disables diagnostics.`);
      }
    }
  }

  if (targets.includes('ios')) {
    const podfile = code(read('ios/App/Podfile'));
    const podLock = read('ios/App/Podfile.lock');
    check(podLock === read('ios/App/Pods/Manifest.lock'), 'iOS: Pods are out of sync with Podfile.lock.');
    check(new RegExp(`platform\\s*:ios,\\s*['"]${escape(manifest.ios.deploymentTarget)}['"]`).test(podfile), `iOS: Podfile deployment target must be ${manifest.ios.deploymentTarget}.`);
    const registry = json('ios/App/App/capacitor.config.json');
    for (const [name, [pod, className]] of Object.entries(plugins)) {
      check(new RegExp(`^\\s*pod\\s+['"]${pod}['"]`, 'm').test(podfile), `iOS: ${pod} missing from Podfile.`);
      const expectedVersion = json(`node_modules/${name}/package.json`).version;
      check(new RegExp(`^  - ${pod} \\(${escape(expectedVersion)}\\)`, 'm').test(podLock), `iOS: ${pod} missing or stale in Podfile.lock.`);
      check(registry.packageClassList?.includes(className), `iOS: ${className} missing from generated Capacitor registration; sync iOS.`);
    }
    const project = plist('ios/App/App.xcodeproj/project.pbxproj');
    const objects = project.objects ?? {};
    const app = Object.values(objects).find((object) => object.isa === 'PBXNativeTarget' && object.name === 'App');
    const projectObject = objects[project.rootObject];
    check(Boolean(app), 'iOS: expected the CocoaPods App target in project.pbxproj.');
    const projectConfigs = objects[projectObject?.buildConfigurationList]?.buildConfigurations ?? [];
    const appConfigs = objects[app?.buildConfigurationList]?.buildConfigurations ?? [];
    check(appConfigs.length > 0, 'iOS: App build configurations are missing.');
    const settings = appConfigs.map((id) => {
      const config = objects[id];
      const parent = projectConfigs.map((key) => objects[key]).find((entry) => entry.name === config?.name);
      return { ...parent?.buildSettings, ...config?.buildSettings };
    });
    const phases = (app?.buildPhases ?? []).map((id) => objects[id]);
    if (diagnostics) {
      const delegate = code(read('ios/App/App/AppDelegate.swift'));
      check(/\bimport FirebaseCore\b/.test(delegate) && /\bFirebaseApp\.configure\(\)/.test(delegate), 'iOS: AppDelegate must initialize FirebaseCore.');
      const firebase = plist('ios/App/App/GoogleService-Info.plist');
      check(Boolean(firebase.PROJECT_ID) && firebase.GOOGLE_APP_ID?.includes(':ios:')
        && settings.length > 0 && settings.every((config) => config.PRODUCT_BUNDLE_IDENTIFIER === firebase.BUNDLE_ID), 'iOS: Firebase plist must match the App bundle identifier in every configuration.');
      check(phases.some((phase) => phase?.isa === 'PBXResourcesBuildPhase' && phase.files?.some((id) => {
        const ref = objects[objects[id]?.fileRef];
        return ref?.path === 'GoogleService-Info.plist';
      })), 'iOS: GoogleService-Info.plist must be in App Copy Bundle Resources.');
      for (const pod of ['FirebaseCrashlytics', 'FirebasePerformance']) {
        check(new RegExp(`^  - ${pod} \\(${escape(manifest.diagnostics.iosSdkVersion)}\\)`, 'm').test(podLock), `iOS: ${pod} must resolve to ${manifest.diagnostics.iosSdkVersion}.`);
      }
      const info = plist('ios/App/App/Info.plist');
      check(info.FirebaseCrashlyticsCollectionEnabled !== false && info.firebase_performance_collection_enabled !== false
        && info.firebase_performance_collection_deactivated !== true, 'iOS: Info.plist disables diagnostic collection.');
      check(settings.length > 0 && settings.every((config) => config.DEBUG_INFORMATION_FORMAT === 'dwarf-with-dsym'), 'iOS: every App configuration must generate DWARF with dSYM.');
      const phase = phases.at(-1);
      check(phase?.isa === 'PBXShellScriptBuildPhase' && code(phase.shellScript ?? '').includes('"${PODS_ROOT}/FirebaseCrashlytics/run"')
        && Number(phase.runOnlyForDeploymentPostprocessing ?? 0) === 0, 'iOS: the final App build phase must run FirebaseCrashlytics/run for normal builds.');
      const inputs = (phase?.inputPaths ?? []).map(normalizePath);
      for (const input of dsymInputs) check(inputs.includes(input), `iOS: Crashlytics input missing: ${input}`);
      if (settings.some((config) => config.ENABLE_USER_SCRIPT_SANDBOXING === 'YES' && config.ENABLE_DEBUG_DYLIB === 'YES')) {
        check(inputs.includes('${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}.debug.dylib'), 'iOS: sandboxed debug dylib builds require the debug dylib dSYM input.');
      }
    }
  }

  if (targets.some((target) => target !== 'web')) {
    const runner = 'scripts/patch-native-ad-events.mjs';
    if (read(runner)) {
      const result = run(process.execPath, [runner, '--check'], { cwd: root, encoding: 'utf8' });
      check(result.status === 0 && !result.error && !result.signal, 'Native ad patches are missing, drifted, or could not be checked; run the project patch workflow.');
    }
  }
  return { errors, checks };
}

function main() {
  const { values } = parseArgs({ options: { targets: { type: 'string' }, diagnostics: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: barsuk-verify-plugins --targets android,ios [--diagnostics]\nRun from the game root after install and sync. Supports web, Android Groovy and iOS CocoaPods App on macOS. Read-only; no build/device/console proof.');
    return;
  }
  const result = verifyPluginSetup({ root: process.cwd(), targets: values.targets?.split(','), diagnostics: values.diagnostics });
  for (const error of result.errors) console.error(`FAIL: ${error}`);
  console.log(`${result.errors.length ? 'FAILED' : 'PASSED'}: ${result.checks} source/dependency checks, ${result.errors.length} errors. No native build, device or Firebase delivery was verified.`);
  process.exitCode = result.errors.length ? 1 : 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
