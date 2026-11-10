import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyTemplate } from '../tools/verify-template.mjs';

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function world(t, { template = {}, consumer = {}, divergence } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-template-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const write = (root, files) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
  };
  const templateRoot = path.join(base, 'template');
  const root = path.join(base, 'game');
  write(templateRoot, template);
  write(root, consumer);
  if (divergence) write(root, { 'template-divergence.json': JSON.stringify(divergence) });
  return () => verifyTemplate({ root, template: templateRoot });
}

test('identical copies pass and game-only files are not the check’s business', t => {
  const run = world(t, {
    template: { 'platform/bridge.js': 'a', 'scripts/lib/x.mjs': 'b' },
    consumer: { 'src/js/platform/bridge.js': 'a', 'scripts/lib/x.mjs': 'b', 'src/js/platform/own.js': 'c' },
  });
  assert.deepEqual(run(), { problems: [], current: 2, divergent: 0 });
});

test('an unrecorded edit or a missing copy fails', t => {
  const run = world(t, {
    template: { 'platform/bridge.js': 'a', 'platform/startup.js': 's' },
    consumer: { 'src/js/platform/bridge.js': 'edited' },
  });
  const { problems } = run();
  assert.equal(problems.length, 2);
  assert.match(problems[0], /bridge\.js: differs from the template/);
  assert.match(problems[1], /startup\.js: missing/);
});

test('a reviewed divergence passes only while both sides are exactly what was reviewed', t => {
  const recorded = { reason: 'game telemetry', template: sha('a'), consumer: sha('game') };
  assert.deepEqual(world(t, {
    template: { 'platform/bridge.js': 'a' },
    consumer: { 'src/js/platform/bridge.js': 'game' },
    divergence: { 'src/js/platform/bridge.js': recorded },
  })().problems, []);

  const edited = world(t, {
    template: { 'platform/bridge.js': 'a' },
    consumer: { 'src/js/platform/bridge.js': 'game, edited later' },
    divergence: { 'src/js/platform/bridge.js': recorded },
  })().problems;
  assert.equal(edited.length, 1);
  assert.match(edited[0], /the copy changed since this divergence was reviewed/);

  const templateMoved = world(t, {
    template: { 'platform/bridge.js': 'a, with a new guard' },
    consumer: { 'src/js/platform/bridge.js': 'game' },
    divergence: { 'src/js/platform/bridge.js': recorded },
  })().problems;
  assert.equal(templateMoved.length, 1);
  assert.match(templateMoved[0], /the template changed since this divergence was reviewed/);
});

test('a deliberately absent file is recorded with a null consumer', t => {
  const run = world(t, {
    template: { 'platform/startup.js': 's' },
    divergence: { 'src/js/platform/startup.js': { reason: 'own startup module', template: sha('s'), consumer: null } },
  });
  assert.deepEqual(run().problems, []);
});

test('stale, unexplained and unknown entries fail', t => {
  const { problems } = world(t, {
    template: { 'platform/a.js': 'a', 'platform/b.js': 'b' },
    consumer: { 'src/js/platform/a.js': 'a', 'src/js/platform/b.js': 'game' },
    divergence: {
      'src/js/platform/a.js': { reason: 'old', template: sha('a'), consumer: sha('old') },
      'src/js/platform/b.js': { reason: ' ', template: sha('b'), consumer: sha('game') },
      'src/js/platform/gone.js': { reason: 'x', template: 'x', consumer: 'x' },
    },
  })();
  assert.equal(problems.length, 3);
  assert.match(problems[0], /a\.js: matches the template again/);
  assert.match(problems[1], /b\.js: a divergence needs a reason/);
  assert.match(problems[2], /gone\.js: not a template file/);
});
