// Is this value something a game could have written down itself?
//
// The question behind it is narrower than "does it serialize": a debug snapshot
// carrying a live store survives `JSON.stringify` perfectly happily, because
// methods are dropped in silence and a non-enumerable one is invisible to a
// round-trip comparison too. What has to be true is that every value is data —
// no functions, no accessors, no hidden properties, no class instances — because
// any of those is an SDK reaching back through the one door built to keep it out.
const PLAIN_PROTOTYPES = new Set([Object.prototype, Array.prototype, null]);

// A real array index, not merely a key that survives a round trip through
// Number(). `'-1'`, `'NaN'` and `'Infinity'` all do survive one, and none of
// them is an index — an array never iterates them, so a value parked under one
// is invisible to every reader that walks the array itself.
function isArrayIndex(key) {
  if (typeof key !== 'string') return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

export function findNonPlainValue(value, path = '$') {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return null;
  if (type === 'number') {
    return Number.isFinite(value) ? null : `${path} is ${value}, which cannot be written down`;
  }
  // `undefined` reads as a hole: JSON writes it down as null on the way out and
  // as nothing at all inside an object, so it never survives a round trip
  // intact and cannot be part of a reading.
  if (value === undefined) return `${path} is undefined, which cannot be written down`;
  if (type !== 'object') return `${path} is a ${type}`;

  const prototype = Object.getPrototypeOf(value);
  if (!PLAIN_PROTOTYPES.has(prototype)) {
    return `${path} is a ${value.constructor?.name ?? 'class'} instance, not plain data`;
  }

  // An array's own `length` is non-enumerable by construction, so it is walked
  // by index instead — and any key that is not an index is a passenger.
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length' || isArrayIndex(key)) continue;
      return `${path}[${String(key)}] rides along on an array`;
    }
    for (const [index, entry] of value.entries()) {
      const found = findNonPlainValue(entry, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  // Own keys rather than enumerable ones: a method hidden behind
  // `enumerable: false` is exactly how a live handle travels unnoticed.
  for (const key of Reflect.ownKeys(value)) {
    const label = typeof key === 'symbol' ? `${path}[${String(key)}]` : `${path}.${key}`;
    if (typeof key === 'symbol') return `${label} is keyed by a symbol`;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set) return `${label} is an accessor`;
    if (!descriptor.enumerable) return `${label} is hidden behind a non-enumerable descriptor`;
    const found = findNonPlainValue(descriptor.value, label);
    if (found) return found;
  }
  return null;
}

// A `Record<string, T>`: a plain object, never an array, however array-like.
export function isRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && PLAIN_PROTOTYPES.has(Object.getPrototypeOf(value));
}
