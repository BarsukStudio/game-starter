import { FacebookAnalytics } from '@capgo/capacitor-facebook-analytics';
import { readConsentSignals, hasMetaConsent } from './consent-signals.js';
import { isNative } from './env.js';

// Opt-in Meta App Events for paid acquisition: the install and launch signal
// Meta needs to attribute and optimize app install campaigns. Android and iOS
// only.
//
// The native setup removes the SDK's startup provider and turns automatic
// initialization and logging off, so this call is the SDK's only way in. Call it
// after the advertising consent flow and the iOS tracking prompt have finished.
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
  } catch (error) {
    console.warn('Meta App Events start failed', error);
  }
  return started;
}
