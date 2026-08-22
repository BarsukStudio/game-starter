// The native app shell: the Capacitor surface that is about the app itself
// rather than about money — the splash screen, the status bar, the Activity
// lifecycle and leaving the app.
//
// Hard rule 1 gives this module the app-shell plugins. It holds no state, makes
// no policy decision and knows nothing about providers, ads or purchases; the
// bridge composes it with everything else and publishes three of these four
// through the facade.
import { SystemBars, SystemBarType } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

import { isNative } from './env.js';

// Deliberately unguarded and deliberately not swallowing: the only caller is
// already inside the native branch of `initializePlatformServices`, and it owns
// the warning so the failure stays visible next to the startup sequence it
// belongs to.
export function hideSplashScreen() {
  return SplashScreen.hide();
}

// The game owns the whole screen, so the clock and the battery must not sit on
// top of it. Only the top bar goes: the navigation buttons stay visible, which
// is what the bottom banner is spaced against. What is left above the game is
// the black safe area under the display cutout, because `--safe-top` keeps
// reporting the cutout inset after the status bar is gone.
export async function hideNativeStatusBar() {
  if (!isNative) return;
  try {
    await SystemBars.hide({ bar: SystemBarType.StatusBar });
  } catch (error) {
    console.warn('SystemBars.hide(StatusBar) failed', error);
  }
}

// Native side of `app-lifecycle.js`. Both `appStateChange` and `pause`/`resume`
// are bound on purpose: Android reports the Activity transition through the
// first, while a native layer taking over the screen (an ad, the ATT prompt)
// can be visible only through the second. The lifecycle collapses the duplicates.
// Returns a disposer. `addListener` resolves a handle rather than returning
// one, so awaiting is what makes a failed registration observable at all — an
// unawaited rejection would sail past the try/catch and leave the game believing
// it is bound.
export async function bindNativeLifecycle({ onPause, onResume, onBack } = {}) {
  const handles = [];
  const dispose = async () => {
    while (handles.length) {
      try {
        await handles.pop()?.remove?.();
      } catch (error) {
        console.warn('Native lifecycle listener removal failed', error);
      }
    }
  };
  if (!isNative) return dispose;

  try {
    handles.push(await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onResume?.();
      else onPause?.();
    }));
    handles.push(await App.addListener('pause', () => onPause?.()));
    handles.push(await App.addListener('resume', () => onResume?.()));
    // Registering this listener disables Capacitor's default back behaviour,
    // so leaving the app is now the game's own decision — see `exitNativeApp`.
    handles.push(await App.addListener('backButton', (event) => onBack?.(event)));
  } catch (error) {
    console.warn('Native lifecycle binding failed', error);
    await dispose();
  }
  return dispose;
}

export async function exitNativeApp() {
  if (!isNative) return false;
  try {
    await App.exitApp();
    return true;
  } catch (error) {
    console.warn('App exit failed', error);
    return false;
  }
}
