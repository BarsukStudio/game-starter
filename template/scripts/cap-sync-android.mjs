// `cap sync android`, plus everything Capacitor regenerates away every time.
//
// The generated Android project is not a place to edit by hand: a sync rewrites
// it. So the game's own additions — its application id, the gradle classpaths
// and repositories it needs, and the ad-mediation adapters — are re-applied here
// after every sync, from `build.config.mjs`.
//
// Nothing about a game is written into this file. Which adapters, which id and
// which patches to run are the consumer's; what stays here is the order of the
// steps and the rule that a missing anchor is an error rather than a silent
// no-op.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { BUILD_CONFIG } from './build.config.mjs';

const root = process.cwd();
const {
  appId,
  preSyncHooks,
  rootGradleClasspaths,
  rootGradleRepositories,
  moduleGradleDependencies,
} = BUILD_CONFIG.android;

const androidConfigPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
const androidBuildGradlePath = path.join(root, 'android', 'build.gradle');
const appCapacitorGradlePath = path.join(root, 'android', 'app', 'capacitor.build.gradle');

// The game's own native patches, run before the sync that would overwrite them.
// An empty list is the expected answer: two games are *supposed* to differ here,
// and one with no native patches has nothing to run.
for (const hook of preSyncHooks) {
  execFileSync('bash', [hook], { stdio: 'inherit' });
}

// A missing anchor means the generated file changed shape (a plugin was added or
// removed). Failing loudly here beats silently dropping the injected block,
// which is how ad-mediation dependencies have gone missing from a build before.
function addMissingBlock(contents, anchor, lines) {
  if (!lines.length) return contents;
  if (!contents.includes(anchor)) {
    throw new Error(`cap-sync-android: anchor not found, cannot inject block:\n${anchor}`);
  }
  const missingLines = lines.filter((line) => !contents.includes(line));
  if (!missingLines.length) return contents;
  return contents.replace(anchor, `${anchor}${missingLines.map((line) => `    ${line}`).join('\n')}\n`);
}

// Inserts *inside* a block rather than after it. The anchor carries the block's
// closing lines because the line to insert after is not unique on its own —
// `mavenCentral()` appears in more than one repositories block, and only one of
// them is the project-wide one.
//
// Idempotent, and still loud: once the lines are in place the anchor no longer
// matches, so a run that finds neither the anchor nor its own lines is looking
// at a file that moved under it and says so.
function insertIntoBlock(contents, anchor, lines) {
  if (!lines.length) return contents;
  if (!contents.includes(anchor)) {
    if (lines.every((line) => contents.includes(line))) return contents;
    throw new Error(`cap-sync-android: anchor not found, cannot insert into block:\n${anchor}`);
  }
  const [first, ...closing] = anchor.split('\n');
  const indent = first.match(/^\s*/)[0];
  const inserted = [first, ...lines.map((line) => `${indent}${line}`), ...closing].join('\n');
  return contents.replace(anchor, inserted);
}

// A declared dependency names a coordinate and a version. Older versions of the
// same coordinate are stripped first, so a version bump in config replaces the
// line instead of stacking a second one beside it.
function coordinateOf(line) {
  const match = /["']([^"':]+:[^"':]+):[^"']+["']/.exec(line);
  if (!match) {
    throw new Error(`cap-sync-android: cannot read a group:artifact coordinate from:\n${line}`);
  }
  return match[1];
}

function stripDeclaredCoordinates(contents, lines) {
  return lines.reduce((acc, line) => {
    const escaped = coordinateOf(line).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return acc.replace(new RegExp(`^\\s*implementation ["']${escaped}:[^"']+["']\\n`, 'gm'), '');
  }, contents);
}

execFileSync('node', ['scripts/patch-native-ad-events.mjs', '--check'], { stdio: 'inherit' });
execFileSync('npx', ['cap', 'sync', 'android'], { stdio: 'inherit' });

const config = JSON.parse(fs.readFileSync(androidConfigPath, 'utf8'));
config.appId = appId;
fs.writeFileSync(androidConfigPath, `${JSON.stringify(config, null, '\t')}\n`);

// A configured injection whose target file is gone is the same failure as a
// moved anchor: the block is silently dropped and the build reports success.
// Only a game that configured nothing may find nothing.
function requireTarget(filePath, injections) {
  if (fs.existsSync(filePath)) return true;
  const configured = injections.filter(([, injection]) => injection.lines.length).map(([name]) => name);
  if (!configured.length) return false;
  throw new Error(
    `cap-sync-android: ${path.relative(root, filePath)} does not exist, but ${configured.join(' and ')} `
    + 'expect to be injected into it.',
  );
}

if (requireTarget(androidBuildGradlePath, [
  ['rootGradleClasspaths', rootGradleClasspaths],
  ['rootGradleRepositories', rootGradleRepositories],
])) {
  let gradle = fs.readFileSync(androidBuildGradlePath, 'utf8');
  gradle = addMissingBlock(gradle, rootGradleClasspaths.anchor, rootGradleClasspaths.lines);
  gradle = insertIntoBlock(gradle, rootGradleRepositories.anchor, rootGradleRepositories.lines);
  fs.writeFileSync(androidBuildGradlePath, gradle);
}

if (requireTarget(appCapacitorGradlePath, [['moduleGradleDependencies', moduleGradleDependencies]])) {
  const gradle = fs.readFileSync(appCapacitorGradlePath, 'utf8');
  const cleanGradle = stripDeclaredCoordinates(gradle, moduleGradleDependencies.lines);
  const nextGradle = addMissingBlock(
    cleanGradle,
    moduleGradleDependencies.anchor,
    moduleGradleDependencies.lines,
  );
  fs.writeFileSync(appCapacitorGradlePath, nextGradle);
}

console.log(`Android Capacitor appId set to ${appId}`);
