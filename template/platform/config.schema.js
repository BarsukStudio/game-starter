// What `config.js` must provide, and why each field exists.
//
// The template reads every game-specific value from one consumer module. This
// file is the written half of that seam: it names the fields, and it can check
// a config object against them so a game finds a missing field in its own test
// run rather than at runtime on a device.
//
// Deliberately not imported by any runtime module. A template that validated its
// config on the way up would add a failure mode the game it was cut from never
// had, and would decide for every future consumer that a missing ad unit is
// fatal. Consumers import this from their own tests instead.
//
// Nothing here carries a value. Ids, keys, links and amounts live in the game's
// `config.js` and never in this repository.

// The two store keys the template asks for by name. `getStoreKey()` in `env.js`
// answers one of these, and every per-store map below is keyed by both.
export const STORE_KEYS = Object.freeze(['ios', 'android']);

// The runtime-target marker and the QA storage keys, which are the only globals
// and storage keys the template touches. They are named by the consumer because
// two games sharing one browser profile — a portal build and a local dev server
// on the same origin — would otherwise read each other's QA overrides.
//
// `legacyAdsProviderKeys` may be empty. It exists for a game that once persisted
// a provider override under a name it no longer writes: production clears those
// keys on every start, so an app update repairs a device that still carries one.
// A game with no such history declares `[]` and the loop does nothing.
export const PLATFORM_FIELDS = Object.freeze({
  runtimeTargetGlobal: 'string',
  debugAdsProviderKey: 'string',
  legacyAdsProviderKeys: 'string[]',
});

// A product entry. `id` is what the store knows; `consumable` decides which
// finish path a transaction takes, and it is read in exactly one place so a
// product can never be a consumable in one half of the adapter and a
// non-consumable in the other.
//
// The keys of the catalogue are the game's own vocabulary — how many products it
// sells, what it calls them and what they grant is not the contract's business.
export const PRODUCT_FIELDS = Object.freeze({
  id: 'string',
  consumable: 'boolean',
});

function fail(problems, path, expected, value) {
  problems.push(`${path}: expected ${expected}, got ${describe(value)}`);
}

function describe(value) {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  return typeof value;
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkString(problems, path, value) {
  if (!isFilledString(value)) fail(problems, path, 'a non-empty string', value);
}

function checkBoolean(problems, path, value) {
  if (typeof value !== 'boolean') fail(problems, path, 'a boolean', value);
}

function checkRecord(problems, path, value) {
  const ok = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!ok) fail(problems, path, 'an object', value);
  return ok;
}

function checkAdUnits(problems, path, units) {
  if (!checkRecord(problems, path, units)) return;
  for (const field of ['banner', 'interstitial', 'rewarded']) {
    checkString(problems, `${path}.${field}`, units[field]);
  }
}

function checkCatalogue(problems, path, catalogue) {
  if (!checkRecord(problems, path, catalogue)) return;
  // An empty catalogue is valid, and deliberately so: a game may ship with
  // purchases switched off entirely, and the contract already calls an empty
  // catalogue the honest answer for it rather than a failure — see
  // `products-are-a-map-of-configured-keys-to-store-ids` in
  // `contract/cases/purchases.mjs`, which cites `GAME_PLAYBOOK.md` §10. A schema
  // that demanded one product would contradict the canonical case it exists to
  // serve.
  for (const key of Object.keys(catalogue)) {
    // The key is the name the game speaks — it reaches the shop, the delivery
    // switch and the price map. The contract requires `key.trim()`, so a blank
    // one is a product the game cannot refer to.
    if (!key.trim()) problems.push(`${path}: a product key must be a name, not blank`);
    const product = catalogue[key];
    if (!checkRecord(problems, `${path}.${key}`, product)) continue;
    checkString(problems, `${path}.${key}.id`, product.id);
    checkBoolean(problems, `${path}.${key}.consumable`, product.consumable);
  }
}

// Answers the problems it found, never throws: a caller collecting them can
// report every missing field at once instead of one per run.
export function validateConsumerConfig(config) {
  const problems = [];
  if (!checkRecord(problems, 'config', config)) return problems;

  if (checkRecord(problems, 'config.platform', config.platform)) {
    checkString(problems, 'config.platform.runtimeTargetGlobal', config.platform.runtimeTargetGlobal);
    checkString(problems, 'config.platform.debugAdsProviderKey', config.platform.debugAdsProviderKey);
    const legacy = config.platform.legacyAdsProviderKeys;
    if (!Array.isArray(legacy)) {
      fail(problems, 'config.platform.legacyAdsProviderKeys', 'an array', legacy);
    } else {
      legacy.forEach((key, index) => {
        checkString(problems, `config.platform.legacyAdsProviderKeys[${index}]`, key);
      });
    }
  }

  if (checkRecord(problems, 'config.links', config.links)) {
    for (const storeKey of STORE_KEYS) {
      if (!checkRecord(problems, `config.links.${storeKey}`, config.links[storeKey])) continue;
      checkString(problems, `config.links.${storeKey}.app`, config.links[storeKey].app);
      checkString(problems, `config.links.${storeKey}.developer`, config.links[storeKey].developer);
    }
  }

  if (checkRecord(problems, 'config.ads', config.ads)) {
    checkBoolean(problems, 'config.ads.nativeTestMode', config.ads.nativeTestMode);
    if (checkRecord(problems, 'config.ads.admob', config.ads.admob)) {
      const admob = config.ads.admob;
      if (!Array.isArray(admob.testingDevices)) {
        fail(problems, 'config.ads.admob.testingDevices', 'an array', admob.testingDevices);
      } else {
        // Handed to the AdMob SDK as device ids. A number here reaches the SDK
        // as one and registers nothing, which looks exactly like a device that
        // was never added to the list.
        admob.testingDevices.forEach((id, index) => {
          checkString(problems, `config.ads.admob.testingDevices[${index}]`, id);
        });
      }
      checkBoolean(problems, 'config.ads.admob.useSampleAds', admob.useSampleAds);
      for (const storeKey of STORE_KEYS) {
        if (!checkRecord(problems, `config.ads.admob.${storeKey}`, admob[storeKey])) continue;
        checkString(problems, `config.ads.admob.${storeKey}.appId`, admob[storeKey].appId);
        checkAdUnits(problems, `config.ads.admob.${storeKey}`, admob[storeKey]);
      }
    }
    if (checkRecord(problems, 'config.ads.yandex', config.ads.yandex)) {
      // `test` alongside the two stores: the Yandex SDK has demo units of its
      // own, and native test mode routes to them rather than to real ids.
      for (const key of ['test', ...STORE_KEYS]) {
        checkAdUnits(problems, `config.ads.yandex.${key}`, config.ads.yandex[key]);
      }
    }
  }

  if (checkRecord(problems, 'config.purchases', config.purchases)) {
    for (const storeKey of STORE_KEYS) {
      checkCatalogue(problems, `config.purchases.${storeKey}`, config.purchases[storeKey]);
    }
  }

  return problems;
}
