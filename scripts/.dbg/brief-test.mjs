import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await (await browser.newContext({ viewport: { width: 1240, height: 900 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const png = fs.readFileSync('examples/art/shop-owner.png').toString('base64');
const CAR = { topic: 'ليش البحث ما يكفي', slides: [
  { role: 'cover', title: 'عميلك يعرف وش يحتاج', title_accent: 'بس ما يعرف اسم المنتج', sub: 'ليش Search والفلاتر ما يحلّون كل شيء', visual: '' },
  { role: 'point', n: 1, title: 'تعوّد يسأل AI', title_accent: 'قبل ما يشتري', body: 'اسأل → قارن → افهم → قرّر. هذي عادته الجديدة.', visual: 'shopper chatting on phone comparing two products' },
  { role: 'point', n: 2, title: 'وفي متجرك يلقى', bullets: ['Search', 'Filters', 'Product Cards', 'اختر بنفسك'], body: 'تجربة مبنية لعميل يعرف مسبقًا وش يبي', visual: '' },
  { role: 'point', n: 3, title: 'Search يشتغل', title_accent: 'لما تعرف وش تدوّر عليه', body: 'العميل يعرف الاحتياج والميزانية والمناسبة، مو اسم المنتج.', en: 'Search works when you already know what to search for.', en_sub: 'البحث يشتغل لما تعرف مسبقًا عن إيش تبحث', visual: '' },
  { role: 'point', n: 4, title: 'AI وحده ما يكفي', body: 'المساعدة الذكية تبدأ من بيانات منتجات تقدر تثق فيها.', visual: 'incomplete product data sheet with missing fields' },
  { role: 'point', n: 5, title: 'الحقيقة من الكتالوج', title_accent: 'والفهم من AI', body: 'AI cannot sell what your catalog cannot explain.', visual: '' },
  { role: 'cta', title: 'نبني FullTimeDigi عشان هذي الفجوة', body: 'مساعد بيع يفهم العميل ولا يخترع حقيقة المنتج.', cta: 'تابع رحلة البناء', visual: '' } ], caption: 'c', hashtags: ['#FullTimeDigi'] };
const AD = { product: 'FullTimeDigi', variants: [{ name: 'problem', headline: 'عميلك يعرف وش يحتاج، بس ما يعرف اسم المنتج', sub: 'وأغلب المتاجر مبنية لعميل يعرف مسبقًا وش يبي', badge: '', cta: 'تابع رحلة بناء FullTimeDigi', image: 'shopper in front of a wall of perfume bottles looking undecided', space: 'bottom', mood: 'clean' }, { name: 'insight', headline: 'AI ما يقدر يبيع اللي الكتالوج ما يقدر يشرحه', sub: 'الحقيقة من بيانات المنتج، والفهم من AI', badge: '', cta: 'تابعنا', image: 'x', space: 'bottom', mood: 'clean' }, { name: 'pov', headline: 'Search يشتغل لما تعرف وش تدوّر عليه', sub: 'والعميل غالبًا ما يعرف', badge: '', cta: 'تابعنا', image: 'x', space: 'bottom', mood: 'warm' }], caption: 'c', hashtags: ['#FullTimeDigi'] };
await page.route('https://generativelanguage.googleapis.com/**', (route) => { const body = JSON.parse(route.request().postData()); const mods = body.generationConfig?.responseModalities || []; const sys = body.systemInstruction?.parts?.[0]?.text || ''; const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); if (mods.includes('IMAGE')) return reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }); const obj = /static social ads/.test(sys) ? AD : CAR; return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }); });
await page.goto('http://localhost:8090/index.html'); await page.evaluate(() => localStorage.setItem('gemini_key', 'x')); await page.reload();
await page.click('text=أنشئ هوية البراند الآن'); await page.click('button:has-text("هوية FullTimeDigi الجاهزة")'); await page.waitForFunction(() => document.getElementById('b_brief').value.length > 500); await page.screenshot({ path: `${out}/b3-dialog.png` }); await page.click('button:has-text("حفظ الهوية")'); await page.waitForTimeout(300);
const ctx = await page.evaluate(() => Suite.brandContext()); console.log('ctx length', ctx.length, '| has POV', ctx.includes('AI cannot sell'), '| has visual', ctx.includes('NEVER show robots'), '| dialect', ctx.includes('white'));
console.log('imageStyle', (await page.evaluate(() => Suite.imageStyle())).slice(0, 60));
await page.screenshot({ path: `${out}/b3-hub.png`, fullPage: true });
await page.goto('http://localhost:8090/carousel.html'); await page.fill('#topic', 'x'); await page.click('#go'); await page.waitForFunction(() => !document.querySelector('#out').hidden, null, { timeout: 60000 }); await page.waitForTimeout(300);
const sysUsed = await page.evaluate(() => window.__lastSys || ''); 
await page.evaluate(async () => { await aiBg(1); }); await page.waitForTimeout(300);
for (const i of [0, 1, 2, 3, 6]) { const b = await page.evaluate(async (i) => { const box = document.getElementById('exportBox'); box.innerHTML = slideHTML(DATA.slides[i], i, DATA.slides.length); await Suite.sleep(30); const bl = await Suite.nodeToPng(box.firstElementChild, 0.5); box.innerHTML = ''; return Array.from(new Uint8Array(await bl.arrayBuffer())); }, i); fs.writeFileSync(`${out}/b3-car-${i}.png`, Buffer.from(b)); }
await page.goto('http://localhost:8090/ad.html'); await page.fill('#brief', 'x'); await page.click('#go'); await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز'), null, { timeout: 60000 }); await page.waitForTimeout(300);
let b = await page.evaluate(async () => Array.from(new Uint8Array(await (await renderPng(0, 's45')).arrayBuffer()))); fs.writeFileSync(`${out}/b3-ad.png`, Buffer.from(b));
console.log('errors', errors); await browser.close();
