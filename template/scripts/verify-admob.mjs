// Hashes come from the official npm 8.1.0 archive, verified against package-lock
// integrity. Consumer manifests may differ only for the approved banner geometry.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(fs.readFileSync(new URL('./admob-files.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('../node_modules/@capacitor-community/admob/', import.meta.url));
for (const [file, expected] of Object.entries(manifest.files)) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== expected) {
    throw new Error(`Unexpected AdMob modification or missing file: ${file}. Reinstall the pinned package and apply only the approved banner geometry patch.`);
  }
}
console.log(`Verified AdMob ${manifest.version}: official package with ${manifest.bannerGeometry ? 'approved banner geometry only' : 'no local patches'}.`);
