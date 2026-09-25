import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isNative, nativePlatform } from '../env.js';

const registrations = new WeakMap();
const ADMOB_PRECISION = ['unknown', 'estimated', 'publisher_provided', 'precise'];

function text(value) {
  return typeof value === 'string' ? value.slice(0, 100) : '';
}

// Custom fields deliberately do not feed Firebase's standard ad revenue totals.
// A callback ID identifies our observation, not an SDK-guaranteed impression ID.
export function revenueParameters(provider, format, payload, testAds) {
  const params = {
    schema_revision: 1,
    ad_provider: provider,
    ad_format: format,
    test_ads: testAds ? 1 : 0,
    revenue_status: 'missing',
    revenue_precision: 'unknown',
    ad_unit_id: text(payload?.adUnitId),
  };
  let amount;
  let currency;
  if (provider === 'admob') {
    const micros = payload?.valueMicros;
    if (micros !== undefined && micros !== null) {
      if (typeof micros !== 'number' || !Number.isSafeInteger(micros) || micros < 0) {
        params.revenue_status = 'invalid';
        return params;
      }
      amount = micros / 1e6;
    }
    currency = payload?.currencyCode;
    params.revenue_precision = ADMOB_PRECISION[payload?.precision] ?? 'unknown';
    params.ad_network = text(payload?.networkName);
  } else if (provider === 'yandex') {
    let data;
    if (payload?.impressionData == null) return params;
    try {
      data = JSON.parse(payload.impressionData);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid ILRD');
    } catch (_) {
      params.revenue_status = 'invalid';
      return params;
    }
    if (data.revenue !== undefined && data.revenue !== null) {
      // Yandex documents decimal strings; never coerce empty/null into zero.
      if (typeof data.revenue !== 'string' || !/^\d+(?:\.\d+)?$/.test(data.revenue)) {
        params.revenue_status = 'invalid';
        return params;
      }
      amount = Number(data.revenue);
    }
    currency = data.currency;
    params.revenue_precision = ['estimated', 'publisher_defined'].includes(data.precision)
      ? data.precision : 'unknown';
    params.ad_network = text(data.network?.name);
  }
  if (amount === undefined) return params;
  if (!Number.isFinite(amount) || amount < 0 || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    params.revenue_status = 'invalid';
    return params;
  }
  params.revenue_status = 'reported';
  params.revenue_amount = amount;
  params.revenue_currency = currency;
  return params;
}

export async function bindAdRevenueEvents(plugin, provider, events, testAds) {
  if (!isNative || nativePlatform !== 'android') return;
  let bound = registrations.get(plugin);
  if (!bound) registrations.set(plugin, bound = new Map());
  await Promise.all(Object.entries(events).map(async ([format, event]) => {
    if (bound.has(event)) return bound.get(event);
    const registration = Promise.resolve().then(() => plugin.addListener(event, (payload) => {
      // No retry: a rejected bridge Promise does not prove Firebase rejected the event.
      void Promise.resolve().then(() => FirebaseAnalytics.logEvent({
        name: 'bs_ad_revenue',
        params: {
          ...revenueParameters(provider, format, payload, testAds),
          callback_id: globalThis.crypto.randomUUID(),
        },
      })).catch(() => console.warn('Ad revenue telemetry delivery failed'));
    })).catch(() => {
      bound.delete(event);
      console.warn('Ad revenue telemetry listener unavailable');
    });
    bound.set(event, registration);
    await registration;
  }));
}
