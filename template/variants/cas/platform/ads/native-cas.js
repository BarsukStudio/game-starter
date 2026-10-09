import { createRequestId } from '../request-id.js';
import { App } from '@capacitor/app';
import { CAS } from '@barsuk/capacitor-cas';
import { APP_CONFIG } from '../config.js';
import { getNativeKey } from '../env.js';
import { beginConsentTelemetry, recordCasInitialization } from '../consent-telemetry.js';
import { recordCasImpression } from './ad-revenue.js';
import { recordCasAdEvent } from './cas-telemetry.js';

let deps;
let initialization;
let listeners;
let finishStartupConsent;
let lastInitializationResult;
let retryOnForeground = false;
let foregroundVersion = 0;
let foregroundActive = true;
let ready = false;
let privacyBusy = false;
let privacyAvailable = false;
let presentation = null;
let banner = null;
const slots = { interstitial: null, rewarded: null };
const suffix = format => format === 'interstitial' ? 'Interstitial' : 'Rewarded';
const telemetry = (name, fields) => recordCasAdEvent(name, { testMode: APP_CONFIG.ads.nativeTestMode, ...fields });

export const isReady = () => ready && !privacyBusy;
export const hasPresentation = () => presentation !== null;
export const isPresentationUnresolved = format => presentation?.format === format && !presentation.scope.isCurrent();
export const getPrivacyOptionsState = () => ({ available: privacyAvailable, busy: privacyBusy });

function settle(show, error) {
  if (presentation !== show) return;
  presentation = null;

  telemetry(error ? 'bs_ad_show_failed' : 'bs_ad_closed', {
    format: show.format, requestId: show.requestId, showId: show.showId,
    ...(error ? { error, errorSource: show.failureSource || 'show_call' } : {}),
  });

  // Release native ownership before callbacks: the game can start its next load.
  if (error) show.scope.showFailed(error);
  else show.scope.showClosed();
  if (show.format === 'interstitial' && deps.isAdsRemoved()) hideBanner();
  if (slots[show.format]?.loaded) {
    deps[show.format].setAvailability(true);
  }
  deps.onPresentationSettled?.();
}

function onAdEvent(event) {
  if (event.type === 'impression') recordCasImpression(event);
  if (event.format === 'banner') {
    const current = banner;
    if (!current) return;
    if (!current.requestId) { current.events.push(event); return; }
    if (event.requestId !== current.requestId) return;
    if (event.type === 'loaded' || event.type === 'loadFailed') {
      telemetry(event.type === 'loaded' ? 'bs_banner_loaded' : 'bs_banner_error', {
        format: 'banner', requestId: current.requestId,
        loadScope: current.observed ? 'sdk_autoload' : 'app_request',
        ...(event.type === 'loadFailed' ? { error: event, errorSource: 'load_callback' } : {}),
      });
      current.observed = true;
    }
    if (event.type === 'loaded' && !deps.isAdsRemoved() && !privacyBusy) {
      void CAS.showBanner().catch(error => {
        if (banner === current) telemetry('bs_banner_error', {
          format: 'banner', requestId: current.requestId, error, errorSource: 'show_call',
        });
        console.warn('CAS banner show failed', error);
      });
    }
    return;
  }
  const slot = slots[event.format];
  if (!slot) return;
  // Capacitor may deliver a load callback before the load command reply.
  if (!slot.requestId) { slot.events.push(event); return; }
  if (slot.requestId !== event.requestId) return;
  if (event.type === 'loaded') {
    telemetry('bs_ad_loaded', { format: event.format, requestId: slot.requestId,
      loadScope: slot.observed ? 'sdk_autoload' : 'app_request' });
    slot.observed = true;
    slot.loaded = true;
    // SDK Autoload events outlive a game's individual wait attempt.
    deps[event.format].setAvailability(true, event);
  } else if (event.type === 'loadFailed') {
    telemetry('bs_ad_load_failed', { format: event.format, requestId: slot.requestId,
      loadScope: slot.observed ? 'sdk_autoload' : 'app_request', error: event, errorSource: 'load_callback' });
    slot.observed = true;
    slot.loaded = false;
    deps[event.format].setAvailability(false, event);
  }
  const show = presentation;
  if (!show || show.format !== event.format || show.requestId !== event.requestId || !event.showId) return;
  if (show.showId !== event.showId) return;
  if (event.type === 'showed' && !show.shown) {
    show.shown = true;
    telemetry('bs_ad_shown', { format: event.format, requestId: show.requestId, showId: show.showId });
    show.scope.showStarted();
  }
  if (event.type === 'reward' && event.format === 'rewarded' && !show.rewarded) {
    show.rewarded = true;
    telemetry('bs_ad_reward_earned', { format: event.format, requestId: show.requestId, showId: show.showId });
    show.scope.rewardEarned(event);
  }
  if (event.type === 'dismissed') settle(show);
  if (event.type === 'showFailed') {
    show.failureSource = 'show_callback';
    settle(show, event);
  }
}

function layoutBanner(frame) {
  // Coordinates are logical WebView pixels. Reserve overlap, including bottom inset,
  // rather than adding the banner height on top of an existing safe-area reserve.
  const overlap = frame.visible && banner && !privacyBusy && !deps.isAdsRemoved() ? Math.max(0, Math.min(window.innerHeight, window.innerHeight - frame.y)) : 0;
  document.documentElement.style.setProperty('--native-banner-bottom', `${overlap}px`);
}

async function loadBanner() {
  if (!isReady() || deps.isAdsRemoved() || banner) return;
  const current = banner = { requestId: null, events: [], observed: false };
  telemetry('bs_banner_request', { format: 'banner' });
  const startedInForeground = foregroundVersion;
  try {
    const result = await CAS.loadBanner({ position: 'bottom' });
    if (banner !== current) return;
    current.requestId = result.requestId;
    for (const event of current.events.splice(0)) onAdEvent(event);
    if (deps.isAdsRemoved()) hideBanner();
  } catch (error) {
    if (banner !== current) return;
    banner = null;
    telemetry('bs_banner_error', { format: 'banner', error, errorSource: 'load_call' });
    console.warn('CAS banner load failed', error);
    if (error?.code === 'NOT_FOREGROUND' && foregroundAdvanced(startedInForeground)) void loadBanner();
  }
}

function initializeInventory() {
  if (!isReady()) return;
  deps.preloadInterstitial();
  deps.preloadRewarded();
  void loadBanner();
}

function applyConsentStatus(status) {
  const success = ['obtained', 'notRequired'].includes(status);
  if (success) {
    privacyAvailable = status === 'obtained';
  }
  return success;
}

function onInitialization(result) {
  applyConsentStatus(result.consentStatus);
  const signature = JSON.stringify([result.initialized, result.consentStatus, result.error, result.isConsentRequired]);
  if (signature !== lastInitializationResult) {
    lastInitializationResult = signature;
    recordCasInitialization(result);
  }
  if (finishStartupConsent) {
    if (['obtained', 'notRequired'].includes(result.consentStatus)) {
      finishStartupConsent({ stage: 'cas_consent' });
      finishStartupConsent = null;
    } else if (['unavailable', 'internalError', 'networkError', 'invalidContext', 'stillPresenting'].includes(result.consentStatus)) {
      finishStartupConsent({ stage: 'cas_consent', failed: true, error: { code: result.consentStatus } });
      finishStartupConsent = null;
    }
  }
  if (typeof result.isConsentRequired === 'boolean') privacyAvailable = result.isConsentRequired;
  if (!result.initialized || ready) return;
  ready = true;
  initializeInventory();
}

// An active signal can arrive before a native rejection crosses the bridge.
// Consume each new signal once; never poll or retry a SDK/network failure.
function foregroundAdvanced(version) {
  return foregroundActive && foregroundVersion !== version;
}

async function onForeground() {
  foregroundActive = true;
  foregroundVersion++;
  if (retryOnForeground) await init(deps);
  else initializeInventory();
}

export function init(adapterDeps) {
  deps = adapterDeps;
  if (initialization) return initialization;
  retryOnForeground = false;
  const startedInForeground = foregroundVersion;
  initialization = (async () => {
    finishStartupConsent ??= beginConsentTelemetry('startup');
    try {
      // Register once, even when initialization was rejected before SDK creation.
      listeners ??= (async () => {
        await CAS.addListener('adEvent', onAdEvent);
        await CAS.addListener('bannerLayout', layoutBanner);
        await CAS.addListener('initialization', onInitialization);
        await App.addListener('resume', onForeground);
        await App.addListener('appStateChange', ({ isActive }) => {
          foregroundActive = isActive;
          if (isActive) return onForeground();
        });
      })();
      await listeners;
      const config = APP_CONFIG.ads.cas;
      const result = await CAS.initialize({
        casId: config[getNativeKey()].casId,
        audience: config.audience,
        testMode: APP_CONFIG.ads.nativeTestMode,
        consentFlow: true,
        debugGeography: 'disabled',
      });
      onInitialization(result);
      // An asynchronous failure is owned by CAS, never recreate its manager.
      return true;
    } catch (error) {
      recordCasInitialization(null, error);
      retryOnForeground = error?.code === 'NOT_FOREGROUND';
      console.warn('CAS initialization failed', error);
      // Keep the selected provider while waiting for a safe foreground retry.
      return retryOnForeground;
    } finally {
      if (retryOnForeground) {
        initialization = null;
        if (foregroundAdvanced(startedInForeground)) void init(deps);
      }
    }
  })();
  return initialization;
}

async function preload(format) {
  const scope = deps[format].captureLoad();
  if (!isReady() || presentation?.format === format || (format === 'interstitial' && deps.isAdsRemoved())) {
    scope.loadFailed(new Error('CAS inventory unavailable'));
    return;
  }
  const previous = slots[format];
  if (previous?.loaded) { scope.loadSucceeded(); return; }
  if (previous) {
    try {
      // A rejected show (for example while backgrounded) may leave SDK inventory ready.
      // Query readiness without issuing another network load.
      const status = await CAS.getStatus();
      if (slots[format] === previous && presentation?.format !== format && scope.isCurrent()
        && !(format === 'interstitial' && deps.isAdsRemoved()) && status[`${format}Loaded`]) {
        previous.loaded = true;
        scope.loadSucceeded();
      }
    } catch (error) { scope.loadFailed(error); }
    return;
  }
  const slot = slots[format] = { requestId: null, events: [], loaded: false, observed: false };
  telemetry('bs_ad_load_request', { format });
  const startedInForeground = foregroundVersion;
  try {
    const result = await CAS[`load${suffix(format)}`]();
    if (slots[format] !== slot) return;
    slot.requestId = result.requestId;
    for (const event of slot.events.splice(0)) onAdEvent(event);
  } catch (error) {
    if (slots[format] === slot) {
      slots[format] = null;
      telemetry('bs_ad_load_failed', { format, error, errorSource: 'load_call', loadScope: 'app_request' });
      scope.loadFailed(error);
      if (error?.code === 'NOT_FOREGROUND' && foregroundAdvanced(startedInForeground)) {
        deps[`preload${suffix(format)}`]();
      }
    }
  }
}
export const preloadInterstitial = () => { void preload('interstitial'); };
export const preloadRewarded = () => { void preload('rewarded'); };

async function show(format) {
  const scope = deps[format].captureShow();
  const slot = slots[format];
  if (presentation || !isReady() || !slot?.loaded || (format === 'interstitial' && deps.isAdsRemoved())) {
    scope.showFailed(new Error('CAS cannot present this ad'));
    return false;
  }
  slot.loaded = false;
  const current = presentation = { format, scope, requestId: slot.requestId, showId: createRequestId(), rewarded: false, shown: false };
  telemetry('bs_ad_show_request', { format, requestId: current.requestId, showId: current.showId });
  try {
    await CAS[`show${suffix(format)}`]({ showId: current.showId });
    // Promise is terminal evidence only. Reward comes exclusively from earned events.
    settle(current);
    return true;
  } catch (error) {
    settle(current, error);
    return false;
  }
}
export const showInterstitial = () => show('interstitial');
export const showRewarded = () => show('rewarded');

export function hideBanner() {
  banner = null;
  layoutBanner({ visible: false });
  void CAS.destroyAd({ format: 'banner' }).catch(error => console.warn('CAS banner cleanup failed', error));
  if (!presentation || presentation.format !== 'interstitial') {
    slots.interstitial = null;
    deps.interstitial.setAvailability(false, new Error('Interstitial disabled by ads-removal ownership'));
    void CAS.destroyAd({ format: 'interstitial' }).catch(error => console.warn('CAS interstitial cleanup failed', error));
  }
}

export async function showPrivacyOptions() {
  if (!ready || privacyBusy || presentation) return false;
  privacyBusy = true;
  const finish = beginConsentTelemetry('privacy');
  banner = null;
  for (const format of ['interstitial', 'rewarded']) {
    deps[format].setAvailability(false, new Error('Privacy choices changed'));
    slots[format] = null;
  }
  layoutBanner({ visible: false });
  try {
    const result = await CAS.showConsentFlow();
    const success = applyConsentStatus(result.status);
    finish({ stage: 'cas_privacy', failed: !success, error: { code: result.status } });
    return success;
  } catch (error) {
    // Foreground validation can reject before the native consent method retires ads.
    // Explicitly retire them here so forgotten JS requests cannot remain onscreen.
    await Promise.all(['banner', 'interstitial', 'rewarded'].map(format =>
      CAS.destroyAd({ format }).catch(cleanupError => console.warn('CAS privacy cleanup failed', cleanupError))));
    finish({ stage: 'cas_privacy', failed: true, error });
    return false;
  } finally {
    privacyBusy = false;
  }
}

export function resumeInventory(adapterDeps) {
  deps = adapterDeps;
  initializeInventory();
}
