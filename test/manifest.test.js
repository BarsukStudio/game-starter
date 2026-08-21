// The manifest is data, so its tests are about the shape that data has to keep.
//
// None of this proves a platform works — that is the conformance suite's job.
// What it catches is the manifest rotting: a name landing in two capability
// groups, a group drifting out of sync with the contract it indexes, a callback
// colliding with a method, or the manifest starting to read its version from
// somewhere else.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import {
  CAPABILITY_GROUPS,
  CONTRACT_VERSION,
  PLATFORM_CALLBACKS,
  PLATFORM_CONTRACT,
  PLATFORM_INITIALIZER_INPUTS,
} from '../contract/manifest.js';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MANIFEST = new URL('../contract/manifest.js', import.meta.url);

// One check for every list of names in the manifest, because the three lists
// earn the same guarantees and writing them out per list is how one of them
// ends up with fewer. A `null` in a callback bag used to pass: the frozen and
// unique checks were there, the "is it even a name" check was only on methods.
function assertNameList(names, label) {
  assert.ok(Array.isArray(names), `${label} must be an array`);
  assert.ok(Object.isFrozen(names), `${label} must be frozen`);
  for (const name of names) {
    assert.equal(typeof name, 'string', `${label} may only hold strings`);
    assert.ok(name.trim(), `${label} may not hold an empty name`);
  }
  assert.equal(new Set(names).size, names.length, `${label} may name each entry once`);
}

test('the contract is a frozen, sorted, unique list of names', () => {
  assertNameList(PLATFORM_CONTRACT, 'the contract');
  assert.ok(PLATFORM_CONTRACT.length > 0);
  assert.deepEqual(
    [...PLATFORM_CONTRACT],
    [...PLATFORM_CONTRACT].sort(),
    'kept sorted so a diff here is a diff over the contract, not over grouping'
  );
});

test('the capability groups index the contract exactly once each', () => {
  assert.ok(Object.isFrozen(CAPABILITY_GROUPS));
  const grouped = [];
  for (const [group, names] of Object.entries(CAPABILITY_GROUPS)) {
    assertNameList(names, `capability group ${group}`);
    grouped.push(...names);
  }
  assert.equal(new Set(grouped).size, grouped.length, 'a method belongs to one group');
  assert.deepEqual(
    grouped.slice().sort(),
    [...PLATFORM_CONTRACT],
    'the groups and the contract must name the same methods'
  );
});

test('every callback bag belongs to a method that receives one', () => {
  assert.ok(Object.isFrozen(PLATFORM_CALLBACKS));
  const all = [];
  for (const [method, names] of Object.entries(PLATFORM_CALLBACKS)) {
    assert.ok(
      PLATFORM_CONTRACT.includes(method),
      `${method} carries callbacks but is not in the contract`
    );
    assertNameList(names, `${method} callbacks`);
    all.push(...names);
  }
  assert.equal(new Set(all).size, all.length, 'a callback name belongs to one bag only');
  for (const name of all) {
    assert.ok(
      !PLATFORM_CONTRACT.includes(name),
      `${name} is both a method and a callback — one of them is wrong`
    );
  }
});

test('initializer inputs are named apart from the callbacks they travel with', () => {
  assert.ok(Object.isFrozen(PLATFORM_INITIALIZER_INPUTS));
  for (const [method, fields] of Object.entries(PLATFORM_INITIALIZER_INPUTS)) {
    assert.ok(
      PLATFORM_CONTRACT.includes(method),
      `${method} carries inputs but is not in the contract`
    );
    assertNameList(fields, `${method} inputs`);
    const callbacks = PLATFORM_CALLBACKS[method] ?? [];
    for (const field of fields) {
      assert.ok(
        !callbacks.includes(field),
        `${field} cannot be both an input and a callback of ${method}`
      );
    }
  }
});

// Two version fields on purpose: the template and the scripts move without the
// method list moving.
//
// What is checked is *separate ownership*, not two different values. Two
// independent counters are allowed to read the same at some point — an assertion
// that they must differ would fail on a legitimate coincidence and would still
// not prove independence. What actually has to hold is that the manifest names
// its version itself and never reaches for the package's.
test('the contract version is owned by the manifest, not read from the package', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(CONTRACT_VERSION, SEMVER);
  assert.match(pkg.version, SEMVER);

  const manifest = fs.readFileSync(MANIFEST, 'utf8');
  assert.match(
    manifest,
    /^export const CONTRACT_VERSION = '[^']+';$/m,
    'CONTRACT_VERSION must be a literal in the manifest'
  );

  // Read off the code, not the prose. The comment above CONTRACT_VERSION
  // explains why it is independent of the package version, and it names
  // `package.json` to do so — a rule that counted that would be a rule about
  // English. Whole-line comments go first, and the strip proves itself: if a
  // trailing comment ever appears, this fails instead of silently checking less.
  const code = manifest
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !code.includes('//'),
    'this rule only strips whole-line comments and a trailing one appeared'
  );
  assert.doesNotMatch(
    code,
    /package\.json|createRequire|process\.env/,
    'the manifest must not derive its version from anywhere else'
  );
});
