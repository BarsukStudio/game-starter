// A stand-in for `@capacitor/core`, for the shell module the bridge imports.
export const Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
};

export const SystemBars = {
  hide: () => Promise.resolve(),
  show: () => Promise.resolve(),
};

export const SystemBarType = Object.freeze({ StatusBar: 'statusBar', NavigationBar: 'navigationBar' });
