/* Doodle Studio suite — shared layer: settings, Gemini client, brand DNA, library, UI helpers.
   Everything runs in the visitor's browser; the only network calls go to Google with the user's own key. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  // ---------- settings (same localStorage keys as the doodle studio) ----------
  const SCRIPT_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash', 'gemini-3-flash', 'gemini-2.5-flash'];
  const IMG_MODELS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'];
  const IMG_PRICE = { 'gemini-3.1-flash-image': 0.067, 'gemini-2.5-flash-image': 0.039, 'gemini-3.1-flash-lite-image': 0.034 };
  const settings = {
    get key() { return localStorage.getItem('gemini_key') || ''; }, set key(v) { localStorage.setItem('gemini_key', v); },
    get model() { const m = localStorage.getItem('gemini_model') || SCRIPT_MODELS[0]; return m === 'gemini-2.5-flash' ? SCRIPT_MODELS[0] : m; }, set model(v) { localStorage.setItem('gemini_model', v); },
    get img() { return localStorage.getItem('img_model') || IMG_MODELS[0]; }, set img(v) { localStorage.setItem('img_model', v); },
  };

  // ---------- Gemini ----------
  let waitHook = null; // (message) => void, set per call for countdown messages
  async function gemini(model, body, onWait) {
    if (!settings.key) throw new Error('ضع مفتاح Gemini في الإعدادات أولًا (⚙️)');
    const waits = [12, 22, 32, 45, 60];
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.key }, body: JSON.stringify(body) });
      if ((r.status === 429 || r.status === 503) && attempt < waits.length) {
        for (let s = waits[attempt]; s > 0; s--) { (onWait || waitHook || (() => {}))(`⏳ حصة Google ممتلئة مؤقتًا — إعادة المحاولة خلال ${s} ث`); await sleep(1000); }
        continue;
      }
      if (!r.ok) { const err = new Error(r.status === 429 ? 'تجاوزت حصة Gemini — انتظر دقيقة ثم أعد المحاولة' : `Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`); err.status = r.status; throw err; }
      return r.json();
    }
  }
  async function geminiAny(models, body, onWait) {
    let last;
    for (const m of models) { try { return { j: await gemini(m, body, onWait), model: m }; } catch (e) { last = e; if (e.status !== 404 && e.status !== 400) throw e; } }
    throw last;
  }
  const textOf = (j) => j.candidates?.[0]?.content?.parts?.filter((p) => p.text && !p.thought).map((p) => p.text).join('') || '';
  function parseJSON(text) {
    const t = text.replace(/```json|```/g, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < 0) throw new Error('لم يُرجع النموذج JSON صالحًا');
    return JSON.parse(t.slice(a, b + 1));
  }
  // structured call: system prompt + user text -> JSON object. `search` adds Google Search grounding (trend research).
  async function geminiJSON(system, user, { search = false, temperature = 0.7, onWait, images = [] } = {}) {
    const parts = [{ text: user }, ...images.map((u) => ({ inlineData: { mimeType: u.match(/^data:([^;]+)/)[1], data: u.split(',')[1] } }))];
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature } };
    if (search) body.tools = [{ google_search: {} }]; else body.generationConfig.responseMimeType = 'application/json';
    const models = [settings.model, ...SCRIPT_MODELS.filter((m) => m !== settings.model)];
    try {
      const { j, model } = await geminiAny(models, body, onWait);
      if (model !== settings.model) settings.model = model;
      const out = parseJSON(textOf(j));
      const src = j.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c) => c.web).filter(Boolean) || [];
      if (src.length) out._sources = src.slice(0, 8);
      return out;
    } catch (e) {
      if (search && (e.status === 400 || /JSON/.test(e.message))) return geminiJSON(system, user, { search: false, temperature, onWait, images }); // search tool unavailable for this key/model: continue without it
      throw e;
    }
  }
  function findImagePart(o) { if (!o || typeof o !== 'object') return null; if (typeof o.data === 'string' && /^image\//.test(o.mimeType || o.mime_type || '')) return { data: o.data, mime: o.mimeType || o.mime_type }; for (const v of Object.values(o)) { const f = findImagePart(v); if (f) return f; } return null; }
  async function generateImage(prompt, { ratio = '1:1', refs = [], onWait } = {}) {
    const parts = [{ text: prompt }, ...refs.map((u) => ({ inlineData: { mimeType: u.match(/^data:([^;]+)/)[1], data: u.split(',')[1] } }))];
    const models = [settings.img, ...IMG_MODELS.filter((m) => m !== settings.img)]; let last;
    for (const m of models) {
      for (const cfg of [{ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } }, { responseModalities: ['TEXT', 'IMAGE'] }]) {
        try { const j = await gemini(m, { contents: [{ parts }], generationConfig: cfg }, onWait); const im = findImagePart(j.candidates?.[0]?.content); if (im) return `data:${im.mime};base64,${im.data}`; last = new Error('لم يُرجع Gemini صورة (ربما رفض الوصف)'); }
        catch (e) { last = e; if (e.status !== 400 && e.status !== 404) throw e; }
      }
    }
    throw last || new Error('تعذّر توليد الصورة');
  }
  // ---------- Veo (video generation, long-running) ----------
  const VEO_MODELS = { fast: 'veo-3.1-fast-generate-preview', standard: 'veo-3.1-generate-preview', lite: 'veo-3.1-lite-generate-preview' };
  const VEO_PRICE = { fast: { '720p': 0.10, '1080p': 0.12 }, standard: { '720p': 0.40, '1080p': 0.40 }, lite: { '720p': 0.05, '1080p': 0.08 } }; // per second
  const inline = (u) => ({ inlineData: { mimeType: u.match(/^data:([^;]+)/)[1], data: u.split(',')[1] } });
  async function veoGenerate({ prompt, refs = [], image = null, tier = 'fast', aspect = '9:16', resolution = '1080p', duration = 8, negative = '', onStatus }) {
    if (!settings.key) throw new Error('ضع مفتاح Gemini في الإعدادات أولًا (⚙️)');
    const model = VEO_MODELS[tier] || VEO_MODELS.fast;
    const inst = { prompt }; if (image) inst.image = inline(image); if (refs.length) inst.referenceImages = refs.slice(0, 3).map((u) => ({ image: inline(u), referenceType: 'asset' }));
    const params = { aspectRatio: aspect, resolution, durationSeconds: duration, personGeneration: 'allow_adult', numberOfVideos: 1 }; if (negative) params.negativePrompt = negative;
    const H = { 'content-type': 'application/json', 'x-goog-api-key': settings.key };
    let r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, { method: 'POST', headers: H, body: JSON.stringify({ instances: [inst], parameters: params }) });
    if (r.status === 400 && inst.referenceImages) { delete inst.referenceImages; r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, { method: 'POST', headers: H, body: JSON.stringify({ instances: [inst], parameters: params }) }); }
    if (!r.ok) { const t = await r.text(); throw new Error(r.status === 429 ? 'تجاوزت حصة Veo — انتظر دقيقة' : `Veo ${r.status}: ${t.slice(0, 240)}`); }
    const op = await r.json(); let name = op.name; let tries = 0;
    while (true) {
      await sleep(8000); tries++; if (onStatus) onStatus(`⏳ Veo يُصوّر… ${tries * 8} ث`);
      const p = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { headers: { 'x-goog-api-key': settings.key } });
      if (!p.ok) throw new Error(`Veo poll ${p.status}`);
      const j = await p.json();
      if (j.error) throw new Error('Veo: ' + (j.error.message || 'فشل التوليد'));
      if (j.done) {
        const s = j.response?.generateVideoResponse?.generatedSamples?.[0] || j.response?.generatedVideos?.[0];
        const uri = s?.video?.uri; if (!uri) throw new Error('Veo لم يُرجع فيديو (ربما رفض الوصف أو الصورة)');
        const v = await fetch(uri, { headers: { 'x-goog-api-key': settings.key } }); if (!v.ok) throw new Error(`تعذّر تنزيل الفيديو (${v.status})`);
        return await v.blob();
      }
      if (tries > 90) throw new Error('Veo تأخر أكثر من ١٢ دقيقة');
    }
  }
  async function pmap(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

  // ---------- brand DNA ----------
  const DIALECTS = { eg: 'مصري', gulf: 'خليجي', msa: 'فصحى مبسّطة' };
  const DIALECT_NOTE = {
    eg: 'Egyptian colloquial Arabic (مصري): natural spoken Cairo dialect as used by Egyptian marketers (دلوقتي، عايز، بيدخل، إزاي). Warm, witty, direct.',
    gulf: 'Gulf colloquial Arabic (خليجي، white dialect understood across KSA/UAE/Kuwait): الحين، أبي/أبغى، وش، شلون، ودّك. Polite, confident, premium feel.',
    msa: 'Simple Modern Standard Arabic (فصحى مبسّطة) with short sentences; no classical vocabulary.',
  };
  const TONES = ['ودود', 'محترف', 'حماسي', 'فاخر', 'مرح', 'هادئ وواثق'];
  const DEFAULT_BRAND = { name: '', sells: '', audience: '', dialect: 'eg', tones: ['ودود', 'واثق'], colors: { primary: '#1d1d1d', accent: '#e63946', bg: '#ffffff' }, font: 'Cairo', logo: '', cta: 'اطلب الآن', website: '', phone: '', banned: '', usp: '', hashtags: '' };
  function loadBrand() { try { return { ...DEFAULT_BRAND, ...JSON.parse(localStorage.getItem('brand') || '{}') }; } catch { return { ...DEFAULT_BRAND }; } }
  function saveBrand(b) { localStorage.setItem('brand', JSON.stringify(b)); }
  const brandReady = (b) => !!(b.name && b.sells);
  function brandContext(b = loadBrand()) {
    if (!brandReady(b)) return `Dialect: ${DIALECT_NOTE[b.dialect] || DIALECT_NOTE.eg}`;
    return [
      `BRAND DNA (apply to everything you write):`,
      `- Brand: ${b.name}`, `- What it sells: ${b.sells}`, b.usp && `- Main promise / USP: ${b.usp}`,
      `- Audience: ${b.audience || 'general Arabic-speaking consumers'}`,
      `- Dialect: ${DIALECT_NOTE[b.dialect] || DIALECT_NOTE.eg}`,
      `- Tone: ${(b.tones || []).join('، ') || 'ودود'}`,
      `- Default call to action: ${b.cta || 'اطلب الآن'}`, b.website && `- Website: ${b.website}`, b.phone && `- Phone/WhatsApp: ${b.phone}`,
      b.banned && `- Never use these words/claims: ${b.banned}`, b.hashtags && `- Brand hashtags: ${b.hashtags}`,
      `- Never invent statistics, prices, awards or testimonials that are not in the brief.`,
    ].filter(Boolean).join('\n');
  }

  // ---------- library (IndexedDB) ----------
  function idb() { return new Promise((ok, bad) => { const r = indexedDB.open('doodle-suite', 1); r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' }); if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets'); }; r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); }); }
  const tx = async (store, mode, fn) => { const db = await idb(); return new Promise((ok, bad) => { const t = db.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => ok(req && req.result); t.onerror = () => bad(t.error); }); };
  const lib = {
    async save(item) { item.id = item.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); item.created = item.created || Date.now(); item.updated = Date.now(); await tx('library', 'readwrite', (s) => s.put(item)); return item; },
    async list(type) { const all = (await tx('library', 'readonly', (s) => s.getAll())) || []; return all.filter((x) => !type || x.type === type).sort((a, b) => b.updated - a.updated); },
    async get(id) { return tx('library', 'readonly', (s) => s.get(id)); },
    async del(id) { return tx('library', 'readwrite', (s) => s.delete(id)); },
    async asset(k, v) { return v === undefined ? tx('assets', 'readonly', (s) => s.get(k)) : tx('assets', 'readwrite', (s) => s.put(v, k)); },
  };

  // ---------- UI ----------
  let toastEl = null, toastT = null;
  function toast(m) { if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); } toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2200); }
  const say = (id, m, err) => { const el = $(id); if (!el) return; el.textContent = m; el.classList.toggle('err', !!err); };
  async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('✅ نُسخ'); } catch { toast('تعذّر النسخ'); } }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const readFile = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
  function fonts() { if ($('suiteFonts')) return; const st = document.createElement('style'); st.id = 'suiteFonts'; st.textContent = [['Cairo', 400, 'cairo-arabic-400-normal'], ['Cairo', 700, 'cairo-arabic-700-normal'], ['Cairo', 900, 'cairo-arabic-900-normal'], ['Tajawal', 400, 'tajawal-arabic-400-normal'], ['Tajawal', 700, 'tajawal-arabic-700-normal'], ['Tajawal', 800, 'tajawal-arabic-800-normal']].map(([n, w, f]) => `@font-face{font-family:"${n}";font-weight:${w};src:url(assets/fonts/${f}.woff2) format("woff2");font-display:swap}`).join('') + '@font-face{font-family:"Patrick Hand";src:url(assets/fonts/PatrickHand.ttf)}@font-face{font-family:"Aref Ruqaa";src:url(assets/fonts/ArefRuqaa.ttf)}'; document.head.appendChild(st); }

  // header + shared settings dialog
  function mountHeader(crumb) {
    fonts();
    const b = loadBrand();
    const h = document.createElement('header'); h.className = 'top';
    h.innerHTML = `<a class="logo" href="index.html"><img src="assets/brand/fd-logo.png" alt=""><span>FullTime<em>Digi</em> Studio</span></a>${crumb ? `<span class="crumb">/ ${esc(crumb)}</span>` : ''}<span class="grow"></span>
      <a class="brandChip" href="index.html#brand" title="هوية البراند"><span class="dot">${b.logo ? `<img src="${b.logo}" alt="">` : esc((b.name || '؟').slice(0, 1))}</span><span class="n">${esc(b.name || 'أنشئ هوية البراند')}</span></a>
      <button class="soft small" onclick="Suite.openSettings()" title="الإعدادات">⚙️</button>`;
    document.body.prepend(h);
    const d = document.createElement('dialog'); d.id = 'suiteSettings';
    d.innerHTML = `<div class="body"><h2>⚙️ الإعدادات</h2>
      <div class="note">مفتاح Gemini واحد يشغّل كل الوحدات (نص، صوت، صور). أنشئه من <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>. يُحفظ في متصفحك فقط.</div>
      <label class="f">GEMINI_API_KEY</label><input id="ss_key" placeholder="AIza…">
      <label class="f">نموذج النص</label><input id="ss_model" placeholder="gemini-3.6-flash">
      <label class="f">نموذج الصور</label><select id="ss_img"><option value="gemini-3.1-flash-image">Nano Banana 2 — الأفضل (≈ $0.067)</option><option value="gemini-2.5-flash-image">Nano Banana (≈ $0.039)</option><option value="gemini-3.1-flash-lite-image">Nano Banana 2 Lite (≈ $0.034)</option></select>
      <div class="row" style="margin-top:14px"><button class="fix" onclick="Suite.saveSettings()">حفظ</button><span class="grow"></span><button class="ghost fix" onclick="document.getElementById('suiteSettings').close()">إغلاق</button></div><div id="ss_msg" class="msg"></div></div>`;
    document.body.appendChild(d);
  }
  function openSettings() { $('ss_key').value = settings.key; $('ss_model').value = settings.model; $('ss_img').value = settings.img; $('suiteSettings').showModal(); }
  function saveSettings() { settings.key = $('ss_key').value.trim(); settings.model = $('ss_model').value.trim() || SCRIPT_MODELS[0]; settings.img = $('ss_img').value; say('ss_msg', '✅ حُفظ'); setTimeout(() => $('suiteSettings').close(), 500); }
  function needKey(msgId) { if (settings.key) return true; openSettings(); if (msgId) say(msgId, 'ضع مفتاح Gemini ثم احفظ وأعد المحاولة', true); return false; }

  // chat-based editing: apply a plain-language instruction to any JSON result, same shape back
  async function chatEdit(json, instruction, kind, onWait) {
    const sys = `You edit a ${kind} JSON for an Arabic marketing team. Apply the user's instruction and return the COMPLETE updated JSON with exactly the same keys and structure. Keep everything the user did not ask to change. ${brandContext()}`;
    const out = await geminiJSON(sys, `Current JSON:\n${JSON.stringify(json)}\n\nInstruction: ${instruction}`, { temperature: 0.4, onWait });
    delete out._sources; return out;
  }

  // export a DOM node (a slide / an ad) to a PNG blob at its design size
  async function nodeToPng(node, scale = 1) { return window.htmlToImage.toBlob(node, { pixelRatio: scale, cacheBust: false, skipFonts: false }); }
  async function zipBlobs(files) { const z = new JSZip(); for (const [n, b] of files) z.file(n, b); return z.generateAsync({ type: 'blob' }); }

  // library helpers for module pages: load an item by ?id= and expose thumbnail utils
  const q = new URLSearchParams(location.search);
  async function thumb(node, size = 320) { try { const b = await window.htmlToImage.toJpeg(node, { pixelRatio: size / Math.max(node.offsetWidth, 1), quality: 0.7 }); return b; } catch { return ''; } }

  window.Suite = { $, esc, sleep, settings, SCRIPT_MODELS, IMG_MODELS, IMG_PRICE, gemini, geminiAny, geminiJSON, generateImage, pmap, textOf, parseJSON,
    VEO_MODELS, VEO_PRICE, veoGenerate, DIALECTS, DIALECT_NOTE, TONES, DEFAULT_BRAND, loadBrand, saveBrand, brandReady, brandContext, lib, toast, say, copyText, download, readFile, fonts, mountHeader, openSettings, saveSettings, needKey, chatEdit, nodeToPng, zipBlobs, q, thumb };
})();
