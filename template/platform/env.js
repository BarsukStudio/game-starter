// Which environment the bundle is actually running in.
//
// One bundle ships to five places — the two native shells and the three web
// targets — and almost every platform decision starts by asking which one this
// is. Hard rule 1 gives this module Capacitor *runtime detection*: it is the
// only place that asks `Capacitor` which platform this is, and the answers are
// read once here, at import time, so the rest of `platform/` shares one reading
// instead of calling again. Other modules may still import their own plugin
// from `@capacitor/core` — `native-shell.js` takes `SystemBars` from it — they
// just do not re-derive the environment.
//
// Nothing here decides policy. It reports facts: the native platform, the web
// target injected by the consumer's web build, and which config key those two
// answers select.
import { Capacitor } from '@capacitor/core';

import { APP_CONFIG, getMobileStoreKey } from './config.js';

const DEFAULT_TARGET = {
  target: 'generic',
  ads: false,
  payments: false,
  sdk: null,
};

// The global the web build writes the target into, named by the consumer. Read
// through config rather than hard-coded here: two games served from one origin —
// a portal build and a dev server — would otherwise read each other's marker,
// and a starter that picked the name would be identifiable in every game cut
// from it.
export const runtimeTarget = window[APP_CONFIG.platform.runtimeTargetGlobal] || DEFAULT_TARGET;
export const nativePlatform = Capacitor.getPlatform();
export const isNative = Capacitor.isNativePlatform();

export function getNativeKey() {
  return nativePlatform === 'android' ? 'android' : 'ios';
}

export function getStoreKey() {
  if (isNative) return getNativeKey();
  return getMobileStoreKey();
}
