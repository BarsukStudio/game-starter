import { FacebookAnalytics } from '@capgo/capacitor-facebook-analytics';
import { readConsentSignals, hasMetaConsent } from './consent-signals.js';
import { isNative, nativePlatform } from './env.js';

// Opt-in Meta App Events for paid acquisition: the install and launch signal
// Meta needs to attribute and optimize app install campaigns. Android and iOS
// only.
//
// The native setup removes the SDK's startup provider and turns automatic
// initialization and logging off, so this call is the SDK's only way in. Call it
// only after an AdMob startup that completed, so the consent flow and the iOS
// tracking prompt have run in this launch; an early failure has run neither.
// It reads the stored UMP choices itself: outside GDPR it starts; under GDPR only
// with storage purpose 1 and Meta's Additional Consent; anything unknown keeps
// it off. A refusal or a failure is not cached, so a later call after a retried
// consent flow checks again. Once started, the SDK runs until the process ends,
// so a withdrawn choice takes effect on the next launch. Nothing here throws or
// waits on the network, and nothing blocks ads or gameplay.
let started = false;
let pending = null;

export function startMetaAppEvents() {
  if (!isNative || started) return Promise.resolve(started);
  pending ??= start().finally(() => { pending = null; });
  return pending;
}

async function start() {
  try {
    if (!hasMetaConsent(await readConsentSignals())) return false;
    await FacebookAnalytics.initAppEvents();
    started = true;
    // With automatic logging off, facebook-core drops its own launch event (the
    // install ping still goes out), so Android logs it explicitly. FBSDKCoreKit
    // already logs it as an explicit event; logging it again would double it.
    if (nativePlatform === 'android') await FacebookAnalytics.logEvent({ event: 'fb_mobile_activate_app' });
  } catch (error) {
    console.warn('Meta App Events start failed', error);
  }
  return started;
}
