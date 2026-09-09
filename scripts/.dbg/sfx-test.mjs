import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:8090/index.html');
await page.evaluate(() => localStorage.removeItem('doodle_script'));
await page.evaluate(() => loadExample());
await page.waitForFunction(() => COMPILED && !BUSY, null, { timeout: 90000 });
const r = await page.evaluate(async () => {
  const c = { ...COMPILED, audio: [], music: 'none', sfx: true };
  const buf = await mixAudio(c); const d = buf.getChannelData(0); const win = 0.1; const n = Math.floor(12 / win); const rms = [];
  for (let i = 0; i < n; i++) { let s = 0; const a = Math.floor(i * win * buf.sampleRate), b = Math.floor((i + 1) * win * buf.sampleRate); for (let k = a; k < b; k++) s += d[k] * d[k]; rms.push(Math.sqrt(s / (b - a))); }
  const pc = window.doodle.penCurve(0.01); const act = []; for (let i = 0; i < n; i++) { let m = 0; for (let k = i * 10; k < (i + 1) * 10; k++) m = Math.max(m, pc.speed[k] || 0); act.push(m); }
  const peak = Math.max(...rms); const tl = window.doodle.timeline();
  return { peak, rms: rms.map((v) => Math.round(v / peak * 9)).join(''), act: act.map((v) => Math.min(9, Math.round(v / 300))).join(''), pen: tl.pen.slice(0, 4).map((p) => [p.start.toFixed(1), p.end.toFixed(1)].join('-')) };
});
console.log('peak', r.peak.toFixed(3));
console.log('sfx  ', r.rms);
console.log('speed', r.act);
console.log('elements', r.pen);
await browser.close();
