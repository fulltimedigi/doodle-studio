import { chromium } from 'playwright';
import fs from 'node:fs';
const out = '/tmp/claude-0/-home-user-fulltimedigi-app/dc64386e-3636-55db-bf63-338cab5c6ded/scratchpad';
const mobile = process.argv[2] === 'mobile';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1240, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
const png = fs.readFileSync('examples/art/shop-owner.png').toString('base64');
const demo = JSON.parse(fs.readFileSync('examples/demo-ar.json', 'utf8'));
const MOCK = {
  brand: { name: 'عطور ليل', sells: 'عطور نيش', usp: 'توصيل خلال ٢٤ ساعة', audience: 'سيدات ٢٥–٤٥ في الرياض', dialect: 'gulf', tones: ['فاخر', 'هادئ وواثق'], cta: 'اطلبي الآن', banned: '', hashtags: '#عطور_ليل #عطور_نيش' },
  reel: { topic: 'ليه عطرك ما يثبت؟', trend: 'فورمات "٣ أخطاء" مع نص كبير على الشاشة', ideas: [1, 2, 3].map((n) => ({ title: 'فكرة ' + n, format: 'talking head', duration: 30, hook: 'عطرك يروح بعد ساعة؟ الغلط مو في العطر', beats: [{ t: '0-3', say: 'عطرك يروح بعد ساعة؟', screen: 'يروح بعد ساعة؟', show: 'لقطة قريبة للعطر' }, { t: '3-10', say: 'أول غلط: تحطينه على الملابس', screen: 'الغلط الأول', show: 'يد ترش على القماش' }, { t: '10-20', say: 'ثاني غلط: تفركين معصمك', screen: 'لا تفركين', show: 'فرك المعصم مع علامة X' }, { t: '20-30', say: 'حطيه على البشرة المرطبة ويثبت اليوم كله', screen: 'يثبت اليوم كله', show: 'رش على المعصم' }], cta: 'اطلبي عطرك من ليل، توصيل خلال ٢٤ ساعة', caption: 'عطرك يروح بعد ساعة؟\nالغلط مو في العطر\nاطلبي الآن', hashtags: ['#عطور', '#الرياض', '#عطور_نيش'], why: 'يخاطب ألمًا شائعًا' })) },
  carousel: { topic: '٥ أسرار لثبات العطر', slides: [{ role: 'cover', title: '٥ أسرار تخلي عطرك يثبت طول اليوم', sub: 'جرّبيها اليوم وشوفي الفرق', visual: 'perfume bottle on marble' }, ...[1, 2, 3, 4, 5].map((n) => ({ role: 'point', n, title: 'السر رقم ' + n, body: 'رشّي العطر على البشرة المرطبة بعد الاستحمام مباشرة، لأن الترطيب يمسك الرائحة أطول.', visual: 'skin moisturiser' })), { role: 'cta', title: 'جاهزة لعطر يثبت؟', body: 'تشكيلة ليل توصلك خلال ٢٤ ساعة.', cta: 'اطلبي الآن', visual: 'gift box' }], caption: 'احفظي المنشور', hashtags: ['#عطور', '#الرياض'] },
  ad: { product: 'عطر ليل', variants: [{ name: 'benefit', headline: 'عطر يثبت من الصبح للّيل', sub: 'تركيز عالي وتوصيل خلال ٢٤ ساعة داخل الرياض', badge: '', cta: 'اطلبي الآن', image: 'perfume bottle on dark marble with soft light', space: 'bottom', mood: 'premium' }, { name: 'offer', headline: 'خصم ٢٠٪ حتى الجمعة', sub: 'على كل عطور ليل', badge: 'خصم ٢٠٪', cta: 'اطلبي الآن', image: 'perfume gift box', space: 'top', mood: 'bold' }, { name: 'emotional', headline: 'ريحتك أول ما يتذكرونه', sub: 'اختاري عطرًا يشبهك', badge: '', cta: 'اطلبي الآن', image: 'woman silhouette', space: 'bottom', mood: 'warm' }], caption: 'عطر ليل', hashtags: ['#عطور'] },
  motion: { title: 'موشن ليل', lines: [{ text: 'عطرك يروح بعد ساعة؟', emphasis: true, hold: 1.6 }, { text: 'الغلط مو في العطر', emphasis: false, hold: 1.5 }, { text: 'الغلط في طريقة الرش', emphasis: false, hold: 1.5 }, { text: 'رشّي على بشرة مرطبة', emphasis: true, hold: 1.8 }, { text: 'ويثبت اليوم كله', emphasis: false, hold: 1.5 }, { text: 'اطلبي الآن من ليل', emphasis: true, hold: 2 }], caption: 'كابشن الموشن', hashtags: ['#ليل'] },
};
const pcm = Buffer.alloc(24000 * 2); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), i * 2);
const calls = {};
await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const body = JSON.parse(route.request().postData()); const mods = body.generationConfig?.responseModalities || []; const sys = body.systemInstruction?.parts?.[0]?.text || ''; const user = body.contents?.[0]?.parts?.map((p) => p.text || '').join('') || '';
  const reply = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, groundingMetadata: body.tools ? { groundingChunks: [{ web: { uri: 'https://example.com', title: 'مصدر' } }] } : undefined }] }) });
  let kind = mods.includes('AUDIO') ? 'tts' : mods.includes('IMAGE') ? 'img' : /You edit a/.test(sys) ? 'edit' : /brand strategist/.test(sys) ? 'brand' : /short-form video/.test(sys) ? 'reel' : /carousel/.test(sys) ? 'carousel' : /static social ads/.test(sys) ? 'ad' : /kinetic/.test(sys) ? 'motion' : 'doodle';
  calls[kind] = (calls[kind] || 0) + 1;
  if (kind === 'tts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) });
  if (kind === 'img') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }) });
  if (kind === 'edit') { const cur = JSON.parse(user.match(/Current JSON:\n([\s\S]*)\n\nInstruction/)[1]); const s = JSON.stringify(cur).replace(/عطرك/g, 'ريحتك'); return reply(JSON.parse(s)); }
  return reply(MOCK[kind] || demo);
});
const onFail = async (e) => { console.log('FAIL', e.message.split('\n')[0], 'at', page.url()); try { console.log('msgs:', await page.evaluate(() => [...document.querySelectorAll('.msg')].map((x) => x.textContent).join(' | '))); } catch {} console.log('errors:', errors.slice(0, 6)); process.exit(1); }; process.on('unhandledRejection', onFail); process.on('uncaughtException', onFail);
const shot = (n) => page.screenshot({ path: `${out}/s-${n}${mobile ? '-m' : ''}.png`, fullPage: true });
// 1) hub + brand
await page.goto('http://localhost:8090/index.html'); await page.evaluate(() => { localStorage.setItem('gemini_key', 'x'); });
await page.reload(); await shot('hub-empty');
await page.click('text=أنشئ هوية البراند الآن'); await page.fill('#b_desc', 'متجر عطور نيش في الرياض'); await page.click('button:has-text("املأ تلقائيًا")');
await page.waitForFunction(() => document.querySelector('#b_msg').textContent.includes('راجع')); await page.click('button:has-text("حفظ الهوية")'); await page.waitForTimeout(300);
console.log('brand:', await page.evaluate(() => JSON.parse(localStorage.getItem('brand')).name), await page.evaluate(() => document.querySelector('.brandChip .n').textContent));
await shot('hub');
// 2) reels
await page.goto('http://localhost:8090/reels.html'); await page.fill('#topic', 'ليه عطرك ما يثبت'); await page.click('#go');
await page.waitForFunction(() => !document.querySelector('#out').hidden); await page.waitForTimeout(200);
await page.fill('#chatIn', 'غيّر كلمة عطرك'); await page.click('.chat button'); await page.waitForFunction(() => document.querySelector('#msg2').textContent.includes('تم'));
console.log('reel edited:', await page.evaluate(() => document.querySelector('.hook').textContent)); await page.click('text=حفظ في المكتبة'); await page.waitForTimeout(300); await shot('reels');
// 3) carousel
await page.goto('http://localhost:8090/carousel.html'); await page.fill('#topic', 'أسرار ثبات العطر'); await page.check('#aiCover'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز'), null, { timeout: 60000 }); await page.waitForTimeout(400);
await page.click('.frame:nth-child(3)'); await page.fill('#edTitle', 'عنوان معدّل'); await page.waitForTimeout(100);
const zipSize = await page.evaluate(async () => { const files = []; for (let i = 0; i < DATA.slides.length; i++) files.push([`s${i}.png`, await renderPng(i)]); const z = await Suite.zipBlobs(files); return [z.size, files.map((f) => f[1].size)]; });
const slide0 = await page.evaluate(async () => { const b = await renderPng(0); return Array.from(new Uint8Array(await b.arrayBuffer())); }); fs.writeFileSync(`${out}/slide0.png`, Buffer.from(slide0)); const slide2 = await page.evaluate(async () => { const b = await renderPng(2); return Array.from(new Uint8Array(await b.arrayBuffer())); }); fs.writeFileSync(`${out}/slide2.png`, Buffer.from(slide2));
console.log('carousel zip bytes:', zipSize[0], 'slide sizes:', zipSize[1].join(','));
await page.evaluate(() => save()); await page.waitForTimeout(800); await shot('carousel');
// 4) ad
await page.goto('http://localhost:8090/ad.html'); await page.fill('#brief', 'عطر ليل خصم ٢٠٪'); await page.click('#go');
await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('جاهز'), null, { timeout: 60000 }); await page.waitForTimeout(400);
const adArr = await page.evaluate(async () => Array.from(new Uint8Array(await (await renderPng(1, 's45')).arrayBuffer()))); fs.writeFileSync(`${out}/ad1.png`, Buffer.from(adArr)); console.log('ad png bytes:', adArr.length);
await page.evaluate(() => save()); await page.waitForTimeout(800); await shot('ad');
// 5) motion
await page.goto('http://localhost:8090/doodle.html?mode=motion'); await page.waitForTimeout(800);
await page.fill('#brief', 'عطر ليل يثبت طول اليوم'); await page.click('#makeBtn');
await page.waitForFunction(() => document.querySelector('#result video') || document.querySelector('#jobMsg').classList.contains('err'), null, { timeout: 600000 });
console.log('motion:', await page.evaluate(() => document.querySelector('#jobMsg').textContent), await page.evaluate(() => ({ scenes: SCRIPT.scenes.length, hand: SCRIPT.hand, bg: SCRIPT.defaults?.background })));
await shot('motion');
const frameUrl = await page.evaluate(() => { window.doodle.seek(2.2); const c = document.createElement('canvas'); c.width = 540; c.height = 960; window.doodle.paint(c.getContext('2d'), 0.5, null); return c.toDataURL(); });
fs.writeFileSync(`${out}/motion-frame.png`, Buffer.from(frameUrl.split(',')[1], 'base64'));
// 6) hub library
await page.goto('http://localhost:8090/index.html'); await page.waitForTimeout(600);
console.log('library items:', await page.evaluate(() => document.querySelectorAll('.lib .it').length)); await shot('hub-lib');
console.log('calls', calls); console.log('errors:', errors.slice(0, 8));
await browser.close();
