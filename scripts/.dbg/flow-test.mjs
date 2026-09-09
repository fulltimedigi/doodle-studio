import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const mobile = process.argv[2] === 'mobile';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const demo = JSON.parse(fs.readFileSync('examples/demo-ar.json', 'utf8'));
// make the script reference two AI drawings with a shared character
demo.artRequests = [{ file: 'art/owner-a.png', character: 'owner', prompt: 'smiling shop owner' }, { file: 'art/owner-b.png', character: 'owner', prompt: 'same owner with phone' }];
demo.scenes[0].elements[0].src = 'art/owner-a.png'; demo.scenes[4].elements[0].src = 'art/owner-b.png';
const png = fs.readFileSync('examples/art/shop-owner.png').toString('base64');
const pcm = Buffer.alloc(24000 * 2 * 2); for (let i = 0; i < 48000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), i * 2);
let calls = { script: 0, tts: 0, img: 0 };
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const body = JSON.parse(route.request().postData()); const mods = body.generationConfig?.responseModalities || [];
  await new Promise((r) => setTimeout(r, 300));
  if (mods.includes('AUDIO')) { calls.tts++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) }); }
  if (mods.includes('IMAGE')) { calls.img++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }) }); }
  calls.script++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(demo) }] } }] }) });
});
await page.goto('http://localhost:8090/index.html');
await page.evaluate(() => { localStorage.setItem('gemini_key', 'x'); settings.key = 'x'; localStorage.removeItem('doodle_script'); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/home-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
await page.fill('#brief', 'فيديو لمساعد تسوق ذكي');
const t0 = Date.now();
await page.click('#makeBtn');
await page.waitForFunction(() => document.querySelector('#result video') || document.querySelector('#jobMsg').classList.contains('err'), null, { timeout: 900000 });
console.log('flow:', await page.evaluate(() => document.querySelector('#jobMsg').textContent), ((Date.now() - t0) / 1000).toFixed(0), 's', calls);
console.log('steps:', await page.evaluate(() => [...document.querySelectorAll('.steps span')].map((x) => x.dataset.step + ':' + x.className).join(' ')));
console.log('art:', await page.evaluate(() => [...ART.keys()].filter((n) => n.startsWith('owner'))));
await page.screenshot({ path: `${out}/done-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
if (!mobile) {
  const buf = await page.evaluate(async () => { const v = document.querySelector('#result video'); const b = await (await fetch(v.src)).blob(); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  fs.writeFileSync(`${out}/final.webm`, Buffer.from(buf)); console.log('video MB', (buf.length / 1e6).toFixed(1));
  await page.click('#advBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/advanced.png`, fullPage: true });
}
console.log('errors:', errors.slice(0, 5));
await browser.close();
