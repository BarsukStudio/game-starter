// SDK stand-ins shared by consumers. The production controller, bridge,
// adapters and runtime remain real; only SDK responses are driven here.
const listeners = new Map();
const requests = new Map();
let available = true;
const calls = [];
export const analyticsEvents = [];
export const FirebaseAnalytics = {
  async logEvent(event) { analyticsEvents.push(event); },
};
const emit = (event, payload) => {
  for (const handler of listeners.get(event) ?? []) handler(payload);
};
async function addListener(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return { remove: async () => listeners.get(event).delete(handler) };
}
async function prepare(format, options = {}) {
  calls.push(['prepare', format]);
  if (!available) throw Object.assign(new Error('No inventory'), { requestId: options.requestId });
  return { requestId: options.requestId };
}
function show(provider, format, options = {}) {
  calls.push(['show', format]);
  return new Promise((resolve, reject) => {
    requests.set(format, { provider, requestId: options.requestId, resolve, reject });
  });
}
export const AdMob = {
  addListener,
  async initialize() {},
  async requestConsentInfo() { return { canRequestAds: true, status: 'OBTAINED', privacyOptionsRequirementStatus: 'REQUIRED' }; },
  async trackingAuthorizationStatus() { return { status: 'denied' }; },
  async showPrivacyOptionsForm() {},
  async showBanner() {},
  async removeBanner() {},
  async hideBanner() {},
  prepareInterstitial: options => prepare('interstitial', options),
  prepareRewardVideoAd: options => prepare('rewarded', options),
  showInterstitial: () => show('admob', 'interstitial'),
  showRewardVideoAd: () => show('admob', 'rewarded'),
};
export const YandexAds = {
  addListener,
  async initialize() {},
  async resetAds() {},
  async setUserConsent() {},
  async showBanner() {},
  async removeBanner() {},
  async hideBanner() {},
  prepareInterstitial: options => prepare('interstitial', options),
  prepareRewarded: options => prepare('rewarded', options),
  showInterstitial: options => show('yandex', 'interstitial', options),
  showRewarded: options => show('yandex', 'rewarded', options),
};
export const AdmobConsentStatus = { REQUIRED: 'REQUIRED' };
export const BannerAdPosition = { BOTTOM_CENTER: 'bottom' };
export const BannerAdSize = { ADAPTIVE_BANNER: 'adaptive' };
export const BannerAdPluginEvents = { Loaded: 'bannerLoaded', FailedToLoad: 'bannerFailedToLoad', SizeChanged: 'bannerSize', AdPaid: 'bannerAdPaid' };
export const InterstitialAdPluginEvents = {
  Showed: 'interstitialShown', FailedToShow: 'interstitialFailedToShow', Dismissed: 'interstitialDismissed', AdImpression: 'interstitialImpression',
};
export const RewardAdPluginEvents = {
  Showed: 'rewardedShown', FailedToShow: 'rewardedFailedToShow', Dismissed: 'rewardedDismissed', AdImpression: 'rewardedImpression',
};
function slot(format) {
  const payload = () => ({ requestId: requests.get(format)?.requestId });
  return {
    present() { emit(`${format}Shown`, payload()); },
    complete() {
      const request = requests.get(format);
      if (!request) return;
      if (format === 'rewarded' && request.provider === 'yandex') emit('rewarded', payload());
      if (request.provider === 'admob' && format === 'rewarded') request.resolve({ amount: 1, type: 'reward' });
      emit(`${format}Dismissed`, payload());
      request.resolve({ ...payload(), presented: true, rewarded: format === 'rewarded' });
    },
    fail() {
      const error = Object.assign(new Error('Native show failed'), payload());
      emit(`${format}FailedToShow`, error);
      requests.get(format)?.reject(error);
    },
    silent() {},
    inFlight: () => requests.has(format),
  };
}
export const ads = {
  available(value) { available = value; },
  interstitial: slot('interstitial'),
  rewarded: slot('rewarded'),
  showCount: () => calls.filter(([method]) => method === 'show').length,
  emitBanner: (event, payload = {}) => emit(event, payload),
};

export const FirebaseCrashlytics = { async setCustomKey() {}, async recordException() {} };
export const FirebasePerformance = { async startTrace() {}, async stopTrace() {}, async putMetric() {} };
