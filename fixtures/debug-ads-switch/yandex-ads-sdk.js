// A stand-in for `capacitor-plugin-yandex-ads`, which the adapter imports
// dynamically. Present here so the Yandex half of the removal is a real call
// rather than the "plugin never loaded" shortcut.
import { removeBanner } from './banner-probe.js';

export const YandexAds = {
  removeBanner: () => removeBanner('yandex'),
};
