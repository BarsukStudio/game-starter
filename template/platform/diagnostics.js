// Native diagnostics only. Web/portal builds never call either Firebase SDK.
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics';
import { FirebasePerformance } from '@capacitor-firebase/performance';
import { isNative, nativePlatform } from './env.js';

const BOOT_TRACE = 'js_bootstrap';
const MAX_REPORTS = 8;
const reported = new Set();
let initialized = false;
let bootFinished = false;
let bootStartedAt = 0;
let bootTrace;

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
  bootStartedAt = performance.now();
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
  bootTrace = callSdk(FirebasePerformance, 'startTrace', { traceName: BOOT_TRACE });
}

// The splash is hidden once the game has reached platform initialization.
// This measures that boundary, not ad readiness or the first rendered frame.
export function finishBootstrapTrace() {
  if (!isNative || !initialized || bootFinished) return;
  bootFinished = true;
  const duration = Math.round(performance.now() - bootStartedAt);
  void callSdk(FirebaseCrashlytics, 'setCustomKey', {
    key: 'game_stage', value: 'splash_hidden', type: 'string',
  });
  void (async () => {
    if (!await bootTrace) return;
    // Keep the JS duration even if scheduling on the native bridge was delayed.
    await callSdk(FirebasePerformance, 'putMetric', {
      traceName: BOOT_TRACE, metricName: 'js_duration_ms', num: duration,
    });
    await callSdk(FirebasePerformance, 'stopTrace', { traceName: BOOT_TRACE });
  })();
}
