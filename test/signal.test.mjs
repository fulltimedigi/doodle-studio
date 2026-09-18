// The signal strip is a claim about consistency: the same three lines, the same three colours, in
// the same order, on every surface the studio exports. A claim like that is only worth anything if
// it is checked on the real exports, so this drives each unit the way the person does — put the
// three lines in, then look at what comes out of the canvas.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, chromiumOrNull } from './helpers.mjs';

const BRAND = {
  name: 'FullTimeDigi', sells: 'مساعد بيع ذكي', audience: 'تجار', dialect: 'white',
  tones: ['تعليمي'], cta: 'تابع الرحلة', banned: 'ضاعف مبيعاتك فورًا، الأرخص',
  colors: { primary: '#0b3b33', accent: '#00b478', bg: '#ffffff' },
};
const SIG = { who: 'تجار العطور الإلكترونية', why: 'الزائر يحتار بين المنتجات', what: 'ساعده يختار بثقة' };

/** The three lines as the page painted them, in render order, with the colour of each dot. */
const readStrip = (page, sel = '.ftd-signal') => page.evaluate((s) => {
  const bar = document.querySelector(s);
  if (!bar) return null;
  return [...bar.querySelectorAll('.s')].map((row) => ({
    text: row.querySelector('span').textContent,
    dot: getComputedStyle(row.querySelector('i')).backgroundColor,
  }));
}, sel);

const RGB = { primary: 'rgb(11, 59, 51)', problem: 'rgb(194, 96, 63)', accent: 'rgb(0, 180, 120)' };

describe('content signal system', { timeout: 120000 }, () => {
  let base, stop, browser, ctx;

  /** A unit page with the brand set, the key stubbed, and the model answering with `answer`. */
  const open = async (url, answer) => {
    const page = await ctx.newPage();
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    }));
    await page.goto(base + url, { waitUntil: 'networkidle' });
    return page;
  };

  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    ctx = await browser.newContext();
    await ctx.addInitScript((b) => {
      localStorage.setItem('gemini_key', 'test-key');
      localStorage.setItem('brand', b);
    }, JSON.stringify(BRAND));
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('the model is asked for the three lines, and they reach every slide of a carousel', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const deck = {
      topic: 'بيانات المنتجات', caption: 'كابشن', hashtags: ['#FullTimeDigi'], signal: SIG,
      slides: [{ role: 'cover', title: 'عنوان', sub: 'سطر' }, { role: 'point', title: 'نقطة', body: 'نص' }],
    };
    const page = await open('/web/carousel.html', deck);
    const sent = page.waitForRequest('https://generativelanguage.googleapis.com/**');
    await page.evaluate(() => { document.getElementById('topic').value = 'بيانات المنتجات'; generate(); });
    const body = JSON.parse((await sent).postData());
    assert.match(JSON.stringify(body), /SIGNAL STRIP/, 'the unit never asked the model for a signal');

    await page.waitForSelector('.frame .ftd-signal');
    assert.equal(await page.locator('.frame .ftd-signal').count(), deck.slides.length,
      'a carousel is read one slide at a time — every slide carries the strip, not just the cover');
    assert.deepEqual(await readStrip(page), [
      { text: SIG.who, dot: RGB.primary },
      { text: SIG.why, dot: RGB.problem },
      { text: SIG.what, dot: RGB.accent },
    ]);
    await page.close();
  });

  test('a reel cover and an ad carry the identical strip', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const reels = await open('/web/reels.html', {
      topic: 'البحث', signal: SIG,
      ideas: [{ title: 'فكرة', hook: 'خطّاف قوي جدًا هنا', format: 'كلام للكاميرا', duration: 30, cta: 'تابع', beats: [{ t: '0-3', say: 'جملة', screen: 'نص على الشاشة' }], caption: 'ك', hashtags: [] }],
    });
    await reels.evaluate(() => { document.getElementById('topic').value = 'البحث'; generate(); });
    await reels.waitForSelector('#sigBox input');
    // The cover is only built on export, so build one and read it out of the hidden export box.
    const cover = await reels.evaluate(() => {
      document.getElementById('exportBox').innerHTML = coverHTML(DATA.ideas[0]);
      const bar = document.querySelector('#exportBox .ftd-signal');
      return bar && [...bar.querySelectorAll('.s span')].map((x) => x.textContent);
    });
    assert.deepEqual(cover, [SIG.who, SIG.why, SIG.what], 'the reel cover lost the strip');
    await reels.close();

    const ad = await open('/web/ad.html', {
      product: 'مساعد', caption: 'ك', hashtags: [], signal: SIG,
      variants: [{ name: 'أ', headline: 'عنوان الإعلان', sub: 'سطر', cta: 'تابع', space: 'bottom' }],
    });
    await ad.evaluate(() => { document.getElementById('brief').value = 'مساعد'; generate(); });
    await ad.waitForSelector('.frame .ftd-signal');
    assert.deepEqual(await readStrip(ad, '.frame .ftd-signal'), [
      { text: SIG.who, dot: RGB.primary },
      { text: SIG.why, dot: RGB.problem },
      { text: SIG.what, dot: RGB.accent },
    ], 'the ad strip drifted from the carousel strip');
    await ad.close();
  });

  test('the exported landing page carries the strip with nothing to fetch', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open('/web/landing.html', {
      headline: 'دليل تجهيز بيانات منتجاتك', sub: 'لتجار سلة وزد', inside: ['نقطة'],
      objection: 'قراءة ١٠ دقائق', cta: 'حمّل الدليل', privacy: 'رسالة شهريًا', signal: SIG,
    });
    await page.evaluate(() => { document.getElementById('headline').value = 'دليل'; writeCopy(); });
    await page.waitForFunction(() => document.querySelector('#sigBox input')?.value);

    const html = await page.evaluate(() => buildPage());
    assert.match(html, /ftd-signal/, 'the exported page has no strip');
    assert.match(html, new RegExp(SIG.why.replace(/ /g, '\\s')), 'the problem line did not travel');
    assert.doesNotMatch(html, /js\/signal\.js/, 'the export must not reference a file only the studio has');
    // The strip's own CSS has to ride along: the exported file is opened from someone else's host.
    assert.match(html, /\.ftd-signal\{--sg-u/, 'the strip would render unstyled off the studio');
    await page.close();
  });

  test('a next step the product cannot keep yet is flagged, not published quietly', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open('/web/landing.html', {});
    const warnings = await page.evaluate((b) => ({
      promise: Signal.check({ who: 'تجار', why: 'مشكلة', what: 'اطلب الآن' }, b),
      banned: Signal.check({ who: 'تجار', why: 'ضاعف مبيعاتك فورًا', what: 'تابع الرحلة' }, b),
      long: Signal.check({ who: 'ت', why: 'م', what: 'خ'.repeat(40) }, b),
      clean: Signal.check({ who: 'تجار العطور', why: 'الزائر يحتار', what: 'تابع الرحلة' }, b),
    }), BRAND);
    assert.match(warnings.promise.join(' '), /بمنتج جاهز/);
    assert.match(warnings.banned.join(' '), /ممنوعة/);
    assert.match(warnings.long.join(' '), /طويلة/);
    assert.deepEqual(warnings.clean, [], 'a clean signal should not be nagged at');

    // And the warning is on screen, next to the boxes, not only in the console.
    await page.evaluate(() => { STATE.signal = { who: 'تجار', why: 'مشكلة', what: 'اطلب الآن' }; render(); });
    await page.waitForSelector('#sigBox .sig-warn:not([hidden])');
    assert.match(await page.locator('#sigBox .sig-warn').textContent(), /بمنتج جاهز/);
    await page.close();
  });

  test('all three dots stay visible on a dark canvas', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open('/web/carousel.html', {
      topic: 'ت', caption: '', hashtags: [], signal: SIG,
      slides: [{ role: 'cover', title: 'عنوان', sub: 'سطر' }],
    });
    await page.evaluate(() => { document.getElementById('topic').value = 'ت'; generate(); });
    await page.waitForSelector('.frame .ftd-signal');
    await page.evaluate(() => { document.querySelector('input[name=tpl][value=t-dark]').checked = true; render(); });
    const dots = await page.evaluate(() => {
      const bar = document.querySelector('.frame .ftd-signal');
      return { dark: bar.classList.contains('on-dark'),
        rings: [...bar.querySelectorAll('.s i')].map((i) => getComputedStyle(i).boxShadow) };
    });
    assert.ok(dots.dark, 'a dark template should get the dark strip');
    // The brand's own dark green is invisible against a dark panel; without the ring the audience
    // signal silently disappears on every dark slide and every photo.
    for (const ring of dots.rings) assert.match(ring, /rgba\(255, 255, 255/, 'a dot lost its ring');
    await page.close();
  });

  test('an incomplete signal prints nothing rather than half a strip', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open('/web/landing.html', {});
    const out = await page.evaluate(() => ({
      partial: Signal.bar({ who: 'تجار', why: '', what: 'تابع' }, {}),
      none: Signal.bar(null, {}),
      full: Signal.bar({ who: 'أ', why: 'ب', what: 'ج' }, {}),
    }));
    assert.equal(out.partial, '', 'two thirds of a strip is worse than none — it reads as a bug');
    assert.equal(out.none, '');
    assert.match(out.full, /ftd-signal/);
    await page.close();
  });

  test('typing in a signal box does not throw the caret out of it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open('/web/carousel.html', {
      topic: 'ت', caption: '', hashtags: [], signal: SIG,
      slides: [{ role: 'cover', title: 'عنوان', sub: 'سطر' }],
    });
    await page.evaluate(() => { document.getElementById('topic').value = 'ت'; generate(); });
    await page.waitForSelector('#sigBox input[data-sig=who]');
    const box = page.locator('#sigBox input[data-sig=who]');
    await box.click();
    await box.fill('');
    await page.keyboard.type('تجار سلة');
    assert.equal(await box.inputValue(), 'تجار سلة', 'the redraw ate the keystrokes');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.sig), 'who');
    assert.match(await page.locator('.frame .ftd-signal').first().textContent(), /تجار سلة/,
      'the canvas should follow the box as you type');
    await page.close();
  });
});
