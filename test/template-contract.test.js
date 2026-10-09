import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { PLATFORM_CONTRACT } from '../contract/manifest.js';
import { exportTemplate } from '../tools/export-template.mjs';

// Exercise the exported facade's real method table with declared bridge
// functions. This checks template wiring, not SDK behavior or conformance.
for (const nativeStack of ['admob', 'cas']) {
  test(`${nativeStack} exported facade exposes callable methods for the full contract`, t => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-contract-'));
    t.after(() => fs.rmSync(out, { recursive: true, force: true }));
    exportTemplate({ nativeStack, out });
    const platform = path.join(out, 'src/js/platform');
    const bridgeSource = fs.readFileSync(path.join(platform, 'bridge.js'), 'utf8');
    const bridge = Object.fromEntries([...bridgeSource.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\(/g)]
      .map(([, name]) => [name, () => {}]));
    const source = fs.readFileSync(path.join(platform, 'index.js'), 'utf8')
      .replace("import * as bridge from './bridge.js';", '')
      .replace('export function createPlatformController()', 'function createPlatformController()');
    const controller = vm.runInNewContext(`${source}\ncreatePlatformController();`, { bridge });
    assert.deepEqual(Object.keys(controller).sort(), [...PLATFORM_CONTRACT]);
    for (const name of PLATFORM_CONTRACT) assert.equal(typeof controller[name], 'function', name);
  });
}
