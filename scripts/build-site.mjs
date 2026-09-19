// Builds the fully static, browser-only version of Doodle Studio into ./site (deployable to Vercel/Netlify/GitHub Pages).
// Everything (script agent, voice, drawing, video encoding) runs in the visitor's browser; no server is needed.
//
// What goes where is described in src/site-map.mjs, which src/server.mjs reads too, so the static
// build and the served source tree cannot disagree about the layout the pages are written against.
import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ASSETS, PAGES, SCRIPTS, GENERATED, catalog } from '../src/site-map.mjs';
import { ROOT } from '../src/project.mjs';

const SITE = join(ROOT, 'site');
rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, 'js'), { recursive: true });
mkdirSync(join(SITE, 'assets'), { recursive: true });

// pages
for (const p of PAGES) {
  const from = join(ROOT, 'web', p.from);
  if (!existsSync(from)) throw new Error(`missing page source: web/${p.from}`);
  cpSync(from, join(SITE, p.to));
}
cpSync(join(ROOT, 'web/css'), join(SITE, 'css'), { recursive: true });

// scripts — copied, or rewritten from a module source into a plain script
for (const [name, s] of Object.entries(SCRIPTS)) {
  const from = join(ROOT, s.from);
  if (!existsSync(from)) throw new Error(`missing script source: ${s.from}`);
  const to = join(SITE, 'js', name);
  if (s.rewrite) writeFileSync(to, s.rewrite(readFileSync(from, 'utf8')));
  else cpSync(from, to);
}

// assets
for (const a of ASSETS) {
  const from = join(ROOT, a.from);
  if (!existsSync(from)) { if (a.optional) continue; throw new Error(`missing asset source: ${a.from}`); }
  const to = join(SITE, 'assets', a.to);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, a.dir ? { recursive: true } : {});
}
for (const [name, build] of Object.entries(GENERATED)) writeFileSync(join(SITE, 'assets', name), build());

cpSync(join(ROOT, 'deploy/netlify.toml'), join(SITE, 'netlify.toml'));
const c = catalog();
console.log(`✅ site built: ${SITE} (tabler icons: ${c.tabler.length}, doodles: ${c.doodles.length}, peeps: ${c.peeps.length})`);
