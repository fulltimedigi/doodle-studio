// Smoke test for the served layout.
//
// Each suite page is written against the static build's paths. Three times a page shipped
// referencing something only the build produces, and nobody noticed until it was opened by hand.
// So: start the real server, read every fixed relative path out of every page, and ask for it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, startServer } from './helpers.mjs';

const PAGES = readdirSync(join(ROOT, 'web')).filter((f) => f.endsWith('.html'));
let base, stop;
before(async () => { ({ base, stop } = await startServer()); });
after(() => stop && stop());

/** Fixed relative URLs a file asks for. Anything interpolated at runtime is left to other tests. */
function refs(text) {
  const out = new Set();
  for (const re of [/fetch\(\s*['"`]([^'"`]+)['"`]/g, /\bsrc\s*=\s*"([^"]+)"/g, /\bhref\s*=\s*"([^"]+)"/g, /url\(([^)'"]+\.(?:woff2|ttf|png|svg))\)/g]) {
    for (const m of text.matchAll(re)) {
      const u = m[1].trim();
      if (!u || /^(https?:|data:|mailto:|blob:|#|\/)/.test(u) || u.includes('${') || u.endsWith('.html')) continue;
      out.add(u);
    }
  }
  return [...out];
}

test('every page is served', async () => {
  for (const p of PAGES) {
    const r = await fetch(`${base}/web/${p}`);
    assert.equal(r.status, 200, `/web/${p}`);
  }
  assert.equal((await fetch(base + '/')).status, 200);
});

test('every fixed path the pages ask for is served', async () => {
  const missing = [];
  for (const p of [...PAGES.map((f) => join('web', f)), join('web/js/core.js')]) {
    for (const u of refs(readFileSync(join(ROOT, p), 'utf8'))) {
      const r = await fetch(`${base}/web/${u}`);
      if (!r.ok) missing.push(`${p} -> ${u} (${r.status})`);
    }
  }
  assert.deepEqual(missing, [], 'pages reference paths the server does not serve');
});

test('the generated catalog is served and is real', async () => {
  const r = await fetch(base + '/web/assets/catalog.json');
  assert.equal(r.status, 200);
  const c = await r.json();
  for (const k of ['icons', 'doodles', 'peeps', 'art']) assert.ok(c[k]?.length, `catalog.${k}`);
});

test('the rewritten scripts are served as plain scripts', async () => {
  for (const name of ['trace_skeleton.js', 'shapes.js', 'core.js', 'engine.js']) {
    const r = await fetch(`${base}/web/js/${name}`);
    assert.equal(r.status, 200, name);
    assert.doesNotMatch(await r.text(), /^\s*export\s/m, `${name} is still a module`);
  }
});

test('paths outside the repo are refused', async () => {
  for (const u of ['/web/assets/../../package.json', '/web/js/../../package.json', '/web/../package.json',
    '/assets/..%2f..%2fpackage.json', '/files/../../package.json']) {
    const r = await fetch(base + u);
    assert.ok(!r.ok, `${u} returned ${r.status}`);
  }
});

test('/api/meta describes the workspace', async () => {
  const m = await (await fetch(base + '/api/meta')).json();
  for (const k of ['doodles', 'icons', 'hands', 'voices', 'example', 'settings']) assert.ok(m[k], `meta.${k}`);
  assert.ok(m.doodles.length && m.hands.length);
});
