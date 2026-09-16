// The published layout is the contract the suite pages are written against. These tests hold the
// description honest: every source it names exists, nothing resolves outside the repo, and the
// catalog is real rather than empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS, SCRIPTS, GENERATED, catalog, assetSource, scriptSource } from '../src/site-map.mjs';
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
