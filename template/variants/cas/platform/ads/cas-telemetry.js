import { logNativeAnalytics } from '../native-analytics.js';
import { isNative, nativePlatform } from '../env.js';

const EVENTS = new Set([
  'bs_banner_request', 'bs_banner_loaded', 'bs_banner_error',
  'bs_ad_load_request', 'bs_ad_loaded', 'bs_ad_load_failed',
  'bs_ad_show_request', 'bs_ad_shown', 'bs_ad_show_failed', 'bs_ad_closed', 'bs_ad_reward_earned',
]);
const ERROR_CODES = new Set(['NOT_FOREGROUND', 'NOT_INITIALIZED', 'NOT_READY', 'UNAVAILABLE',
  'UNIMPLEMENTED', 'INVALID_ARGUMENT', 'INVALID_CONTEXT', 'BUSY', 'DESTROYED', 'SHOW_FAILED']);

function errorCode(error) {
  const code = error?.code;
  if ((typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 9999)
    || (typeof code === 'string' && /^\d{1,4}$/.test(code))) return String(code);
  return ERROR_CODES.has(code) ? code.toLowerCase() : 'unknown';
}

export function recordCasAdEvent(name, { format, testMode, requestId, showId, loadScope, error, errorSource } = {}) {
  if (!isNative || !EVENTS.has(name) || !['banner', 'interstitial', 'rewarded'].includes(format)) return;
  const params = {
    schema_revision: 1, native_platform: nativePlatform, ad_provider: 'cas', ad_format: format,
    test_ads: testMode === true ? 1 : testMode === false ? 0 : -1,
  };
  if (typeof requestId === 'string' && requestId.length <= 100) params.ad_request_id = requestId;
  if (typeof showId === 'string' && showId.length <= 100) params.ad_show_id = showId;
  if (['app_request', 'sdk_autoload'].includes(loadScope)) params.load_scope = loadScope;
  if (error) params.error_code = errorCode(error);
  if (['load_call', 'load_callback', 'show_call', 'show_callback'].includes(errorSource)) params.error_source = errorSource;
  // Callback observations are not SDK network-request totals. Never retry Analytics delivery.
  logNativeAnalytics({ name, params });
}
