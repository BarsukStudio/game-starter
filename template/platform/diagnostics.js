// Native diagnostics only. Web/portal builds never call Crashlytics.
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics';
import { isNative, nativePlatform } from './env.js';

const MAX_REPORTS = 8;
const reported = new Set();
let initialized = false;
let splashHidden = false;

// Every SDK rejection is consumed here: diagnostics must not create another
// unhandled rejection or prevent the game from starting.
async function callSdk(sdk, method, options) {
  try {
    await sdk[method](options);
    return true;
  } catch (error) {
    console.warn(`Native diagnostics ${method} failed`, error);
    return false;
  }
}

function stackFrames(error) {
  if (typeof error?.stack !== 'string') return [];
  return error.stack.split('\n').flatMap((line) => {
    // Android WebView (V8) and WKWebView (JavaScriptCore) stack formats.
    const match = line.trim().match(/^at (.*?) \((.+):(\d+):\d+\)$/)
      || line.trim().match(/^(.*?)@(.+):(\d+):\d+$/)
      || line.trim().match(/^at ()(.+):(\d+):\d+$/);
    if (!match) return [];
    return [{
      functionName: match[1] || '<anonymous>',
      fileName: match[2].split(/[?#]/)[0],
      lineNumber: Number(match[3]),
    }];
  }).slice(0, 32);
}

function reportError(error, source, event) {
  const message = `${source}: ${error?.message || event?.message || String(error ?? 'Unknown error')}`.slice(0, 1024);
  const stacktrace = stackFrames(error);
  if (!stacktrace.length && event?.filename) {
    stacktrace.push({
      functionName: '<anonymous>',
      fileName: event.filename.split(/[?#]/)[0],
      lineNumber: event.lineno || 0,
    });
  }
  const signature = JSON.stringify([message, stacktrace[0]]);
  if (reported.size >= MAX_REPORTS || reported.has(signature)) return;
  reported.add(signature);
  void callSdk(FirebaseCrashlytics, 'recordException', { message, stacktrace });
}

export function initializeDiagnostics() {
  if (!isNative || initialized) return;
  initialized = true;
  window.addEventListener('error', (event) => {
    // Resource-load failures are not JavaScript exceptions.
    if (event.error || event.message) reportError(event.error, 'js_error', event);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'unhandled_rejection');
  });
  void callSdk(FirebaseCrashlytics, 'setCustomKey', {
    key: 'native_platform', value: nativePlatform, type: 'string',
  });
  void callSdk(FirebaseCrashlytics, 'setCustomKey', {
    key: 'game_stage', value: 'js_bootstrap', type: 'string',
  });
}

// The splash is hidden once the game has reached platform initialization, so a
// crash report can tell a startup failure from one during play.
export function markSplashHidden() {
  if (!isNative || !initialized || splashHidden) return;
  splashHidden = true;
  void callSdk(FirebaseCrashlytics, 'setCustomKey', {
    key: 'game_stage', value: 'splash_hidden', type: 'string',
  });
}
