import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await (await browser.newContext({ viewport: { width: 1240, height: 900 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
const onFail = async (e) => { console.log('FAIL', e.message.split('\n')[0], 'at', page.url()); try { console.log('msgs:', await page.evaluate(() => [...document.querySelectorAll('.msg')].map((x) => x.textContent).join(' | '))); } catch {} console.log('errors:', errors.slice(0, 6)); process.exit(1); };
process.on('unhandledRejection', onFail); process.on('uncaughtException', onFail);
const png = fs.readFileSync('examples/art/shop-owner.png').toString('base64');
const MOCK = {
  ugc: { title: 'إعلان ليل', creator: 'Saudi woman in her late 20s, black hijab, beige abaya, warm smile', setting: 'bright modern kitchen, morning light', clips: [{ n: 1, role: 'hook', say: 'عطرك يروح بعد ساعة؟ نفس مشكلتي كانت', caption_ar: 'يروح بعد ساعة؟', action: 'holds phone selfie', camera: 'selfie close-up' }, { n: 2, role: 'product', say: 'جربت ليل من أسبوع وثبت معي طول اليوم', caption_ar: 'ثبت طول اليوم', action: 'shows the bottle', camera: 'selfie medium' }, { n: 3, role: 'cta', say: 'اطلبيه من ليل ويوصلك خلال ٢٤ ساعة', caption_ar: 'اطلبي الآن', action: 'smiles', camera: 'selfie' }], end_card: { line: 'يثبت طول اليوم', cta: 'اطلبي الآن' }, caption: 'كابشن', hashtags: ['#ليل'] },
  magnet: { title: 'دليل ٧ خطوات لعطر يثبت طول اليوم', subtitle: 'من ليل للعطور', audience: 'لكل سيدة تحب عطرها يثبت', intro: 'في هذا الدليل نشرح خطوات بسيطة.', chapters: [1, 2, 3, 4, 5].map((n) => ({ title: `الخطوة ${n}`, paragraphs: ['رشّي العطر على البشرة المرطبة مباشرة بعد الاستحمام لأن الترطيب يحفظ الرائحة لساعات أطول.', 'اختاري نقاط النبض: المعصم، خلف الأذن، والرقبة.'], bullets: ['لا تفركي معصمك', 'رشة واحدة تكفي', 'احفظي العطر بعيدًا عن الشمس'] })), closing: { title: 'جاهزة لعطر يثبت؟', body: 'تشكيلة ليل توصلك خلال ٢٤ ساعة.', cta: 'اطلبي الآن' }, cover_visual: 'perfume bottle illustration', landing_copy: { headline: 'حمّلي دليل ثبات العطر', sub: '٧ خطوات في ٥ دقائق', cta: 'حمّلي الدليل مجانًا' } },
  logo: { concepts: [1, 2, 3, 4].map((n) => ({ idea: `اتجاه ${n}`, prompt: `logo concept ${n}` })) },
};
let calls = {};
await page.route('**/*', async (route) => {
  const u = route.request().url();
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return route.continue();
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : {}; const mods = body.generationConfig?.responseModalities || []; const sys = body.systemInstruction?.parts?.[0]?.text || '';
  const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes(':predictLongRunning')) { calls.veo = (calls.veo || 0) + 1; return reply({ name: 'operations/op' + calls.veo }); }
  if (u.includes('/operations/')) return reply({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'http://localhost:8090/fixtures/clip.mp4' } }] } } });
  if (mods.includes('IMAGE')) { calls.img = (calls.img || 0) + 1; return reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }); }
  const kind = /UGC/.test(sys) ? 'ugc' : /lead magnet/.test(sys) ? 'magnet' : /brand designer/.test(sys) ? 'logo' : 'other'; calls[kind] = (calls[kind] || 0) + 1;
  return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(MOCK[kind] || {}) }] } }] });
});
page.on('dialog', (d) => d.accept());
await page.goto('http://localhost:8090/index.html'); await page.evaluate(() => { localStorage.setItem('gemini_key', 'x'); localStorage.setItem('brand', JSON.stringify({ name: 'عطور ليل', sells: 'عطور نيش', audience: 'سيدات', dialect: 'gulf', tones: ['فاخر'], colors: { primary: '#1b2a41', accent: '#c9a227', bg: '#ffffff' }, cta: 'اطلبي الآن', website: 'layl.sa' })); });
await page.reload(); await page.screenshot({ path: `${out}/p2-hub.png`, fullPage: true });
// UGC
await page.goto('http://localhost:8090/ugc.html'); await page.fill('#brief', 'عطر ليل'); await page.click('#go');
await page.waitForFunction(() => !document.querySelector('#scriptCard').hidden); await page.waitForTimeout(200);
console.log('ugc script clips:', await page.evaluate(() => DATA.clips.length), 'cost line:', await page.evaluate(() => document.querySelector('#costLine').textContent));
// make polling fast for the test
await page.evaluate(() => { const orig = Suite.sleep; Suite.sleep = (ms) => orig(Math.min(ms, 50)); });
const t0 = Date.now(); await page.click('#shootBtn');
await page.waitForFunction(() => !document.querySelector('#assembleRow').hidden, null, { timeout: 120000 });
console.log('clips shot in', ((Date.now() - t0) / 1000).toFixed(1), 's', await page.evaluate(() => Object.keys(CLIPS).length));
await page.screenshot({ path: `${out}/p2-ugc-clips.png`, fullPage: true });
const t1 = Date.now(); await page.evaluate(() => assemble());
await page.waitForFunction(() => document.querySelector('#final video') || document.querySelector('#msg2').classList.contains('err'), null, { timeout: 600000 });
console.log('assemble:', await page.evaluate(() => document.querySelector('#msg2').textContent), ((Date.now() - t1) / 1000).toFixed(0), 's', 'final MB', await page.evaluate(() => (FINAL.size / 1e6).toFixed(2)));
const fin = await page.evaluate(async () => Array.from(new Uint8Array(await FINAL.arrayBuffer()))); fs.writeFileSync(`${out}/ugc-final.mp4`, Buffer.from(fin));
// grab a frame from the assembled canvas at caption time and the end card
await page.evaluate(async () => { const c = document.getElementById('outCanvas'); window.__f = c.toDataURL('image/jpeg', 0.7); });
fs.writeFileSync(`${out}/ugc-endcard.jpg`, Buffer.from((await page.evaluate(() => window.__f)).split(',')[1], 'base64'));
await page.screenshot({ path: `${out}/p2-ugc-final.png`, fullPage: true });
// Magnet
await page.goto('http://localhost:8090/magnet.html'); await page.fill('#topic', 'ثبات العطر'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز'), null, { timeout: 60000 }); await page.waitForTimeout(300);
const pdfBytes = await page.evaluate(async () => { const P = pages(); const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); for (let i = 0; i < P.length; i++) { const box = document.getElementById('exportBox'); box.innerHTML = P[i]; await Suite.sleep(30); const d = await window.htmlToImage.toJpeg(box.firstElementChild, { pixelRatio: 1, quality: 0.9 }); if (i === 0) window.__cover = d; if (i === 2) window.__ch = d; box.innerHTML = ''; if (i > 0) pdf.addPage(); pdf.addImage(d, 'JPEG', 0, 0, 210, 297); } return [P.length, pdf.output('arraybuffer').byteLength]; });
console.log('magnet pages/pdf bytes:', pdfBytes);
fs.writeFileSync(`${out}/magnet-cover.jpg`, Buffer.from((await page.evaluate(() => window.__cover)).split(',')[1], 'base64')); fs.writeFileSync(`${out}/magnet-ch.jpg`, Buffer.from((await page.evaluate(() => window.__ch)).split(',')[1], 'base64'));
await page.evaluate(() => save()); await page.waitForTimeout(500);
// Logo
await page.goto('http://localhost:8090/logo.html'); await page.fill('#name', 'ليل'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز'), null, { timeout: 60000 });
console.log('logos:', await page.evaluate(() => Object.keys(IMGS).length)); await page.click('.lg button.primary'); await page.waitForTimeout(300);
console.log('brand logo set:', await page.evaluate(() => !!JSON.parse(localStorage.getItem('brand')).logo));
await page.screenshot({ path: `${out}/p2-logo.png`, fullPage: true });
await page.goto('http://localhost:8090/index.html'); await page.waitForTimeout(500); console.log('library:', await page.evaluate(() => document.querySelectorAll('.lib .it').length));
console.log('calls', calls, 'errors:', errors.slice(0, 6));
await browser.close();
