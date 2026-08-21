// The shell around the game: pausing with the app, leaving it, and the two
// links that send a player to a store page.
//
// The lifecycle pair are no-ops off a native shell, and that is the contract
// rather than an accident: one web bundle ships to a browser and to two app
// stores, so the game calls them unconditionally and the platform decides
// whether they mean anything here. A method that threw off-native would push
// that decision back into the game, which is what the facade exists to prevent.
//
// The two store links are not no-ops — a game asks for them because a player
// pressed something — but what they do with the request is the platform's:
// a portal may open its own review prompt, a shell may hand off to a store app,
// a browser may navigate. Contract 0.1.0 therefore asks only that asking is
// safe. Pinning the navigation itself was considered and left out: it is a
// change to the contract's result and has not been agreed.
import assert from 'node:assert/strict';

export const cases = [
  {
    name: 'binding-the-native-lifecycle-is-safe-off-native',
    environment: 'generic-web',
    async run({ createController }) {
      const seen = [];
      await createController().bindNativeLifecycle({
        onPause: () => seen.push('pause'),
        onResume: () => seen.push('resume'),
        onBack: () => seen.push('back'),
      });
      assert.deepEqual(seen, [], 'nothing fires by itself just because handlers were offered');
    },
  },
  {
    name: 'binding-the-native-lifecycle-accepts-no-handlers-at-all',
    environment: 'generic-web',
    async run({ createController }) {
      // A game that wants none of them still has to be able to call this: the
      // platform's own defaults are what fill the gaps.
      await createController().bindNativeLifecycle({});
    },
  },
  {
    name: 'exiting-the-app-is-safe-off-native',
    environment: 'generic-web',
    async run({ createController }) {
      await createController().exitNativeApp();
    },
  },
  {
    // Which listings they point at is the game's own business, and how a
    // platform honours the request is the platform's, so what is left to pin is
    // that a call site which cannot handle a failure is never handed one.
    name: 'the-store-links-answer-without-throwing',
    environment: 'generic-web',
    async run({ createController }) {
      const controller = createController();
      controller.openDeveloperPage();
      await controller.requestRating();
    },
  },
];
