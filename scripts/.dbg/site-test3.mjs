import { chromium } from 'playwright';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const mobile = process.argv[2] === 'mobile';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 1000 }, userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
const t0 = Date.now();
await page.goto('http://localhost:8090/index.html');
await page.waitForFunction(() => COMPILED && !BUSY, null, { timeout: 90000 });
console.log('prepared in', ((Date.now() - t0) / 1000).toFixed(1), 's; duration', await page.evaluate(() => COMPILED.duration.toFixed(1)));
await page.screenshot({ path: `${out}/ui-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
if (!mobile) {
  // frames from the DOM preview at key moments
  const times = await page.evaluate(() => { const s = COMPILED.scenes; const e0 = s[0].elements[0]; return { outline: e0.start + e0.draw * 0.4, fill: e0.start + e0.draw * 0.85, done: s[0].end - 0.4, pan: s[0].end + 0.1, s2: s[1].start + 2.5, cta: s[s.length - 1].start + 2.0 }; });
  console.log('times', times);
  for (const [k, t] of Object.entries(times)) {
    await page.evaluate((t) => { scrubTo(t); }, t);
    await page.waitForTimeout(150);
    await page.locator('#previewWrap').screenshot({ path: `${out}/frame-${k}.png` });
    // also canvas painter
    const dataUrl = await page.evaluate(async (t) => { window.doodle.seek(t); const c = document.createElement('canvas'); c.width = 960; c.height = 540; const ctx = c.getContext('2d'); window.doodle.paint(ctx, 0.5, HAND_IMG); return c.toDataURL('image/png'); }, t);
    (await import('node:fs')).writeFileSync(`${out}/paint-${k}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  // open an element editor
  await page.evaluate(() => toggleEditor(0, 1));
  await page.waitForTimeout(100);
  await page.locator('#scenesCard').screenshot({ path: `${out}/editor.png` });
  // chalk board + no hand quick check
  await page.evaluate(() => { SCRIPT.board = 'chalk'; changed(); });
  await page.waitForFunction(() => COMPILED && !BUSY, null, { timeout: 90000 });
  await page.evaluate((t) => scrubTo(t), times.fill); await page.waitForTimeout(150);
  await page.locator('#previewWrap').screenshot({ path: `${out}/frame-chalk.png` });
  await page.evaluate(() => { SCRIPT.board = 'paper'; changed(); });
  await page.waitForFunction(() => COMPILED && !BUSY, null, { timeout: 90000 });
  // draft render (no key -> no narration; music + sfx synthesised)
  const t1 = Date.now();
  await page.evaluate(() => render(true));
  await page.waitForFunction(() => document.querySelector('#result video') || document.querySelector('#jobMsg').textContent.startsWith('❌'), null, { timeout: 600000 });
  console.log('render:', await page.evaluate(() => document.querySelector('#jobMsg').textContent), 'in', ((Date.now() - t1) / 1000).toFixed(0), 's');
  console.log('result:', await page.evaluate(() => document.querySelector('#result')?.textContent?.trim()));
  const size = await page.evaluate(async () => { const v = document.querySelector('#result video'); if (!v) return 0; const b = await (await fetch(v.src)).blob(); return b.size; });
  console.log('video bytes', size);
  const buf = await page.evaluate(async () => { const v = document.querySelector('#result video'); const b = await (await fetch(v.src)).blob(); const ab = await b.arrayBuffer(); return Array.from(new Uint8Array(ab)); });
  (await import('node:fs')).writeFileSync(`${out}/draft.mp4`, Buffer.from(buf));
}
console.log('errors:', errors.slice(0, 10));
await browser.close();
