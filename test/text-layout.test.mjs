// Arabic text on the doodle board: a long sentence must wrap inside its box and shrink until it
// fits, never be cut at the edge of the box or the frame, stay out of the brand mark's corner, and
// look the same in the two ways a video is produced — the CLI screenshots the page (DOM), the
// browser export repaints onto a canvas (paint).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromiumOrNull } from './helpers.mjs';
import { ROOT, fontCss } from '../src/project.mjs';

const LONG = 'العميل يسألك الساعة ثلاثة الفجر عن الخامة والمقاس والسعر وإنت نايم، وكل إجابة لازم تكون من كلامك أنت';
const T = (id, content, box, extra = {}) => ({ id, kind: 'text', content, ...box, start: 0.1, draw: 1, ...extra });

const project = ({ W = 1080, H = 1920, logo = null, els }) => ({
  width: W, height: H,
  defaults: { font: '"Patrick Hand","Cairo",cursive', fontSize: '7%', textColor: '#1d1d1d', strokeColor: '#222', strokeWidth: 9, background: '#ffffff', transition: 'fade', transitionDuration: 0.4, hold: 0.9, gap: 0.15, minDraw: 0.7, maxDraw: 4 },
  board: { style: 'white', layout: 'scenes', color: '#ffffff' },
  hand: { src: '', naturalWidth: 420, naturalHeight: 520, tip: [14, 14], height: 300, hidden: true },
  logo, scenes: [{ start: 0, end: 3, elements: els }], duration: 3, title: 't', audio: [],
});

describe('Arabic text layout', { timeout: 180000 }, () => {
  let browser, page, logoUrl;
  const build = async (p) => {
    await page.setViewportSize({ width: p.width, height: p.height });
    await page.evaluate((pp) => window.doodle.build(pp), p);
    await page.evaluate(() => window.doodle.seek(2.9));
  };
  // every line of every text element, as laid out on the page, in stage pixels
  const lines = () => page.evaluate(() => [...document.querySelectorAll('#stage .el')].filter((el) => el.querySelector('.text')).map((el) => {
    const box = el.getBoundingClientRect();
    return { box: { l: box.left, r: box.right, t: box.top, b: box.bottom }, font: parseFloat(el.querySelector('.text').style.fontSize),
      lines: [...el.querySelectorAll('.line')].map((l) => { const w = [...l.querySelectorAll('.w')].map((x) => x.getBoundingClientRect()); return { text: l.textContent, l: Math.min(...w.map((x) => x.left)), r: Math.max(...w.map((x) => x.right)), t: Math.min(...w.map((x) => x.top)), b: Math.max(...w.map((x) => x.bottom)), clip: l.style.clipPath }; }) };
  }));

  before(async () => {
    const c = await chromiumOrNull(); if (!c) return;
    browser = await c.chromium.launch(c.options);
    page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto(pathToFileURL(join(ROOT, 'src/renderer/page.html')).href);
    await page.addStyleTag({ content: fontCss() });
    logoUrl = 'data:image/png;base64,' + readFileSync(join(ROOT, 'assets/brand/fd-logo.png')).toString('base64');
  });
  after(async () => { if (browser) await browser.close(); });

  for (const [W, H] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
    test(`a long sentence wraps and fits its box, every word kept (${W}x${H})`, async (t) => {
      if (!browser) return t.skip('needs chromium (npm run setup)');
      await build(project({ W, H, els: [T(1, LONG, { x: '6%', y: '25%', w: '88%', h: '20%', size: '8%' })] }));
      const [el] = await lines();
      assert.ok(el.lines.length > 1, 'wrapped onto several lines');
      assert.equal(el.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim(), LONG, 'no word lost');
      for (const l of el.lines) {
        assert.ok(l.l >= el.box.l - 1 && l.r <= el.box.r + 1, `line inside the box: ${l.text}`);
        assert.ok(l.l >= 0 && l.r <= W, 'line inside the frame');
        assert.equal(l.clip, 'none', 'a finished line is not clipped');
      }
      assert.ok(el.font < H * 0.08, 'shrunk to fit');
    });
  }

  test('a short line keeps the size it asked for', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ els: [T(1, 'خلّها علينا', { x: '10%', y: '45%', w: '80%', h: '10%', size: '9%' })] }));
    const [el] = await lines();
    assert.equal(el.lines.length, 1);
    assert.ok(Math.abs(el.font - 1920 * 0.09) < 0.5, `font ${el.font} box ${JSON.stringify(el.box)} lines ${JSON.stringify(el.lines)}`);
  });

  test('text stays out of the brand mark and inside the safe area', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ logo: { src: logoUrl, ratio: 1.41, height: '7%', margin: '4%', corner: 'top-right', opacity: 0.9 },
      els: [T(1, 'متجرك يستاهل عميل يفهمه', { x: '6%', y: '2%', w: '88%', h: '12%', size: '7%' })] }));
    const mb = await page.evaluate(() => window.doodle.markBox());
    const [el] = await lines();
    for (const l of el.lines) assert.ok(l.r <= mb.x || l.t >= mb.y + mb.h || l.b <= mb.y, `line clear of the mark: ${l.text}`);
    assert.ok(el.box.t >= 1920 * 0.06 - 1, 'below the top safe margin');
  });

  test('fit: false keeps the author\'s lines exactly', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ els: [T(1, 'سطر أول\nسطر ثاني', { x: '6%', y: '25%', w: '88%', h: '20%', size: '7%', fit: false })] }));
    const [el] = await lines();
    assert.deepEqual(el.lines.map((l) => l.text), ['سطر أول', 'سطر ثاني']);
  });

  test('the exported frame (canvas) matches the page (DOM)', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ els: [
      T(1, LONG, { x: '6%', y: '20%', w: '88%', h: '26%', size: '7%' }),
      T(2, 'إعلانك يجيب العميل… وإحنا نساعده يختار', { x: '6%', y: '60%', w: '88%', h: '14%', size: '8%' }, { anim: 'pop' }),
    ] }));
    const dom = await page.screenshot({ type: 'png' });
    const diff = await page.evaluate(async (b64) => {
      const im = new Image(); await new Promise((ok) => { im.onload = ok; im.src = 'data:image/png;base64,' + b64; });
      const W = im.width, H = im.height;
      const a = document.createElement('canvas'); a.width = W; a.height = H; const ax = a.getContext('2d'); ax.drawImage(im, 0, 0);
      const c = document.createElement('canvas'); c.width = W; c.height = H; window.doodle.paint(c.getContext('2d'), 1, null);
      const da = ax.getImageData(0, 0, W, H).data, dc = c.getContext('2d').getImageData(0, 0, W, H).data;
      let inkA = 0, inkC = 0, both = 0;
      for (let i = 0; i < W * H; i++) { const pa = da[i * 4] < 128, pc = dc[i * 4] < 128; inkA += pa; inkC += pc; both += pa && pc; }
      return { inkA, inkC, both };
    }, dom.toString('base64'));
    assert.ok(diff.inkA > 5000, 'there is text on the page');
    assert.ok(Math.abs(diff.inkA - diff.inkC) / diff.inkA < 0.05, `same amount of ink: ${diff.inkA} vs ${diff.inkC}`);
    assert.ok(diff.both / diff.inkA > 0.85, `ink in the same places: ${(diff.both / diff.inkA).toFixed(3)}`);
  });
});
