// Fullscreen ads, judged by what reaches the game.
//
// Not by what `showInterstitialAd()` resolves to. A fullscreen ad covers the
// app for tens of seconds and its outcome arrives afterwards, on the callback
// bag the game handed to the initializer; an SDK that never answers leaves the
// show call's promise pending for as long as it likes, and the watchdog that
// rescues the game reports through the lifecycle instead. So a promise that has
// not settled is not a contract failure here, and a missing callback is.
//
// Nothing here names an SDK. A case asks for an ad to be presented or completed
// and the consumer's fixture decides which callback of which plugin that is —
// otherwise the starter would prescribe one plugin and "adapters may diverge"
// would stop being true.
import assert from 'node:assert/strict';

import { recordCallbacks } from './startup.mjs';

// A show is started, never awaited.
//
// What `showInterstitialAd()` resolves to is not the contract, and waiting for
// it here would quietly make it one: a platform whose show call settles only
// when the ad closes would deadlock against a case that waits for the promise
// before telling the SDK to present anything. The rejection is swallowed for
// the same reason a game would swallow it — the outcome arrives on the callback
// bag — but an unhandled rejection would still crash the run, so it is attached
// immediately rather than later.
function startShow(promise) {
  promise.catch(() => {});
}

// Let whatever the show call queued reach the SDK. A platform that dispatches
// through an await needs one turn; one that calls straight through needs none,
// and an extra turn costs it nothing.
const reachSdk = () => new Promise((resolve) => setImmediate(resolve));

// A platform may well preload during initialization, so whether an ad is ready
// is decided before the initializer runs, not after it.
async function started({ createController, controls }, { removeAdsFlag = false, adsAvailable = true } = {}) {
  const controller = createController();
  controls.ads.available(adsAvailable);
  const recorder = recordCallbacks('initializePlatformServices', { locale: 'en-US', removeAdsFlag });
  await controller.initializePlatformServices(recorder.bag);
  return { controller, ...recorder };
}

const only = (names, kind) => names.filter((name) => name.startsWith(`on${kind}`));
const count = (names, name) => names.filter((entry) => entry === name).length;

export const cases = [
  {
    // Driven by an ad that never loaded. Deliberately *not* driven by a close
    // arriving before presentation: platforms disagree about that one — some
    // report a failed show and refuse a later reward, others open their window
    // and grant it — and freezing either answer here would settle a question no
    // second consumer has been asked yet.
    name: 'interstitial-failure-before-presentation-reports-only-show-failed',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness, { adsAvailable: false });
      startShow(controller.showInterstitialAd());
      await reachSdk();

      const interstitial = only(names(), 'Interstitial');
      assert.equal(count(interstitial, 'onInterstitialShowFailed'), 1);
      assert.equal(count(interstitial, 'onInterstitialShown'), 0, 'nothing was presented');
      assert.equal(count(interstitial, 'onInterstitialClosed'), 0, 'nothing was there to close');
    },
  },
  {
    name: 'interstitial-success-reports-shown-then-closed',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadInterstitialAd();
      startShow(controller.showInterstitialAd());
      await reachSdk();
      harness.controls.ads.interstitial.present();
      harness.controls.ads.interstitial.complete();

      assert.deepEqual(
        only(names(), 'Interstitial'),
        ['onInterstitialLoaded', 'onInterstitialShown', 'onInterstitialClosed'],
        'a presented ad is shown once and then closed once, and never also failed'
      );
    },
  },
  {
    name: 'interstitial-reports-show-failed-when-the-sdk-goes-silent',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadInterstitialAd();
      startShow(controller.showInterstitialAd());
      await reachSdk();
      harness.controls.ads.interstitial.silent();
      harness.controls.clock.runAll();

      assert.equal(
        count(names(), 'onInterstitialShowFailed'),
        1,
        'a show the SDK never answered must still reach the game'
      );
      assert.equal(count(names(), 'onInterstitialShown'), 0);
    },
  },
  {
    name: 'rewarded-failure-before-presentation-reports-only-show-failed',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness, { adsAvailable: false });
      startShow(controller.showRewardedAd());
      await reachSdk();

      const rewarded = only(names(), 'Rewarded');
      assert.equal(count(rewarded, 'onRewardedShowFailed'), 1);
      assert.equal(count(rewarded, 'onRewardedShown'), 0, 'nothing was presented');
      assert.equal(count(rewarded, 'onRewardedComplete'), 0, 'an ad nobody watched pays nothing');
      assert.equal(count(rewarded, 'onRewardedClosed'), 0, 'nothing was there to close');
    },
  },
  {
    name: 'rewarded-success-reports-shown-then-closed',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadRewardedAd();
      startShow(controller.showRewardedAd());
      await reachSdk();
      harness.controls.ads.rewarded.present();
      harness.controls.ads.rewarded.complete();

      const rewarded = only(names(), 'Rewarded');
      assert.equal(count(rewarded, 'onRewardedShown'), 1);
      assert.equal(count(rewarded, 'onRewardedClosed'), 1);
      assert.equal(count(rewarded, 'onRewardedShowFailed'), 0);
      assert.ok(
        rewarded.indexOf('onRewardedShown') < rewarded.indexOf('onRewardedClosed'),
        'a rewarded ad is shown before it is closed'
      );
    },
  },
  {
    name: 'rewarded-completes-at-most-once-per-show',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadRewardedAd();
      startShow(controller.showRewardedAd());
      await reachSdk();
      harness.controls.ads.rewarded.present();
      harness.controls.ads.rewarded.complete();
      harness.controls.ads.rewarded.complete();

      assert.equal(
        count(names(), 'onRewardedComplete'),
        1,
        'one watched ad is one reward, however many times the SDK says so'
      );
    },
  },
  {
    name: 'late-or-repeated-sdk-signals-do-not-duplicate-a-callback',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadInterstitialAd();
      startShow(controller.showInterstitialAd());
      await reachSdk();
      harness.controls.ads.interstitial.present();
      harness.controls.ads.interstitial.complete();
      const settled = only(names(), 'Interstitial');

      // Everything the SDK could still say about an attempt that is over.
      harness.controls.ads.interstitial.present();
      harness.controls.ads.interstitial.complete();
      harness.controls.ads.interstitial.fail();
      harness.controls.clock.runAll();

      assert.deepEqual(
        only(names(), 'Interstitial'),
        settled,
        'a finished attempt cannot be reopened by a late signal'
      );
    },
  },
  {
    name: 'preload-is-safe-before-initialize',
    environment: 'portal-ads',
    run({ createController }) {
      const controller = createController();
      controller.preloadInterstitialAd();
      controller.preloadRewardedAd();
    },
  },
  {
    // Only the interstitial. Whether the ads-removal entitlement also stops a
    // rewarded ad
    // is the game's decision — one game sells the removal of interruptions and
    // keeps its opt-in rewards, another unlocks everything and has nothing left
    // to reward — and a contract that picked a side would be writing policy.
    name: 'ads-removed-suppresses-the-interstitial',
    environment: 'portal-ads',
    async run(harness) {
      const { controller, names } = await started(harness);
      controller.preloadInterstitialAd();
      controller.setAdsRemovedOwned();

      startShow(controller.showInterstitialAd());
      await reachSdk();
      harness.controls.ads.interstitial.present();
      harness.controls.ads.interstitial.complete();

      assert.equal(
        count(names(), 'onInterstitialShown'),
        0,
        'an owner of the ads-removal entitlement is not shown an interstitial'
      );
    },
  },
];
