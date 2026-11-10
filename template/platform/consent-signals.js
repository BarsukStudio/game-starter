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
  return hasProviderConsent(signals, '1033');
}

// Meta App Events: Google's Additional Consent provider 89. Only consumers that
// copy the opt-in meta-app-events.js module call this.
export function hasMetaConsent(signals) {
  return hasProviderConsent(signals, '89');
}

// Outside GDPR, allowed; under GDPR, storage purpose 1 and the provider's
// Additional Consent; an unknown region or unread choices, refused.
function hasProviderConsent(signals, provider) {
  if (signals.gdprApplies === false) return true;
  if (signals.gdprApplies !== true) return false;
  const parts = (signals.additionalConsent ?? '').split('~');
  if (!['1', '2'].includes(parts[0])) return false;
  // ACv2's third segment lists disclosed vendors, not consented ones.
  return parts[1]?.split('.').includes(provider) === true
    && signals.purposeConsents?.[0] === '1';
}
