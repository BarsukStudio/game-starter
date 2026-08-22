import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { BUILD_CONFIG } from './build.config.mjs';
import { readRuntimeReadyGlobal, readRuntimeTargetGlobal } from './lib/runtime-target-global.mjs';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const outRoot = path.join(root, BUILD_CONFIG.web.outDir);

// The platform marker is emitted as a file rather than an inline script so no
// target has to widen the CSP with 'unsafe-inline'.
const PLATFORM_MARKER_FILE = 'platform-target.js';

// Every target this game ships, straight from its own build config: which
// directory it lands in, what the marker declares, which SDK hosts its policy
// has to allow, and the markup it needs in the page. All of that is the game's —
// a template that named a portal would be a template for one game.
export const targets = BUILD_CONFIG.web.targets;

const CSP_META_PATTERN = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;

function parseCsp(content) {
  const directives = new Map();
  for (const chunk of content.split(';')) {
    const tokens = chunk.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

function serializeCsp(directives) {
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

function widen(directives, name, sources, fallback) {
  if (!directives.has(name)) directives.set(name, [...fallback]);
  const current = directives.get(name);
  for (const source of sources) {
    if (!current.includes(source)) current.push(source);
  }
}

/**
 * Widen the shared native policy by exactly what a portal target needs.
 * The base policy is read back from the built html so `src/index.html` stays
 * the single owner of the strict default.
 */
export function buildCsp(content, config) {
  const directives = parseCsp(content);
  const fallback = directives.get('default-src') ?? ["'self'"];

  // Without an explicit script-src, scripts fall back to default-src ('self'),
  // which blocks every portal SDK.
  widen(directives, 'script-src', config.scriptSrc, fallback);
  if (!config.scriptSrc.length) return serializeCsp(directives);

  // Portal ad delivery fans out over many hosts that neither portal documents
  // exhaustively. Keep script execution pinned to the SDK origins above and
  // allow the passive fetches those ads need.
  widen(directives, 'connect-src', ['https:'], ["'self'", 'data:']);
  widen(directives, 'img-src', ['https:'], ["'self'", 'data:']);
  widen(directives, 'frame-src', ['https:'], ["'self'"]);
  return serializeCsp(directives);
}

// Subscripted, never dotted: the name comes from config, where the schema allows
// any non-empty string, and only some of those are valid JavaScript identifiers.
export function renderPlatformMarker(config, source) {
  const target = readRuntimeTargetGlobal(source);
  const lines = [`window[${JSON.stringify(target)}] = ${JSON.stringify(config.platform)};`];
  if (config.ready) lines.push(`window[${JSON.stringify(readRuntimeReadyGlobal(source))}] = true;`);
  return `${lines.join('\n')}\n`;
}

/**
 * Every replacement below is asserted: a silently skipped injection would ship
 * a portal build that quietly falls back to the generic provider.
 */
export function injectIndexHtml(html, config) {
  if (!CSP_META_PATTERN.test(html)) {
    throw new Error('Content-Security-Policy meta tag not found in index.html');
  }
  let result = html.replace(
    CSP_META_PATTERN,
    (match, prefix, content, suffix) => `${prefix}${buildCsp(content, config)}${suffix}`
  );

  // The marker must run before the deferred module that reads it.
  const head = [
    ...config.head,
    `<script src="./${PLATFORM_MARKER_FILE}"></script>`,
  ];
  if (!result.includes('</head>')) throw new Error('No </head> in index.html');
  result = result.replace('</head>', `  ${head.join('\n  ')}\n</head>`);

  if (config.bodyEnd.length) {
    if (!result.includes('</body>')) throw new Error('No </body> in index.html');
    result = result.replace('</body>', `  ${config.bodyEnd.join('\n  ')}\n</body>`);
  }
  return result;
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  const targetArg = process.argv[2] || 'all';
  const buildFirst = !process.argv.includes('--no-build');
  const selected = targetArg === 'all'
    ? Object.keys(targets)
    : targetArg.split(',').map((s) => s.trim()).filter(Boolean);

  for (const target of selected) {
    if (!targets[target]) {
      console.error(`Unknown target: ${target}`);
      process.exit(1);
    }
  }

  if (buildFirst) {
    execFileSync(process.execPath, ['scripts/vite-run.mjs', 'build'], { stdio: 'inherit' });
  }

  if (!fs.existsSync(distDir)) {
    console.error('dist/ does not exist. Run a build first.');
    process.exit(1);
  }

  fs.mkdirSync(outRoot, { recursive: true });

  for (const target of selected) {
    const config = targets[target];
    const targetDir = path.join(outRoot, config.dir);
    copyDir(distDir, targetDir);

    const indexPath = path.join(targetDir, 'index.html');
    fs.writeFileSync(indexPath, injectIndexHtml(fs.readFileSync(indexPath, 'utf8'), config));
    fs.writeFileSync(path.join(targetDir, PLATFORM_MARKER_FILE), renderPlatformMarker(config));

    console.log(`Prepared ${target} build in ${path.relative(root, targetDir)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
