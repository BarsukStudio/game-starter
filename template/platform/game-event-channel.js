// The game's semantic events, bounded before any transport sees them.
//
// The game owns their meaning: the event names, the fields each one carries,
// which ones count once per launch, and the moments it emits them. This module
// owns what every game shares — the `bs_` prefix, the schema revision on every
// event, the value rules and the Analytics limits — so a declared schema cannot
// produce an event Analytics drops or truncates without telling anyone.
//
// It imports no SDK and decides no consent or platform. The entry module
// subscribes the native transport before the game module loads, so no early
// event is missed; that transport sends nothing outside Android and iOS.
const PREFIX = 'bs_';
const NAME = /^[a-z][a-z0-9_]*$/;
// Analytics limits: 40 characters per event or parameter name, 25 parameters
// per event, 100 characters per string value. Past them an event is dropped or a
// value cut short, and no error reaches the app.
const MAX_NAME = 40;
const MAX_PARAMS = 25;
const MAX_VALUE = 100;
// Prefixes Analytics reserves for its own parameters; event names are safe
// behind `bs_`.
const RESERVED = /^(?:firebase_|google_|ga_)/;
// Without a declared pattern a string value is a short lowercase token — an id
// the game chose, never free text.
const TOKEN = /^[a-z0-9_-]{1,40}$/;

// A malformed declaration is a programming error. It throws when the game's
// events module is first imported, so the game's own tests fail before a build
// rather than a release losing the event.
export function createGameEventChannel({ schemaRevision, events, oncePerLaunch = [], valuePatterns = {} }) {
  if (!Number.isInteger(schemaRevision) || schemaRevision < 1) {
    throw new TypeError('Game events: schemaRevision must be a positive integer.');
  }
  // Maps, not object lookups: an inherited name such as `constructor` must not
  // count as declared, and Object.hasOwn needs Chrome 93 while older Android
  // WebViews still run games.
  const fields = new Map();
  for (const [name, keys] of Object.entries(events)) {
    if (!NAME.test(name) || PREFIX.length + name.length > MAX_NAME) {
      throw new TypeError(`Game events: invalid event name ${name}.`);
    }
    if (!Array.isArray(keys) || keys.length >= MAX_PARAMS || new Set(keys).size !== keys.length
      || keys.some((key) => typeof key !== 'string' || !NAME.test(key) || key.length > MAX_NAME
        || RESERVED.test(key) || key === 'schema_revision')) {
      throw new TypeError(`Game events: invalid fields for ${name}.`);
    }
    fields.set(name, Object.freeze([...keys]));
  }
  const once = new Set(oncePerLaunch);
  for (const name of once) {
    if (!fields.has(name)) throw new TypeError(`Game events: once-per-launch event ${name} is not declared.`);
  }
  const patterns = new Map(Object.entries(valuePatterns));
  for (const [key, pattern] of patterns) {
    // A global or sticky pattern keeps lastIndex between tests and would reject
    // every other valid value.
    if (!(pattern instanceof RegExp) || pattern.global || pattern.sticky) {
      throw new TypeError(`Game events: the pattern for ${key} must be a non-global RegExp.`);
    }
  }
  const listeners = new Set();
  const sent = new Set();

  function subscribeGameEvents(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Returns whether the event was published. An undeclared event, a repeated
  // once-per-launch event or any field outside the rules sends nothing: a partial
  // event would count in a funnel without the context that makes it readable.
  function emitGameEvent(name, values) {
    const keys = fields.get(name);
    if (!keys || sent.has(name)) return false;
    const params = { schema_revision: schemaRevision };
    for (const key of keys) {
      const value = values?.[key];
      if (typeof value === 'string' && value.length <= MAX_VALUE && (patterns.get(key) ?? TOKEN).test(value)) params[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) params[key] = value;
      else return false;
    }
    if (once.has(name)) sent.add(name);
    const event = Object.freeze({ name: PREFIX + name, params: Object.freeze(params) });
    for (const listener of listeners) {
      try { listener(event); } catch { /* Analytics never interrupts gameplay. */ }
    }
    return true;
  }

  return { emitGameEvent, subscribeGameEvents };
}
