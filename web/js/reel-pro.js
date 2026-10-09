/* Pro reel engine — voice-synced motion reels built from templates.
 *
 * One file, three users: the studio page (live preview + in-browser export through html-to-image),
 * the server and the CLI (src/reel-pro.mjs renders it frame by frame in Chromium). Every frame is a
 * pure function of time — mount() builds the DOM once and render(t) sets styles for that instant —
 * so any frame renders the same way twice, a frame can be grabbed at any moment, and no clock or
 * timer is involved. There is no Math.random: anything that should look random comes from rng().
 *
 * A spec is untrusted input (the server API accepts one verbatim). Text only ever reaches the page
 * through textContent; the few attributes that carry a value (an image source, a colour) are
 * checked against a narrow pattern first.
 *
 * The timeline is driven by the voice. A template never says "at 4.2 seconds": it says "when the
 * word X is spoken", "at the start of line Y", or "at the second phrase of line Z", so a new voice,
 * a rewritten line or a faster read re-syncs the whole film without touching a template.
 */
(function (root) {
  'use strict';
  const W = 1080, H = 1920;

  // ------------------------------------------------------------------ math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const P = (t, a, b) => (b === a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
  const ease = {
    out: (x) => 1 - Math.pow(1 - x, 3),
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.55, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  function rng(seed = 7) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  // ------------------------------------------------------------------ text
  const TASHKEEL = /[ً-ْٰـ]/g;
  /** A word as it should be compared: no diacritics, tatweel or punctuation. */
  const strip = (s) => String(s ?? '').replace(TASHKEEL, '').replace(/[،,.:؛;؟?!«»"'…()\-–—]/g, '').trim();
  /** Looser form for matching what was heard against what was written. */
  function norm(s) {
    let x = String(s ?? '').replace(TASHKEEL, '').toLowerCase();
    for (const [a, b] of [['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ى', 'ي'], ['ة', 'ه'], ['ؤ', 'و'], ['ئ', 'ي']]) x = x.split(a).join(b);
    return x.replace(/[^\p{L}\p{N}]/gu, '');
  }
  const wordsOf = (text) => String(text ?? '').split(/\s+/).filter(Boolean);
  // Pauses a reader makes after a word, by its last character (seconds). Used to estimate timing
  // before a voice exists, and to place words between the pauses a real voice made.
  const PAUSE = { '،': 0.08, ',': 0.08, ':': 0.12, '؛': 0.1, '.': 0.15, '؟': 0.15, '?': 0.15, '!': 0.14, '…': 0.6 };
  const pauseAfter = (w) => PAUSE[String(w).trim().slice(-1)] || 0;
  /** The phrases of a line — the pieces between punctuation — as word-index ranges. */
  function phrases(text) {
    const ws = wordsOf(text), out = []; let s = 0;
    ws.forEach((w, i) => { if (pauseAfter(w) || i === ws.length - 1) { out.push([s, i]); s = i + 1; } });
    return out.length ? out : [[0, Math.max(0, ws.length - 1)]];
  }

  // ------------------------------------------------------------------ timeline
  /**
   * Where the important things go on a 1080×1920 frame: out from under the platforms' own buttons,
   * names and captions. The strictest of the published guides, taken together —
   *   top 288    YouTube Shorts (288); Instagram/Facebook Reels ads ask 14% (269); TikTok 240
   *   bottom 672 Instagram/Facebook Reels ads 35% (672) and YouTube Shorts (672); TikTok 660
   *   sides 130  TikTok 120 on each side (its Arabic layout moves the button column to the LEFT);
   *              Meta 6% (65); YouTube Shorts ads want 192 on the right — the one guide this misses
   * Sources: Meta Ads Guide «Instagram Reels» safe zones, TikTok Ads «Auction In-Feed Ads» safe-zone
   * templates (standard and Arabic/RTL), Google Ads help 9128498 (vertical video ads), Snap ad specs.
   */
  const SAFE = { top: 288, bottom: 1248, left: 130, right: 950 };
  const CPS = 12.5; // Arabic narration, characters per second (spaces included) — measured on Gemini TTS
  /** Seconds a line takes when there is no voice yet (preview, music-only films). */
  function estimateDuration(text) {
    const ws = wordsOf(text);
    const pauses = ws.slice(0, -1).reduce((a, w) => a + pauseAfter(w), 0);
    return Math.max(1.1, String(text).trim().length / CPS + pauses + 0.15);
  }
  /** Spread a line's words over `dur` seconds: each word gets time by length, plus its pause. */
  function estimateWords(text, dur) {
    const ws = wordsOf(text);
    if (!ws.length) return [];
    const weight = ws.map((w) => Math.max(1, norm(w).length) + 1.2);
    const pauses = ws.map((w, i) => (i < ws.length - 1 ? pauseAfter(w) : 0));
    const speak = Math.max(0.2, dur - pauses.reduce((a, b) => a + b, 0));
    const total = weight.reduce((a, b) => a + b, 0);
    let t = 0;
    return ws.map((w, i) => { const d = (speak * weight[i]) / total; const o = { w, t: +t.toFixed(3), d: +d.toFixed(3) }; t += d + pauses[i]; return o; });
  }

  /**
   * Lay the lines out on the clock.
   *   voiced[id] = { dur, words:[{w,t,d}] } for lines that have real audio (t relative to the line)
   * Returns T: { order, lines: {id: {id, text, start, dur, end, words:[{w,at,d}]}}, duration }.
   */
  function timeline(spec, voiced = {}, tpl = null) {
    tpl = tpl || TEMPLATES[spec.template] || TEMPLATES.challenge;
    const lead = +(spec.timing?.lead ?? 0.2), gap = +(spec.timing?.gap ?? 0.35), hold = +(spec.timing?.hookHold ?? 0.45);
    const tail = +(spec.timing?.tail ?? tpl.tail ?? 1.6);
    const order = lineOrder(spec, tpl);
    const lines = {};
    let t = lead;
    order.forEach((id, i) => {
      const text = lineText(spec, tpl, id);
      const v = voiced[id];
      const dur = v && v.dur > 0 ? v.dur : estimateDuration(text);
      const words = (v && v.words && v.words.length ? v.words : estimateWords(text, dur)).map((w) => ({ w: w.w, d: w.d, at: t + w.t }));
      lines[id] = { id, text, start: t, dur, end: t + dur, words };
      t += dur + gap + (i === 0 ? hold : 0);
    });
    const last = lines[order[order.length - 1]];
    return { order, lines, duration: +((last ? last.end : 1) + tail).toFixed(3) };
  }
  function lineOrder(spec, tpl) {
    const have = new Set((spec.lines || []).filter((l) => l && String(l.text || '').trim()).map((l) => l.id));
    return tpl.lines.map((l) => l.id).filter((id) => have.has(id) || (!spec.lines && true));
  }
  /** Lines every template draws from: a spec without them cannot be rendered. → the missing ids */
  const REQUIRED = ['hook'];
  function missingLines(spec) {
    const have = new Set((spec && Array.isArray(spec.lines) ? spec.lines : []).filter((l) => l && String(l.text || '').trim()).map((l) => l.id));
    return REQUIRED.filter((id) => !have.has(id));
  }
  function lineText(spec, tpl, id) {
    const l = (spec.lines || []).find((x) => x && x.id === id);
    return String((l && l.text) || tpl.lines.find((x) => x.id === id)?.def || '').trim();
  }

  /** Time lookups bound to one timeline. */
  function clock(T) {
    const L = (id) => T.lines[id] || null;
    const has = (id) => !!T.lines[id];
    // the moment word `key` (a string, or an index) of line `id` starts; null when it is not there
    function W(id, key, nth = 0) {
      const l = L(id); if (!l) return null;
      if (typeof key === 'number') return (l.words[key] || l.words[l.words.length - 1] || { at: l.start }).at;
      const k = norm(key); if (!k) return null;
      const hits = l.words.filter((w) => { const n = norm(w.w); return n === k || (k.length > 2 && (n.endsWith(k) || n.startsWith(k))); });
      return hits.length ? hits[Math.min(nth, hits.length - 1)].at : null;
    }
    // W(), falling back to a fraction of the line when the word was reworded — never throws
    const at = (id, word, frac = 0.5, nth = 0) => {
      const w = word == null ? null : W(id, word, nth); if (w != null) return w;
      const l = L(id); return l ? l.start + l.dur * frac : 0;
    };
    // the start of the k-th of the last `n` phrases of a line (e.g. three listed items)
    const phrase = (id, k, n) => {
      const l = L(id); if (!l) return 0;
      const ph = phrases(l.text); const take = ph.slice(Math.max(0, ph.length - n));
      const p = take[k]; if (!p) return l.start + l.dur * ((k + 0.5) / n);
      return (l.words[p[0]] || { at: l.start }).at;
    };
    return { L, has, W, at, phrase };
  }

  // ------------------------------------------------------------------ animation helpers
  function env(t, a, b, fi = 0.45, fo = 0.45) {
    if (t < a || t > b) return 0;
    const i = fi > 0 ? ease.out(P(t, a, a + fi)) : 1;
    const o = fo > 0 ? 1 - ease.inOut(P(t, b - fo, b)) : 1;
    return Math.min(i, o);
  }
  // Fade/scale/blur a scene in its window. Invisible scenes are display:none — that is also what
  // keeps the in-browser export fast, since html-to-image serialises only what is displayed.
  function sceneFx(el, t, a, b, { fi = 0.4, fo = 0.45 } = {}) {
    const v = env(t, a, b, fi, fo);
    el.style.opacity = v;
    el.style.display = v <= 0 ? 'none' : '';
    if (v <= 0) return false;
    const inK = ease.out(P(t, a, a + 0.6)), outK = fo ? ease.inOut(P(t, b - fo, b)) : 0;
    el.style.transform = `scale(${1.045 - 0.045 * inK - 0.035 * outK})`;
    el.style.filter = outK > 0 ? `blur(${(outK * 8).toFixed(2)}px)` : 'none';
    return true;
  }
  function show(el, v) { el.style.opacity = v; el.style.display = v <= 0.001 ? 'none' : ''; }
  function revealWords(ws, t, times, { stagger = 0.1, dur = 0.5, dy = 46 } = {}) {
    ws.forEach((w, i) => {
      const s = Array.isArray(times) ? times[Math.min(i, times.length - 1)] : times + i * stagger;
      const k = ease.out(P(t, s, s + dur));
      w.style.opacity = k;
      w.style.transform = `translateY(${((1 - k) * dy).toFixed(1)}px) scale(${(0.94 + 0.06 * k).toFixed(3)})`;
      w.style.filter = k < 1 ? `blur(${((1 - k) * 10).toFixed(1)}px)` : 'none';
    });
  }
  function pop(el, t, start, { dur = 0.55, from = 0.6, dy = 0, base = '' } = {}) {
    const k = P(t, start, start + dur);
    show(el, clamp(k * 2.2));
    el.style.transform = `${base} translateY(${((1 - ease.out(k)) * dy).toFixed(1)}px) scale(${(from + (1 - from) * ease.back(k)).toFixed(3)})`;
  }
  function rise(el, t, start, { dur = 0.5, dx = 0, dy = 24, base = '' } = {}) {
    const k = ease.out(P(t, start, start + dur));
    show(el, k);
    el.style.transform = `${base} translate(${((1 - k) * dx).toFixed(1)}px,${((1 - k) * dy).toFixed(1)}px)`;
  }
  function lightOn(el, t, when) {
    const q = P(t, when, when + 0.5);
    el.style.opacity = q <= 0 ? 0 : q < 0.3 ? q / 0.3 : 1 - 0.3 * ease.out((q - 0.3) / 0.7);
    el.style.transform = `scale(${(1 + (q < 0.5 ? 0.08 * Math.sin((q / 0.5) * Math.PI) : 0)).toFixed(3)})`;
  }

  // ------------------------------------------------------------------ DOM (safe)
  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Word spans for a headline (words, never letters — letters break Arabic joining). */
  function words(e, text, cls = '', mintWords = []) {
    e.textContent = '';
    const mw = new Set((mintWords || []).map(norm).filter(Boolean));
    return wordsOf(text).map((w) => el('span', 'w ' + cls + (mw.has(norm(w)) ? ' mint' : ''), e, w));
  }
  function line(parent, cls, top, size, extra = {}) {
    const e = el('div', 'line ' + cls, parent);
    e.style.top = top + 'px'; if (size) e.style.fontSize = size + 'px';
    // headlines keep to one line and smaller copy to two: fitLines() shrinks the type if the words
    // someone wrote are longer than the template's example
    if (/\b(h1|h2)\b/.test(cls)) e.dataset.fit = '1'; else if (/\bsub\b/.test(cls)) e.dataset.fit = '2';
    Object.assign(e.style, extra);
    return e;
  }
  // Measured type depends on the font being loaded: mount() fits once, and the page or the renderer
  // calls stage.fit() again once the fonts are in (each fit starts from the template's own size).
  const startSize = (e) => { if (!e.dataset.fs0) e.dataset.fs0 = parseFloat(e.style.fontSize || getComputedStyle(e).fontSize) || 0; e.style.fontSize = e.dataset.fs0 + 'px'; return +e.dataset.fs0; };
  function fitLines(root) {
    for (const e of root.querySelectorAll('.line[data-fit]')) {
      const max = +e.dataset.fit; let fs = startSize(e); const min = fs * 0.66;
      const lh = () => parseFloat(getComputedStyle(e).lineHeight) || fs * 1.25;
      for (let i = 0; i < 24 && fs > min && e.offsetHeight > lh() * max + 6; i++) { fs *= 0.95; e.style.fontSize = fs.toFixed(1) + 'px'; }
    }
    // one-line pills and labels: no wider than the safe area
    for (const e of root.querySelectorAll('[data-maxw], .tag, .pill, .okpill, .plats, .qb')) {
      const maxw = +(e.dataset.maxw || SAFE.right - SAFE.left);
      let fs = startSize(e); const min = fs * 0.66;
      for (let i = 0; i < 24 && fs > min && e.offsetWidth > maxw; i++) { fs *= 0.95; e.style.fontSize = fs.toFixed(1) + 'px'; }
    }
  }
  /**
   * Salla, Zid … by name, set in our own type. Their logos are trademarks whose owners forbid
   * recolouring or restyling them (Zid's brand guidelines say so outright), and neither publishes
   * an «available on» badge for apps — so the reels never draw their logos.
   */
  function platformChips(parent, top, names, { big = false } = {}) {
    const list = (Array.isArray(names) && names.length ? names : ['سلة', 'زد']).map((n) => String(n).trim()).filter(Boolean).slice(0, 3);
    if (big) return list.slice(0, 2).map((n, i) => { const c = el('div', 'plat big', parent, n); ABS(c, { left: [720, 360][i], top }); c.dataset.base = 'translateX(-50%)'; return c; });
    const row = el('div', 'plats', parent); row.style.top = top + 'px'; row.dataset.base = 'translateX(-50%)';
    el('span', 'lb', row, 'لمتاجر'); list.forEach((n) => el('span', 'plat', row, n));
    return [row];
  }
  const ABS = (e, o) => { e.style.position = 'absolute'; for (const k in o) e.style[k] = typeof o[k] === 'number' ? o[k] + 'px' : o[k]; return e; };
  const hasLatin = (s) => /[A-Za-z]/.test(String(s));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(parent, d, size = 40, stroke = 'var(--mint)') {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', stroke); s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    for (const p of [].concat(d)) {
      const m = /^c:(.*)$/.exec(p);
      if (m) { const [cx, cy, r] = m[1].split(','); const c = document.createElementNS(SVG_NS, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); s.appendChild(c); }
      else { const e = document.createElementNS(SVG_NS, 'path'); e.setAttribute('d', p); s.appendChild(e); }
    }
    parent.appendChild(s); return s;
  }
  const ICON = {
    lock: ['M6.5 11h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M8 11V7.5a4 4 0 0 1 8 0V11'],
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'c:12,12,3'],
    shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z', 'M8.5 12.2l2.4 2.4 4.6-4.8'],
    link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
    tag: ['M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'c:7.5,7.5,1.5'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
    report: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4', 'M14 3l5 5v3', 'M8 9h5M8 13h4', 'c:17.5,17.5,4', 'M14.7 20.3l5.6-5.6'],
  };

  // Colours reach the stage through CSS variables, so only plain colour syntax is accepted.
  const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]{1,60}\))$/;
  const okColor = (v) => typeof v === 'string' && COLOR.test(v.trim());
  // An image is either one of the bundled files (a plain relative path) or a data: URL.
  const IMG_PATH = /^[a-z0-9][a-z0-9_\-/]*\.(png|jpe?g|webp)$/i;
  const okImage = (v) => typeof v === 'string' && ((IMG_PATH.test(v) && !v.includes('..')) || /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(v));

  function theme(rootEl, brand = {}) {
    // FullTimeDigi's night palette is the default. A different accent re-tints the light, a
    // different primary re-tints the dark — derived with color-mix so the hierarchy holds.
    if (okColor(brand.accent) && !/^#00b478$/i.test(brand.accent.trim())) {
      const a = brand.accent.trim();
      const v = { '--mint': `color-mix(in srgb, ${a} 70%, #fff)`, '--mint-2': a, '--mint-hi': `color-mix(in srgb, ${a} 30%, #fff)`, '--mint-lo': `color-mix(in srgb, ${a} 90%, #000)`,
        '--mint-ink': `color-mix(in srgb, ${a} 70%, #000)`, '--btn-top': `color-mix(in srgb, ${a} 45%, #fff)`, '--btn-mid': `color-mix(in srgb, ${a} 80%, #fff)`, '--btn-bot': a,
        '--glass-line': `color-mix(in srgb, ${a} 55%, transparent)`, '--mint-a': `color-mix(in srgb, ${a} 35%, transparent)` };
      for (const k in v) rootEl.style.setProperty(k, v[k]);
    }
    if (okColor(brand.primary) && !/^#0b3b33$/i.test(brand.primary.trim())) {
      const p = brand.primary.trim();
      const v = { '--deep': `color-mix(in srgb, ${p} 30%, #000)`, '--bg-mid': `color-mix(in srgb, ${p} 40%, #000)`, '--bg-glow': `color-mix(in srgb, ${p} 70%, #000)`,
        '--bg-edge': `color-mix(in srgb, ${p} 18%, #000)`, '--glow1': p, '--glow2': `color-mix(in srgb, ${p} 70%, #000)`, '--ink': `color-mix(in srgb, ${p} 40%, #000)`,
        '--glass': `color-mix(in srgb, ${p} 55%, #000 45%)` };
      for (const k in v) rootEl.style.setProperty(k, v[k]);
    }
  }

  // ------------------------------------------------------------------ background
  function background(stage) {
    const r = rng(7), host = el('div', 'bgwrap', stage);
    el('div', 'bg', host);
    const g1 = el('div', 'glow', host); ABS(g1, { width: 720, height: 720, background: 'var(--glow1)' });
    const g2 = el('div', 'glow', host); ABS(g2, { width: 620, height: 620, background: 'var(--glow2)' });
    const r1 = el('div', 'ring', host); ABS(r1, { width: 900, height: 900, right: -430, top: -380 });
    ABS(el('div', 'ring', host), { width: 640, height: 640, right: -300, top: -250, opacity: 0.8 });
    ABS(el('div', 'ring', host), { width: 760, height: 760, left: -420, bottom: -360, opacity: 0.7 });
    ABS(el('div', 'dots', host), { left: 70, top: 110, width: 180, height: 120 });
    const bars = el('div', 'bars', host);
    for (const h of [160, 240, 330, 420]) { const i = el('i', '', bars); i.style.height = h + 'px'; }
    const sparks = [...Array(30)].map(() => ({ e: el('div', 'spark', host), x: r() * W, y: r() * H, v: 18 + r() * 40, s: 0.4 + r() * 1.1, ph: r() * 6.28 }));
    return (t) => {
      g1.style.transform = `translate(${(-120 + Math.sin(t * 0.35) * 120).toFixed(1)}px,${(260 + Math.cos(t * 0.3) * 90).toFixed(1)}px)`;
      g2.style.transform = `translate(${(520 + Math.cos(t * 0.28) * 110).toFixed(1)}px,${(1180 + Math.sin(t * 0.33) * 120).toFixed(1)}px)`;
      r1.style.transform = `rotate(${(t * 4).toFixed(2)}deg)`;
      for (const p of sparks) {
        const y = ((p.y - t * p.v) % H + H) % H;
        p.e.style.transform = `translate(${(p.x + Math.sin(t + p.ph) * 14).toFixed(1)}px,${y.toFixed(1)}px) scale(${p.s.toFixed(2)})`;
        p.e.style.opacity = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7 + p.ph))).toFixed(3);
      }
    };
  }

  // ------------------------------------------------------------------ shared scenes
  // Scene window: in 0.35 s before its line, out once its line is done and the next one has begun,
  // so neighbouring scenes overlap and no frame is ever an empty background.
  function windows(T) {
    return (id) => {
      const i = T.order.indexOf(id), l = T.lines[id], next = T.lines[T.order[i + 1]];
      if (!l) return [0, 0];
      return [i === 0 ? 0 : l.start - 0.35, next ? Math.max(l.end + 0.5, next.start + 0.25) : T.duration + 1];
    };
  }

  /** The closing card: logo, headline, the button on «الحين», the domain, platforms, a last line. */
  function ctaScene(ctx, id, C) {
    const { stage, k, asset, brand } = ctx;
    const sc = el('div', 'scene', stage);
    const logo = el('img', 'abs', sc); logo.src = brand.logo || asset('brand/fd-logo-night.png'); ABS(logo, { left: 405, top: SAFE.top, width: 270, height: 202, objectFit: 'contain' });
    const A = words(line(sc, 'h1', 515, C.aSize || 96), C.a, '', C.mint);
    const B = words(line(sc, 'h1', 625, 118), C.b, 'mint');
    const btn = el('div', 'btn', sc); btn.style.top = '790px';
    el('span', '', btn, C.btn);
    const arr = el('span', 'arr', btn); icon(arr, ICON.arrow, 54, 'var(--mint)');
    const shine = el('i', 'shine', btn);
    const url = line(sc, 'latin', 968, 54); url.textContent = brand.website || 'fulltimedigi.com';
    // the platforms by name, in our own type — never their logos (see platformChips)
    const plats = C.platforms === false || (Array.isArray(C.platforms) && !C.platforms.filter(Boolean).length) ? [] : platformChips(sc, 1062, C.platforms);
    let last = null;
    if (C.reply) { last = el('div', 'pill', sc); last.style.top = '1158px'; last.style.fontSize = '34px'; last.dataset.maxw = SAFE.right - SAFE.left; last.style.fontWeight = '700'; el('span', 'n', last, '?'); el('span', '', last, C.reply); }
    else if (C.micro) { last = line(sc, 'micro', 1170); last.textContent = ''; C.micro.split('·').map((s) => s.trim()).filter(Boolean).forEach((s, i) => { if (i) el('b', '', last, '·'); el('span', '', last, s); }); }
    return (t) => {
      const [a, b] = k.win(id); if (!sceneFx(sc, t, a, b, { fo: 0 })) return;
      pop(logo, t, a + 0.05, { dur: 0.7, from: 0.7 });
      logo.style.filter = `drop-shadow(0 0 ${(30 + 14 * Math.sin(t * 2.2)).toFixed(1)}px rgba(94,240,200,.45))`;
      const l = k.L(id), c0 = l.start;
      revealWords(A, t, c0, { stagger: 0.17 });
      revealWords(B, t, k.at(id, C.bWord || C.b, 0.25) - 0.08, { dur: 0.55, dy: 60 });
      const b0 = k.at(id, 'الحين', 0.4) - 0.05;
      pop(btn, t, b0, { dur: 0.65, from: 0.7, dy: 50 });
      if (t > b0 + 0.65) {
        const pl = 0.5 + 0.5 * Math.sin((t - b0) * 4.2);
        btn.style.transform = `scale(${(1 + 0.025 * pl).toFixed(4)})`;
        btn.style.boxShadow = `0 0 ${(40 + 50 * pl).toFixed(1)}px rgba(94,240,200,${(0.35 + 0.35 * pl).toFixed(3)}),0 22px 50px rgba(0,0,0,.45)`;
      } else btn.style.boxShadow = '0 22px 50px rgba(0,0,0,.45)';
      const sh = ((t - b0 - 0.9) % 1.9 + 1.9) % 1.9;
      shine.style.transform = `translateX(${(-200 + (sh / 0.9) * 1100).toFixed(1)}px) rotate(18deg)`;
      shine.style.opacity = t > b0 + 0.9 && sh < 0.9 ? 1 : 0;
      const u0 = Math.min(k.at(id, 'فل', 0.6), l.start + l.dur * 0.6) - 0.05;
      rise(url, t, u0);
      plats.forEach((p, i) => pop(p, t, u0 + 0.5 + i * 0.15, { from: 0.6, dy: 30, base: p.dataset.base || '' }));
      if (last) {
        if (C.reply) { pop(last, t, l.end + 0.05, { from: 0.8, dy: 30, base: 'translateX(-50%)' }); }
        else rise(last, t, u0 + 0.9, { dy: 20 });
      }
    };
  }

  /** Countdown ring over an element: ٣ ٢ ١ on the three spoken numbers. */
  function countdown(parent, pos) {
    const box = el('div', 'timer', parent); ABS(box, pos);
    el('div', 'disc', box);
    const s = document.createElementNS(SVG_NS, 'svg'); s.setAttribute('viewBox', '0 0 210 210');
    const c1 = document.createElementNS(SVG_NS, 'circle'); for (const [a, v] of [['cx', 105], ['cy', 105], ['r', 95], ['fill', 'none'], ['stroke', 'rgba(94,240,200,.18)'], ['stroke-width', 11]]) c1.setAttribute(a, v);
    const c2 = document.createElementNS(SVG_NS, 'circle'); for (const [a, v] of [['cx', 105], ['cy', 105], ['r', 95], ['fill', 'none'], ['stroke', 'var(--mint)'], ['stroke-width', 11], ['stroke-linecap', 'round'], ['transform', 'rotate(-90 105 105)'], ['stroke-dasharray', '596.9']]) c2.setAttribute(a, v);
    s.appendChild(c1); s.appendChild(c2); box.appendChild(s);
    const d = el('div', 'd', box, '٣');
    const DIG = ['٣', '٢', '١'];
    return (t, ticks, endAt) => {
      const tIn = ease.out(P(t, ticks[0] - 0.3, ticks[0])), tOut = ease.inOut(P(t, endAt - 0.25, endAt + 0.1));
      show(box, tIn * (1 - tOut));
      const di = t < ticks[1] ? 0 : t < ticks[2] ? 1 : 2; d.textContent = DIG[di];
      box.style.transform = `scale(${((0.7 + 0.3 * tIn) * (1 + 0.12 * Math.sin(Math.PI * P(t, ticks[di], ticks[di] + 0.35)))).toFixed(3)})`;
      c2.setAttribute('stroke-dashoffset', (596.9 * P(t, ticks[0], ticks[2] + 0.9)).toFixed(1));
    };
  }

  /** A numbered pill list in the title area (the answers, as they are revealed). */
  function pillList(parent, items, top = SAFE.top + 4, step = 78) {
    return items.map((txt, i) => { const d = el('div', 'pill', parent); d.style.top = top + i * step + 'px'; d.dataset.maxw = SAFE.right - SAFE.left; el('span', 'n', d, '١٢٣٤٥'[i] || String(i + 1)); el('span', '', d, txt); return d; });
  }

  /** The illustrative report card: a heading row and linked lines. */
  function reportCard(parent, top, title, rows, note) {
    const c = el('div', 'rep', parent); c.style.top = top + 'px';
    const hd = el('div', 'hd', c); const ic = el('span', 'ic', hd); ic.style.flex = '0 0 64px'; ic.style.height = '64px'; icon(ic, ICON.tag, 34); el('span', '', hd, title);
    const lines = rows.map((r) => { const ln = el('div', 'ln', c); const s = el('span', '', ln, r); if (hasLatin(r)) s.style.unicodeBidi = 'plaintext'; el('span', 'lk', ln, note); return ln; });
    return { card: c, lines };
  }

  // ------------------------------------------------------------------ templates
  // Each template: the spoken lines (ids fixed, wording free), the on-screen copy (`fields`,
  // defaults are a complete approved example), and build() → render(t). All screen words come from
  // fields; all timing comes from the voice.
  const CTA_CHECK = { a: 'افحص متجرك', b: 'مجانًا', btn: 'افحص متجري مجانًا', platforms: ['سلة', 'زد'] };

  const TEMPLATES = {};

  TEMPLATES.challenge = {
    id: 'challenge', icon: '⏱️', title: 'تحدي ٣ ثواني', tail: 2.4,
    desc: 'صفحة منتج فيها ٣ أخطاء + عدّاد ٣، ٢، ١ — المشاهد يدوّر قبل الجواب',
    lines: [
      { id: 'hook', label: 'الهوك', def: 'عندك ثلاث ثواني: وش الناقص في صفحة المنتج هذي؟' },
      { id: 'count', label: 'العدّ', def: 'ثلاث… ثنتين… وحدة!' },
      { id: 'reveal', label: 'الكشف (٣ أشياء مفصولة بفواصل)', def: 'الوصف ناقص، المقاسات بأسماء مختلفة، والسعر مو واضح.' },
      { id: 'turn', label: 'ليش يهمّ', def: 'وعميلك يقرّر يشتري أو لا، من صفحة المنتج.' },
      { id: 'answer', label: 'الحل', def: 'الفحص المجاني يطلع لك هالأشياء، من منتجاتك أنت، مو نصايح عامة.' },
      { id: 'cta', label: 'الدعوة', def: 'افحص متجرك مجانًا الحين، على فُل تايم ديجي دوت كوم.' },
    ],
    fields: {
      hookA: 'عندك ٣ ثواني', hookMint: ['٣'], hookB: 'وش الناقص في صفحة المنتج هذي؟',
      product: { name: 'عباية كريب سوداء', image: 'reel-pro/abaya.jpg', priceK: 'السعر:', priceV: 'تواصل معنا', sizeK: 'المقاس:', sizes: ['S', '38', 'وسط'], descK: 'الوصف:', descV: 'منتج مميز بجودة عالية.', button: 'أضف للسلة' },
      finds: ['وصف ناقص', 'مقاسات بأسماء مختلفة', 'سعر غير واضح'],
      turnA: 'عميلك يقرّر يشتري أو لا', turnB: 'من صفحة المنتج',
      ansA: 'الفحص المجاني', ansMint: ['المجاني'], ansB: 'يطلع لك هالأشياء', ansS: 'من منتجاتك أنت، مو نصايح عامة', rowNote: 'مع رابط المنتج',
      cta: { ...CTA_CHECK, reply: 'كم واحد لقيت قبل الجواب؟ قل لنا بالتعليقات' },
      pageTag: 'مثال توضيحي — ليس متجرًا حقيقيًا', reportTag: 'مثال توضيحي — ليس نتيجة متجر حقيقي',
    },
    build(ctx) {
      const { stage, F, k, asset } = ctx, p = F.product;
      // the page stays on screen from frame 1 to the turn, so it is not a scene of its own
      // the whole page — and so every thing the viewer hunts for — sits inside the safe area
      const pg = el('div', 'page', stage); ABS(pg, { left: 140, top: 528, width: 800, height: 752 });
      pg.style.transformOrigin = '50% 0';
      // the address bar carries the «illustrative» label, so it is on screen whenever the page is
      const bar = el('div', 'bar', pg); el('i', '', bar); const pgTag = el('b', '', bar, F.pageTag); pgTag.style.fontSize = '26px'; el('u', '', bar);
      const pic = el('div', 'pic', pg); pic.style.height = '252px'; const im = el('img', '', pic); im.src = asset(p.image);
      el('div', 'ttl', pg, p.name);
      const fld = (top, h) => { const f = el('div', 'fld', pg); f.style.top = top + 'px'; f.style.height = h + 'px'; return f; };
      const fPrice = fld(406, 64); el('span', 'k', fPrice, p.priceK); el('span', 'v', fPrice, p.priceV);
      const fSize = fld(478, 80); el('span', 'k', fSize, p.sizeK); for (const s of (p.sizes || []).slice(0, 4)) el('span', 'chip', fSize, s);
      const fDesc = fld(566, 64); el('span', 'k', fDesc, p.descK); el('span', 'v', fDesc, p.descV);
      const cart = el('div', 'cart', pg, p.button); cart.style.bottom = '26px'; cart.style.height = '76px';
      const FL = [fDesc, fSize, fPrice].map((f, i) => ({ mk: el('i', 'mk', f), num: el('i', 'num', f, '١٢٣'[i]) }));
      const timer = countdown(stage, { left: 170, top: 620 });
      const finger = el('div', 'finger', stage);

      const hook = el('div', 'scene', stage);
      const HA = words(line(hook, 'h1', SAFE.top, 112), F.hookA, '', F.hookMint);
      const HB = words(line(hook, 'sub', 432, 44), F.hookB);
      const rv = el('div', 'scene', stage); const FP = pillList(rv, F.finds);
      const turn = el('div', 'scene', stage);
      const TA = words(line(turn, 'h2', SAFE.top, 74), F.turnA); const TB = words(line(turn, 'h2', 400, 74), F.turnB, 'mint');
      const ans = el('div', 'scene', stage);
      const AA = words(line(ans, 'h2', SAFE.top), F.ansA, '', F.ansMint); const AB = words(line(ans, 'h2', 400), F.ansB);
      const ROWS = F.finds.map((txt, i) => {
        const r = el('div', 'row', ans); r.style.top = 560 + i * 136 + 'px';
        icon(el('div', 'ic', r), ICON.link, 40); el('div', 'tx', r, txt);
        const n = el('div', '', r, F.rowNote); Object.assign(n.style, { marginRight: 'auto', fontSize: '26px', fontWeight: '700', color: 'var(--muted)', whiteSpace: 'nowrap' }); return r;
      });
      const AS = words(line(ans, 'sub', 1000), F.ansS);
      const repTag = el('div', 'tag', ans, F.reportTag); repTag.style.top = '1110px';
      const cta = ctaScene(ctx, 'cta', F.cta);

      return (t) => {
        const L = k.L, hk = L('hook'), rvL = L('reveal'), tn = L('turn'), an = L('answer');
        const ticks = [k.at('count', 'ثلاث', 0.0), k.at('count', 'ثنتين', 0.3), k.at('count', 'وحدة', 0.62)];
        const endHook = rvL ? rvL.start : (L('count') ? L('count').end + 0.3 : hk.end + 0.6);
        const tnS = tn ? tn.start : endHook + 4, anS = an ? an.start : tnS + 4;
        // page: up from frame 0, shrinks for the turn, leaves before the answer
        const pin = ease.out(P(t, 0, 0.7)), shrink = ease.inOut(P(t, tnS - 0.4, tnS + 0.4)), out = ease.inOut(P(t, anS - 0.45, anS - 0.05));
        show(pg, 1 - out);
        pg.style.transform = `translateY(${((1 - pin) * 260 + shrink * 210).toFixed(1)}px) scale(${((0.96 + 0.04 * pin) * (1 - 0.3 * shrink)).toFixed(4)})`;
        if (L('count')) timer(t, ticks, endHook); else show(stage.querySelector('.timer'), 0);
        // hook title: readable from the very first frame
        { const v = env(t, 0, endHook - 0.05, 0, 0.4); show(hook, v);
          if (v > 0) {
            const kk = ease.out(P(t, 0, 0.45));
            hook.firstChild.style.transform = `scale(${(1.18 - 0.18 * kk).toFixed(3)})`; hook.firstChild.style.opacity = clamp(0.7 + kk);
            revealWords(HB, t, HB.map((_, i) => k.at('hook', wordsOf(F.hookB)[i], 0.3 + 0.5 * i / Math.max(1, HB.length)) - 0.08), { dy: 26 });
            const pk = Math.max(0, ...ticks.map((s) => Math.sin(Math.PI * P(t, s, s + 0.3))));
            HA.forEach((w) => { if (w.classList.contains('mint')) w.style.transform = `scale(${(1 + 0.16 * pk).toFixed(3)})`; });
          } }
        // reveal: rings + numbers on the page, the list builds above
        const ws = [0, 1, 2].map((i) => (rvL ? k.phrase('reveal', i, 3) : endHook + i));
        show(rv, env(t, endHook - 0.35, tnS + 0.05, 0.3, 0.4));
        FL.forEach((f, i) => { lightOn(f.mk, t, ws[i]); pop(f.num, t, ws[i], { from: 0.3 }); if (t < ws[i]) f.num.style.opacity = 0;
          f.mk.style.opacity *= (1 - shrink); f.num.style.opacity *= (1 - shrink); });
        FP.forEach((p2, i) => pop(p2, t, ws[i] - 0.05, { from: 0.7, dy: 20, base: 'translateX(-50%)' }));
        // turn: the shrunken page, a finger hovering over the button and not tapping
        if (tn) { const [a, b] = k.win('turn'); if (sceneFx(turn, t, a, b)) { revealWords(TA, t, k.wordTimes('turn', TA.length, 0)); revealWords(TB, t, k.wordTimes('turn', TB.length, TA.length)); } }
        else show(turn, 0);
        { const s = tnS + 0.3, e = anS - 0.4, v = Math.min(ease.out(P(t, s, s + 0.4)), 1 - ease.inOut(P(t, e - 0.3, e)));
          show(finger, tn ? v * 0.95 : 0);
          finger.style.left = (540 + Math.sin((t - s) * 2.4) * 120).toFixed(1) + 'px';
          finger.style.top = (1210 + Math.sin((t - s) * 4.8) * 22 - (1 - ease.out(P(t, s, s + 0.6))) * 160).toFixed(1) + 'px'; }
        // answer: the findings as report rows
        if (an) { const [a, b] = k.win('answer'); if (sceneFx(ans, t, a, b)) {
          revealWords(AA, t, an.start - 0.1, { stagger: 0.2 }); revealWords(AB, t, k.at('answer', wordsOf(F.ansB)[0], 0.2) - 0.1, { stagger: 0.14 });
          const r0 = Math.min(k.at('answer', 'هالأشياء', 0.35) - 0.2, an.start + 0.55);
          ROWS.forEach((r, i) => rise(r, t, r0 + i * 0.22, { dx: 160, dy: 0 }));
          revealWords(AS, t, k.at('answer', 'منتجاتك', 0.55) - 0.15, { stagger: 0.12, dy: 20 });
          rise(repTag, t, r0 + 0.6, { base: 'translateX(-50%)', dy: 16 });
        } } else show(ans, 0);
        cta(t);
      };
    },
    sfx(k) {
      const out = [];
      if (k.has('count')) out.push(['tick', k.at('count', 'ثلاث', 0)], ['tick', k.at('count', 'ثنتين', 0.3)], ['tick', k.at('count', 'وحدة', 0.62)]);
      if (k.has('reveal')) for (let i = 0; i < 3; i++) out.push(['ding', k.phrase('reveal', i, 3)]);
      if (k.has('turn')) out.push(['whoosh', k.L('turn').start]);
      if (k.has('answer')) out.push(['whoosh', k.L('answer').start], ['pop', k.L('answer').start + 0.7], ['pop', k.L('answer').start + 0.92], ['pop', k.L('answer').start + 1.14]);
      return out.concat(ctaSfx(k));
    },
  };

  TEMPLATES.brand = {
    id: 'brand', icon: '🔤', title: 'نفس الماركة بكم طريقة؟', tail: 2.4,
    desc: 'قائمة منتجات لماركة وحدة مكتوبة بثلاث طرق — ثم تتوحّد',
    lines: [
      { id: 'hook', label: 'الهوك', def: 'نفس الماركة… مكتوبة بكم طريقة هنا؟' },
      { id: 'count', label: 'العدّ', def: 'ثلاث… ثنتين… وحدة!' },
      { id: 'reveal', label: 'الكشف (٣ أشياء مفصولة بفواصل)', def: 'ثلاث طرق: بالعربي، بالإنجليزي، ومرة بخطأ إملائي.' },
      { id: 'turn', label: 'ليش يهمّ', def: 'وكلما كانت التفاصيل أوضح، صار اختيار العميل أسهل.' },
      { id: 'answer', label: 'الحل', def: 'الفحص المجاني يطلع لك الماركات المكتوبة بأكثر من طريقة، من منتجاتك أنت.' },
      { id: 'cta', label: 'الدعوة', def: 'افحص متجرك مجانًا الحين، على فُل تايم ديجي دوت كوم.' },
    ],
    fields: {
      hookA: 'نفس الماركة…', hookMint: ['الماركة…', 'الماركة'], hookB: 'مكتوبة بكم طريقة هنا؟', search: 'سماعات',
      items: [
        { before: 'سماعة', brand: 'نوريكس', after: 'برو', sub: 'سماعة رأس لاسلكية', image: 'reel-pro/headphones-1.jpg' },
        { before: 'سماعات أذن', brand: 'Norix', after: '', sub: 'مع علبة شحن', image: 'reel-pro/headphones-2.jpg' },
        { before: 'سماعة', brand: 'نوركس', after: 'رياضية', sub: 'بخطاف للأذن', image: 'reel-pro/headphones-3.jpg' },
      ],
      labels: ['بالعربي', 'بالإنجليزي', 'بخطأ إملائي'], unified: 'نوريكس',
      turnA: 'كلما كانت التفاصيل أوضح', turnB: 'صار اختيار العميل أسهل',
      ansA: 'الفحص المجاني يطلع لك', ansMint: ['المجاني'], ansB: 'الماركات المكتوبة بأكثر من طريقة', repTitle: 'ماركة مكتوبة بأكثر من طريقة', rowNote: 'رابط المنتج ↗', ansS: 'من منتجاتك أنت',
      cta: { ...CTA_CHECK, reply: 'كم طريقة لقيت قبل الجواب؟ قل لنا بالتعليقات' },
      pageTag: 'مثال توضيحي — ماركة ومنتجات وهمية', reportTag: 'مثال توضيحي — ليس نتيجة متجر حقيقي',
    },
    build(ctx) {
      const { stage, F, k, asset } = ctx;
      const pn = el('div', 'page', stage); ABS(pn, { left: 130, top: 528, width: 820, height: 760 });
      // the search bar carries the «illustrative» label, so it is on screen whenever the listing is
      const bar = el('div', 'bar', pn); bar.style.height = '92px'; el('i', '', bar); const sb = el('b', '', bar, F.search); Object.assign(sb.style, { flex: '0 0 auto', height: '56px', fontSize: '30px', padding: '9px 30px' });
      const pnTag = el('span', '', bar, F.pageTag); Object.assign(pnTag.style, { flex: '1', textAlign: 'left', fontSize: '24px', fontWeight: '700', color: '#8a8f94', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
      const BW = F.items.slice(0, 3).map((it, i) => {
        const r = el('div', 'it', pn); Object.assign(r.style, { top: 98 + i * 212 + 'px', height: '206px' }); if (i === 2) r.style.borderBottom = '0';
        const im = el('img', '', r); im.src = asset(it.image);
        const tx = el('div', 'tx', r); const tt = el('div', 'tt', tx);
        if (it.before) tt.appendChild(document.createTextNode(it.before + ' '));
        const bw = el('span', 'bw', tt); const a = el('span', 'a' + (hasLatin(it.brand) ? ' latin' : ''), bw, it.brand); if (hasLatin(it.brand)) a.style.letterSpacing = '0';
        const b = el('span', 'b', bw, F.unified); b.style.opacity = 0; const mk = el('i', 'mk', bw);
        if (it.after) tt.appendChild(document.createTextNode(' ' + it.after));
        el('div', 'sb', tx, it.sub);
        im.style.flex = '0 0 180px'; im.style.height = '180px';
        return { bw, a, b, mk };
      });
      const LAB = F.labels.slice(0, 3).map((s) => el('div', 'lab', stage, s));
      const timer = countdown(stage, { left: 160, top: 660 });
      const hook = el('div', 'scene', stage);
      words(line(hook, 'h1', SAFE.top, 110), F.hookA, '', F.hookMint);
      const HB = words(line(hook, 'sub', 432, 46), F.hookB);
      const rv = el('div', 'scene', stage); const FP = pillList(rv, F.labels.slice(0, 3));
      const turn = el('div', 'scene', stage);
      const TA = words(line(turn, 'h2', SAFE.top, 68), F.turnA); const TB = words(line(turn, 'h2', 388, 68), F.turnB, 'mint');
      const ans = el('div', 'scene', stage);
      const AA = words(line(ans, 'h2', SAFE.top, 72), F.ansA, '', F.ansMint); const AB = words(line(ans, 'sub', 400, 44), F.ansB, 'mint');
      const rep = reportCard(ans, 540, F.repTitle, F.items.slice(0, 3).map((it) => [it.before, it.brand, it.after].filter(Boolean).join(' ')), F.rowNote);
      const AS = words(line(ans, 'sub', 1010, 46), F.ansS);
      const repTag = el('div', 'tag', ans, F.reportTag); repTag.style.top = '1110px';
      const cta = ctaScene(ctx, 'cta', F.cta);
      return (t) => {
        const L = k.L, rvL = L('reveal'), tn = L('turn'), an = L('answer'), hk = L('hook');
        const ticks = [k.at('count', 'ثلاث', 0), k.at('count', 'ثنتين', 0.3), k.at('count', 'وحدة', 0.62)];
        const endHook = rvL ? rvL.start : (L('count') ? L('count').end + 0.3 : hk.end + 0.6);
        const anS = an ? an.start : endHook + 8;
        const ws = [0, 1, 2].map((i) => (rvL ? k.phrase('reveal', i, 3) : endHook + i));
        const unify = tn ? k.at('turn', wordsOf(F.turnA).slice(-1)[0], 0.35) : endHook + 4;
        const pin = ease.out(P(t, 0, 0.7)), out = ease.inOut(P(t, anS - 0.45, anS - 0.05));
        show(pn, 1 - out);
        pn.style.transform = `translateY(${((1 - pin) * 260 + out * 60).toFixed(1)}px) scale(${(0.97 + 0.03 * pin).toFixed(4)})`;
        if (L('count')) timer(t, ticks, endHook); else show(stage.querySelector('.timer'), 0);
        { const v = env(t, 0, endHook - 0.05, 0, 0.4); show(hook, v);
          if (v > 0) { const kk = ease.out(P(t, 0, 0.45)); hook.firstChild.style.transform = `scale(${(1.18 - 0.18 * kk).toFixed(3)})`;
            revealWords(HB, t, HB.map((_, i) => k.at('hook', wordsOf(F.hookB)[i], 0.35 + 0.5 * i / Math.max(1, HB.length)) - 0.08), { dy: 26 }); } }
        show(rv, env(t, endHook - 0.35, (tn ? tn.start : unify) + 0.05, 0.3, 0.4));
        FP.forEach((p2, i) => pop(p2, t, ws[i] - 0.05, { from: 0.7, dy: 20, base: 'translateX(-50%)' }));
        const labOut = 1 - ease.inOut(P(t, unify - 0.3, unify + 0.2));
        BW.forEach((b, i) => {
          lightOn(b.mk, t, ws[i]); if (t >= unify) b.mk.style.opacity = 1;
          const r = b.bw.getBoundingClientRect(), s = stage.getBoundingClientRect(), sc = s.width / W || 1;
          LAB[i].style.left = ((r.left - s.left) / sc + r.width / sc / 2).toFixed(1) + 'px'; LAB[i].style.top = ((r.bottom - s.top) / sc + 14).toFixed(1) + 'px';
          pop(LAB[i], t, ws[i] + 0.05, { from: 0.6, dy: 14, base: 'translateX(-50%)' }); LAB[i].style.opacity *= labOut * (1 - out);
          const u = ease.inOut(P(t, unify + i * 0.18, unify + i * 0.18 + 0.45));
          b.a.style.opacity = 1 - u; b.a.style.filter = u > 0 ? `blur(${(u * 8).toFixed(1)}px)` : 'none';
          b.b.style.opacity = u; b.b.style.transform = `translateY(${((1 - u) * 20).toFixed(1)}px)`;
        });
        if (tn) { const [a, b] = k.win('turn'); if (sceneFx(turn, t, a, b)) { revealWords(TA, t, k.wordTimes('turn', TA.length, 0)); revealWords(TB, t, k.wordTimes('turn', TB.length, TA.length)); } } else show(turn, 0);
        if (an) { const [a, b] = k.win('answer'); if (sceneFx(ans, t, a, b)) {
          revealWords(AA, t, an.start - 0.1, { stagger: 0.15 });
          revealWords(AB, t, k.at('answer', wordsOf(F.ansB)[0], 0.35) - 0.1, { stagger: 0.12, dy: 24 });
          const r0 = Math.min(k.at('answer', wordsOf(F.ansB)[0], 0.35), an.start + 0.6);
          rise(rep.card, t, an.start + 0.15, { dy: 60 });
          rep.lines.forEach((ln, i) => rise(ln, t, r0 + 0.3 + i * 0.25, { dx: 120, dy: 0 }));
          revealWords(AS, t, k.at('answer', 'منتجاتك', 0.8) - 0.15, { stagger: 0.14, dy: 20 });
          rise(repTag, t, r0 + 1.0, { base: 'translateX(-50%)', dy: 16 });
        } } else show(ans, 0);
        cta(t);
      };
    },
    sfx(k) {
      const out = [];
      if (k.has('count')) out.push(['tick', k.at('count', 'ثلاث', 0)], ['tick', k.at('count', 'ثنتين', 0.3)], ['tick', k.at('count', 'وحدة', 0.62)]);
      if (k.has('reveal')) for (let i = 0; i < 3; i++) out.push(['ding', k.phrase('reveal', i, 3)]);
      if (k.has('turn')) out.push(['whoosh', k.L('turn').start], ['chime', k.phrase('turn', 0, 2) + 0.5, 2], ['chime', k.phrase('turn', 1, 2) + 0.6, 4]);
      if (k.has('answer')) out.push(['whoosh', k.L('answer').start], ['pop', k.L('answer').start + 0.9], ['pop', k.L('answer').start + 1.15], ['pop', k.L('answer').start + 1.4]);
      return out.concat(ctaSfx(k));
    },
  };

  TEMPLATES.questions = {
    id: 'questions', icon: '💬', title: 'كم مرة جاتك هالرسالة؟', tail: 2.4,
    desc: 'رسائل العملاء تتوالى ← أماكن فاضية في صفحة المنتج ← الفحص ← مساعد المتجر',
    lines: [
      { id: 'hook', label: 'الهوك', def: 'كم مرة جاتك هالرسالة؟' },
      { id: 'msgs', label: 'الأسئلة (٣ أسئلة)', def: 'كم السعر؟ مقاسي موجود؟ متوفر بالأسود؟' },
      { id: 'why', label: 'ليش يسأل', def: 'عميلك يسأل قبل ما يشتري، لأن المعلومة غالبًا ناقصة في صفحة المنتج.' },
      { id: 'check', label: 'الفحص', def: 'افحص كتالوج متجرك مجانًا، واعرف وين صفحاتك تحتاج تفاصيل أوضح.' },
      { id: 'assist', label: 'مساعد المتجر (اختياري)', def: 'ومساعد المتجر يرد على عميلك من منتجاتك، من معلومات أنت راجعتها واعتمدتها.' },
      { id: 'cta', label: 'الدعوة', def: 'ابدأ بالفحص المجاني الحين، على فُل تايم ديجي دوت كوم.' },
    ],
    fields: {
      hookA: 'كم مرة جاتك هالرسالة؟', hookMint: ['جاتك'], inboxTitle: 'الرسائل', sender: 'عميل',
      greeting: 'السلام عليكم', questions: ['كم السعر؟', 'مقاسي موجود؟', 'متوفر بالأسود؟'],
      whyA: 'عميلك يسأل قبل ما يشتري', whyB: 'لأن المعلومة غالبًا ناقصة في صفحة المنتج',
      product: { name: 'عباية كريب سوداء', image: 'reel-pro/abaya.jpg' }, slots: ['السعر', 'المقاسات', 'الألوان'],
      checkA: 'افحص كتالوج متجرك', checkB: 'مجانًا', repTitle: 'تقرير الفحص', finds: ['سعر غير واضح', 'مقاسات بأسماء مختلفة', 'ألوان غير مذكورة'], rowNote: 'مع رابط المنتج', checkS: 'واعرف وين صفحاتك تحتاج تفاصيل أوضح',
      asA: 'مساعد المتجر', asMint: ['المتجر'], asB: 'يرد على عميلك من منتجاتك', assistName: 'مساعد المتجر',
      thread: { q: 'مقاسي موجود؟ أبي مقاس 54', a: 'هلا! هذا المنتج متوفر بمقاس 54 حسب معلومات المتجر.', note: 'من منتجاتك · معلومات راجعتها واعتمدتها' },
      cta: { a: 'ابدأ بالفحص', b: 'المجاني', bWord: 'المجاني', btn: 'افحص متجري مجانًا', platforms: ['سلة', 'زد'], reply: 'وش أكثر سؤال يجيك من عملائك؟ اكتبه بالتعليقات' },
      pageTag: 'مثال توضيحي — ليس متجرًا حقيقيًا', reportTag: 'مثال توضيحي — ليس نتيجة متجر حقيقي', chatTag: 'مثال توضيحي',
    },
    build(ctx) {
      const { stage, F, k, asset } = ctx;
      // a shorter phone than life, so its newest messages stay above the captions
      const phone = el('div', 'phone', stage); ABS(phone, { left: 274, top: 470, height: 790 });
      const scr = el('div', 'screen', phone); scr.style.height = '758px';
      const inbox = el('div', 'scr', scr); el('div', 'hdr', inbox).appendChild(document.createTextNode(F.inboxTitle));
      const msgs = [F.greeting, ...F.questions.slice(0, 3), F.questions[0], F.questions[1]].filter(Boolean);
      const ROWS = msgs.map((m) => {
        const d = el('div', 'conv', inbox); const av = el('div', 'av', d); el('i', '', av);
        const tx = el('div', 'tx', d); el('div', 'nm', tx, F.sender); el('div', 'ms', tx, m); el('span', 'dot', d); return d;
      });
      const thread = el('div', 'scr', scr); const th = el('div', 'hdr', thread); el('span', 'av', th); el('span', '', th, F.assistName);
      const qb = el('div', 'bub in', thread, F.thread.q); qb.style.top = '170px';
      const ty = el('div', 'typing', thread); ty.style.top = '340px'; const dots = [0, 1, 2].map(() => el('i', '', ty));
      const ab = el('div', 'bub out', thread, F.thread.a); ab.style.top = '340px'; el('small', '', ab, F.thread.note);
      const phTag = el('div', 'tag', stage, F.chatTag); phTag.style.top = '1180px';
      const hook = el('div', 'scene', stage); const HA = words(line(hook, 'h1', SAFE.top, 100), F.hookA, '', F.hookMint);
      const why = el('div', 'scene', stage);
      const YA = words(line(why, 'h2', SAFE.top, 70), F.whyA); const YB = words(line(why, 'sub', 384, 40), F.whyB, 'mint');
      const pp = el('div', 'page', why); ABS(pp, { left: 230, top: 540, width: 680, height: 640 });
      const pic = el('div', 'pic', pp); pic.style.height = '250px'; el('img', '', pic).src = asset(F.product.image);
      el('div', 'ttl', pp, F.product.name);
      const SL = F.slots.slice(0, 3).map((s, i) => { const d = el('div', 'slot', pp); d.style.top = 350 + i * 90 + 'px'; el('span', '', d, s); el('b', '', d, '؟'); return d; });
      const QB = F.questions.slice(0, 3).map((q, i) => { const d = el('div', 'qb', why, q); ABS(d, { left: [134, 150, 134][i], top: [640, 760, 880][i] }); return d; });
      const ppTag = el('div', 'tag', why, F.pageTag); ppTag.style.top = '1192px';
      const chk = el('div', 'scene', stage);
      const CA = words(line(chk, 'h2', SAFE.top, 78), F.checkA); const CB = words(line(chk, 'h1', 392, 100), F.checkB, 'mint');
      const rep = reportCard(chk, 540, F.repTitle, F.finds.slice(0, 3), F.rowNote);
      const CS = words(line(chk, 'sub', 1000, 42), F.checkS);
      const repTag = el('div', 'tag', chk, F.reportTag); repTag.style.top = '1150px';
      const as = el('div', 'scene', stage);
      const SA = words(line(as, 'h1', SAFE.top, 96), F.asA, '', F.asMint); const SB = words(line(as, 'sub', 412, 42), F.asB);
      const cta = ctaScene(ctx, 'cta', F.cta);
      return (t) => {
        const L = k.L, wy = L('why'), asL = L('assist'), ms = L('msgs'), ctaL = L('cta');
        const whyS = wy ? wy.start : (ms ? ms.end + 0.5 : 3);
        const pIn = ease.out(P(t, 0, 0.6)), pOut = ease.inOut(P(t, whyS - 0.4, whyS));
        const pBack = asL ? ease.out(P(t, asL.start - 0.35, asL.start + 0.25)) : 0, pGone = ctaL ? ease.inOut(P(t, ctaL.start - 0.45, ctaL.start - 0.05)) : 0;
        const inboxPhase = !asL || t < asL.start - 0.35;
        show(phone, inboxPhase ? 1 - pOut : pBack * (1 - pGone));
        phone.style.transform = inboxPhase ? `translateY(${((1 - pIn) * 220 - pOut * 120).toFixed(1)}px) scale(${(1 - 0.08 * pOut).toFixed(4)})` : `translateY(${((1 - pBack) * 200 + 30).toFixed(1)}px) scale(0.96)`;
        inbox.style.display = inboxPhase ? '' : 'none'; thread.style.display = inboxPhase ? 'none' : '';
        show(phTag, inboxPhase ? 0 : pBack * (1 - pGone));
        if (inboxPhase) {
          const qs = [0, 1, 2].map((i) => (ms ? k.phrase('msgs', i, 3) - 0.1 : 1 + i));
          const arr = [0, ...qs, (ms ? ms.end : 4) + 0.15, (ms ? ms.end : 4) + 0.45].slice(0, ROWS.length);
          ROWS.forEach((r, i) => {
            const kk = ease.out(P(t, arr[i], arr[i] + 0.35));
            const slide = arr.slice(i + 1).reduce((acc, s) => acc + ease.out(P(t, s, s + 0.35)), 0);
            r.style.top = (118 + slide * 140).toFixed(1) + 'px'; r.style.opacity = kk; r.style.transform = `translateX(${((1 - kk) * 60).toFixed(1)}px)`;
            const fresh = 1 - P(t, arr[i], arr[i] + 1.2);
            r.style.background = `rgba(${Math.round(255 - 30 * fresh)},255,${Math.round(255 - 12 * fresh)},1)`;
          });
        } else {
          const q0 = asL.start + 0.1, t0 = k.at('assist', 'يرد', 0.2) - 0.1, a0 = k.at('assist', 'عميلك', 0.3) + 0.25;
          rise(qb, t, q0, { dy: 30 }); show(ty, t >= t0 && t < a0 ? 1 : 0);
          dots.forEach((d, i) => { d.style.transform = `translateY(${(-8 * Math.max(0, Math.sin((t - t0) * 8 - i * 0.9))).toFixed(1)}px)`; });
          pop(ab, t, a0, { from: 0.85, dy: 30 });
        }
        { const v = env(t, 0, whyS - 0.05, 0, 0.4); show(hook, v);
          if (v > 0) { const kk = ease.out(P(t, 0, 0.45)); hook.firstChild.style.transform = `scale(${(1.15 - 0.15 * kk).toFixed(3)})`;
            const hw = k.at('hook', wordsOf(F.hookA).slice(-1)[0], 0.7); const pk = Math.sin(Math.PI * P(t, hw, hw + 0.4));
            HA.forEach((w) => { if (w.classList.contains('mint')) w.style.transform = `scale(${(1 + 0.1 * pk).toFixed(3)})`; }); } }
        if (wy) { const [a, b] = k.win('why'); if (sceneFx(why, t, a, b)) {
          revealWords(YA, t, k.wordTimes('why', YA.length, 0)); revealWords(YB, t, k.wordTimes('why', YB.length, YA.length), { dy: 24 });
          const pk = ease.out(P(t, a + 0.1, a + 0.7)); pp.style.opacity = pk; pp.style.transform = `translateY(${((1 - pk) * 120).toFixed(1)}px)`;
          QB.forEach((q, i) => pop(q, t, a + 0.5 + i * 0.3, { from: 0.5, dy: 30 }));
          const nq = k.at('why', 'ناقصة', 0.7);
          SL.forEach((s, i) => { const kk = P(t, nq + i * 0.12, nq + i * 0.12 + 0.5); const on = kk > 0;
            s.style.borderColor = on ? 'var(--mint-2)' : '#c3c8cb'; s.style.boxShadow = on ? `0 0 ${(24 * Math.sin(Math.PI * Math.min(1, kk * 1.2)) + 8).toFixed(1)}px rgba(31,214,165,.6)` : 'none';
            const b = s.querySelector('b'); b.style.background = on ? 'var(--mint-2)' : '#eef0f1'; b.style.color = on ? 'var(--ink)' : '#8a8f94'; });
          rise(ppTag, t, a + 0.9, { base: 'translateX(-50%)', dy: 14 });
        } } else show(why, 0);
        if (k.has('check')) { const [a, b] = k.win('check'); if (sceneFx(chk, t, a, b)) {
          const c = L('check'); revealWords(CA, t, c.start - 0.1, { stagger: 0.15 }); revealWords(CB, t, k.at('check', F.checkB, 0.25) - 0.08, { dur: 0.55, dy: 50 });
          rise(rep.card, t, c.start + 0.2, { dy: 60 });
          const w0 = k.at('check', 'وين', 0.55) - 0.25; rep.lines.forEach((ln, i) => rise(ln, t, w0 + i * 0.25, { dx: 120, dy: 0 }));
          revealWords(CS, t, k.at('check', wordsOf(F.checkS)[0], 0.45) - 0.1, { stagger: 0.08, dy: 18 });
          rise(repTag, t, w0 + 0.9, { base: 'translateX(-50%)', dy: 16 });
        } } else show(chk, 0);
        if (asL) { const [a, b] = k.win('assist'); if (sceneFx(as, t, a, b)) {
          revealWords(SA, t, asL.start - 0.1, { stagger: 0.2 });
          revealWords(SB, t, k.at('assist', 'يرد', 0.2) - 0.1, { stagger: 0.12, dy: 22 });
        } } else show(as, 0);
        cta(t);
      };
    },
    sfx(k) {
      const out = [['notify', k.L('hook').start + 0.05]];
      if (k.has('msgs')) for (let i = 0; i < 3; i++) out.push(['notify', k.phrase('msgs', i, 3) - 0.1]);
      if (k.has('why')) out.push(['whoosh', k.L('why').start], ['chime', k.at('why', 'ناقصة', 0.7), 2]);
      if (k.has('check')) out.push(['whoosh', k.L('check').start], ['pop', k.at('check', 'وين', 0.55)]);
      if (k.has('assist')) out.push(['whoosh', k.L('assist').start], ['pop', k.at('assist', 'عميلك', 0.3) + 0.25]);
      return out.concat(ctaSfx(k));
    },
  };

  TEMPLATES.trust = {
    id: 'trust', icon: '🔒', title: 'لا تعطي أحد كلمة مرور متجرك', tail: 1.8,
    desc: 'تحذير يوقف الإصبع ← «حتى إحنا ما نطلبها» ← ربط رسمي ← قراءة فقط',
    lines: [
      { id: 'hook', label: 'الهوك', def: 'لا تعطي أحد كلمة مرور متجرك.' },
      { id: 'us', label: 'المفاجأة', def: 'حتى إحنا، ما نطلبها.' },
      { id: 'how', label: 'الربط', def: 'الربط رسمي، والموافقة من داخل سلة أو زد.' },
      { id: 'read', label: 'الوعود', def: 'نقرأ فقط، وما نغيّر شي في متجرك. والقرار لك.' },
      { id: 'cta', label: 'الدعوة', def: 'افحص متجرك مجانًا الحين، على فُل تايم ديجي دوت كوم.' },
    ],
    fields: {
      hookA: 'لا تعطي أحد', hookB: 'كلمة مرور متجرك', fieldLabel: 'كلمة مرور المتجر', stamp: 'بدون كلمة مرور',
      usA: 'حتى إحنا', usB: 'ما نطلبها', howA: 'الربط رسمي', howMint: ['رسمي'], howB: 'والموافقة من داخل سلة أو زد', ok: 'الموافقة من داخل منصتك',
      readA: 'نقرأ فقط', readMint: ['فقط'], rows: ['لا نطلب كلمة مرور متجرك', 'ما نغيّر شي في متجرك', 'القرار لك'], platforms: ['سلة', 'زد'],
      cta: { ...CTA_CHECK, micro: 'مجاني · قراءة فقط · لا نعدّل أي شيء في متجرك' },
    },
    build(ctx) {
      const { stage, F, k, asset } = ctx;
      const hook = el('div', 'scene', stage);
      const HA = words(line(hook, 'h1', SAFE.top, 104), F.hookA); const HB = words(line(hook, 'h1', 410, 104), F.hookB, 'mint');
      const lock = el('img', 'abs masked', stage); lock.src = asset('reel-pro/lock.jpg'); ABS(lock, { left: 270, top: 500, width: 540, height: 540 });
      const field = el('div', 'field', stage); Object.assign(field.style, { top: '1010px', height: '178px', padding: '22px 40px' }); el('div', 'lb', field, F.fieldLabel);
      const pw = el('div', 'pw', field); const DOTS = [...Array(10)].map(() => el('i', '', pw)); const car = el('span', 'car', pw);
      const strike = el('div', 'strike', stage); strike.style.top = '1098px';
      const nope = el('div', 'okpill', stage); nope.style.top = '880px'; icon(nope, ICON.check, 40, 'var(--ink)'); el('span', '', nope, F.stamp);
      const us = el('div', 'scene', stage);
      const UA = words(line(us, 'h1', SAFE.top, 104), F.usA); const UB = words(line(us, 'h1', 410, 104), F.usB, 'mint');
      const how = el('div', 'scene', stage);
      const WA = words(line(how, 'h1', SAFE.top, 104), F.howA, '', F.howMint); const WB = words(line(how, 'sub', 424, 46), F.howB);
      const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('viewBox', '0 0 1080 1920'); ABS(svg, { left: 0, top: 0, width: 1080, height: 1920 }); how.appendChild(svg);
      const mkPath = (d) => { const p = document.createElementNS(SVG_NS, 'path'); for (const [a, v] of [['d', d], ['fill', 'none'], ['stroke', 'rgba(94,240,200,.5)'], ['stroke-width', 5], ['stroke-dasharray', '10 12']]) p.setAttribute(a, v); svg.appendChild(p); return p; };
      const mkDot = () => { const c = document.createElementNS(SVG_NS, 'circle'); c.setAttribute('r', 12); c.setAttribute('fill', '#b4ffe9'); svg.appendChild(c); return c; };
      const paths = [mkPath('M540 770 C540 860 720 860 720 960'), mkPath('M540 770 C540 860 360 860 360 960')], pdots = [mkDot(), mkDot()];
      const mini = el('img', 'abs', how); mini.src = ctx.brand.logo || asset('brand/fd-logo-night.png'); ABS(mini, { left: 410, top: 560, width: 260, height: 194, objectFit: 'contain' });
      // the two platforms by name, in our own type — never their logos
      const [bS, bZ] = platformChips(how, 960, F.platforms, { big: true });
      const ok = el('div', 'pill', how); ok.style.top = '1124px'; const okn = el('span', 'n', ok); icon(okn, ICON.check, 30, 'var(--ink)'); el('span', '', ok, F.ok);
      const rd = el('div', 'scene', stage);
      const RA = words(line(rd, 'h1', SAFE.top, 100), F.readA, '', F.readMint);
      const shield = el('img', 'abs masked', rd); shield.src = asset('reel-pro/shield.jpg'); ABS(shield, { left: 300, top: 400, width: 480, height: 456 });
      const ROWS = F.rows.slice(0, 3).map((txt, i) => { const r = el('div', 'row', rd); r.style.top = 870 + i * 118 + 'px'; r.style.height = '104px'; icon(el('div', 'ic', r), [ICON.lock, ICON.eye, ICON.shield][i], 40); el('div', 'tx', r, txt); return r; });
      const cta = ctaScene(ctx, 'cta', F.cta);
      // the paths' length is fixed by their shape; measure once
      let plen = null;
      return (t) => {
        const L = k.L, hk = L('hook'), usL = L('us'), hw = L('how');
        const thud = k.at('hook', wordsOf(F.hookB).slice(-1)[0], 0.8), no = usL ? k.at('us', wordsOf(F.usB)[0], 0.4) : hk.end + 0.6;
        const howS = hw ? hw.start : no + 2;
        { const v = env(t, 0, (usL ? usL.start : howS) - 0.05, 0, 0.35); show(hook, v);
          if (v > 0) { const kk = ease.out(P(t, 0, 0.4)); hook.firstChild.style.transform = `scale(${(1.15 - 0.15 * kk).toFixed(3)})`;
            revealWords(HB, t, -0.25, { stagger: 0.1, dy: 30 });
            const sh = Math.sin(Math.PI * P(t, thud, thud + 0.35)); hook.children[1].style.transform = `translateX(${(Math.sin(t * 60) * 10 * sh).toFixed(1)}px)`; } }
        const gone = ease.inOut(P(t, howS - 0.45, howS - 0.05));
        const lk = ease.out(P(t, -0.25, 0.45)), lp = Math.sin(Math.PI * P(t, no, no + 0.5));
        show(lock, lk * (1 - gone));
        lock.style.transform = `translateY(${((1 - lk) * 60 + Math.sin(t * 1.5) * 8).toFixed(1)}px) scale(${(0.9 + 0.1 * lk + 0.08 * lp - 0.06 * gone).toFixed(3)})`;
        lock.style.filter = `drop-shadow(0 0 ${(20 + 50 * lp).toFixed(1)}px rgba(94,240,200,.6)) brightness(${(1 + 0.4 * lp).toFixed(3)})`;
        const fk = ease.out(P(t, -0.2, 0.35)), shake = Math.sin(Math.PI * P(t, thud, thud + 0.4));
        show(field, fk * (1 - gone));
        field.style.transform = `translate(${(Math.sin(t * 70) * 16 * shake).toFixed(1)}px,${((1 - fk) * 80).toFixed(1)}px)`;
        const typed = Math.floor(10 * P(t, hk.start, thud));
        DOTS.forEach((d, i) => { const fall = ease.inOut(P(t, no + i * 0.04, no + i * 0.04 + 0.5));
          d.style.opacity = (i < typed ? 1 : 0) * (1 - fall); d.style.transform = `translateY(${(fall * 90).toFixed(1)}px) scale(${(1 - 0.5 * fall).toFixed(3)})`; });
        car.style.opacity = t < no && Math.floor(t * 2.6) % 2 === 0 ? 1 : 0;
        const st = ease.out(P(t, no - 0.05, no + 0.35)); show(strike, st * (1 - gone)); strike.style.transform = `scaleX(${st.toFixed(3)})`;
        pop(nope, t, (usL ? usL.end : no + 1) - 0.4, { from: 0.6, dy: 30, base: 'translateX(-50%)' }); nope.style.opacity *= (1 - gone);
        if (usL) { const v = env(t, usL.start - 0.05, howS - 0.05, 0.05, 0.35); show(us, v);
          if (v > 0) { revealWords(UA, t, k.wordTimes('us', UA.length, 0), { dy: 30 }); revealWords(UB, t, k.wordTimes('us', UB.length, UA.length), { dy: 60 }); } } else show(us, 0);
        if (hw) { const [a, b] = k.win('how'); if (sceneFx(how, t, a, b)) {
          revealWords(WA, t, k.wordTimes('how', WA.length, 0), { dy: 40 }); revealWords(WB, t, k.wordTimes('how', WB.length, WA.length), { dy: 24 });
          pop(mini, t, a + 0.1, { from: 0.6, dur: 0.6 }); mini.style.filter = `drop-shadow(0 0 ${(24 + 10 * Math.sin(t * 2.2)).toFixed(1)}px rgba(94,240,200,.45))`;
          const s1 = k.at('how', 'سلة', 0.7), s2 = k.at('how', 'زد', 0.85);
          if (bS) pop(bS, t, s1 - 0.05, { from: 0.55, dy: 40, base: bS.dataset.base }); if (bZ) pop(bZ, t, s2 - 0.05, { from: 0.55, dy: 40, base: bZ.dataset.base });
          if (plen == null) plen = paths.map((p) => { try { return p.getTotalLength(); } catch { return 300; } });
          paths.forEach((p, i) => { const s0 = a + 0.4 + i * 0.2, dk = ease.out(P(t, s0, s0 + 0.8));
            p.style.opacity = dk; p.setAttribute('stroke-dashoffset', (-t * 40).toFixed(1));
            const q = Math.max(0, ((t - s0) * 0.6) % 1); let pt = { x: 540, y: 800 }; try { pt = p.getPointAtLength(q * plen[i]); } catch {}
            pdots[i].setAttribute('cx', pt.x.toFixed(1)); pdots[i].setAttribute('cy', pt.y.toFixed(1)); pdots[i].style.opacity = t > s0 + 0.8 ? 1 : 0; });
          pop(ok, t, s2 + 0.35, { from: 0.7, dy: 30, base: 'translateX(-50%)' });
        } } else show(how, 0);
        if (k.has('read')) { const [a, b] = k.win('read'); if (sceneFx(rd, t, a, b)) {
          revealWords(RA, t, k.wordTimes('read', RA.length, 0), { dy: 40 });
          const sk = ease.out(P(t, a + 0.2, a + 1.0)); shield.style.opacity = sk;
          shield.style.transform = `translateY(${((1 - sk) * 60 + Math.sin(t * 1.6) * 6).toFixed(1)}px) scale(${(0.9 + 0.1 * sk).toFixed(3)})`;
          [a + 0.6, k.phrase('read', 1, 3) - 0.2, k.phrase('read', 2, 3) - 0.15].forEach((s, i) => ROWS[i] && rise(ROWS[i], t, s, { dx: 160, dy: 0 }));
        } } else show(rd, 0);
        cta(t);
      };
    },
    sfx(k) {
      const out = [['type', k.L('hook').start, 9], ['thud', k.at('hook', 'متجرك', 0.8)]];
      if (k.has('us')) out.push(['impact', k.at('us', 'ما', 0.4)]);
      if (k.has('how')) out.push(['whoosh', k.L('how').start], ['pop', k.at('how', 'سلة', 0.7)], ['pop', k.at('how', 'زد', 0.85)]);
      if (k.has('read')) out.push(['whoosh', k.L('read').start], ['pop', k.L('read').start + 0.6], ['pop', k.phrase('read', 1, 3)], ['pop', k.phrase('read', 2, 3)]);
      return out.concat(ctaSfx(k));
    },
  };

  function ctaSfx(k) {
    if (!k.has('cta')) return [];
    return [['impact', k.L('cta').start - 0.3], ['pop', k.at('cta', 'الحين', 0.4) - 0.05]];
  }

  // ------------------------------------------------------------------ fields
  /** Template defaults with the spec's fields laid over them (one level of nesting is merged). */
  function fieldsFor(spec, tpl) {
    const out = JSON.parse(JSON.stringify(tpl.fields));
    const f = spec.fields && typeof spec.fields === 'object' ? spec.fields : {};
    for (const key of Object.keys(out)) {
      const v = f[key];
      if (v == null) continue;
      if (Array.isArray(out[key])) {
        if (Array.isArray(v)) out[key] = out[key].map((d, i) => (v[i] == null ? d : typeof d === 'object' ? { ...d, ...v[i] } : String(v[i])));
      } else if (typeof out[key] === 'object') { if (typeof v === 'object') out[key] = { ...out[key], ...v }; }
      else out[key] = String(v);
    }
    // images: anything that is not a bundled path or an inline image falls back to the default
    const fixImg = (o, d) => { if (o && typeof o === 'object' && 'image' in o && !okImage(o.image)) o.image = d.image; };
    if (out.product) fixImg(out.product, tpl.fields.product);
    if (Array.isArray(out.items)) out.items.forEach((it, i) => fixImg(it, tpl.fields.items[i] || tpl.fields.items[0]));
    return out;
  }

  // ------------------------------------------------------------------ mount
  /**
   * Build the stage for `spec` inside `host` and return { render(t), duration, root }.
   * `opts.asset(path)` turns a bundled path ("reel-pro/abaya.jpg", "brand/…") into a URL.
   */
  function mount(host, spec, T, opts = {}) {
    const tpl = TEMPLATES[spec.template] || TEMPLATES.challenge;
    const asset = (p) => (String(p).startsWith('data:') ? p : (opts.asset ? opts.asset(p) : 'assets/' + p));
    host.textContent = '';
    const stage = el('div', 'rp', host);
    theme(stage, spec.brand || {});
    const bg = background(stage);
    const c = clock(T);
    const k = { ...c, win: windows(T),
      // the start time of each of `n` words of a line, from word `from` — for a headline that
      // mirrors the spoken line word for word
      wordTimes: (id, n, from = 0) => { const l = T.lines[id]; if (!l) return [0]; return [...Array(n)].map((_, i) => (l.words[from + i] || l.words[l.words.length - 1] || { at: l.start }).at - 0.08); },
    };
    const brand = {
      website: String(spec.brand?.website || 'fulltimedigi.com').replace(/^https?:\/\//, '').replace(/[^\w.\-/]/g, '').slice(0, 60) || 'fulltimedigi.com',
      // another brand's own logo (an uploaded image); FullTimeDigi's night logo otherwise
      logo: typeof spec.brand?.logo === 'string' && /^data:image\//.test(spec.brand.logo) && okImage(spec.brand.logo) ? spec.brand.logo : null,
    };
    const F = fieldsFor(spec, tpl);
    const draw = tpl.build({ stage, F, k, asset, brand, spec });
    fitLines(stage);
    let last = 0;
    const render = (t) => { last = t; bg(t); draw(t); };
    // fitting measures layout, so the scenes that render() hid are shown for the measurement
    const fit = () => { const hidden = [...stage.querySelectorAll('*')].filter((e) => e.style.display === 'none'); hidden.forEach((e) => { e.style.display = ''; }); fitLines(stage); render(last); };
    render(0);
    return { render, fit, duration: T.duration, root: stage };
  }

  /** Sound events for a spec on a timeline: [{type, at, note?, keys?}] */
  function sfx(spec, T) {
    const tpl = TEMPLATES[spec.template] || TEMPLATES.challenge;
    const k = clock(T);
    return (tpl.sfx ? tpl.sfx(k) : []).filter((e) => Number.isFinite(e[1])).map(([type, at, x]) => ({ type, at, note: type === 'chime' ? x : undefined, keys: type === 'type' ? x : undefined }));
  }

  /** A complete spec for a template, with its approved default copy. */
  function example(id) {
    const tpl = TEMPLATES[id] || TEMPLATES.challenge;
    return { template: tpl.id, slug: 'reel-' + tpl.id, lines: tpl.lines.map((l) => ({ id: l.id, text: l.def })), fields: JSON.parse(JSON.stringify(tpl.fields)) };
  }

  // ------------------------------------------------------------------ claims
  // What a FullTimeDigi reel must never say (the brand guide's banned list, as patterns), plus the
  // things a marketing script slips into: numbers and percentages, guarantees, "coming soon".
  const LINT = [
    [/\d+\s*[%٪]|[٠-٩]+\s*[%٪]/, 'نسبة مئوية — لا أرقام نتائج بدون مصدر'],
    [/(ضاعف|تضاعف|ضعف)\s*(مبيعات|أرباح)/, 'وعد بمضاعفة المبيعات أو الأرباح'],
    [/(نزيد|يزيد|تزيد|زيادة)\s*(مبيعات|المبيعات|أرباح|التحويل)/, 'وعد بزيادة المبيعات — الشعار المعتمد وحده مسموح'],
    [/قريب[اًا]?\b|قريبًا|قريباً/, '«قريبًا» — الإعلانات تنزل مع الانطلاق'],
    [/مضمون|نضمن|ضمان/, 'ضمان نتيجة'],
    [/الأفضل في|الأقوى|الأرخص|رقم ١|رقم 1/, 'مبالغة مقارنة'],
    [/كل الأخطاء|جميع الأخطاء|يكتشف كل/, 'ادعاء دقة كاملة'],
    [/شريك\s*(رسمي|معتمد)|شراكة\s*(رسمية|مع)|شركاء\s*(سلة|زد)|معتمد\s*من\s*(سلة|زد)|موصى\s*به\s*من|(سلة|زد)\s*(توصي|يوصي|تنصح|تعتمد)|partner|certified/i,
      'ادعاء شراكة أو اعتماد من سلة أو زد — ممنوع بدون اتفاق مكتوب منهم'],
    [/shopify|شوبيفاي/i, 'Shopify غير متاح بعد'],
  ];
  const PLATFORM = /(^|[\s،,«(:])(سلة|زد)(?=[\s،,.؟?!»):]|$)|\bsalla\b|\bzid\b/i;
  /** Warnings for every spoken line and on-screen string in a spec. */
  function lint(spec, banned = []) {
    const out = [];
    const texts = [];
    for (const l of spec.lines || []) texts.push(['السطر ' + l.id, l.text]);
    const walk = (o, path) => { if (typeof o === 'string') texts.push([path, o]); else if (o && typeof o === 'object') for (const k2 of Object.keys(o)) walk(o[k2], path + '.' + k2); };
    // what is on screen: the template's defaults with the spec's own words laid over them
    const tpl = TEMPLATES[spec.template];
    walk(tpl ? fieldsFor(spec, tpl) : spec.fields || {}, 'الشاشة');
    for (const [where, s] of texts) {
      for (const [re, why] of LINT) if (re.test(s)) out.push({ where, text: s, why });
      for (const b of banned) if (b && String(s).includes(b)) out.push({ where, text: s, why: 'ممنوع في دليل الهوية: ' + b });
    }
    // naming a platform is fine only once our app is really in its app store («للسلة», the cart, is not a mention)
    const named = texts.find(([, s]) => PLATFORM.test(String(s)));
    if (named) out.push({ where: named[0], text: named[1], why: 'يذكر سلة/زد — انشره بعد ما يكون تطبيقنا منشورًا ومعتمدًا في متجر تطبيقات المنصة نفسها' });
    return out;
  }

  root.ReelPro = { W, H, SAFE, TEMPLATES, missingLines, pauseAfter, timeline, estimateDuration, estimateWords, phrases, norm, strip, wordsOf, mount, sfx, example, fieldsFor, lint, okImage };
})(globalThis);
