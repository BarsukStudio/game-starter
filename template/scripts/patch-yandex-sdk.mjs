// Reproduce the reviewed SDK pins from the Yandex bridge source repository.
import { readFileSync, writeFileSync } from 'node:fs';
const pins = [
  ['CapacitorPluginYandexAds.podspec', ["'YandexMobileAds', '8.2.1'", "'YandexMobileAds', '8.6.0'"], "'YandexMobileAds', '8.7.1'"],
  ['Package.swift', ['exact: "8.2.0"', 'exact: "8.6.0"'], 'exact: "8.7.1"'],
  ['android/build.gradle', ['mobileads:8.2.0', 'mobileads:8.5.0'], 'mobileads:8.6.0'],
];
for (const [file, baselines, current] of pins) {
  const target = new URL(`../node_modules/capacitor-plugin-yandex-ads/${file}`, import.meta.url);
  const source = readFileSync(target, 'utf8');
  if (source.includes(current)) continue;
  const previous = baselines.find(pin => source.includes(pin));
  if (process.argv.includes('--check') || !previous) {
    throw new Error(`Yandex SDK pin is missing or drifted in ${file}. Run postinstall and review the SDK pins.`);
  }
  writeFileSync(target, source.replace(previous, current));
}
