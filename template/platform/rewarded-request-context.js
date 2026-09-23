// One rewarded show = one request, decided before the ad opens.
//
// The reward used to be reconstructed after the ad closed, from whatever
// `openWindow`, `rewardNum`, `numPurch` and the visible modals happened to say
// at that moment. A rewarded ad covers the app for tens of seconds and the
// player can background it, so those globals are not the same ones the player
// tapped on. Everything the grant needs is therefore snapshotted at tap time
// and carried through the whole flow.
//
// Deliberately free of game, DOM and SDK knowledge: `main.js` supplies the
// payload and the two handlers, `bridge.js` supplies the terminal events.

export const REWARDED_PLACEMENTS = {
  RANDOM_REWARD: 'random_reward',
  COMPETITION_DOUBLE: 'competition_double',
  SHOP_OFFER: 'shop_offer',
};

const noop = () => { };

let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return `rewarded-${requestSequence}`;
}

export function createRewardedRequestCoordinator(options = {}) {
  const {
    onRewardEarned = noop,
    onFinalize = noop,
    createRequestId = nextRequestId,
  } = options;

  let active = null;
  let saveEpoch = 0;

  function notify(handler, request, outcome) {
    try {
      handler(request, outcome);
    } catch (error) {
      // A throwing game handler must not wedge the coordinator: the state
      // transition is already committed by the time we get here, so the next
      // rewarded request can still start.
      console.warn('Rewarded request handler failed', request?.placement, outcome, error);
    }
  }

  // `requestId` is optional because the ad SDK terminal events carry no id of
  // their own — in production the game calls these without one, and the
  // ordering guarantee comes from `ad-lifecycle`, which emits exactly one
  // terminal outcome per show and swallows duplicates. Passing an id is the
  // stricter path: it rejects a callback that explicitly belongs to a request
  // that is no longer active.
  function matches(requestId) {
    if (!active) return false;
    return requestId === undefined || requestId === active.requestId;
  }

  return {
    // Returns the request, or null when one is already in flight. A concurrent
    // second tap gets no reward of its own — the outcome belongs to the attempt
    // that is already showing.
    begin({ placement, payload = {} } = {}) {
      if (active) return null;
      if (!placement) throw new Error('Rewarded request requires a placement.');
      active = {
        requestId: createRequestId(),
        saveEpoch,
        placement,
        payload,
        rewardGranted: false,
        finalized: false,
      };
      return active;
    },

    // The closure owns the original request even after another show begins.
    captureReward() {
      const request = active;
      return () => {
        if (!request || request.saveEpoch !== saveEpoch || request.rewardGranted) return false;
        request.rewardGranted = true;
        notify(onRewardEarned, request, 'rewarded');
        return true;
      };
    },

    invalidate() {
      saveEpoch += 1;
      active = null;
    },

    getActive() {
      return active;
    },

    isBusy() {
      return active !== null;
    },

    // The reward itself. At most once per request, and never after the request
    // has been finalized.
    rewardEarned(requestId) {
      if (!matches(requestId)) return false;
      const request = active;
      if (request.rewardGranted) return false;
      request.rewardGranted = true;
      notify(onRewardEarned, request, 'rewarded');
      return true;
    },

    // Everything that has to happen whether or not the reward was earned:
    // closing the message, the competition's base payout, the location change.
    // At most once per request, and it is what releases the coordinator.
    finalize(outcome = 'closed', requestId) {
      if (!matches(requestId)) return false;
      const request = active;
      request.finalized = true;
      active = null;
      notify(onFinalize, request, outcome);
      return true;
    },
  };
}
