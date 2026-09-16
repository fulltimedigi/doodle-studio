// The carousel export runs entirely in the browser — html-to-image, then JSZip. When one of its
// vendored scripts went missing the whole export was dead and the page still looked fine, so this
// test drives the real export path in a real browser and measures what comes out of it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, chromiumOrNull } from './helpers.mjs';

const DECK = {
  topic: 'اختبار',
  caption: 'كابشن',
  hashtags: ['#تجربة'],
  slides: [
    { role: 'cover', title: 'عنوان الغلاف', sub: 'سطر فرعي' },
    { role: 'point', title: 'النقطة الأولى', body: 'شرح قصير' },
    { role: 'cta', title: 'ابدأ الآن', body: 'رابط في البايو' },
  ],
};

describe('carousel export', { timeout: 120000 }, () => {
  let base, stop, browser, page;
  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    page = await browser.newPage();
    await page.goto(base + '/web/carousel.html', { waitUntil: 'networkidle' });
    await page.evaluate((d) => { DATA = d; render(); }, DECK);
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('the three canvas sizes each export at their own height', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    for (const h of [1080, 1350, 1920]) {
      const got = await page.evaluate(async (height) => {
        const blob = await renderPng(0, height);
        const bmp = await createImageBitmap(blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = cv.getContext('2d');
        cx.drawImage(bmp, 0, 0);
        // Sample a grid; a blank export is one colour everywhere.
        const seen = new Set();
        for (let x = 20; x < bmp.width; x += 97) for (let y = 20; y < bmp.height; y += 97) {
          const [r, g, b] = cx.getImageData(x, y, 1, 1).data;
          seen.add(`${r},${g},${b}`);
        }
        return { w: bmp.width, h: bmp.height, bytes: blob.size, colors: seen.size };
      }, h);
      assert.equal(got.w, 1080, `${h}: width`);
      assert.equal(got.h, h, `${h}: height`);
      assert.ok(got.bytes > 3000, `${h}: the PNG is suspiciously small (${got.bytes})`);
      assert.ok(got.colors > 1, `${h}: the export is a blank rectangle`);
    }
  });

  test('every slide renders, and the ZIP names them per size', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const names = await page.evaluate(async () => {
      const files = [];
      for (const z of [{ id: '4x5', h: 1350 }, { id: '9x16', h: 1920 }]) {
        for (let i = 0; i < DATA.slides.length; i++) files.push([`${z.id}/slide-${String(i + 1).padStart(2, '0')}.png`, await renderPng(i, z.h)]);
      }
      files.push(['caption.txt', new Blob([DATA.caption], { type: 'text/plain' })]);
      const zip = await Suite.zipBlobs(files);
      const entries = Object.keys(await window.JSZip.loadAsync(zip).then((z) => z.files));
      return { entries, bytes: zip.size };
    });
    assert.ok(names.entries.includes('4x5/slide-01.png'), names.entries.join(','));
    assert.ok(names.entries.includes('9x16/slide-03.png'), names.entries.join(','));
    assert.ok(names.entries.includes('caption.txt'));
    assert.ok(names.bytes > 10000, `the ZIP is suspiciously small (${names.bytes})`);
  });
});
