import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', (e) => console.log('pageerror', e.message, e.stack?.split('\n').slice(0,3).join(' | ')));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
await page.goto('http://localhost:8090/index.html');
await page.waitForTimeout(15000);
console.log(await page.evaluate(() => ({ busy: window.BUSY, compiled: !!window.COMPILED, job: document.querySelector('#jobMsg').textContent, ai: document.querySelector('#aiMsg').textContent, scenes: SCRIPT.scenes.length })));
await browser.close();
