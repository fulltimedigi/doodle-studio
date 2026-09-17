// The landing page is the only thing the studio makes that a stranger uses. It is exported as one
// file and lives on someone else's host, so the test builds it, serves it, and fills it in like a
// visitor would — including the case where the lead cannot be delivered.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, chromiumOrNull } from './helpers.mjs';

const EXPORTED = 'http://127.0.0.1:1/exported.html';   // never fetched: always fulfilled by a route
const ENDPOINT = 'https://formspree.test/f/abc';
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJfbk/N8K';   // enough to be a real data URL

describe('landing page builder', { timeout: 90000 }, () => {
  let base, stop, browser, ctx, builder;

  const build = (fields) => builder.evaluate((f) => {
    for (const [id, v] of Object.entries(f)) document.getElementById(id).value = v;
    render();
    return buildPage();
  }, fields);

  /** Serve an exported page and drive it as a visitor. Returns the page plus what the form sent. */
  const visit = async (html, { endpointStatus = 200 } = {}) => {
    const page = await ctx.newPage();
    const posted = [];
    await page.route(EXPORTED, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.route(ENDPOINT, async (route) => {
      posted.push(route.request().postData() || '');
      await route.fulfill({ status: endpointStatus, contentType: 'application/json', body: '{}' });
    });
    await page.goto(EXPORTED, { waitUntil: 'domcontentloaded' });
    return { page, posted };
  };

  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    ctx = await browser.newContext({ acceptDownloads: true });
    builder = await ctx.newPage();
    await builder.goto(base + '/web/landing.html', { waitUntil: 'networkidle' });
    await builder.evaluate((pdf) => { PDF = pdf; PDF_NAME = 'guide.pdf'; }, PDF);
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('the exported page carries the copy, the form and the guide', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const html = await build({ headline: 'دليل تجهيز بيانات منتجاتك', sub: 'للتجار على سلة وزد', inside: 'ماذا تكتب في الوصف\nكيف تسمّي الخيارات', cta: 'حمّل الدليل', privacy: 'رسالة أو اثنتان شهريًا', endpoint: ENDPOINT });
    assert.match(html, /<title>دليل تجهيز بيانات منتجاتك<\/title>/);
    assert.match(html, /ماذا تكتب في الوصف/);
    assert.match(html, /كيف تسمّي الخيارات/);
    assert.match(html, /data:application\/pdf/, 'the guide should be embedded in the page');
    assert.match(html, /fonts\.googleapis\.com/, 'the exported file cannot use the studio’s own fonts');
    assert.doesNotMatch(html, /assets\/fonts\//, 'the export must not reference files only the studio has');

    const { page } = await visit(html);
    assert.equal(await page.locator('h1').textContent(), 'دليل تجهيز بيانات منتجاتك');
    assert.equal(await page.locator('li').count(), 2);
    assert.ok(await page.locator('#email').isVisible());
    assert.equal(await page.locator('#thanks').isVisible(), false);
    await page.close();
  });

  test('a visitor’s details reach the endpoint, and the guide downloads', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await builder.evaluate(() => { document.querySelector('#fields input[value=name]').checked = true; render(); });
    const html = await build({ headline: 'الدليل', sub: '', inside: 'نقطة', cta: 'حمّله', privacy: '', endpoint: ENDPOINT });
    const { page, posted } = await visit(html);
    await page.fill('#name', 'محمد');
    await page.fill('#email', 'm@example.com');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#go'),
    ]);
    assert.equal(download.suggestedFilename(), 'guide.pdf');
    await page.waitForSelector('#thanks', { state: 'visible' });
    assert.equal(await page.locator('#f').isVisible(), false, 'the form should give way to the thank-you');
    assert.equal(posted.length, 1, 'the lead never reached the endpoint');
    assert.match(posted[0], /محمد/);
    assert.match(posted[0], /m@example\.com/);
    assert.match(posted[0], /name="source"/, 'the page should say where the lead came from');
    assert.equal(await page.locator('#err').isVisible(), false);
    await page.close();
  });

  test('a rejected lead still gets the guide, and says so', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const html = await build({ headline: 'الدليل', sub: '', inside: 'نقطة', cta: 'حمّله', privacy: '', endpoint: ENDPOINT });
    const { page } = await visit(html, { endpointStatus: 500 });
    await page.fill('#name', 'محمد');
    await page.fill('#email', 'm@example.com');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#go'),
    ]);
    assert.ok(download, 'the visitor was promised a file — a failed lead must not cost them it');
    await page.waitForSelector('#thanks', { state: 'visible' });
    assert.equal(await page.locator('#err').isVisible(), true, 'the failure should be visible, not silent');
    await page.close();
  });

  test('with no endpoint the page still delivers, and the builder warns', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const html = await build({ headline: 'الدليل', sub: '', inside: 'نقطة', cta: 'حمّله', privacy: '', endpoint: '' });
    assert.equal(await builder.locator('#noEndpoint').isVisible(), true, 'a page that drops every lead must say so');
    const { page, posted } = await visit(html);
    await page.fill('#name', 'محمد');          // the name field is still switched on from the test above
    await page.fill('#email', 'm@example.com');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#go')]);
    assert.ok(download);
    assert.equal(posted.length, 0);
    await page.close();
  });

  test('text from the form cannot break out into the page', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const nasty = 'دليل </scr' + 'ipt><img src=x onerror=alert(1)> "مزدوجة"';
    const html = await build({ headline: nasty, sub: '', inside: '<b>عريض</b>', cta: 'حمّله', privacy: '', endpoint: ENDPOINT });
    // The config block legitimately carries the text verbatim — as inert JSON. Everywhere else in
    // the document it must be escaped, and the block itself must not be escapable.
    const cfg = html.match(/<script id="cfg"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(cfg, 'the config block should be there');
    assert.doesNotMatch(cfg[1], /<\/script/i, 'the config can be closed early — everything after it is markup');
    assert.doesNotMatch(html.replace(cfg[0], ''), /<img src=x/, 'raw markup survived into the page');
    const { page } = await visit(html);
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.waitForSelector('#go');
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.match(await page.locator('h1').textContent(), /onerror=alert\(1\)/, 'the text should be printed, not run');
    assert.match(await page.locator('li').first().textContent(), /<b>عريض<\/b>/);
    assert.deepEqual(problems, [], 'the injected text broke the page script');
    await page.close();
  });
});
