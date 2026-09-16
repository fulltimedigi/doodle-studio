// The brand analysis fills a form. It returns an empty string for anything the input does not
// state — correct behaviour, but it means whatever was already in those boxes survives. That is
// right when you are refining one brand and wrong when you just described another one, so the
// page has to say which boxes it did not touch. With a stubbed answer this needs no API key.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, chromiumOrNull } from './helpers.mjs';

// What the real model returns for a two-line description: the facts it was given, empty for the
// rest. Captured from a live call.
const PARTIAL = {
  name: '', sells: 'عود ومسك وعطور شرقية فاخرة عبر الإنترنت', usp: '',
  audience: 'العملاء المهتمون بالعطور في السعودية ودول الخليج', dialect: 'gulf',
  tones: ['فاخر', 'هادئ وواثق'], cta: 'تسوق الآن', banned: '',
  hashtags: '#عطور_شرقية #عود_ومسك', brief: '', visual: '',
};
const OTHER_BRAND = { name: 'FullTimeDigi', sells: 'مساعد بيع ذكي', usp: 'حقيقة الكتالوج', audience: 'تجار', dialect: 'white', tones: ['تعليمي'], cta: 'تابع الرحلة', hashtags: '#FullTimeDigi', banned: 'ضاعف مبيعاتك فورًا', brief: 'دليل هوية FullTimeDigi الكامل', visual: 'White backgrounds, never show robots', colors: { primary: '#0b3b33', accent: '#00b478', bg: '#ffffff' } };

describe('brand auto-fill', { timeout: 60000 }, () => {
  let base, stop, browser, page;
  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    const ctx = await browser.newContext();
    await ctx.addInitScript((b) => { localStorage.setItem('gemini_key', 'test-key'); localStorage.setItem('brand', b); }, JSON.stringify(OTHER_BRAND));
    await ctx.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(PARTIAL) }] } }] }),
    }));
    page = await ctx.newPage();
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('says which boxes it did not touch, and can clear them', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await page.goto(base + '/web/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => { openBrand(); document.getElementById('b_desc').value = 'متجر عطور سعودي أونلاين'; });
    await page.evaluate(() => autoBrand());

    const after1 = await page.evaluate(() => ({
      sells: document.getElementById('b_sells').value,
      brief: document.getElementById('b_brief').value,
      banned: document.getElementById('b_banned').value,
      warned: !document.getElementById('b_stale').hidden,
      warning: document.getElementById('b_stale').textContent,
    }));
    assert.match(after1.sells, /عطور/, 'the extracted field was not applied');
    assert.ok(after1.warned, 'the other brand’s guide was kept with no warning');
    for (const label of ['دليل الهوية', 'الممنوعات', 'اسم البراند']) {
      assert.ok(after1.warning.includes(label), `${label} missing from the warning`);
    }
    assert.equal(after1.brief, OTHER_BRAND.brief, 'the field should be kept, not silently wiped');

    await page.evaluate(() => clearStale());
    const after2 = await page.evaluate(() => ({
      brief: document.getElementById('b_brief').value,
      banned: document.getElementById('b_banned').value,
      sells: document.getElementById('b_sells').value,
      warned: !document.getElementById('b_stale').hidden,
    }));
    assert.equal(after2.brief, '', 'clearing left the other brand’s guide in place');
    assert.equal(after2.banned, '');
    assert.match(after2.sells, /عطور/, 'clearing wiped a field the analysis did extract');
    assert.equal(after2.warned, false);
  });
});
