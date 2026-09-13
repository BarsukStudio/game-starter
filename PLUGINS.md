# Plugin installation and verification

Use this recipe when creating a consumer or deliberately updating its SDKs.
The version owner is [template/plugins-manifest.json](template/plugins-manifest.json).
It records a local-build reference set, not device/store certification. Never use
`latest`. Existing games may intentionally pin older sets; report differences
and review their upgrade separately instead of changing versions to make a check pass.

This guide supports the starter's current `src/js/platform` layout, Android
Groovy Gradle files and an iOS CocoaPods workspace with target `App`. It is not a
generic installer for arbitrary Xcode projects, Kotlin DSL, SPM or Electron/Tauri.

## Select what is being installed

| Manifest section | When to use |
| --- | --- |
| `platform.dependencies`, `platform.devDependencies` | Every consumer of the current full platform template, including its web builds |
| `android.dependencies`, `android.devDependencies` | Android target |
| `ios.dependencies`, `ios.devDependencies` | iOS target |
| `diagnostics.dependencies` | Optional Firebase bundle: Analytics, Crashlytics, Performance and app configuration |

The current bridge imports the app-shell and ad adapters; even web builds of
this template must resolve their npm packages. Disabling ads or providing an
empty purchase catalogue changes runtime behavior, not npm dependency resolution.
A browser prototype that does not use this platform template does not need its
Capacitor packages. Separating all existing adapters into dependency-free feature
packages is outside this recipe.

Firebase is different: the base template never imports `diagnostics.js`. A
consumer without diagnostics omits that file, its test and the two lifecycle
edits below. Do not import a Firebase module and rely on `isNative` to avoid
installing its dependencies; the bundler still resolves imports.

## 1. Dependencies and source files

1. Keep the starter pinned by exact SHA as a devDependency (see [README](README.md#install)).
   For a new version of this recipe, update to a starter artifact containing it.
2. Merge the selected manifest sections into the game's `package.json`, preserving
   existing scripts and unrelated dependencies. Keep runtime SDKs in `dependencies`.
   Run `npm install` and retain `package-lock.json`.
3. Copy the platform/build template and supply the game-owned `config.js`,
   `debug.js` and `scripts/build.config.mjs` declared in `template/manifest.js`.
   Use the existing schema and conformance checks; the SDK recipe does not replace
   the platform contract or the game's purchase-delivery integration.
4. For new mobile targets only, initialize `capacitor.config.json` with the game's
   own identity/web output and run `npx cap add android` and/or `npx cap add ios`.
   Do not run `cap add` over existing targets or replace published app identities.

Read the installed version table without duplicating it in another document:

```sh
node -p "JSON.stringify(require('@barsuk/game-starter/template/plugins-manifest'), null, 2)"
```

In the snippets below, `<section.key>` means **replace it with the corresponding
manifest value**. These placeholders are not valid Gradle/Ruby syntax. Merge into
existing blocks; never overwrite an entire native file with a snippet.

## 2. Native advertising and purchases

- Put the game's ad units, provider policy, store links and product catalogue in
  its platform config. Register the real products in each store separately.
- Android AdMob needs the game's AdMob application ID in the application manifest:
  `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/admob_app_id" />`.
  Define `admob_app_id` in `res/values/strings.xml`. This is an AdMob application
  ID, not an ad unit or Firebase app ID.
- iOS needs that platform's AdMob application ID under `GADApplicationIdentifier`
  in `Info.plist`. Configure the current SKAdNetwork entries and tracking usage
  description according to the SDKs and the game's ATT/consent flow. Provider
  consent and ATT are separate flows; copying IDs or policy from another game
  is not part of installation.
- Mediation is game-owned. Choose the actual enabled networks and mappings.
  Put Android adapter dependencies in `BUILD_CONFIG.android.moduleGradleDependencies`
  so `cap:sync:android` reapplies them. Put iOS mediation pods in `target 'App'`
  **outside** `def capacitor_pods`, which Capacitor regenerates. Preserve the
  lockfile. Do not resurrect disabled adapters or copy stale `OTHER_LDFLAGS`.
  Mediation network choice, versions and dashboard mappings are not certified by
  the plugin verifier.
- Copy `template/scripts/patch-native-ad-events.mjs` and its entire adjacent
  `patches/` directory together. Merge its invocation into `postinstall` and
  `prebuild`, retaining existing hooks. The runner needs Git and the game root:

  ```sh
  node scripts/patch-native-ad-events.mjs
  node scripts/patch-native-ad-events.mjs --check
  ```

  A failed applicability check blocks native builds. Do not edit `node_modules`
  manually or turn the failure into a warning. Existing games can carry additional
  approved patches; preserve them. Banner geometry patches are shell-specific;
  decide from the intended safe area/navigation behavior, not by copying Gym blindly.

For Android, merge `android.classpaths` and `android.variables` from the manifest.
The Kotlin plugin classpath is needed by the native ad stack. Keep root Gradle
classpath injections in `BUILD_CONFIG.android.rootGradleClasspaths` as well.
For iOS, set the Podfile deployment target from `ios.deploymentTarget`; align the
App target deployment setting in Xcode. Native SDKs are registered by the sync in step 4.

## 3. Optional Firebase diagnostics

### JavaScript wiring

After installing `diagnostics.dependencies`, copy:

| Source | Game destination |
| --- | --- |
| `template/platform/diagnostics.js` | `src/js/platform/diagnostics.js` |
| `template/scripts/diagnostics-test.mjs` | `scripts/diagnostics-test.mjs` |

In `src/js/platform/index.js`, import `initializeDiagnostics` from
`./diagnostics.js` and call it at the beginning of `createPlatformController()`.
Keep the existing controller method list unchanged. In `native-shell.js`, import
`finishBootstrapTrace` from `./diagnostics.js` and use:

```js
export async function hideSplashScreen() {
  await SplashScreen.hide();
  finishBootstrapTrace();
}
```

`js_bootstrap` ends at successful splash hiding; `js_duration_ms` measures the JS
elapsed time. Neither measures first paint, ad readiness or gameplay FPS. JS
errors are non-fatal reports with bounded deduplication; native SDK failures are
consumed so diagnostics do not block gameplay. Web/portal execution sends no
diagnostic calls through this module.

The existing diagnostic test covers the copied transport with fake SDKs. In a
consumer's platform-conformance fixtures, supply the browser's `addEventListener`
surface (for example an `EventTarget`), since the real controller now registers
handlers. Keep the real controller under test; do not replace it with a stub.

### Android

1. Register the **existing Android applicationId** in the intended Firebase project.
   Download `google-services.json` to `android/app/google-services.json`. Do not
   edit the identity to fit a downloaded file.
2. Merge `diagnostics.androidVariables` into `android/variables.gradle`:

   ```gradle
   firebaseCrashlyticsVersion = '<diagnostics.androidVariables.firebaseCrashlyticsVersion>'
   firebasePerfVersion = '<diagnostics.androidVariables.firebasePerfVersion>'
   ```

3. Merge `diagnostics.androidClasspaths` into `android/build.gradle`'s buildscript
   dependencies **and** `BUILD_CONFIG.android.rootGradleClasspaths.lines`:

   ```gradle
   classpath 'com.google.firebase:firebase-crashlytics-gradle:<diagnostics.androidClasspaths.com.google.firebase:firebase-crashlytics-gradle>'
   classpath 'com.google.firebase:perf-plugin:<diagnostics.androidClasspaths.com.google.firebase:perf-plugin>'
   ```

   Google Services is already listed under `android.classpaths`; retain it.
4. In `android/app/build.gradle`, apply:

   ```gradle
   apply plugin: 'com.google.gms.google-services'
   apply plugin: 'com.google.firebase.crashlytics'
   apply plugin: 'com.google.firebase.firebase-perf'
   ```

   Avoid duplicating an existing application of a plugin. Retain the normal
   Capacitor generated dependencies. Add this to the app dependencies:

   ```gradle
   implementation "com.google.firebase:firebase-crashlytics-ndk:$firebaseCrashlyticsVersion"
   ```

   The Capacitor plugins own the Java Crashlytics and Performance SDK dependencies.
   Remove obsolete direct declarations of those SDKs when migrating an existing
   integration. NDK capture does not provide symbols for third-party `.so` files;
   symbolication needs their actual unstripped symbols and separate upload setup.
5. Keep collection enabled for this profile. Check that AndroidManifest metadata
   or application code does not disable Crashlytics/Performance. The Performance
   Gradle plugin adds HTTP instrumentation; upgrading from SDK-only monitoring
   changes what is collected.

### iOS (CocoaPods)

1. Register the **App target's bundle identifier** in the intended Firebase project.
   Download `GoogleService-Info.plist` into `ios/App/App/`. In Xcode, add it to the
   App target and verify it appears under **Copy Bundle Resources**. A file on disk
   alone is insufficient; a test device must receive it inside the application.
2. `cap sync ios` in step 4 generates the Capacitor Firebase pod entries. Keep this
   additional Analytics subspec inside `target 'App'`, outside `capacitor_pods`:

   ```ruby
   pod 'CapacitorFirebaseAnalytics/Analytics', :path => '../../node_modules/@capacitor-firebase/analytics'
   ```

   The reference `Podfile.lock` resolves Firebase Crashlytics/Performance to
   `diagnostics.iosSdkVersion`. For reproducible fresh installation, pin those
   two native pods to that value in `target 'App'`, outside `capacitor_pods`.
   Keep `Podfile.lock`; review dependency drift instead of blindly updating pods.
3. In the existing `AppDelegate.swift`, add `import FirebaseCore` and call
   `FirebaseApp.configure()` once in `application(_:didFinishLaunchingWithOptions:)`,
   before the bridge uses Firebase. Preserve the rest of the delegate.
4. In Xcode, set **Debug Information Format → DWARF with dSYM File** for every
   App build configuration, including Debug. Add a Run Script as the **last App
   build phase**, after the CocoaPods phases:

   ```sh
   if [ "${CRASHLYTICS_SKIP_SYMBOL_UPLOAD:-NO}" = "YES" ]; then
     echo "Skipping Crashlytics symbol upload for local validation"
     exit 0
   fi
   "${PODS_ROOT}/FirebaseCrashlytics/run"
   ```

   Add these **Input Files**:

   ```text
   ${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}
   ${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}
   ${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Info.plist
   $(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/GoogleService-Info.plist
   $(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)
   ```

   With both user-script sandboxing and debug dylibs enabled, also add
   `${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${PRODUCT_NAME}.debug.dylib`.
   Do not enable “Run script only when installing”. Keep the phase last after sync.
   `CRASHLYTICS_SKIP_SYMBOL_UPLOAD=YES` is only for local validation; release builds
   must run symbol upload. Do not claim upload verification after a skipped run.
5. Check that `Info.plist` or runtime code does not disable diagnostic collection.
   Review the game's diagnostic-data disclosures before publishing this new SDK set.

## 4. Build, sync and verify

Copy the starter's `cap-sync-android.mjs` with its required game build config and
declare `"cap:sync:android": "node scripts/cap-sync-android.mjs"`. From the game root:

```sh
npm run build
npm run cap:sync:android
npx cap sync ios
```

Run only the selected native targets. Existing release wrappers remain the owner
of production-ad selection; these generic commands do not produce release proof.
After sync inspect generated plugin registration, app identities and preserved
native injections. Never hand-edit `capacitor.build.gradle` as the durable fix.

The verifier ships with the starter; **do not copy it or its version table** into
each game. Once the starter artifact includes this tool, add these npm scripts:

```json
{
  "scripts": {
    "test:plugin-setup": "barsuk-verify-plugins --targets android,ios --diagnostics",
    "test:diagnostics": "node --test scripts/diagnostics-test.mjs"
  }
}
```

Choose `--targets web`, `android`, `ios` or a comma-separated combination. Targets
are explicit: a missing native folder must fail, not silently turn into a web-only
check. Omit `--diagnostics` and the diagnostic test for a consumer without Firebase.
If either diagnostic plugin is declared, the verifier also checks the full bundle.
For a pre-release checkout, run `node /path/to/game-starter/tools/verify-plugin-setup.mjs`
with the same flags **from the game root**, without repinning the game.

The tool verifies reference pins, lockfile/installed metadata, documented native
settings, registrations, Firebase identity, bundle inclusion, dSYM configuration,
JS wiring and the existing ad patch runner's exit status. Missing inputs and failed
checks exit nonzero. iOS inspection uses macOS `plutil` to read the Xcode/plist
structure; it does not infer build success by finding a script name in text.
It is a source/metadata preflight, not a Gradle/Swift interpreter, dependency
integrity rehash, signing/certificate audit, mediation validator or network probe.

If the game already uses Passport, **append npm script names** to its existing
`PASSPORT_CONFIG.checks`: `test:plugin-setup` and, when enabled, `test:diagnostics`.
Do not insert shell commands or replace the game's existing checks. Run Passport
with `--verify` to execute them; without it Passport only records metadata.

## 5. Acceptance beyond preflight

- Run the game's required tests and web build. Confirm a consumer without Firebase
  still builds without the optional imports/dependencies.
- Build Android and iOS for the selected native targets. A successful preflight is
  not a native build. Verify dSYM generation separately from successful upload.
- On devices, check startup, ads/consent, reward delivery, purchases/Restore and
  lifecycle for the enabled functions. For Firebase, trigger a controlled JS error
  and a native test crash in a QA build, relaunch without a debugger, and verify the
  reports, readable stacks and `js_bootstrap` in the correct Firebase app.
- Record versions, platforms, evidence and remaining gates in the game's status
  document. Keep account IDs, store state and device results out of this shared guide.
