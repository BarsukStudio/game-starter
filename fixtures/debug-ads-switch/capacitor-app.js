// A stand-in for `@capacitor/app`.
export const App = {
  addListener: () => Promise.resolve({ remove() {} }),
  exitApp: () => Promise.resolve(),
};
