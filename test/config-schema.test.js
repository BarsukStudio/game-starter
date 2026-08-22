// Whether the config schema actually rejects what it claims to reject.
//
// A validator nobody runs against a broken input is worse than no validator: it
// reads like a guarantee, and the first game to rely on it finds out on a device
// that the guarantee was never exercised. Every rule below is proven by breaking
// exactly one field of an otherwise valid config.
//
// The values are shapes, never a game's. What a real consumer's config must
// contain beyond this shape — that the ids are the ones the stores know — is the
// consuming game's own contract, not this one's.
import assert from 'node:assert/strict';
import test from 'node:test';

import { STORE_KEYS, validateConsumerConfig } from '../template/schemas/config.schema.js';

function validConfig() {
  const adUnits = () => ({ banner: 'b', interstitial: 'i', rewarded: 'r' });
  return {
    platform: {
      runtimeTargetGlobal: '__EXAMPLE_PLATFORM__',
      debugAdsProviderKey: 'example_debug_ads_provider',
      legacyAdsProviderKeys: ['example_debug_ads_provider_old'],
    },
    links: {
      ios: { app: 'https://example.invalid/ios', developer: 'https://example.invalid/ios-dev' },
      android: { app: 'https://example.invalid/android', developer: 'https://example.invalid/android-dev' },
    },
    ads: {
      nativeTestMode: true,
      admob: {
        testingDevices: [],
        useSampleAds: true,
        ios: { appId: 'ios-app', ...adUnits() },
        android: { appId: 'android-app', ...adUnits() },
      },
      yandex: { test: adUnits(), ios: adUnits(), android: adUnits() },
    },
    purchases: {
      ios: { coins: { id: 'example.coins', consumable: true } },
      android: { coins: { id: 'example.coins', consumable: true } },
    },
  };
}

// One field broken, everything else left valid, so a failure names the rule
// under test rather than the state of the fixture.
function broken(mutate) {
  const config = validConfig();
  mutate(config);
  return validateConsumerConfig(config);
}

function assertNames(problems, path) {
  assert.ok(problems.length, `${path} must be reported`);
  assert.ok(
    problems.some((problem) => problem.startsWith(`${path}:`)),
    `a problem must name the path a game has to fix; got ${JSON.stringify(problems)}`,
  );
}

test('a complete config has nothing to report', () => {
  assert.deepEqual(validateConsumerConfig(validConfig()), []);
});

test('an empty catalogue is a valid answer, not a failure', () => {
  // Pinned rather than left implicit: a game may ship with purchases switched
  // off, and `contract/cases/purchases.mjs` already calls an empty catalogue the
  // honest answer for it. A schema demanding one product would contradict the
  // canonical case.
  const config = validConfig();
  for (const storeKey of STORE_KEYS) config.purchases[storeKey] = {};
  assert.deepEqual(validateConsumerConfig(config), []);
});

test('an empty list of legacy keys is a valid answer too', () => {
  const config = validConfig();
  config.platform.legacyAdsProviderKeys = [];
  assert.deepEqual(validateConsumerConfig(config), []);
});

test('every marker name must be declared', () => {
  assertNames(broken((c) => { delete c.platform.runtimeTargetGlobal; }), 'config.platform.runtimeTargetGlobal');
  assertNames(broken((c) => { c.platform.debugAdsProviderKey = '   '; }), 'config.platform.debugAdsProviderKey');
  assertNames(broken((c) => { c.platform.legacyAdsProviderKeys = 'one'; }), 'config.platform.legacyAdsProviderKeys');
  assertNames(broken((c) => { c.platform.legacyAdsProviderKeys = ['']; }), 'config.platform.legacyAdsProviderKeys[0]');
});

test('a product must carry a store id and a type', () => {
  assertNames(broken((c) => { delete c.purchases.ios.coins.consumable; }), 'config.purchases.ios.coins.consumable');
  assertNames(broken((c) => { c.purchases.ios.coins.id = 42; }), 'config.purchases.ios.coins.id');
  // The type decides which finish path a transaction takes, so a string that
  // merely looks true is not an answer.
  assertNames(broken((c) => { c.purchases.android.coins.consumable = 'true'; }), 'config.purchases.android.coins.consumable');
});

test('a product key must be a name the game can refer to', () => {
  // `contract/cases/purchases.mjs` asserts `key.trim()` on every key the
  // catalogue answers with, so a blank one is a product the game can never name
  // — in the shop, in delivery, or in the price map.
  assertNames(broken((c) => { c.purchases.ios = { '   ': { id: 'x', consumable: true } }; }), 'config.purchases.ios');
  assertNames(broken((c) => { c.purchases.android[''] = { id: 'y', consumable: false }; }), 'config.purchases.android');
});

test('a test device id is a string or the SDK registers nothing', () => {
  // A number reaches the AdMob SDK as a number and matches no device, which on a
  // QA build is indistinguishable from a device that was never added.
  assertNames(broken((c) => { c.ads.admob.testingDevices = [42]; }), 'config.ads.admob.testingDevices[0]');
  assertNames(broken((c) => { c.ads.admob.testingDevices = ['ok', '']; }), 'config.ads.admob.testingDevices[1]');
});

test('both stores must be answerable', () => {
  assertNames(broken((c) => { delete c.links.android.developer; }), 'config.links.android.developer');
  assertNames(broken((c) => { delete c.ads.admob.ios.appId; }), 'config.ads.admob.ios.appId');
  assertNames(broken((c) => { delete c.purchases.android; }), 'config.purchases.android');
});

test('the ad units the template reads must all be there', () => {
  assertNames(broken((c) => { delete c.ads.yandex.test.rewarded; }), 'config.ads.yandex.test.rewarded');
  assertNames(broken((c) => { delete c.ads.admob.android.banner; }), 'config.ads.admob.android.banner');
  assertNames(broken((c) => { c.ads.nativeTestMode = 'yes'; }), 'config.ads.nativeTestMode');
  assertNames(broken((c) => { c.ads.admob.testingDevices = null; }), 'config.ads.admob.testingDevices');
});

test('problems are collected, not raised one at a time', () => {
  // A validator that stopped at the first problem would make a game fix its
  // config one run at a time, which is how a check stops being run at all.
  const problems = broken((config) => {
    delete config.platform.runtimeTargetGlobal;
    delete config.links.ios.app;
    config.purchases.ios.coins.consumable = 'true';
  });
  assert.equal(problems.length, 3, JSON.stringify(problems));
});

test('a config that is not an object is reported once and not walked', () => {
  for (const value of [null, undefined, 'config', 42, []]) {
    const problems = validateConsumerConfig(value);
    assert.equal(problems.length, 1, `${JSON.stringify(value)} must be one problem, got ${JSON.stringify(problems)}`);
    assert.ok(problems[0].startsWith('config:'));
  }
});
