// A store that records what it was asked to do, for a consumer whose
// capabilities the test decides. Everything it needs comes from the recorder the
// fixture installs, so a case and its controls read the same one.
export function ask(what) {
  globalThis.__conformanceStore?.asked.push(what);
}

export function can(capability) {
  return globalThis.__conformanceStore?.capabilities?.[capability] === true;
}
