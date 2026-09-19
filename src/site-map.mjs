// The published layout of the studio, described once.
//
// The suite pages are written against the static build's layout: scripts under `js/`, everything
// else under `assets/`. That layout does not exist in the source tree — `js/` is assembled out of
// node_modules and src, and half of `assets/` is gathered from examples/ and prompts/. So there
// are two ways to serve the same pages, and every time they were described separately one of them
// drifted and a page 404'd. This module is the single description both of them read:
// scripts/build-site.mjs copies what it lists, src/server.mjs resolves against the same list.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ROOT } from './project.mjs';

const TABLER = 'node_modules/@tabler/icons/icons/outline';
const FONTSOURCE = [
  ['cairo', ['cairo-arabic-400-normal', 'cairo-arabic-700-normal', 'cairo-arabic-900-normal']],
  ['tajawal', ['tajawal-arabic-400-normal', 'tajawal-arabic-700-normal', 'tajawal-arabic-800-normal']],
];

/** Scripts published under `js/`. `rewrite` turns a module source into a plain script. */
export const SCRIPTS = {
  'core.js': { from: 'web/js/core.js' },
  'signal.js': { from: 'web/js/signal.js' },
  'html-to-image.js': { from: 'node_modules/html-to-image/dist/html-to-image.js' },
  'jszip.min.js': { from: 'node_modules/jszip/dist/jszip.min.js' },
  'jspdf.umd.min.js': { from: 'node_modules/jspdf/dist/jspdf.umd.min.js' },
  'engine.js': { from: 'src/renderer/engine.js' },
  'strokes-core.js': { from: 'src/renderer/strokes-core.js' },
  'mp4-muxer.js': { from: 'node_modules/mp4-muxer/build/mp4-muxer.js' },
  'webm-muxer.js': { from: 'node_modules/webm-muxer/build/webm-muxer.js' },
  'trace_skeleton.js': {
    from: 'node_modules/skeleton-tracing-js/trace_skeleton.vanilla.js',
    rewrite: (t) => t.replace(/export\s+default\s+TraceSkeleton\s*;?/, ';(typeof self !== "undefined" ? self : window).TraceSkeleton = TraceSkeleton;'),
  },
  'shapes.js': {
    from: 'src/shapes.mjs',
    rewrite: (t) => t.replace('export function shapeSvg', 'window.shapeSvg = function shapeSvg'),
  },
};

/**
 * The pages, as { to (published name), from (file under web/) }.
 *
 * `app.html` is published as `doodle.html`, and `local.html` only makes sense with the server
 * behind it, so the mapping is not a plain directory copy. It used to be a hand-written list
 * inside the build script, which meant a new unit shipped everywhere except the published site —
 * silently, because the dev server reads web/ directly and never notices. Now a page is only in
 * the studio if it is in this list, and a test walks web/ to catch the one that was forgotten.
 */
export const PAGES = [
  { to: 'index.html', from: 'index.html' },
  { to: 'doodle.html', from: 'app.html' },
  ...['reels.html', 'carousel.html', 'case.html', 'ad.html', 'ugc.html', 'magnet.html', 'logo.html',
    'reel.html', 'plan.html', 'board.html', 'landing.html'].map((f) => ({ to: f, from: f })),
];

/** Pages that deliberately never reach the static build. */
export const SERVER_ONLY = ['local.html'];

/**
 * Everything published under `assets/`, as { to (published path), from (source path) }.
 * `dir` entries publish a whole tree; `optional` entries may legitimately be absent.
 */
export const ASSETS = [
  { to: 'fonts', from: 'assets/fonts', dir: true },
  { to: 'hands', from: 'assets/hands', dir: true },
  { to: 'icons', from: 'assets/icons', dir: true },
  { to: 'illustrations', from: 'assets/illustrations', dir: true },
  { to: 'brand', from: 'assets/brand', dir: true },
  { to: 'hand.svg', from: 'assets/hand.svg' },
  // Gathered from outside assets/ by the build — the reason the server needs this map at all.
  { to: 'art', from: 'examples/art', dir: true },
  { to: 'demo-ar.json', from: 'examples/demo-ar.json' },
  { to: 'prompts', from: 'prompts', dir: true },
  { to: 'script-writer.md', from: 'prompts/script-writer.md' },
  { to: 'tabler', from: TABLER, dir: true, optional: true },
  ...FONTSOURCE.flatMap(([pkg, files]) => files.map((f) => ({
    to: `fonts/${f}.woff2`, from: `node_modules/@fontsource/${pkg}/files/${f}.woff2`,
  }))),
];

/** The index the doodle editor loads at startup: what art, icons and characters exist. */
export function catalog() {
  const tab = join(ROOT, TABLER);
  return {
    icons: readFileSync(join(ROOT, 'assets/icons/INDEX.txt'), 'utf8').trim().split(/,\s*/),
    doodles: readdirSync(join(ROOT, 'assets/illustrations/open-doodles')).map((f) => f.replace('.svg', '')),
    peeps: readdirSync(join(ROOT, 'assets/illustrations/peeps')).map((f) => f.replace('.svg', '')),
    tabler: existsSync(tab) ? readdirSync(tab).map((f) => f.replace('.svg', '')) : [],
    hands: JSON.parse(readFileSync(join(ROOT, 'assets/hands/hands.json'), 'utf8')),
    art: readdirSync(join(ROOT, 'examples/art')),
  };
}

/** Published paths the build writes rather than copies. */
export const GENERATED = { 'catalog.json': () => JSON.stringify(catalog()) };

/** Resolve `base/rel` only when it stays inside `base`. */
function inside(base, rel) {
  const r = resolve(base, String(rel).replace(/^\/+/, ''));
  return r === base || r.startsWith(base + sep) ? r : null;
}

/**
 * The source file behind a published `assets/...` path, or null if there is none.
 * Longest matching entry wins, so `fonts/cairo-…woff2` beats the `fonts` directory.
 */
export function assetSource(rel) {
  const p = String(rel).replace(/^\/+/, '');
  let best = null;
  for (const a of ASSETS) {
    if (a.dir ? (p === a.to || p.startsWith(a.to + '/')) : p === a.to) {
      if (!best || a.to.length > best.to.length || (a.to.length === best.to.length && !a.dir)) best = a;
    }
  }
  if (!best) return null;
  const base = join(ROOT, best.from);
  const file = best.dir ? inside(base, p.slice(best.to.length)) : base;
  return file && existsSync(file) && !statSync(file).isDirectory() ? file : null;
}

/** The source file behind a published `js/...` path, plus its rewrite, or null. */
export function scriptSource(name) {
  const s = SCRIPTS[String(name)];
  if (!s) return null;
  const file = join(ROOT, s.from);
  return existsSync(file) ? { file, rewrite: s.rewrite || null } : null;
}
