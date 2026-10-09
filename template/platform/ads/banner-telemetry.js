import { createRequestId } from '../request-id.js';
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isNative, nativePlatform } from '../env.js';

// These are app-load diagnostics, not impressions or SDK network-request counts.
// SDK refresh failures have no app request ID; stock callbacks cannot correlate
// overlapping native requests. Never use these counts as AdMob report totals.
export function createBannerTelemetry(provider, testAds) {
  let active = false;
  let outcome = 'idle';
  let requestId;
  let scope = 'app_request';
  let retry = 0;
  let exhausted = false;
  function send(name, fields = {}) {
    if (!isNative) return;
    const params = {
      schema_revision: 1, native_platform: nativePlatform,
      ad_provider: provider, ad_format: 'banner', test_ads: testAds ? 1 : 0,
      retry_count: retry, load_scope: scope,
      ...(requestId ? { banner_request_id: requestId } : {}), ...fields,
    };
    // Telemetry cannot delay ads; failure is unknown delivery, never retried.
    void Promise.resolve().then(() => FirebaseAnalytics.logEvent({ name, params })).catch(() => {});
  }
  return {
    request(count = 0) {
      active = true;
      outcome = 'pending';
      retry = count;
      exhausted = false;
      // An observation ID only, not an SDK impression/request identifier.
      scope = 'app_request';
      try { requestId = createRequestId(); } catch (_) { requestId = undefined; }
      send('bs_banner_request');
    },
    loaded() {
      if (!active || outcome === 'loaded') return;
      outcome = 'loaded';
      send('bs_banner_loaded');
      requestId = undefined;
      scope = 'sdk_refresh';
      retry = 0;
      exhausted = false;
    },
    failed(error, source) {
      if (!active || outcome === 'failed') return;
      outcome = 'failed';
      const raw = error?.code;
      const code = (typeof raw === 'number' || typeof raw === 'string')
        && /^-?\d{1,6}$/.test(String(raw)) ? String(raw)
        : ['UNAVAILABLE', 'UNIMPLEMENTED', 'ADS_RESET'].includes(raw) ? raw : 'unknown';
      send('bs_banner_error', { error_code: code, error_source: source });
    },
    retryScheduled(count, delay) {
      if (active) send('bs_banner_retry', { retry_count: count, delay_ms: delay });
    },
    retryExhausted() {
      if (!active || exhausted) return;
      exhausted = true;
      send('bs_banner_retry_exhausted');
    },
    stop() {
      active = false;
      requestId = undefined;
    },
  };
}
