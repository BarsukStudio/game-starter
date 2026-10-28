// Measures whether the device time zone separates regions better than the
// locale that routes native ads today.
import { setNativeUserProperty } from './native-analytics.js';

// The device's named IANA zone (Europe/Kyiv, Europe/Simferopol), refreshed each
// launch. Stored raw: Europe/Kiev and Europe/Kyiv are folded in analysis, not here.
// A user property holds at most 36 characters, and every IANA name fits.
export function recordDeviceTimeZone() {
  let zone = '';
  try { zone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (_) {}
  if (zone) setNativeUserProperty('bs_time_zone', zone);
}
