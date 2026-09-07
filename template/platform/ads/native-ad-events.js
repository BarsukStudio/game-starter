/**
 * Route native events only to the request echoed by the plugin. UUIDs also
 * distinguish requests across WebView reloads. Missing identities fail closed.
 * @param {object} lifecycle Shared lifecycle with captureLoad/captureShow.
 * @param {() => string} createId Generates a unique id for each native call.
 * @returns {object} Request captures and native event handlers.
 */
export function createNativeAdEvents(lifecycle, createId) {
  let load = null;
  let show = null;
  function deliver(attempt, method, payload) {
    if (!attempt || payload?.requestId !== attempt.requestId) return false;
    return attempt[method](payload);
  }
  return {
    captureLoad() {
      load = { ...lifecycle.captureLoad(), requestId: createId() };
      return load;
    },
    captureShow() {
      show = { ...lifecycle.captureShow(), requestId: createId() };
      return show;
    },
    loadSucceeded: (payload) => deliver(load, 'loadSucceeded', payload),
    loadFailed: (payload) => deliver(load, 'loadFailed', payload),
    showStarted: (payload) => deliver(show, 'showStarted', payload),
    showFailed: (payload) => deliver(show, 'showFailed', payload),
    showClosed: (payload) => deliver(show, 'showClosed', payload),
    rewardEarned: (payload) => deliver(show, 'rewardEarned', payload),
  };
}
