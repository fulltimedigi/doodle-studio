// The content board is where a month is actually worked: cards on days, a status each, and the
// finished piece attached to the day it belongs to. It stores everything in the browser, so the
// only honest way to test it is to drive the real page.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, chromiumOrNull } from './helpers.mjs';

const PLAN = {
  month: '2026-10',
  angles: [{ id: 'a1', title: 'محور', why: 'سبب' }],
  posts: [
    { date: '2026-10-03', angle: 'a1', format: 'carousel', hook: 'خطّاف أول', topic: 'موضوع أول', occasion: '', sells: false },
    { date: '2026-10-07', angle: 'a1', format: 'reel', hook: 'خطّاف ثانٍ', topic: 'موضوع ثانٍ', occasion: '', sells: true },
  ],
  notes: 'ملاحظات',
};

describe('content board', { timeout: 90000 }, () => {
  let base, stop, browser, ctx, page;
  const open = async () => { await page.goto(base + '/web/board.html', { waitUntil: 'networkidle' }); };
  const cards = () => page.evaluate(() => CARDS.map((c) => ({ date: c.date, hook: c.hook, status: c.status, format: c.format, platforms: c.platforms, assetId: c.assetId })));

  before(async () => {
    const c = await chromiumOrNull();
    if (!c) return;
    ({ base, stop } = await startServer());
    browser = await c.chromium.launch(c.options);
    ctx = await browser.newContext({ acceptDownloads: true });
    page = await ctx.newPage();
    await open();
  });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });

  test('a card added by hand survives a reload', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await page.evaluate(() => {
      addCard('2026-10-05');
      document.getElementById('c_hook').value = 'بند بيدي';
      document.getElementById('c_topic').value = 'موضوع مكتوب بيدي';
      document.getElementById('c_format').value = 'carousel';
      document.getElementById('c_plats').querySelector('input[value=tiktok]').checked = true;
      saveCard();
    });
    assert.equal(await page.evaluate(() => VIEW), '2026-10', 'the view should follow a card saved into another month');
    await open();
    await page.evaluate(() => { VIEW = '2026-10'; draw(); });
    const all = await cards();
    assert.equal(all.length, 1);
    assert.equal(all[0].hook, 'بند بيدي');
    assert.equal(all[0].date, '2026-10-05');
    assert.deepEqual(all[0].platforms.sort(), ['instagram', 'tiktok']);
    assert.match(await page.textContent('#list'), /بند بيدي/);
  });

  test('a saved month plan imports once, not twice', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await page.evaluate((plan) => Suite.lib.save({ type: 'plan', title: 'خطة 2026-10', data: plan }), PLAN);
    await open();
    const importOnce = async () => {
      await page.evaluate(() => openImport());
      await page.evaluate(() => doImport());
    };
    await importOnce();
    assert.equal((await cards()).length, 3, 'the two plan posts should have been added');
    await importOnce();
    assert.equal((await cards()).length, 3, 'importing the same plan again duplicated it');
    const imported = (await cards()).find((c) => c.hook === 'خطّاف ثانٍ');
    assert.equal(imported.format, 'reel');
    assert.equal(imported.status, 'idea');
  });

  test('the month view shows the month, the filters narrow it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await page.evaluate(() => { VIEW = '2026-10'; draw(); });
    assert.equal(await page.locator('#cal .chip').count(), 3, 'three cards in October');
    await page.selectOption('#fStatus', 'ready');
    assert.equal(await page.locator('#cal .chip').count(), 0, 'nothing is ready yet');
    await page.selectOption('#fStatus', '');
    await page.selectOption('#fPlatform', 'tiktok');
    assert.equal(await page.locator('#cal .chip').count(), 1, 'only the hand-made card is on TikTok');
    await page.selectOption('#fPlatform', '');
    // A different month is a different board page, not a different board.
    await page.evaluate(() => { VIEW = '2026-11'; draw(); });
    assert.equal(await page.locator('#cal .chip').count(), 0);
    assert.match(await page.textContent('#stat'), /لا بنود/);
    await page.evaluate(() => { VIEW = '2026-10'; draw(); });
  });

  test('a piece made from a card comes back attached to it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const id = await page.evaluate(() => CARDS.find((c) => c.hook === 'خطّاف أول').id);
    // What makeCard() does before it navigates, then what the carousel unit does when it saves.
    await page.evaluate(async (cardId) => {
      localStorage.setItem('board_pending', cardId);
      await Suite.lib.save({ type: 'carousel', title: 'كاروسيل الخطّاف الأول', data: { slides: [] } });
    }, id);
    await open();
    const card = (await cards()).find((c) => c.hook === 'خطّاف أول');
    assert.ok(card.assetId, 'the saved piece was not attached to the card it was made for');
    assert.equal(card.status, 'ready', 'attaching a piece should move the card out of "idea"');
    assert.equal(await page.evaluate(() => localStorage.getItem('board_pending')), null, 'the pending marker must be consumed');
    assert.equal(await page.evaluate(() => VIEW), '2026-10', 'returning should land on the month the card is in');
    assert.match(await page.textContent('#list'), /المادة جاهزة/);
  });

  test('dropping a card on another day moves it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    await page.evaluate(() => { VIEW = '2026-10'; draw(); });
    const before = (await cards()).find((c) => c.hook === 'بند بيدي');
    // Drive the page's own drag handlers rather than the browser's drag emulation.
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.chip')].find((c) => c.textContent.includes('بند بيدي'));
      const cell = document.querySelector('.cell[data-date="2026-10-12"]');
      const dataTransfer = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }));
      cell.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true }));
      cell.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => CARDS.find((c) => c.hook === 'بند بيدي').date === '2026-10-12', null, { timeout: 3000 }).catch(() => {});
    const after = (await cards()).find((c) => c.hook === 'بند بيدي');
    assert.equal(before.date, '2026-10-05');
    assert.equal(after.date, '2026-10-12', 'the card did not move');
  });

  test('the month exports as a spreadsheet and as a calendar', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const grab = async (fn) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(fn)]);
      const stream = await dl.createReadStream();
      let text = '';
      for await (const chunk of stream) text += chunk;
      return { name: dl.suggestedFilename(), text };
    };

    const csv = await grab(() => exportCsv());
    assert.match(csv.name, /\.csv$/);
    assert.ok(csv.text.startsWith('﻿'), 'without a BOM Excel mangles the Arabic');
    assert.match(csv.text, /بند بيدي/);
    assert.equal(csv.text.trim().split('\n').length, 4, 'a header and three cards');

    const ics = await grab(() => exportIcs());
    assert.match(ics.name, /\.ics$/);
    assert.match(ics.text, /^BEGIN:VCALENDAR/);
    assert.equal((ics.text.match(/BEGIN:VEVENT/g) || []).length, 3);
    assert.match(ics.text, /DTSTART;VALUE=DATE:20261012/, 'the moved card should export on its new day');
    assert.doesNotMatch(ics.text, /(?<!\r)\n/, 'ICS lines must end with CRLF');
  });

  test('a backup restores without duplicating what is already there', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const dump = await page.evaluate(() => JSON.stringify({ kind: 'fulltimedigi-content-board', version: 1, cards: CARDS }));
    await page.evaluate(async (text) => {
      const file = new File([text], 'backup.json', { type: 'application/json' });
      await importJson(file);
    }, dump);
    assert.equal((await cards()).length, 3, 'restoring the same board doubled it');

    await page.evaluate(async () => {
      const file = new File([JSON.stringify({ cards: [{ date: '2026-10-20', hook: 'من نسخة قديمة', topic: 'x', status: 'ready', format: 'ad', platforms: ['x'] }] })], 'b.json', { type: 'application/json' });
      await importJson(file);
    });
    const all = await cards();
    assert.equal(all.length, 4);
    assert.ok(all.find((c) => c.hook === 'من نسخة قديمة'));
  });
});
