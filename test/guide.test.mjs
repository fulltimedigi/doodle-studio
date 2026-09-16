// The PDF engine: a real Chromium print, then a look at what came out of it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guideCss, guideHtml, renderGuidePdf } from '../src/guide.mjs';
import { chromiumOrNull } from './helpers.mjs';

const page = (body) => `<div class="page">${body}</div>`;
// A 1×1 red PNG, written beside the document so the renderer has a local image to resolve.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('the print stylesheet carries its fonts inline', () => {
  const css = guideCss();
  assert.doesNotMatch(css, /url\(\.\.\/fonts\//, 'a font is still a relative URL, so it breaks off the source tree');
  assert.match(css, /url\(data:font/, 'no font was inlined');
});

test('page bodies are wrapped into one document', () => {
  const doc = guideHtml([page('أ'), page('ب')], { title: 'دليل الاختبار' });
  assert.match(doc, /<html lang="ar" dir="rtl">/);
  assert.match(doc, /دليل الاختبار/);
  assert.equal(doc.split('class="page"').length - 1, 2);
});

describe('renderGuidePdf', { timeout: 120000 }, () => {
  let dir, ok;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'guide-')); ok = !!(await chromiumOrNull()); });
  after(() => dir && rmSync(dir, { recursive: true, force: true }));

  test('prints A4 pages with selectable text', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup)');
    const out = join(dir, 'guide.pdf');
    const r = await renderGuidePdf([page('<h1>الصفحة الأولى</h1><p>نص</p>'), page('<h1>الصفحة الثانية</h1>')], { out, title: 'دليل' });
    assert.equal(r.pages, 2);
    const buf = readFileSync(out);
    assert.equal(buf.slice(0, 5).toString(), '%PDF-', 'not a PDF');
    assert.ok(buf.includes(Buffer.from('/Font')), 'no embedded font — the text is a flat image, not selectable');
    assert.ok(r.bytes > 10000, `suspiciously small: ${r.bytes}`);
  });

  test('a local image in the document is actually embedded', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup)');
    // A document built with setContent has an about:blank origin and Chromium refuses file://
    // subresources into one, so the images silently vanished. baseDir is what fixes that; this
    // test fails if it ever stops working.
    writeFileSync(join(dir, 'dot.png'), PNG);
    const body = page('<h1>غلاف</h1><img src="dot.png" style="width:400px;height:200px">');
    const withImg = join(dir, 'with.pdf'), without = join(dir, 'without.pdf');
    const a = await renderGuidePdf([body], { out: withImg, baseDir: dir, title: 'د' });
    const b = await renderGuidePdf([page('<h1>غلاف</h1>')], { out: without, baseDir: dir, title: 'د' });
    assert.deepEqual(a.missing, [], 'the image beside the document did not load');
    assert.ok(a.bytes > b.bytes, 'the page with an image is no bigger than the page without one');
    // Without baseDir the same document is printed from an about:blank origin, where Chromium
    // refuses the file:// image — the renderer must report that rather than print a blank box.
    const c = await renderGuidePdf([body], { out: join(dir, 'nobase.pdf'), title: 'د' });
    assert.ok(c.missing.length, 'a subresource that never loaded was not reported');
  });
});
