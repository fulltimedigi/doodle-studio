import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const png = fs.readFileSync('examples/art/shop-owner.png').toString('base64');
const clip = fs.readFileSync('scripts/.dbg/fixtures/clip.webm');
const SCRIPT = { creator: 'Gulf store owner, 35', setting: 'perfume shop', clips: [{ role: 'hook', say: 'عملائي يسألون', action: 'a', camera: 'c' }, { role: 'product', say: 'ب', action: 'a', camera: 'c' }], caption: 'c', hashtags: ['#x'] };
let calls = []; let mode = process.argv[2] || 'ladder';
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const u = route.request().url(); const reply = (status, o) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('predictLongRunning')) { const b = JSON.parse(route.request().postData()); const inst = b.instances[0]; calls.push({ fmt: inst.image ? Object.keys(inst.image).join('+') : (inst.referenceImages ? Object.keys(inst.referenceImages[0].image).join('+') : 'none'), model: u.match(/models\/([^:]+)/)[1], img: !!inst.image, refs: !!inst.referenceImages, pg: b.parameters.personGeneration, nov: 'numberOfVideos' in b.parameters, neg: !!b.parameters.negativePrompt, dur: b.parameters.durationSeconds, res: b.parameters.resolution });
    if (mode === 'forbidden') return reply(403, { error: { code: 403, message: 'Permission denied: Veo is not available for this API key. Enable billing.' } });
    if ('numberOfVideos' in b.parameters) return reply(400, { error: { code: 400, message: '`numberOfVideos` isn\'t supported by this model.' } });
    if (JSON.stringify(inst).includes('inlineData')) return reply(400, { error: { code: 400, message: '`inlineData` isn\'t supported by this model. Please remove it or refer to the Gemini API documentation for supported usage.' } });
    if (inst.image && !inst.image.bytesBase64Encoded) return reply(400, { error: { code: 400, message: 'image must have bytesBase64Encoded' } });
    const fast = u.includes('fast') || u.includes('lite');
    if (fast && inst.referenceImages) return reply(400, { error: { code: 400, message: 'allow_adult for personGeneration is currently not supported.' } });
    if (!inst.image && !inst.referenceImages && b.parameters.personGeneration === 'allow_adult') return reply(400, { error: { code: 400, message: 'allow_adult for personGeneration is currently not supported.' } });
    if ((inst.image || inst.referenceImages) && b.parameters.personGeneration !== 'allow_adult') return reply(400, { error: { code: 400, message: 'personGeneration must be allow_adult for image-to-video.' } });
    if (b.parameters.negativePrompt) return reply(400, { error: { code: 400, message: '`negativePrompt` isn\'t supported by this model.' } });
    return reply(200, { name: 'operations/op1' }); }
  if (u.includes('operations/op1')) return reply(200, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/x:download' } }] } } });
  if (u.includes(':download')) return route.fulfill({ status: 200, contentType: 'video/webm', body: clip });
  const body = JSON.parse(route.request().postData()); const mods = body.generationConfig?.responseModalities || [];
  if (mods.includes('IMAGE')) return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] });
  return reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(SCRIPT) }] } }] });
});
await page.goto('http://localhost:8090/ugc.html'); await page.evaluate(() => localStorage.setItem('gemini_key', 'x')); await page.reload();
await page.fill('#brief', 'x'); if (mode === 'onebutton') { /* skip script step: makeAd writes it */ } else { if (mode === 'standard') await page.selectOption('#tier', 'standard'); if (mode === 'lite') await page.selectOption('#tier', 'lite'); await page.evaluate(() => writeScript()); await page.waitForFunction(() => document.querySelectorAll('#clipsEd .clip').length > 0, null, { timeout: 30000 }); }

page.on('dialog', (d) => d.accept());
if (mode === 'onebutton') { await page.click('#go'); } else { await page.click('#shootBtn'); }
await page.waitForFunction(() => /كل اللقطات جاهزة|الإعلان جاهز|فشلت|❌/.test(document.querySelector('#msg2').textContent), null, { timeout: 180000 });
if (mode === 'onebutton') console.log('final video:', await page.evaluate(() => !!document.querySelector('#final video')));
console.log('keyframes', await page.evaluate(() => Object.keys(KEYS).length), '| clips', await page.evaluate(() => Object.keys(CLIPS).length));
console.log(mode, '| msg2:', await page.$eval('#msg2', (e) => e.textContent)); console.log('calls', JSON.stringify(calls));
await page.$('#clips').then((h) => h.screenshot({ path: `${out}/veo-${mode}.png` }));
console.log('errors', errors); await browser.close();
