// Coming up, and staying usable when something did not.
//
// A platform's first job is to answer at all. Every case here runs against a
// controller that has just been built, because that is the state a game is in
// when it starts calling.
import assert from 'node:assert/strict';

import { PLATFORM_CALLBACKS, PLATFORM_INITIALIZER_INPUTS } from '../manifest.js';

// Sentinel values for the non-callback fields an initializer declares. They
// stand for "the game passed this", nothing more: what a platform does with a
// locale is ad-routing policy, and policy stays in the game.
const INPUT_SENTINELS = {
  locale: 'en-US',
  removeAdsFlag: false,
  verbose: false,
};

export function declaredInputs(method, overrides = {}) {
  const inputs = {};
  for (const field of PLATFORM_INITIALIZER_INPUTS[method] ?? []) {
    assert.ok(field in INPUT_SENTINELS, `the suite has no sentinel value for ${field}`);
    inputs[field] = INPUT_SENTINELS[field];
  }
  return { ...inputs, ...overrides };
}

// A recorder for one initializer's callback bag, built from the manifest so a
// callback added to the contract is recorded here without anyone remembering to.
export function recordCallbacks(method, extra = {}) {
  const log = [];
  const bag = { ...extra };
  for (const name of PLATFORM_CALLBACKS[method]) {
    bag[name] = (...args) => log.push({ name, args });
  }
  return { bag, log, names: () => log.map(({ name }) => name) };
}

export const cases = [
  {
    // The bag is assembled from the manifest rather than written out, so a
    // callback or an input added to the contract is handed over here without
    // anyone remembering to. Asserting the manifest's own fields against a
    // literal in this file would only be checking the manifest against itself.
    name: 'initialize-accepts-the-contract-bag-and-resolves',
    environment: 'generic-web',
    async run({ createController }) {
      const { bag } = recordCallbacks('initializePlatformServices', declaredInputs('initializePlatformServices'));
      await createController().initializePlatformServices(bag);
    },
  },
  {
    // What `removeAdsFlag` buys, stated as the game observes it. What `locale`
    // buys is deliberately not pinned: which provider a locale selects is ad
    // policy, and policy stays in the game (`GAME_PLAYBOOK.md` §10).
    name: 'initialize-honours-the-remove-ads-flag-it-was-given',
    environment: 'portal-ads',
    async run({ createController, controls }) {
      const controller = createController();
      controls.ads.available(true);
      const { bag, names } = recordCallbacks('initializePlatformServices', { locale: 'en-US', removeAdsFlag: true });
      await controller.initializePlatformServices(bag);
      controller.preloadInterstitialAd();

      // The show has to actually be attempted. Asserting that nothing was shown
      // without asking for anything to be shown holds whatever the platform does.
      // Started rather than awaited, for the reason `ads.mjs` gives.
      controller.showInterstitialAd().catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
      controls.ads.interstitial.present();
      controls.ads.interstitial.complete();

      assert.equal(
        names().filter((name) => name === 'onInterstitialShown').length,
        0,
        'an owner of remove_ads must not be shown an interstitial'
      );
      assert.ok(
        names().includes('onInterstitialShowFailed'),
        'and the attempt still has to end somewhere the game can see'
      );
    },
  },
  {
    name: 'initialize-survives-an-adapter-that-fails-to-come-up',
    environment: 'portal-refusing',
    async run({ createController }) {
      const controller = createController();
      const { bag, log } = recordCallbacks('initializePlatformServices', { locale: 'en-US', removeAdsFlag: false });
      await controller.initializePlatformServices(bag);

      // Usable afterwards is the whole claim: the controller still answers, and
      // an ad attempt still reaches a terminal outcome instead of hanging.
      controller.showInterstitialAd().catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(
        log.some(({ name }) => name === 'onInterstitialShowFailed'),
        'a platform that came up without a provider must still answer a show attempt'
      );
    },
  },
  {
    // Reached through an ad that never became ready, which is the only shape a
    // platform without a provider can be in: nothing loads, so nothing is ready.
    // What is pinned is that the attempt ends somewhere the game can see it, not
    // which branch inside the platform produced that answer.
    name: 'a-show-attempt-always-ends-in-a-terminal-callback',
    environment: 'generic-web',
    async run({ createController }) {
      const controller = createController();
      const { bag, names } = recordCallbacks('initializePlatformServices', { locale: 'en-US', removeAdsFlag: false });
      await controller.initializePlatformServices(bag);

      controller.showInterstitialAd().catch(() => {});
      controller.showRewardedAd().catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        names(),
        ['onInterstitialShowFailed', 'onRewardedShowFailed'],
        'silence is not a terminal outcome'
      );
    },
  },
  {
    // `string | null`, as agreed. A platform that has no portal to ask may
    // answer either an empty string or nothing at all; narrowing that to one of
    // them would be a change to the contract's result, not a test detail.
    name: 'portal-language-answers-a-string-or-null-off-portal',
    environment: 'generic-web',
    async run({ createController }) {
      const language = await createController().getPortalLanguage();
      assert.ok(
        typeof language === 'string' || language === null,
        `getPortalLanguage() must answer a string or null, got ${typeof language}`
      );
    },
  },
  {
    name: 'hide-native-status-bar-is-safe-off-native',
    environment: 'generic-web',
    async run({ createController }) {
      await createController().hideNativeStatusBar();
    },
  },
];
