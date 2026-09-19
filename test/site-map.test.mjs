// The published layout is the contract the suite pages are written against. These tests hold the
// description honest: every source it names exists, nothing resolves outside the repo, and the
// catalog is real rather than empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { ASSETS, PAGES, SCRIPTS, SERVER_ONLY, GENERATED, catalog, assetSource, scriptSource } from '../src/site-map.mjs';
import { ROOT } from '../src/project.mjs';

test('every published script has a source', () => {
  for (const [name, s] of Object.entries(SCRIPTS)) {
    assert.ok(existsSync(join(ROOT, s.from)), `${name} <- ${s.from}`);
    assert.ok(scriptSource(name), `${name} does not resolve`);
  }
});

test('the rewritten scripts really stop being modules', () => {
  for (const name of ['trace_skeleton.js', 'shapes.js']) {
    const { file, rewrite } = scriptSource(name);
    assert.ok(rewrite, `${name} should be rewritten`);
    const out = rewrite(readFileSync(file, 'utf8'));
    assert.doesNotMatch(out, /^\s*export\s/m, `${name} still exports`);
  }
});

test('every published asset has a source', () => {
  for (const a of ASSETS) {
    if (a.optional && !existsSync(join(ROOT, a.from))) continue;
    assert.ok(existsSync(join(ROOT, a.from)), `${a.to} <- ${a.from}`);
  }
});

test('the pages own asset paths resolve', () => {
  const c = catalog();
  const paths = [
    'demo-ar.json', 'script-writer.md', 'hand.svg', 'brand/fd-logo.png', 'icons/INDEX.txt',
    'hands/hands.json', 'prompts/reel.md', 'prompts/plan.md', 'prompts/carousel.md',
    'fonts/cairo-arabic-700-normal.woff2', 'fonts/tajawal-arabic-400-normal.woff2',
    `art/${c.art[0]}`, `illustrations/open-doodles/${c.doodles[0]}.svg`, `illustrations/peeps/${c.peeps[0]}.svg`,
  ];
  if (c.tabler.length) paths.push(`tabler/${c.tabler[0]}.svg`);
  for (const p of paths) assert.ok(assetSource(p), `assets/${p} does not resolve`);
});

test('nothing resolves outside the repo', () => {
  for (const p of ['../package.json', '../../etc/passwd', 'art/../../package.json', '/etc/passwd', 'prompts/../../src/server.mjs']) {
    const f = assetSource(p);
    assert.ok(f === null || f.startsWith(ROOT), `${p} escaped to ${f}`);
  }
  assert.equal(scriptSource('../../package.json'), null);
});

test('the catalog is populated', () => {
  const c = catalog();
  for (const k of ['icons', 'doodles', 'peeps', 'art']) assert.ok(c[k].length, `catalog.${k} is empty`);
  assert.ok(Object.keys(c.hands).length, 'catalog.hands is empty');
  assert.ok(JSON.parse(GENERATED['catalog.json']()).doodles.length);
});

// A page that exists in web/ but is missing from the build reaches nobody, and nothing complains:
// the dev server reads web/ directly, so it looks right locally and is simply absent in the studio
// people actually open. That is how a whole unit can be finished, committed and never shipped.
test('every page in web/ is either published or deliberately left out', () => {
  const published = new Set(PAGES.map((p) => p.from));
  const excused = new Set(SERVER_ONLY);
  for (const f of readdirSync(join(ROOT, 'web')).filter((f) => f.endsWith('.html'))) {
    assert.ok(published.has(f) || excused.has(f),
      `web/${f} is in neither PAGES nor SERVER_ONLY — it would never reach the published studio`);
  }
  for (const p of PAGES) assert.ok(existsSync(join(ROOT, 'web', p.from)), `PAGES names a missing file: web/${p.from}`);
});

// Every tile on the front page has to lead somewhere that gets built.
test('the hub only links to pages that ship', () => {
  const hub = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
  const to = new Set(PAGES.map((p) => p.to));
  const links = [...hub.matchAll(/href: '([a-z0-9-]+\.html)/g)].map((m) => m[1]);
  assert.ok(links.length > 8, 'the hub tiles were not found — this test stopped checking anything');
  for (const l of links) assert.ok(to.has(l), `the hub links to ${l}, which the build never publishes`);
});
