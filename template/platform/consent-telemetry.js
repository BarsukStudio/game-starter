import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isNative, nativePlatform } from './env.js';

// Only fixed event names and bounded diagnostic fields leave the device.
// Firebase supplies app version and installation identity. Collection settings
// remain owned by the app/SDK; telemetry never changes consent or enables it.
function send(name, params) {
  if (!isNative) return;
  void Promise.resolve().then(() => FirebaseAnalytics.logEvent({
    name,
    params: { schema_revision: 1, native_platform: nativePlatform, ...params },
  })).catch(() => {}); // A diagnostics failure must not become a consent failure.
}

function errorCode(error) {
  const code = error?.code;
  if ((typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 9999)
    || (typeof code === 'string' && /^\d{1,4}$/.test(code))) return String(code);
  if (code === 'UNIMPLEMENTED' || code === 'UNAVAILABLE') return code.toLowerCase();
  // Stock bridges sometimes put the entire error message in code, or omit it.
  return 'unknown';
}

export function beginConsentTelemetry(flow) {
  const prefix = flow === 'privacy' ? 'bs_privacy' : 'bs_consent';
  const started = performance.now();
  let finished = false;
  send(`${prefix}_start`, {});
  return ({ stage, error, failed = false, canRequestAds, attemptCount }) => {
    if (finished) return;
    finished = true;
    const params = { stage, duration_ms: Math.max(0, Math.round(performance.now() - started)) };
    if (Number.isInteger(attemptCount)) params.attempt_count = attemptCount;
    if (failed) params.error_code = errorCode(error);
    if (typeof canRequestAds === 'boolean') params.can_request_ads = Number(canRequestAds);
    send(`${prefix}_${failed ? 'error' : 'complete'}`, params);
  };
}

// One terminal observation per UMP attempt; the original start/terminal pair
// remains once per launch. Never count retries as additional launch failures.
export function recordConsentAttempt({ attempt, stage, failed = false, error, canRequestAds, willRetry = false }) {
  send('bs_consent_attempt', {
    attempt, stage, outcome: failed ? 'error' : 'complete',
    can_request_ads: Number(canRequestAds === true), will_retry: Number(willRetry),
    ...(failed ? { error_code: errorCode(error) } : {}),
  });
}

// A preference-read failure is separate from UMP failure: ads may still be
// eligible, but Yandex must retain false consent when its signals are unknown.
export function recordConsentSignalsError(error) {
  send('bs_consent_signals_error', { stage: 'signals_read', error_code: errorCode(error) });
}

// Measurement contract (native builds containing schema_revision=1 only):
// - bs_consent_attempt records each attempt; attempt_count is on the final result.
// - bs_consent_start -> bs_consent_complete | bs_consent_error, once per launch.
// - bs_privacy_start -> bs_privacy_complete | bs_privacy_error, per accepted open.
// - bs_consent_signals_error is auxiliary, not a failed UMP flow.
// Failure rate = error event count / start event count within the same versions,
// platform and date range. Affected-user share = users with error / users with
// start (deduplicate users; never sum daily unique-user counts).
// can_request_ads=0 means ineligible, not necessarily a user's rejection.
// Missing terminal events are unknown outcomes, not assumed failures. Delivery
// is best effort and respects existing Analytics collection settings; observed
// rates cover reporting installations only. Register stage/error_code as GA4
// custom dimensions for report breakdowns, or query raw BigQuery parameters.
