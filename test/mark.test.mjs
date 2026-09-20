// A doodle opens on an empty board, so the frame a platform grabs for a thumbnail is plain white:
// a profile grid of blank tiles that say nothing about whose they are. The brand mark fixes that
// only if it is on the very first frame and in BOTH ways the video is produced — the CLI
// screenshots the DOM, the browser export repaints onto a canvas, and those are two separate
// pieces of code that have to agree about a logo neither of them owns.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, chromiumOrNull } from './helpers.mjs';
import { ROOT } from '../src/project.mjs';

const LOGO = 'assets/brand/fd-logo.png';

/** A one-scene project, as the compiler hands it to the engine. */
const project = (logo) => ({
  width: 1080, height: 1920,
  defaults: { font: '"Cairo",sans-serif', fontSize: '7%', textColor: '#1d1d1d', strokeColor: '#222', strokeWidth: 9, background: '#ffffff', transition: 'fade', transitionDuration: 0.4, hold: 0.9, gap: 0.15, minDraw: 0.7, maxDraw: 4 },
  board: { style: 'white', layout: 'scenes', color: '#ffffff' },
  hand: { src: '', naturalWidth: 420, naturalHeight: 520, tip: [14, 14], height: 300, hidden: true },
  logo,
  scenes: [{ start: 0, end: 4, elements: [{ id: 1, type: 'text', text: 'مرحبا', x: 100, y: 800, w: 880, h: 200, start: 1.5, draw: 1 }] }],
  duration: 4, title: 't', audio: [],
});

describe('brand mark on the doodle', { timeout: 120000 }, () => {
  let browser, page, logoUrl;

  /** Build a project in the real renderer page and return the page. */
  const build = async (p) => {
    await page.evaluate((pp) => window.doodle.build(pp), p);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.doodle.seek(0));
    return page;
  };

  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    browser = await c.chromium.launch(c.options);
    page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto(pathToFileURL(join(ROOT, 'src/renderer/page.html')).href);
    logoUrl = 'data:image/png;base64,' + readFileSync(join(ROOT, LOGO)).toString('base64');
  });
  after(async () => { if (browser) await browser.close(); });

  test('the very first frame is branded, not blank', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ src: logoUrl, ratio: 1.41, height: '7%', margin: '4%', corner: 'top-right', opacity: 0.9 }));
    const shot = await page.screenshot({ type: 'png' });
    // Count the non-white pixels in the top-right corner of the frame the platform would grab.
    const ink = await page.evaluate(async (b64) => {
      const im = new Image();
      await new Promise((ok) => { im.onload = ok; im.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const box = window.doodle.markBox();
      const d = x.getImageData(box.x, box.y, box.w, box.h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 230 || d[i + 1] < 230 || d[i + 2] < 230) n++;
      return { n, total: d.length / 4 };
    }, shot.toString('base64'));
    assert.ok(ink.n / ink.total > 0.05,
      `frame 0 is still blank where the mark should be (${ink.n}/${ink.total} pixels inked)`);
  });

  test('the DOM and the canvas put it in the same place', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ src: logoUrl, ratio: 1.41, height: '7%', margin: '4%', corner: 'top-right', opacity: 0.9 }));
    const agree = await page.evaluate(() => {
      const box = window.doodle.markBox();
      const el = document.getElementById('mark');
      const dom = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
      // paint() onto a canvas the way the browser export does, then find the inked bounds.
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
      const x = c.getContext('2d'); window.doodle.paint(x, 1, null);
      const d = x.getImageData(0, 0, 1080, 1920).data;
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) continue;
        const px = (i / 4) % 1080, py = Math.floor((i / 4) / 1080);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      return { box, dom, painted: { minX, minY, maxX, maxY } };
    });
    // The DOM element is placed from markBox(), so they must match exactly.
    assert.deepEqual(agree.dom, { x: agree.box.x, y: agree.box.y, w: agree.box.w, h: agree.box.h },
      'the DOM mark drifted from the shared geometry');
    // At t=0 nothing else is drawn, so whatever the canvas inked is the mark — and it has to land
    // inside the same box, or the two renderers are producing different videos.
    const p = agree.painted, b = agree.box;
    assert.ok(p.maxX > 0, 'the canvas painter drew no mark at all');
    assert.ok(p.minX >= b.x - 2 && p.maxX <= b.x + b.w + 2, `painted x ${p.minX}-${p.maxX} outside ${b.x}-${b.x + b.w}`);
    assert.ok(p.minY >= b.y - 2 && p.maxY <= b.y + b.h + 2, `painted y ${p.minY}-${p.maxY} outside ${b.y}-${b.y + b.h}`);
  });

  test('every corner is respected, and the mark stays inside the frame', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    for (const corner of ['top-right', 'top-left', 'bottom-right', 'bottom-left']) {
      await build(project({ src: logoUrl, ratio: 1.41, height: '7%', margin: '4%', corner, opacity: 0.9 }));
      const b = await page.evaluate(() => window.doodle.markBox());
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1080 && b.y + b.h <= 1920, `${corner} put the mark off the frame`);
      assert.equal(b.x > 540, corner.endsWith('right'), `${corner} landed on the wrong side`);
      assert.equal(b.y > 960, corner.startsWith('bottom'), `${corner} landed at the wrong height`);
    }
  });

  test('no logo means no mark — the studio does not brand your video for you', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    for (const logo of [null, undefined, { src: '' }]) {
      await build(project(logo));
      assert.equal(await page.evaluate(() => window.doodle.markBox()), null, `markBox() invented a mark from ${JSON.stringify(logo)}`);
      assert.equal(await page.evaluate(() => document.getElementById('mark').style.display), 'none');
      const painted = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
        const x = c.getContext('2d'); window.doodle.paint(x, 1, null);
        const d = x.getImageData(0, 0, 1080, 400).data;   // the corner the mark would occupy
        for (let i = 0; i < d.length; i += 4) if (d[i] < 230 || d[i + 1] < 230 || d[i + 2] < 230) return true;
        return false;
      });
      assert.equal(painted, false, `something was painted for ${JSON.stringify(logo)}`);
    }
  });

  test('the mark survives being rebuilt without a logo', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await build(project({ src: logoUrl, ratio: 1.41, height: '7%', margin: '4%', corner: 'top-right', opacity: 0.9 }));
    assert.notEqual(await page.evaluate(() => document.getElementById('mark').style.display), 'none');
    await build(project(null));
    assert.equal(await page.evaluate(() => document.getElementById('mark').style.display), 'none',
      'the previous project’s logo stayed on screen — a rebuild must clear it');
  });

  // The renderer page is not the only page the engine runs in. In the studio it shares a document
  // with the whole doodle unit, and the unit's own toggle was called #mark — so the engine picked
  // up a checkbox, asked it for a naturalWidth, and painted nothing at all. Every other test here
  // still passed, because they all run in the clean renderer page. So this one drives the unit.
  test('the mark reaches the export canvas inside the studio itself', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const { base, stop } = await startServer();
    const ctx = await browser.newContext();
    try {
      await ctx.addInitScript((b) => { localStorage.setItem('brand', b); localStorage.setItem('gemini_key', 'k'); },
        JSON.stringify({ name: 'T', sells: 's', audience: 'a', dialect: 'white', tones: ['تعليمي'], cta: 'c', logo: logoUrl, colors: { primary: '#0b3b33', accent: '#00b478', bg: '#ffffff' } }));
      const unit = await ctx.newPage();
      const errors = [];
      unit.on('pageerror', (e) => errors.push(e.message));
      await unit.goto(base + '/web/app.html', { waitUntil: 'networkidle' });

      const out = await unit.evaluate(async () => {
        SCRIPT = { title: 'ت', format: '9:16', hand: 'marker-a', board: 'white', layout: 'fade', music: 'none', sfx: false,
          scenes: [{ narration: '', elements: [{ type: 'text', text: 'نص', x: '10%', y: '42%', w: '80%', h: '14%' }] }] };
        const c = await compileClient(SCRIPT, { withAudio: false });
        const { audio, ...rest } = c;
        await window.doodle.build(structuredClone(rest));
        window.doodle.seek(0);
        const box = window.doodle.markBox();
        const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
        window.doodle.paint(cv.getContext('2d'), 1, null);
        const d = cv.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data;
        let inked = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 230 || d[i + 1] < 230 || d[i + 2] < 230) inked++;
        return { hasLogo: !!c.logo, pct: inked / (d.length / 4) };
      });
      assert.deepEqual(errors, [], 'the unit threw while compiling');
      assert.ok(out.hasLogo, 'the unit’s compiler did not pass the brand logo to the engine');
      assert.ok(out.pct > 0.05, `the export canvas painted nothing where the mark belongs (${(out.pct * 100).toFixed(1)}%)`);

      // And the switch really switches it off.
      const off = await unit.evaluate(async () => {
        document.getElementById('markToggle').checked = false;
        SCRIPT.logo = false;
        const c = await compileClient(SCRIPT, { withAudio: false });
        return c.logo;
      });
      assert.equal(off, null, 'turning the toggle off still produced a mark');
    } finally { await ctx.close(); stop(); }
  });

  test('the compiler hands the engine a real logo, and can be told not to', async (t) => {
    const { compile } = await import('../src/project.mjs');
    const base = { __dir: ROOT, format: '9:16', hand: 'marker-a', mute: true, scenes: [{ elements: [{ type: 'text', text: 'ا', x: '10%', y: '40%', w: '80%', h: '10%' }] }] };
    assert.ok(existsSync(join(ROOT, LOGO)), 'the brand logo used by the studio header has moved');

    const on = await compile({ ...base, logo: LOGO }, { cacheDir: '/tmp/doodle-mark-test', noAudio: true });
    assert.ok(on.logo, 'the compiler dropped the logo');
    assert.match(on.logo.src, /^data:image\/png;base64,/, 'the logo must travel embedded — a path does not survive the render page');
    assert.ok(on.logo.ratio > 0.2 && on.logo.ratio < 8, `a nonsense aspect ratio: ${on.logo.ratio}`);

    for (const logo of [false, undefined]) {
      const off = await compile({ ...base, logo }, { cacheDir: '/tmp/doodle-mark-test', noAudio: true });
      assert.equal(off.logo, null, `logo: ${logo} should produce no mark`);
    }
  });
});
