import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await (await browser.newContext({ viewport: { width: 1240, height: 900 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const MOCK = { topic: 'عميلك تعوّد يسأل AI قبل ما يشتري', slides: [
 { role: 'cover', title: 'عميلك تعوّد يسأل', title_accent: 'AI قبل ما يشتري', sub: 'ثم يدخل متجرك ويُترك يقرر وحده.', visual: 'phone chat' },
 { role: 'point', n: 1, title: 'العميل اليوم يسأل AI:', bullets: ['قارن لي بين هذه المنتجات', 'إيه الأنسب لاحتياجي؟', 'لو ميزانيتي أقل أختار إيه؟'], body: 'طريقة البحث عن المنتج نفسها بدأت تتغير.', visual: '' },
 { role: 'point', n: 2, title: 'المشكلة ليست في عدم وجود منتجات', title_accent: 'المشكلة أن العميل قد يعرف:', bullets: ['احتياجه', 'ميزانيته', 'المناسبة'], body: 'لكن لا يعرف اسم المنتج الذي يبحث عنه.', en: 'Search works when you already know what to search for.', en_sub: 'لكن ماذا لو كنت تعرف احتياجك فقط؟', visual: '' },
 { role: 'point', n: 3, title: 'إضافة AI وحدها', title_accent: 'ليست الحل.', body: 'لأن أي مساعد ذكي يعتمد في النهاية على جودة بيانات منتجات متجرك.', en: 'AI cannot sell what your catalog cannot explain.', visual: '' },
 { role: 'point', n: 4, title: 'الحل: مساعد يفهم النية', bullets: ['يفهم سؤال العميل', 'يقترح من كتالوجك فقط', 'يرد في ثواني'], body: '', visual: '' },
 { role: 'point', n: 5, title: 'يتركّب في دقائق', body: 'بدون برمجة، على سلة وزد وشوبيفاي.', visual: '' },
 { role: 'cta', title: 'نحن في بداية بناء', title_accent: 'FULLTIMEDIGI', body: 'مساعد بيع ذكي للمتاجر الإلكترونية. يفهم ما يبحث عنه العميل من غير ما يخترع حقيقة المنتج.', cta: 'تابعنا لنكون جزءًا من الرحلة', visual: '' } ], caption: 'كابشن', hashtags: ['#FullTimeDigi'] };
await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(MOCK) }] } }] }) }));
await page.goto('http://localhost:8090/index.html'); await page.evaluate(() => localStorage.setItem('gemini_key', 'x'));
await page.reload(); await page.click('text=أنشئ هوية البراند الآن'); await page.click('button:has-text("هوية FullTimeDigi الجاهزة")'); await page.waitForTimeout(600); await page.click('button:has-text("حفظ الهوية")'); await page.waitForTimeout(300);
console.log('brand:', await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('brand')); return [b.name, b.colors.accent, !!b.logo, b.dialect]; }));
await page.goto('http://localhost:8090/carousel.html'); await page.fill('#topic', 'x'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز')); await page.waitForTimeout(400);
for (const i of [0, 2, 3, 6]) { const b = await page.evaluate(async (i) => Array.from(new Uint8Array(await (await renderPng(i)).arrayBuffer())), i); fs.writeFileSync(`${out}/brand-slide${i}.png`, Buffer.from(b)); }
await page.screenshot({ path: `${out}/brand-carousel.png`, fullPage: true });
console.log('errors', errors); await browser.close();
