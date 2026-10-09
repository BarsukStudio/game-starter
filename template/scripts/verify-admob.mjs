// Hashes come from the official npm 8.2.0 archive, verified against package-lock
// integrity. Consumer manifests include approved banner geometry and consent-error metadata.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(fs.readFileSync(new URL('./admob-files.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../node_modules/@capacitor-community/admob/', import.meta.url));
for (const [file, expected] of Object.entries(manifest.files)) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== expected) {
    throw new Error(`Unexpected AdMob modification or missing file: ${file}. Reinstall the pinned package and apply the approved banner geometry and consent-error patches.`);
  }
}
console.log(`Verified AdMob ${manifest.version}: official package with ${manifest.bannerGeometry ? 'banner geometry' : 'stock geometry'}${manifest.consentErrors ? ' and consent-error metadata' : ''}.`);
