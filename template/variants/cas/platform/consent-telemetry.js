import { logNativeAnalytics } from './native-analytics.js';
import { isNative, nativePlatform } from './env.js';

// Only fixed event names and bounded diagnostic fields leave the device.
// Firebase supplies app version and installation identity. Collection settings
// remain owned by the app/SDK; telemetry never changes consent or enables it.
function send(name, params) {
  if (!isNative) return;
  logNativeAnalytics({
    name,
    params: { schema_revision: 1, native_platform: nativePlatform, ...params },
  });
}

function errorCode(error) {
  const code = error?.code;
  if ((typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 9999)
    || (typeof code === 'string' && /^\d{1,4}$/.test(code))) return String(code);
  if (['UNIMPLEMENTED', 'UNAVAILABLE', 'NOT_FOREGROUND', 'NOT_INITIALIZED', 'INVALID_CONTEXT',
    'INVALID_ARGUMENT', 'NATIVE_ERROR', 'BUSY', 'DESTROYED', 'NOT_READY', 'SHOW_FAILED',
    'networkError', 'internalError', 'invalidContext', 'stillPresenting', 'unavailable'].includes(code)) return code.toLowerCase();
  // Stock bridges sometimes put the entire error message in code, or omit it.
  return 'unknown';
}

export function beginConsentTelemetry(flow) {
  const prefix = flow === 'privacy' ? 'bs_privacy' : 'bs_consent';
  const started = performance.now();
  let finished = false;
  send(`${prefix}_start`, {});
  return ({ stage, error, failed = false, canRequestAds }) => {
    if (finished) return;
    finished = true;
    const params = { stage, duration_ms: Math.max(0, Math.round(performance.now() - started)) };
    if (failed) params.error_code = errorCode(error);
    if (typeof canRequestAds === 'boolean') params.can_request_ads = Number(canRequestAds);
    send(`${prefix}_${failed ? 'error' : 'complete'}`, params);
  };
}

export function recordCasInitialization(result, error) {
  const params = { state: error ? 'bridge_error' : result?.initialized ? 'ready' : 'sdk_not_ready' };
  if (error) params.error_code = errorCode(error);
  else if (result?.error) params.error_code = 'sdk_error';
  send('bs_cas_init_state', params);
}

// Measurement contract (native builds containing schema_revision=1 only):
// - bs_consent_start -> bs_consent_complete | bs_consent_error, once per launch.
// - bs_cas_init_state reports bridge errors and SDK state independently.
//   An unknown consent status leaves the consent outcome unobserved.
// - bs_privacy_start -> bs_privacy_complete | bs_privacy_error, per accepted open.
// Failure rate = error event count / start event count within the same versions,
// platform and date range. Affected-user share = users with error / users with
// start (deduplicate users; never sum daily unique-user counts).
// can_request_ads=0 means ineligible, not necessarily a user's rejection.
// Missing terminal events are unknown outcomes, not assumed failures. Delivery
// is best effort and respects existing Analytics collection settings; observed
// rates cover reporting installations only. Register stage/error_code as GA4
// custom dimensions for report breakdowns, or query raw BigQuery parameters.
