import { logNativeAnalytics } from '../native-analytics.js';
import { isNative } from '../env.js';

const text = value => typeof value === 'string' ? value.slice(0, 100) : '';
const seenImpressions = new Set();
const MAX_SEEN_IMPRESSIONS = 256;

export function revenueParameters(event) {
  const params = {
    schema_revision: 1,
    ad_provider: 'cas',
    ad_format: event.format,
    test_ads: event.testMode === true ? 1 : event.testMode === false ? 0 : -1,
    revenue_status: event.revenueStatus === 'invalid' ? 'invalid' : 'missing',
    revenue_precision: ['precise', 'floor', 'estimated'].includes(event.revenuePrecision) ? event.revenuePrecision : 'unknown',
    ad_unit_id: text(event.sourceUnitId),
    ad_network: text(event.sourceName),
    callback_id: text(event.eventId),
  };
  if (params.revenue_status === 'invalid' || event.revenue == null) return params;
  if (typeof event.revenue !== 'number' || !Number.isFinite(event.revenue) || event.revenue < 0 || event.currency !== 'USD') {
    params.revenue_status = 'invalid';
    return params;
  }
  params.revenue_status = 'reported';
  params.revenue_amount = event.revenue;
  params.revenue_currency = event.currency;
  return params;
}

export function recordCasImpression(event) {
  if (!isNative || event.type !== 'impression') return;
  if (typeof event.eventId === 'string' && event.eventId) {
    if (seenImpressions.has(event.eventId)) return;
    seenImpressions.add(event.eventId);
    if (seenImpressions.size > MAX_SEEN_IMPRESSIONS) seenImpressions.delete(seenImpressions.values().next().value);
  }
  // Diagnostic observation on both native platforms. CAS/account configuration owns
  // standard ad_impression; never also log it here or substitute cumulative revenueTotal.
  // No retry: a rejected bridge call does not prove Firebase rejected the event.
  logNativeAnalytics({ name: 'bs_ad_revenue', params: revenueParameters(event) });
}
