// Open every page in a real browser and fail on anything the console or the network complains
// about. A page can be served perfectly and still be dead: a missing script, a throw during
// mount, a request that 404s after load. This is the check that opens all of them, every time.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, startServer, chromiumOrNull } from './helpers.mjs';

const PAGES = ['/', ...readdirSync(join(ROOT, 'web')).filter((f) => f.endsWith('.html') && f !== 'local.html').map((f) => '/web/' + f)];
let base, stop, browser;

describe('pages load clean', async () => {
  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  for (const p of PAGES) test(p, async (t) => {
    if (!browser) return t.skip('no chromium installed (npm run setup)');
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`throw: ${e.message}`));
    // Only our own files are on trial here; a page may legitimately reference a third-party font,
    // and whether this machine can reach it says nothing about the page.
    const ours = (url) => url.startsWith(base) || url.startsWith('data:');
    page.on('requestfailed', (r) => { if (ours(r.url())) problems.push(`failed: ${r.url()}`); });
    page.on('response', (r) => { if (ours(r.url()) && r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
    try {
      await page.goto(base + p, { waitUntil: 'networkidle' });
      // The suite header is mounted by script; if it is there, the page's JS ran.
      const mounted = await page.evaluate(() => !!document.querySelector('h1, .logo, header'));
      assert.ok(mounted, 'page rendered nothing');
      assert.deepEqual(problems, [], `${p} reported errors`);
    } finally { await page.close(); }
  });
});
