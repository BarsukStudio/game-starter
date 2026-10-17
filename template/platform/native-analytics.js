import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isNative } from './env.js';

// The native transport for events composed in JS: game events and advertising
// telemetry. Android and iOS only; the web never calls native Analytics. Each
// event is sent on its own, with no queue, retry or replay, and a synchronous or
// asynchronous failure stops here, so delivery can never interrupt gameplay,
// consent or a reward. Collection and consent settings stay owned by native
// startup and the SDK; nothing here enables or changes them.
export function logNativeAnalytics(event) {
  if (!isNative) return;
  void Promise.resolve().then(() => FirebaseAnalytics.logEvent(event))
    .catch(() => console.warn('Native Analytics event delivery failed'));
}
