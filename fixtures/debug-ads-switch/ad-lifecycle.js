// A stand-in for the consumer's `ad-lifecycle.js`.
//
// The bridge builds its lifecycles lazily, so nothing on the QA-switch path
// touches one. Only the three names the seam declares have to exist.
export const AD_LATE_REWARD_GRACE_MS = 0;
export const AD_PRESENTATION_TIMEOUT_MS = 0;

export function createAdLifecycle() {
  return {
    beginLoad() {},
    beginShow() {},
    loadSucceeded() {},
    loadFailed() {},
    showStarted() {},
    showFailed() {},
    showClosed() {},
    rewardEarned() {},
  };
}
