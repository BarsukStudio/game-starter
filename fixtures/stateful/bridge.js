// Module-level state, which is the whole reason the runner gives every case its
// own graph: `calls` survives for as long as this module does.
import { flavour } from './env.js';

let calls = 0;

export function bump() {
  return ++calls;
}

export function count() {
  return calls;
}

export function flavourName() {
  return flavour;
}

// Read at call time, so a case can prove a global was installed for it.
export function globalProbe() {
  return globalThis.__conformanceProbe ?? null;
}

export function userAgent() {
  return globalThis.navigator?.userAgent ?? null;
}
