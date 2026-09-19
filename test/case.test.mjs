// A case study is worth publishing only because it is true, so the thing worth testing here is not
// the layout — it is the refusals. A number nobody can trace never reaches a slide or the page, a
// testimonial with nobody behind it is not printed, and a source the model wrote itself is thrown
// away, because an invented source is an invented number that looks checked.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startServer, chromiumOrNull } from './helpers.mjs';

const JSZip = createRequire(import.meta.url)('jszip');

const BRAND = {
  name: 'FullTimeDigi', sells: 'مساعد بيع ذكي', audience: 'تجار سلة وزد', dialect: 'white',
  tones: ['تعليمي'], cta: 'تابع رحلة البناء', website: 'fulltimedigi.com',
  banned: 'ضاعف مبيعاتك فورًا، أي رقم أو نسبة نجاح غير موثّقة',
  colors: { primary: '#0b3b33', accent: '#00b478', bg: '#ffffff' },
};

const CASE = {
  kind: 'teardown',
  title: 'كتالوج يخفي منتجاته عن مشتريها',
  client: 'متجر عطور سعودي', who: 'متجر عطور على سلة، يبيع للسوق السعودي',
  context: 'متجر عطور عليه مئة وعشرون منتجًا. الزائر يدخل وهو يعرف المناسبة وميزانيته.',
  problem: ['الأسماء تجارية بلا وصف', 'البحث يقارن حروفًا', 'لا حقل للمناسبة'],
  // Two real counts from the brief — and a source the model was told never to write.
  metrics: [
    { value: '٣٢', label: 'منتجًا بلا وصف', source: 'حسب تقديرنا' },
    { value: '٠', label: 'نتائج لكلمة العميل', source: '' },
  ],
  approach: ['اكتب وصفًا لكل منتج', 'أضف المناسبة حقلًا', 'راجع كلمات البحث الفاشلة'],
  outcome: 'الكتالوج الذي لا يصف منتجه يمنع أي مساعد ذكي من ترشيحه.',
  quote: { text: '', by: '' },
  caption: 'كتالوج يخفي منتجاته', hashtags: ['#FullTimeDigi'],
  signal: { who: 'أصحاب متاجر سلة وزد', why: 'الكتالوج ناقص بيانات', what: 'راجع أوصاف منتجاتك' },
};

describe('case study', { timeout: 120000 }, () => {
  let base, stop, browser, ctx;

  const open = async (answer) => {
    const page = await ctx.newPage();
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    }));
    await page.goto(base + '/web/case.html', { waitUntil: 'networkidle' });
    return page;
  };

  /** Write a case, then wait for it on screen. */
  const write = async (page) => {
    await page.evaluate(() => { document.getElementById('brief').value = 'متجر عطور'; generate(); });
    await page.waitForSelector('#mets .met');
    return page;
  };

  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript((b) => {
      localStorage.setItem('gemini_key', 'test-key');
      localStorage.setItem('brand', b);
    }, JSON.stringify(BRAND));
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('the model is forbidden to invent, and its own source is thrown away', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    const sent = page.waitForRequest('https://generativelanguage.googleapis.com/**');
    await write(page);
    const asked = JSON.stringify(JSON.parse((await sent).postData()));
    assert.match(asked, /never invent a number/i, 'the prompt no longer forbids inventing figures');
    assert.match(asked, /SIGNAL STRIP/, 'a case study carries the signal strip like everything else');

    // The stub answered with source: "حسب تقديرنا" — a guess dressed as provenance.
    const sources = await page.evaluate(() => DATA.metrics.map((m) => m.source));
    assert.deepEqual(sources, ['', ''], 'a source the model wrote itself must not survive');
    await page.close();
  });

  test('a number with no source reaches neither the slides nor the page', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    await write(page);

    // Nothing is sourced yet, so there is no evidence slide at all.
    let state = await page.evaluate(() => ({
      roles: slides().map((s) => s.role),
      html: document.getElementById('frames').textContent,
      page: buildPage(),
    }));
    assert.ok(!state.roles.includes('evidence'), 'an evidence slide with no evidence on it');
    assert.ok(!state.html.includes('منتجًا بلا وصف'), 'an unsourced number reached a slide');
    assert.ok(!state.page.includes('منتجًا بلا وصف'), 'an unsourced number reached the page');
    assert.match(await page.locator('#msg2').textContent(), /بلا مصدر/, 'the hold-back was never explained');
    assert.equal(await page.locator('#mets .met.bad').count(), 2, 'both numbers start unsourced, so both are held back');

    // Give the first number a source; now — and only now — it may be published.
    await page.locator('#mets input[data-k=source][data-i="0"]').fill('جردتها يدويًا من المتجر، ١٥ سبتمبر');
    state = await page.evaluate(() => ({
      roles: slides().map((s) => s.role),
      html: document.getElementById('frames').textContent,
      page: buildPage(),
    }));
    assert.ok(state.roles.includes('evidence'), 'a sourced number earns its slide');
    assert.match(state.html, /منتجًا بلا وصف/);
    assert.match(state.html, /جردتها يدويًا/, 'the slide should print the source next to the figure');
    assert.match(state.page, /جردتها يدويًا/, 'the page should print the source too');
    assert.ok(!state.page.includes('نتائج لكلمة العميل'), 'the still-unsourced number slipped through');
    assert.equal(await page.locator('#mets .met.bad').count(), 1);
    await page.close();
  });

  test('a testimonial with nobody behind it is not printed', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open({ ...CASE, quote: { text: 'غيّر طريقة عملنا بالكامل', by: '' } });
    await write(page);
    let out = await page.evaluate(() => ({ roles: slides().map((s) => s.role), page: buildPage() }));
    assert.ok(!out.roles.includes('quote'), 'an unattributed quote got its own slide');
    assert.ok(!out.page.includes('غيّر طريقة عملنا'), 'an unattributed quote reached the page');

    await page.evaluate(() => { DATA.quote.by = 'خالد، صاحب المتجر'; render(); });
    out = await page.evaluate(() => ({ roles: slides().map((s) => s.role), page: buildPage() }));
    assert.ok(out.roles.includes('quote'), 'an attributed quote should be publishable');
    assert.match(out.page, /خالد، صاحب المتجر/);
    await page.close();
  });

  test('an empty metrics array is accepted as the right answer', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open({ ...CASE, metrics: [] });
    await page.evaluate(() => { document.getElementById('brief').value = 'متجر'; generate(); });
    await page.waitForSelector('#frames .cs');
    assert.match(await page.locator('#msg').textContent(), /لم يُخترَع أي رقم/);
    const roles = await page.evaluate(() => slides().map((s) => s.role));
    assert.deepEqual(roles, ['cover', 'context', 'problem', 'approach', 'outcome'],
      'a case with no figures should simply be a shorter case');
    await page.close();
  });

  test('both outputs come out of the one case, and the page needs nothing fetched', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    await write(page);
    await page.locator('#mets input[data-k=source][data-i="0"]').fill('جرد يدوي');

    const html = await page.evaluate(() => buildPage());
    for (const [what, re] of [['the title', /كتالوج يخفي منتجاته/], ['the context', /مئة وعشرون منتجًا/],
      ['the steps', /اكتب وصفًا لكل منتج/], ['the outcome', /يمنع أي مساعد ذكي/]]) {
      assert.match(html, re, `${what} is missing from the page`);
    }
    assert.match(html, /ftd-signal/, 'the page lost the signal strip');
    assert.match(html, /\.ftd-signal\{--sg-u/, 'the strip would render unstyled off the studio');
    assert.doesNotMatch(html, /js\/signal\.js/, 'the page must not reference a studio-only file');
    assert.doesNotMatch(html, /src="assets\//, 'the page must not reference a studio-only asset');

    // And the slides carry the same strip as every other surface in the suite.
    const strip = await page.evaluate(() => [...document.querySelectorAll('#frames .cs')]
      .map((c) => [...c.querySelectorAll('.ftd-signal .s span')].map((x) => x.textContent)));
    assert.ok(strip.length > 3);
    for (const s of strip) assert.deepEqual(s, ['أصحاب متاجر سلة وزد', 'الكتالوج ناقص بيانات', 'راجع أوصاف منتجاتك']);

    // The ZIP is the deliverable, so open it: slides for Instagram and the page for the site, from
    // the one case. (Its filename is not checked here — headless Chromium reports "download" for
    // any non-ASCII name, café.zip included, so the name on disk says nothing about the product.)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportAll())]);
    const zip = await JSZip.loadAsync(await readFile(await dl.path()));
    const names = Object.keys(zip.files);
    assert.ok(names.filter((n) => n.endsWith('.png')).length >= 4, `too few slides: ${names}`);
    assert.ok(names.includes('case.html'), `the page is missing from the zip: ${names}`);
    assert.ok(names.includes('caption.txt'), `the caption is missing: ${names}`);
    assert.match(await zip.file('case.html').async('string'), /كتالوج يخفي منتجاته/);
    await page.close();
  });

  test('a teardown never turns into a results claim', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    await write(page);
    const teardown = await page.evaluate(() => ({ page: buildPage(), heads: [...document.querySelectorAll('#frames .cs h2')].map((h) => h.textContent) }));
    assert.match(teardown.page, /تفكيك حالة/, 'a teardown should be labelled as one, in the open');
    assert.ok(teardown.heads.includes('ما الذي يصلحها'), 'a teardown proposes a fix, it does not claim one');
    assert.ok(!teardown.heads.includes('ما الذي تغيّر'), 'a teardown must not claim anything changed');

    await page.evaluate(() => { document.querySelector('input[name=kind][value=results]').checked = true; kindChanged(); });
    const results = await page.evaluate(() => ({ page: buildPage(), heads: [...document.querySelectorAll('#frames .cs h2')].map((h) => h.textContent) }));
    assert.match(results.page, /دراسة حالة/);
    assert.ok(results.heads.includes('ما الذي تغيّر'));
    await page.close();
  });

  // The canvas shares one stylesheet with the studio's own chrome, so a class name that exists in
  // both silently restyles the export — suite.css owns `.steps`, and its 13px grey chip rule reached
  // straight inside the slide and shrank every step of the approach.
  test('the studio\'s own chrome does not restyle the slides', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    await write(page);
    const sizes = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('#frames .cs')];
      const step = cs.map((c) => c.querySelector('.cs-steps div span')).find(Boolean);
      const bullet = cs.map((c) => c.querySelector('.bullets div')).find(Boolean);
      return { step: step && parseFloat(getComputedStyle(step).fontSize), bullet: bullet && parseFloat(getComputedStyle(bullet).fontSize) };
    });
    assert.ok(sizes.step >= 30, `a step is rendering at ${sizes.step}px — something outside the canvas is styling it`);
    assert.ok(sizes.bullet >= 30, `a bullet is rendering at ${sizes.bullet}px`);
    await page.close();
  });

  test('typing a source does not take the caret out of the box', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const page = await open(CASE);
    await write(page);
    const box = page.locator('#mets input[data-k=source][data-i="1"]');
    await box.click();
    await page.keyboard.type('عدّيتها بنفسي');
    assert.equal(await box.inputValue(), 'عدّيتها بنفسي', 'the redraw ate the keystrokes');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.k), 'source');
    await page.close();
  });
});
