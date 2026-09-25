import { registerPlugin } from '@capacitor/core';

// UMP stores its choices in native preferences, not WebView localStorage.
// Read only these keys; never manufacture or persist a consent string here.
const ConsentSignals = registerPlugin('ConsentSignals');
export function readConsentSignals() {
  return ConsentSignals.read();
}

// iOS uses Capacitor's controller directly, without initializing ads to get one.
export function showIosConsentForm() {
  return ConsentSignals.showConsentForm();
}

export function showIosPrivacyOptionsForm() {
  return ConsentSignals.showPrivacyOptionsForm();
}

export function hasYandexConsent(signals) {
  if (signals.gdprApplies === false) return true;
  if (signals.gdprApplies !== true) return false;
  const parts = (signals.additionalConsent ?? '').split('~');
  if (!['1', '2'].includes(parts[0])) return false;
  // ACv2's third segment lists disclosed vendors, not consented ones.
  return parts[1]?.split('.').includes('1033') === true
    && signals.purposeConsents?.[0] === '1';
}
