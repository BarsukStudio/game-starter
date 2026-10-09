import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isNative } from './env.js';

// Native startup owns collection, independently of CAS availability. Firebase
// consent settings still govern storage and advertising use of these events.
export function logNativeAnalytics(event) {
  if (!isNative) return;
  void Promise.resolve().then(() => FirebaseAnalytics.logEvent(event))
    .catch(() => console.warn('Native Analytics event delivery failed'));
}
