import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../template/platform/request-id.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function generator(crypto) {
  return runInNewContext(`${source}\ncreateRequestId`, { crypto });
}
test('uses the native UUID implementation with its crypto receiver', () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return 'native-id'; } };
  assert.equal(generator(crypto)(), 'native-id');
});
test('old WebView without randomUUID generates distinct v4 IDs across reloads', () => {
  const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = new Set();
  for (let reload = 0; reload < 2; reload++) {
    const next = generator(crypto);
    for (let i = 0; i < 1000; i++) {
      const id = next(); assert.match(id, uuid); assert.ok(!ids.has(id)); ids.add(id);
    }
  }
});
test('fallback keeps random bytes and sets the UUID version and variant', () => {
  const next = generator({ getRandomValues(bytes) { bytes.fill(255); return bytes; } });
  assert.equal(next(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
