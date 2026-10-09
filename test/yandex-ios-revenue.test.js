import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const patch = fs.readFileSync(new URL('../template/scripts/patches/native-ad-request-ids.patch', import.meta.url), 'utf8');
const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))
  .map(line => line.slice(1)).join('\n');
const destination = patch.split('\n').filter(line => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' '))
  .map(line => line.slice(1)).join('\n');

test('Yandex iOS patch forwards raw impression data through existing guarded events', () => {
  for (const format of ['banner', 'interstitial', 'rewarded']) {
    assert.match(added, new RegExp(`(?:notifyListeners|notifyRequest)\\("${format}Impression",[^\\n]*impressionEvent\\(${format}AdUnitID, impressionData\\)`));
  }
  assert.ok(patch.includes('guard self.bannerAdView === bannerAdView else { return }'));
  for (const format of ['interstitial', 'rewarded']) {
    assert.ok(patch.includes(`guard self.${format}Ad === ${format}Ad, let call = ${format}ShowCall else { return }`));
  }
  assert.match(added, /payload\["impressionData"\] = impressionData\.rawData/);
  assert.match(added, /payload\["impressionData"\] = NSNull\(\)/);
});

test('the patched Swift payload serializes a raw JSON string and explicit null', t => {
  const compiler = spawnSync('xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift compiler is unavailable');
  // Only the pure payload helper is isolated here. The full native bridge is
  // checked by the consumer's iOS build, not this serialization test.
  const helper = destination.match(/    @MainActor private func impressionEvent[\s\S]*?\n    }/);
  assert.ok(helper, 'patch must include the real helper');
  const raw = '{"revenue":"0.01","currency":"USD","precision":"estimated"}';
  const swift = `import Foundation
struct ImpressionData { let rawData: String }
func adEvent(_ adUnitID: String) -> [String: Any] { ["adUnitId": adUnitID] }
${helper[0].replace('@MainActor private ', '')}
let raw = ${JSON.stringify(raw)}
let values = [impressionEvent("unit", ImpressionData(rawData: raw)), impressionEvent("unit", nil)]
print(String(data: try JSONSerialization.data(withJSONObject: values), encoding: .utf8)!)
`;
  const result = spawnSync(compiler.stdout.trim(), ['-'], { input: swift, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { adUnitId: 'unit', impressionData: raw },
    { adUnitId: 'unit', impressionData: null },
  ]);
});
