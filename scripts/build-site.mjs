// Builds the fully static, browser-only version of Doodle Studio into ./site (deployable to Vercel/Netlify/GitHub Pages).
// Everything (script agent, voice, drawing, video encoding) runs in the visitor's browser; no server is needed.
import { mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, 'js'), { recursive: true });
mkdirSync(join(SITE, 'assets'), { recursive: true });

// page
cpSync(join(ROOT, 'web/app.html'), join(SITE, 'index.html'));
// engine + tracing (plain scripts)
cpSync(join(ROOT, 'src/renderer/engine.js'), join(SITE, 'js/engine.js'));
cpSync(join(ROOT, 'src/renderer/strokes-core.js'), join(SITE, 'js/strokes-core.js'));
writeFileSync(join(SITE, 'js/trace_skeleton.js'), readFileSync(join(ROOT, 'node_modules/skeleton-tracing-js/trace_skeleton.vanilla.js'), 'utf8').replace(/export\s+default\s+TraceSkeleton\s*;?/, 'window.TraceSkeleton = TraceSkeleton;'));
writeFileSync(join(SITE, 'js/shapes.js'), readFileSync(join(ROOT, 'src/shapes.mjs'), 'utf8').replace('export function shapeSvg', 'window.shapeSvg = function shapeSvg'));
cpSync(join(ROOT, 'node_modules/mp4-muxer/build/mp4-muxer.js'), join(SITE, 'js/mp4-muxer.js'));
cpSync(join(ROOT, 'node_modules/webm-muxer/build/webm-muxer.js'), join(SITE, 'js/webm-muxer.js'));
// assets
for (const d of ['fonts', 'hands', 'icons', 'illustrations']) cpSync(join(ROOT, 'assets', d), join(SITE, 'assets', d), { recursive: true });
cpSync(join(ROOT, 'assets/hand.svg'), join(SITE, 'assets/hand.svg'));
cpSync(join(ROOT, 'examples/art'), join(SITE, 'assets/art'), { recursive: true });
cpSync(join(ROOT, 'examples/demo-ar.json'), join(SITE, 'assets/demo-ar.json'));
cpSync(join(ROOT, 'prompts/script-writer.md'), join(SITE, 'assets/script-writer.md'));
const tab = join(ROOT, 'node_modules/@tabler/icons/icons/outline');
if (existsSync(tab)) cpSync(tab, join(SITE, 'assets/tabler'), { recursive: true });
// catalog for the UI
const catalog = {
  icons: readFileSync(join(ROOT, 'assets/icons/INDEX.txt'), 'utf8').trim().split(/,\s*/),
  doodles: readdirSync(join(ROOT, 'assets/illustrations/open-doodles')).map((f) => f.replace('.svg', '')),
  peeps: readdirSync(join(ROOT, 'assets/illustrations/peeps')).map((f) => f.replace('.svg', '')),
  tabler: existsSync(tab) ? readdirSync(tab).map((f) => f.replace('.svg', '')) : [],
  hands: JSON.parse(readFileSync(join(ROOT, 'assets/hands/hands.json'), 'utf8')),
  art: readdirSync(join(ROOT, 'examples/art')),
};
writeFileSync(join(SITE, 'assets/catalog.json'), JSON.stringify(catalog));
console.log(`✅ site built: ${SITE} (tabler icons: ${catalog.tabler.length}, doodles: ${catalog.doodles.length}, peeps: ${catalog.peeps.length})`);
