/* doodle-studio in-browser engine. Deterministic: window.doodle.seek(t) sets the whole
   picture for time t (seconds). Node drives it frame by frame and screenshots; the browser
   app paints the same picture on a canvas (paint) for WebCodecs export.

   v2: one big whiteboard with camera pans between scenes ("board" layout), marker-scribble
   colour reveal, board styles (white / paper / chalk / glass), colour-tinted markers,
   kinetic text and a soft "settle" motion when an element is finished. */
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const backOut = (p, s = 1.7) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
  const isRTL = (s) => /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(s);
  const OUTLINE_SHARE = 0.7;          // share of an element's draw time spent on the outline when it is coloured afterwards
  const PAN_BEFORE = 0.3, PAN_AFTER = 0.55; // seconds of camera travel around a scene boundary (board layout)

  let P = null;            // compiled project
  const stage = document.getElementById('stage');
  const hand = document.getElementById('hand');
  const state = { scenes: [], board: null, boardBox: null };
  let uid = 0;

  // ---------- SVG -> sampled stroke paths (handles any transform) ----------
  function svgToStrokes(svgText, box) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none';
    holder.innerHTML = svgText;
    document.body.appendChild(holder);
    const svg = holder.querySelector('svg');
    if (!svg) { holder.remove(); return { paths: [], vb: [0, 0, 100, 100] }; }
    let vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
      ? [svg.viewBox.baseVal.x, svg.viewBox.baseVal.y, svg.viewBox.baseVal.width, svg.viewBox.baseVal.height]
      : [0, 0, parseFloat(svg.getAttribute('width')) || 100, parseFloat(svg.getAttribute('height')) || 100];
    svg.setAttribute('width', vb[2]); svg.setAttribute('height', vb[3]);
    svg.setAttribute('viewBox', vb.join(' '));
    const rootCTM = svg.getScreenCTM();
    const paths = [];
    const nodes = svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon');
    nodes.forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (cs.fill === 'none' && (cs.stroke === 'none' || cs.strokeWidth === '0px')) return;
      let len = 0;
      try { len = el.getTotalLength(); } catch (e) { return; }
      if (!isFinite(len) || len < 1) return;
      const m = el.getScreenCTM();
      if (!m) return;
      const toRoot = rootCTM.inverse().multiply(m);
      const step = Math.max(1.2, len / 600);
      const pts = [];
      for (let d = 0; d <= len; d += step) {
        const p = el.getPointAtLength(d);
        pts.push([toRoot.a * p.x + toRoot.c * p.y + toRoot.e, toRoot.b * p.x + toRoot.d * p.y + toRoot.f]);
      }
      const last = el.getPointAtLength(len);
      pts.push([toRoot.a * last.x + toRoot.c * last.y + toRoot.e, toRoot.b * last.x + toRoot.d * last.y + toRoot.f]);
      let cur = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (Math.hypot(x1 - x0, y1 - y0) > step * 6) { if (cur.length > 1) paths.push(cur); cur = [pts[i]]; }
        else cur.push(pts[i]);
      }
      if (cur.length > 1) paths.push(cur);
    });
    holder.remove();
    paths.sort((a, b) => (a[0][1] * 0.35 + a[0][0] * 0.65) - (b[0][1] * 0.35 + b[0][0] * 0.65));
    return { paths: paths.map((pts) => 'M' + pts.map(([x, y]) => x.toFixed(2) + ' ' + y.toFixed(2)).join('L')), vb };
  }

  // ---------- colours ----------
  function parseColor(c) {
    if (!c) return null; c = String(c).trim();
    let m = c.match(/^#([0-9a-f]{3})$/i); if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
    m = c.match(/^#([0-9a-f]{6})/i); if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = c.match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map((v) => parseFloat(v));
    return null;
  }
  const lum = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const hex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  // a marker is "black" (no tint needed) when the colour is dark and dull
  function markerColor(c) { const rgb = parseColor(c); if (!rgb) return null; const s = Math.max(...rgb) - Math.min(...rgb); return lum(rgb) < 90 && s < 60 ? null : hex(rgb); }

  // ---------- in-browser centerline tracing (raster or filled SVG -> ordered pen strokes) ----------
  function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
  const traceCache = new Map();
  let worker = null, workerBusy = Promise.resolve();
  function getWorker() {
    if (worker || !window.Worker || !window.DOODLE_WORKER_SCRIPTS) return worker;
    const code = `importScripts(${window.DOODLE_WORKER_SCRIPTS.map((u) => JSON.stringify(u)).join(',')});
      self.onmessage = (ev) => { const { id, gray, w, h, opts } = ev.data; try { const r = StrokesCore.extract(gray, w, h, TraceSkeleton.fromBoolArray, opts); self.postMessage({ id, lines: r.lines, width: r.width }); } catch (e) { self.postMessage({ id, error: e.message }); } };`;
    try { worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); } catch (e) { return null; }
    worker.addEventListener('error', (ev) => { console.warn('trace worker failed, falling back to main thread:', ev.message); try { worker.terminate(); } catch {} worker = null; window.DOODLE_WORKER_SCRIPTS = null; });
    return worker;
  }
  function extractStrokes(gray, w, h, opts) {
    const wk = getWorker();
    if (!wk) return Promise.resolve(window.StrokesCore.extract(gray, w, h, window.TraceSkeleton.fromBoolArray, opts));
    const grayCopy = gray.slice();
    const run = () => new Promise((ok, bad) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (ev) => { if (ev.data.id !== id) return; cleanup(); ev.data.error ? bad(new Error(ev.data.error)) : ok(ev.data); };
      const onErr = () => { cleanup(); ok(window.StrokesCore.extract(grayCopy, w, h, window.TraceSkeleton.fromBoolArray, opts)); };
      const cleanup = () => { wk.removeEventListener('message', onMsg); wk.removeEventListener('error', onErr); };
      wk.addEventListener('message', onMsg); wk.addEventListener('error', onErr); wk.postMessage({ id, gray, w, h, opts }, [gray.buffer]);
    });
    const p = workerBusy.then(run, run); workerBusy = p.catch(() => {}); return p;
  }
  async function traceCenterline(src, opts) {
    const key = src.length + ':' + src.slice(0, 200) + ':' + src.slice(-200) + ':' + JSON.stringify(opts);
    if (traceCache.has(key)) return traceCache.get(key);
    const im = await loadImage(src);
    const maxSide = opts.traceSize || 1400;
    const sc = Math.min(1, maxSide / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height));
    const w = Math.max(8, Math.round((im.naturalWidth || im.width) * sc)), h = Math.max(8, Math.round((im.naturalHeight || im.height) * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h); const d = id.data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const grayKeep = gray; // extractStrokes may transfer the buffer to a worker; keep a copy for the ink recolour below
    const grayCopy = opts.darkInk ? gray.slice() : null;
    const minLen = Math.max(10, Math.min(w, h) * 0.012);
    const { lines, width } = await extractStrokes(grayKeep, w, h, { threshold: opts.threshold || 150, minLen });
    const paths = lines.map((l) => `<path d="M${l.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L')}"/>`).join('');
    let fill = '', color = null;
    if (opts.fill !== 'none') {
      const ink = parseColor(opts.darkInk); // on dark boards the artwork's black lines become chalk-coloured
      let cr = 0, cg = 0, cb = 0, cn = 0;
      for (let i = 0; i < w * h; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mn > 225 && mx - mn < 22) d[i * 4 + 3] = Math.round(clamp((248 - mn) / 23, 0, 1) * 255);
        else if (mx - mn > 70 && mx > 60) { cr += r; cg += g; cb += b; cn++; }
        if (ink && grayCopy[i] < 95) { const f = 1 - grayCopy[i] / 95; d[i * 4] = Math.round(lerp(r, ink[0], f)); d[i * 4 + 1] = Math.round(lerp(g, ink[1], f)); d[i * 4 + 2] = Math.round(lerp(b, ink[2], f)); }
      }
      if (cn > w * h * 0.004) color = hex([cr / cn, cg / cn, cb / cn]);
      ctx.putImageData(id, 0, 0);
      fill = `<image href="${c.toDataURL('image/png')}" x="0" y="0" width="${w}" height="${h}"/>`;
    }
    const penW = width * 1.25;
    const out = { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${fill}<g class="strokes" fill="none" stroke="${opts.color || '#1a1a1a'}" stroke-width="${penW.toFixed(2)}">${paths}</g></svg>`, width: penW, size: [w, h], color };
    traceCache.set(key, out); return out;
  }

  // ---------- board backgrounds (white / paper / chalk / glass) ----------
  function noiseTile(size, fn) {
    const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
    const id = ctx.createImageData(size, size); const d = id.data; let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < size * size; i++) { const [r, g, b, a] = fn(rnd, i % size, Math.floor(i / size)); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
    ctx.putImageData(id, 0, 0); return c;
  }
  const boardCache = new Map();
  function makeBoard(style, color) {
    const key = style + '|' + color;
    if (boardCache.has(key)) return boardCache.get(key);
    let b;
    if (style === 'paper') b = { color: color || '#faf6ec', tile: noiseTile(256, (r) => [60, 45, 20, Math.round(r() * 26)]), gradient: null };
    else if (style === 'chalk') b = { color: color || '#2c3b35', tile: noiseTile(256, (r) => { const v = r(); return [235, 235, 225, Math.round(v * v * 34)]; }), gradient: ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.18)'] };
    else if (style === 'glass') b = { color: color || '#13223c', tile: null, gradient: ['rgba(120,170,255,0.20)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.28)'] };
    else b = { color: color || '#ffffff', tile: null, gradient: null };
    b.css = (b.gradient ? `linear-gradient(135deg, ${b.gradient.join(', ')}), ` : '') + (b.tile ? `url(${b.tile.toDataURL()}) repeat, ` : '') + b.color;
    boardCache.set(key, b); return b;
  }
  function paintBoard(ctx, b, x, y, w, h) {
    ctx.fillStyle = b.color; ctx.fillRect(x, y, w, h);
    if (b.tile) { ctx.save(); ctx.fillStyle = ctx.createPattern(b.tile, 'repeat'); ctx.fillRect(x, y, w, h); ctx.restore(); }
    if (b.gradient) { const g = ctx.createLinearGradient(x, y, x + w, y + h); b.gradient.forEach((c, i) => g.addColorStop(i / (b.gradient.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
  }

  // ---------- hands: base bitmap + colour-tinted marker variants ----------
  let baseHand = null; const handVariants = new Map();
  function tintHand(color) {
    if (!baseHand || !P.hand.tintable) return null;
    if (handVariants.has(color)) return handVariants.get(color);
    const rgb = parseColor(color); if (!rgb) return null;
    const w = baseHand.naturalWidth, h = baseHand.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(baseHand, 0, 0);
    let id; try { id = ctx.getImageData(0, 0, w, h); } catch (e) { handVariants.set(color, null); return null; }
    const d = id.data;
    for (let i = 0; i < w * h; i++) {
      const a = d[i * 4 + 3]; if (a < 20) continue;
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const l = 0.299 * r + 0.587 * g + 0.114 * b; const s = Math.max(r, g, b) - Math.min(r, g, b);
      if (l < 92 && s < 46) { // the marker body: dark and colourless
        const f = 0.42 + 0.75 * clamp(l / 90, 0, 1);
        d[i * 4] = clamp(rgb[0] * f, 0, 255); d[i * 4 + 1] = clamp(rgb[1] * f, 0, 255); d[i * 4 + 2] = clamp(rgb[2] * f, 0, 255);
      }
    }
    ctx.putImageData(id, 0, 0);
    const v = { canvas: c, url: null, naturalWidth: w, naturalHeight: h };
    try { v.url = c.toDataURL('image/png'); } catch (e) {}
    handVariants.set(color, v); return v;
  }

  // ---------- building ----------
  function px(v, total) { return typeof v === 'string' && v.endsWith('%') ? parseFloat(v) / 100 * total : +v; }

  async function buildElement(sc, e) {
    const W = P.width, H = P.height;
    const ink = P.defaults.strokeColor;
    let traced = null;
    if (e.kind === 'drawing' && e.trace === 'centerline') {
      const src = e.src || ('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(e.svg))));
      traced = await traceCenterline(src, { threshold: e.threshold, color: e.color || ink, fill: e.style === 'line' ? 'none' : 'original', traceSize: e.traceSize, darkInk: P.board && P.board.dark ? ink : undefined });
      e.svg = traced.svg; e.style = e.style === 'line' ? 'line' : 'color';
      if (!e.strokeWidth) { const s = Math.min(px(e.w, W) / traced.size[0], px(e.h, H) / traced.size[1]); e.strokeWidth = Math.max(3, traced.width * s * (e.strokeScale || 1)); }
    }
    const div = document.createElement('div');
    div.className = 'el';
    const x = px(e.x, W), y = px(e.y, H), w = px(e.w, W), h = px(e.h, H);
    div.style.left = x + 'px'; div.style.top = y + 'px'; div.style.width = w + 'px'; div.style.height = h + 'px';
    div.style.transformOrigin = '50% 50%';
    const rec = { e, div, x, y, w, h, kind: e.kind, strokes: [], totalLen: 0, id: ++uid };
    rec.penColor = markerColor(e.color || (e.kind === 'text' ? P.defaults.textColor : ink));
    rec.motion = e.motion || (e.isShape ? 'none' : (P.defaults.motion || 'pop'));
    if (e.rotate) div.style.transform = `rotate(${e.rotate}deg)`;

    if (e.kind === 'text') {
      const t = document.createElement('div');
      t.className = 'text';
      const rtl = e.dir ? e.dir === 'rtl' : isRTL(e.content);
      t.dir = rtl ? 'rtl' : 'ltr';
      t.style.fontFamily = e.font || P.defaults.font;
      t.style.fontSize = px(e.size || P.defaults.fontSize, H) + 'px';
      t.style.color = e.color || P.defaults.textColor;
      t.style.fontWeight = e.weight || 'normal';
      const align = e.align || (rtl ? 'right' : 'left');
      t.style.textAlign = align;
      t.style.alignItems = align === 'center' ? 'center' : ((align === 'right') === rtl ? 'flex-start' : 'flex-end');
      rec.anim = e.anim && e.anim !== 'write' ? e.anim : 'write';
      const lines = String(e.content).split('\n');
      rec.words = [];
      rec.lines = lines.map((s) => {
        const l = document.createElement('span'); l.className = 'line';
        const ws = (s || ' ').split(' ');
        const words = ws.map((wd, k) => { const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = wd; l.appendChild(sp); if (k < ws.length - 1) l.appendChild(document.createTextNode(' ')); return { el: sp, text: wd }; });
        t.appendChild(l); rec.words.push(...words.filter((x) => x.text.trim()));
        return { el: l, weight: Math.max(1, s.length) };
      });
      rec.rtl = rtl;
      if (rec.anim !== 'write') rec.penColor = null;
      div.appendChild(t);
    } else if (e.kind === 'drawing') {
      const { paths, vb } = svgToStrokes(e.svg, { w, h });
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', vb.join(' '));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      if (e.style !== 'line') {
        const g = document.createElementNS(svgNS, 'g'); g.setAttribute('class', 'fill');
        const holder = document.createElement('div'); holder.innerHTML = e.svg;
        const inner = holder.querySelector('svg');
        if (inner) { inner.removeAttribute('width'); inner.removeAttribute('height'); inner.setAttribute('viewBox', vb.join(' ')); inner.setAttribute('x', 0); inner.setAttribute('y', 0); inner.setAttribute('width', vb[2]); inner.setAttribute('height', vb[3]); g.appendChild(inner); }
        svg.appendChild(g); rec.fillLayer = g;
        rec.fillColor = markerColor(e.fillColor || (traced && traced.color) || e.accent || e.color) || null;
      }
      const gs = document.createElementNS(svgNS, 'g'); gs.setAttribute('class', 'strokes');
      const scale = Math.min(w / vb[2], h / vb[3]);
      const sw = (e.strokeWidth || P.defaults.strokeWidth) / scale;
      paths.forEach((d) => {
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d); p.setAttribute('stroke', e.color || ink); p.setAttribute('stroke-width', sw);
        if (e.strokeOpacity != null && e.strokeOpacity !== 1) p.setAttribute('stroke-opacity', e.strokeOpacity);
        gs.appendChild(p);
        rec.strokes.push({ p, len: 0 });
      });
      svg.appendChild(gs); div.appendChild(svg); rec.svg = svg; rec.vb = vb; rec.scale = scale; rec.gs = gs;
    } else if (e.kind === 'photo') {
      const img = document.createElement('img'); img.className = 'photo'; img.src = e.src; div.appendChild(img); rec.img = img;
    }
    return rec;
  }

  // marker scribble that colours an element after its outline: one continuous zig-zag over the ink's bounding box
  function scribblePath(bb, band) {
    const n = Math.max(3, Math.ceil(bb.h / band)); const bandH = bb.h / n; const pts = [];
    for (let k = 0; k < n; k++) {
      const y = bb.y + (k + 0.5) * bandH; const ltr = k % 2 === 0;
      for (let i = 0; i <= 10; i++) {
        const u = i / 10; const x = ltr ? bb.x - band * 0.35 + u * (bb.w + band * 0.7) : bb.x + bb.w + band * 0.35 - u * (bb.w + band * 0.7);
        pts.push([x, y + bandH * 0.22 * Math.sin(u * Math.PI * 2.3 + k * 1.7)]);
      }
    }
    return 'M' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L');
  }
  function makeScribble(r) {
    if (!r.fillLayer || P.defaults.colorReveal === 'fade') return;
    let bb; try { bb = r.gs.getBBox(); } catch (e) { return; }
    if (!bb || bb.width < 2 || bb.height < 2) { const [vx, vy, vw, vh] = r.vb; bb = { x: vx, y: vy, width: vw, height: vh }; }
    const bandPx = clamp(Math.min(r.w, r.h) * 0.13, 22, 90); const band = bandPx / r.scale;
    const d = scribblePath({ x: bb.x, y: bb.y, w: bb.width, h: bb.height }, band);
    const svgNS = 'http://www.w3.org/2000/svg';
    const mask = document.createElementNS(svgNS, 'mask'); mask.setAttribute('id', 'scrib' + r.id); mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('x', bb.x - band * 2); mask.setAttribute('y', bb.y - band * 2); mask.setAttribute('width', bb.width + band * 4); mask.setAttribute('height', bb.height + band * 4);
    const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', d); p.setAttribute('stroke', '#fff'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-width', band * 1.25);
    mask.appendChild(p); r.svg.insertBefore(mask, r.svg.firstChild);
    r.fillLayer.setAttribute('mask', `url(#scrib${r.id})`);
    const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
    r.scrib = { p, len, band: band * 1.25, path2d: typeof Path2D !== 'undefined' ? new Path2D(d) : null };
  }

  function layoutScenes() {
    const W = P.width, H = P.height; const n = state.scenes.length;
    if (!P.board || P.board.layout !== 'pan' || n < 2) { state.scenes.forEach((s) => { s.off = { x: 0, y: 0 }; }); state.boardBox = { x: 0, y: 0, w: W, h: H }; return; }
    const cols = W >= H ? 3 : 2; const gx = W * 0.16, gy = H * 0.2; let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
    let minX = 0, minY = 0, maxX = W, maxY = H;
    state.scenes.forEach((s, i) => {
      const row = Math.floor(i / cols); let col = i % cols; if (row % 2) col = cols - 1 - col;
      s.off = { x: col * (W + gx) + rnd() * W * 0.04, y: row * (H + gy) + rnd() * H * 0.04 };
      minX = Math.min(minX, s.off.x); minY = Math.min(minY, s.off.y); maxX = Math.max(maxX, s.off.x + W); maxY = Math.max(maxY, s.off.y + H);
    });
    state.boardBox = { x: minX - W, y: minY - H, w: maxX - minX + 2 * W, h: maxY - minY + 2 * H };
  }

  async function build(project) {
    P = project;
    P.board = P.board || { style: 'white', layout: 'scenes' };
    P.defaults.colorReveal = P.defaults.colorReveal || 'scribble';
    stage.style.width = P.width + 'px'; stage.style.height = P.height + 'px';
    stage.innerHTML = '';
    state.scenes = []; scribCanvases.clear();
    const board = document.createElement('div'); board.className = 'board'; stage.appendChild(board); state.board = board;
    const bg = makeBoard(P.board.style, P.board.color || (P.board.style === 'white' ? P.defaults.background : null));
    state.bg = bg;
    P.scenes.forEach((sc) => {
      const sdiv = document.createElement('div'); sdiv.className = 'scene';
      sdiv.style.width = P.width + 'px'; sdiv.style.height = P.height + 'px';
      if (sc.backgroundImage) { sdiv.style.backgroundImage = `url(${sc.backgroundImage})`; }
      const cam = document.createElement('div'); cam.className = 'cam'; sdiv.appendChild(cam);
      const srec = { sc, div: sdiv, cam, els: [] };
      board.appendChild(sdiv); state.scenes.push(srec);
    });
    layoutScenes();
    const pan = P.board.layout === 'pan' && state.scenes.length > 1;
    const bb = state.boardBox;
    board.style.left = '0px'; board.style.top = '0px'; board.style.transform = '';
    if (pan) { board.style.background = bg.css; board.style.width = bb.w + 'px'; board.style.height = bb.h + 'px'; board.style.left = bb.x + 'px'; board.style.top = bb.y + 'px'; board.style.transformOrigin = `${-bb.x}px ${-bb.y}px`; stage.style.background = bg.color; }
    else { board.style.width = P.width + 'px'; board.style.height = P.height + 'px'; stage.style.background = bg.css; }
    state.scenes.forEach((s) => {
      s.div.style.left = (s.off.x - (pan ? bb.x : 0)) + 'px'; s.div.style.top = (s.off.y - (pan ? bb.y : 0)) + 'px';
      s.div.style.background = pan ? 'transparent' : (s.sc.background || bg.css);
    });
    let done = 0; const totalEls = state.scenes.reduce((a, s) => a + s.sc.elements.length, 0);
    for (const srec of state.scenes) for (const e of srec.sc.elements) { if (window.doodleProgress) window.doodleProgress(done, totalEls); const r = await buildElement(srec.sc, e); srec.cam.appendChild(r.div); srec.els.push(r); done++; }
    // measure now that everything is attached (+ canvas paths / colour layer for paint())
    const fillLoads = [];
    const sr = stage.getBoundingClientRect(); const k = sr.width / P.width || 1;
    state.scenes.forEach((s) => s.els.forEach((r) => {
      if (r.kind === 'drawing') {
        r.strokes.forEach((st) => { st.len = st.p.getTotalLength(); st.p.style.strokeDasharray = st.len; st.p.style.strokeDashoffset = st.len; if (typeof Path2D !== 'undefined') st.path2d = new Path2D(st.p.getAttribute('d')); });
        r.totalLen = r.strokes.reduce((a, s) => a + s.len, 0);
        makeScribble(r);
        if (r.fillLayer && r.e.svg) {
          const [vx, vy, vw, vh] = r.vb;
          const norm = r.e.svg.replace(/<svg([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${vw}" height="${vh}">`);
          const im = new Image(); r.fillImg = im;
          fillLoads.push(new Promise((ok) => { im.onload = ok; im.onerror = ok; im.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(norm))); }));
        }
      }
      if (r.kind === 'text') {
        const ox = s.off.x, oy = s.off.y;
        const measure = (el) => { const b = el.getBoundingClientRect(); return { left: (b.left - sr.left) / k - ox, right: (b.right - sr.left) / k - ox, top: (b.top - sr.top) / k - oy, width: b.width / k, height: b.height / k }; };
        r.lines.forEach((l) => { l.rect = measure(l.el); });
        r.words.forEach((w) => { w.rect = measure(w.el); });
      }
    }));
    // hand
    baseHand = await loadImage(P.hand.src).catch(() => null);
    handVariants.clear();
    hand.src = P.hand.src; hand.dataset.color = '';
    const hs = P.hand.height;
    hand.style.height = hs + 'px';
    hand.style.width = 'auto';
    hand.dataset.tipx = P.hand.tip[0] * (hs / P.hand.naturalHeight);
    hand.dataset.tipy = P.hand.tip[1] * (hs / P.hand.naturalHeight);
    hand.style.transformOrigin = `${hand.dataset.tipx}px ${hand.dataset.tipy}px`;
    hand.style.display = P.hand.hidden ? 'none' : 'block';
    const result = { ok: true, strokes: state.scenes.map((s) => s.els.map((r) => r.strokes.length)) };
    const imgs = [hand, ...stage.querySelectorAll('img')];
    return Promise.all([...imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())), ...fillLoads]).then(() => result);
  }

  // ---------- seeking ----------
  const handState = { lastT: -1, tilt: 0 };
  let lastHand = { visible: false };
  function placeHand(pt, { visible, lifted = false, tilt = 0, opacity = 1, color = null }) {
    lastHand = visible ? { visible: true, x: pt.x, y: pt.y, lifted, tilt, opacity, color, tipx: parseFloat(hand.dataset.tipx), tipy: parseFloat(hand.dataset.tipy), height: P.hand.height } : { visible: false };
    if (!visible) { hand.style.opacity = 0; return; }
    const v = color ? tintHand(color) : null; const want = v && v.url ? v.url : P.hand.src;
    if (hand.dataset.color !== (v && v.url ? color : '')) { hand.src = want; hand.dataset.color = v && v.url ? color : ''; }
    hand.style.opacity = opacity;
    const tx = pt.x - parseFloat(hand.dataset.tipx), ty = pt.y - parseFloat(hand.dataset.tipy);
    hand.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${lifted ? 1.035 : 1})`;
    hand.style.filter = lifted ? 'drop-shadow(18px 22px 16px rgba(0,0,0,0.22))' : 'drop-shadow(9px 11px 9px rgba(0,0,0,0.30))';
  }

  // element progress p -> { phase: 'outline'|'fill', q: progress inside the phase }
  function phaseOf(r, p) {
    if (r.scrib) { return p < OUTLINE_SHARE ? { phase: 'outline', q: p / OUTLINE_SHARE } : { phase: 'fill', q: (p - OUTLINE_SHARE) / (1 - OUTLINE_SHARE) }; }
    return { phase: 'outline', q: p };
  }

  // pure: where is the pen for element r at progress p (scene px, before camera)
  function pointAt(r, p) {
    p = clamp(p, 0, 1);
    if (r.kind === 'drawing') {
      const { phase, q } = phaseOf(r, p);
      if (phase === 'fill') return svgPointToScene(r, r.scrib.p.getPointAtLength(clamp(q, 0, 1) * r.scrib.len));
      if (!r.strokes.length) return null;
      const target = q * r.totalLen; let acc = 0;
      for (const st of r.strokes) {
        if (target <= acc + st.len) return svgPointToScene(r, st.p.getPointAtLength(clamp(target - acc, 0, st.len)));
        acc += st.len;
      }
      const last = r.strokes[r.strokes.length - 1];
      return svgPointToScene(r, last.p.getPointAtLength(last.len));
    }
    if (r.kind === 'text') {
      if (r.anim !== 'write') return null;
      const total = r.lines.reduce((a, l) => a + l.weight, 0); let acc = 0; let pt = null;
      for (const l of r.lines) {
        const lp = clamp((p * total - acc) / l.weight, 0, 1); acc += l.weight;
        const rect = l.rect; const rectW = rect.width * (l.el.textContent.trim() ? 1 : 0);
        pt = { x: r.rtl ? rect.right - lp * rectW : rect.left + lp * rectW, y: rect.top + rect.height * 0.72 };
        if (lp < 1) break;
      }
      return pt;
    }
    if (r.kind === 'photo') {
      const rows = 7; const rowF = p * rows, row = Math.min(rows - 1, Math.floor(rowF)), fx = clamp(rowF - row, 0, 1);
      const dir = row % 2 === 0 ? fx : 1 - fx;
      return { x: r.x + dir * r.w, y: r.y + ((row + 0.5) / rows) * r.h };
    }
    return null;
  }
  function penColorAt(r, p) { if (r.kind === 'drawing' && r.scrib && p >= OUTLINE_SHARE) return r.fillColor; return r.penColor; }

  // word animation state for kinetic text: [opacity, scale, dy (in line heights)]
  function wordState(r, k, p) {
    const N = r.words.length; const T = 0.55 * (N - 1) + 1; const wp = clamp(p * T - 0.55 * k, 0, 1);
    if (r.anim === 'pop') return [Math.min(1, wp * 3), wp <= 0 ? 0 : backOut(wp), 0];
    return [wp, 1, (1 - easeOut(wp)) * 0.6];
  }

  // mutate the DOM for element r at progress p
  function drawElement(r, p) {
    if (r.kind === 'drawing') {
      const { phase, q } = phaseOf(r, p);
      const target = (phase === 'outline' ? q : 1) * r.totalLen; let acc = 0;
      for (const st of r.strokes) { st.p.style.strokeDashoffset = st.len - clamp(target - acc, 0, st.len); acc += st.len; }
      if (r.scrib) {
        const fq = phase === 'fill' ? q : 0;
        r.fillLayer.style.opacity = fq > 0 ? 1 : 0;
        if (fq >= 1) r.fillLayer.removeAttribute('mask'); else { r.fillLayer.setAttribute('mask', `url(#scrib${r.id})`); r.scrib.p.style.strokeDashoffset = r.scrib.len * (1 - fq); }
      } else if (r.fillLayer) r.fillLayer.style.opacity = p >= 1 ? 1 : clamp((p - 0.82) / 0.18, 0, 1);
    } else if (r.kind === 'text') {
      if (r.anim !== 'write') {
        r.words.forEach((w, k) => { const [op, s, dy] = wordState(r, k, p); w.el.style.opacity = op; w.el.style.transform = `translateY(${(dy * w.rect.height).toFixed(1)}px) scale(${s.toFixed(3)})`; });
        return;
      }
      const total = r.lines.reduce((a, l) => a + l.weight, 0); let acc = 0;
      for (const l of r.lines) {
        const lp = clamp((p * total - acc) / l.weight, 0, 1); acc += l.weight;
        l.el.style.clipPath = r.rtl ? `inset(0 0 0 ${((1 - lp) * 100).toFixed(2)}%)` : `inset(0 ${((1 - lp) * 100).toFixed(2)}% 0 0)`;
      }
    } else if (r.kind === 'photo') {
      r.img.style.clipPath = `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`;
    }
  }

  // secondary motion once an element is finished: a soft settle "pop", or a slow float
  function motionAt(r, t) {
    const end = r.e.start + r.e.draw; const dt = t - end;
    if (r.motion === 'float' && dt > 0) return { s: 1, dy: 3 * Math.sin(t * 1.5 + r.id), rot: 0.7 * Math.sin(t * 1.1 + r.id * 0.7) };
    if (r.motion === 'pop' && dt > 0 && dt < 0.42) return { s: 1 + 0.035 * Math.sin(Math.PI * dt / 0.42), dy: 0, rot: 0 };
    return null;
  }

  function svgPointToScene(r, pt) {
    const [vx, vy, vw, vh] = r.vb; const s = r.scale;
    const ox = (r.w - vw * s) / 2, oy = (r.h - vh * s) / 2;
    return { x: r.x + ox + (pt.x - vx) * s, y: r.y + oy + (pt.y - vy) * s };
  }

  function applyCamera(srec, t) {
    const sc = srec.sc; const cam = sc.camera;
    if (!cam) { srec.cam.style.transform = ''; srec.camNumbers = { scale: 1, tx: 0, ty: 0 }; return (p) => p; }
    const p = easeInOut(clamp((t - sc.start) / Math.max(0.001, sc.end - sc.start), 0, 1));
    const from = cam.from || { scale: 1, x: 50, y: 50 }, to = cam.to || from;
    const scale = lerp(from.scale ?? 1, to.scale ?? 1, p);
    const cx = lerp(from.x ?? 50, to.x ?? 50, p) / 100 * P.width, cy = lerp(from.y ?? 50, to.y ?? 50, p) / 100 * P.height;
    const tx = P.width / 2 - cx * scale, ty = P.height / 2 - cy * scale;
    srec.cam.style.transformOrigin = '0 0';
    srec.cam.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    srec.camNumbers = { scale, tx, ty };
    return (pt) => ({ x: pt.x * scale + tx, y: pt.y * scale + ty });
  }

  // board camera (pan layout): which part of the big whiteboard is on screen at time t
  function boardCamAt(t) {
    const n = state.scenes.length; const W = P.width, H = P.height;
    const centre = (i) => ({ x: state.scenes[i].off.x + W / 2, y: state.scenes[i].off.y + H / 2 });
    let i = 0; while (i < n - 1 && t >= state.scenes[i].sc.end) i++;
    let f = centre(i), scale = 1;
    const travel = (a, b, p) => { const u = easeInOut(clamp(p, 0, 1)); f = { x: lerp(centre(a).x, centre(b).x, u), y: lerp(centre(a).y, centre(b).y, u) }; scale = 1 - 0.09 * Math.sin(u * Math.PI); };
    if (i < n - 1 && t >= state.scenes[i].sc.end - PAN_BEFORE) travel(i, i + 1, (t - (state.scenes[i].sc.end - PAN_BEFORE)) / (PAN_BEFORE + PAN_AFTER));
    else if (i > 0 && t < state.scenes[i - 1].sc.end + PAN_AFTER) travel(i - 1, i, (t - (state.scenes[i - 1].sc.end - PAN_BEFORE)) / (PAN_BEFORE + PAN_AFTER));
    return { scale, tx: W / 2 - f.x * scale, ty: H / 2 - f.y * scale, panning: scale < 0.9999 };
  }

  // decide where the hand is at time t: drawing, travelling between strokes (lifted arc), or away
  function handAt(t, camMaps) {
    let active = null, prev = null, next = null;
    state.scenes.forEach((srec, i) => {
      const sc = srec.sc; if (t < sc.start || t >= sc.end) return;
      srec.els.forEach((r) => {
        const e = r.e; const end = e.start + e.draw;
        if (e.until != null && t >= e.until) return;
        if (t >= e.start && t < end) { if (!active || e.start > active.r.e.start) active = { r, i }; }
        else if (end <= t) { if (!prev || end > prev.end) prev = { r, i, end }; }
        else if (e.start > t) { if (!next || e.start < next.r.e.start) next = { r, i }; }
      });
    });
    const map = (o, pt) => camMaps[o.i](pt);
    if (active) {
      const e = active.r.e; const p = (t - e.start) / Math.max(0.001, e.draw);
      const pt = pointAt(active.r, p); if (!pt) return { visible: false };
      const ahead = pointAt(active.r, Math.min(1, p + 0.006)) || pt;
      const ang = Math.atan2(ahead.y - pt.y, ahead.x - pt.x);
      const tiltTarget = Math.hypot(ahead.x - pt.x, ahead.y - pt.y) < 0.5 ? handState.tilt : clamp(5 * Math.sin(ang) - 4 * Math.cos(ang), -8, 8);
      const cont = t > handState.lastT && t - handState.lastT < 0.2;
      handState.tilt = cont ? handState.tilt + (tiltTarget - handState.tilt) * 0.15 : tiltTarget; handState.lastT = t;
      const jx = 1.1 * Math.sin(t * 23.1) + 0.7 * Math.sin(t * 41.3), jy = 1.0 * Math.cos(t * 19.7) + 0.6 * Math.sin(t * 33.9);
      const m = map(active, pt);
      return { visible: true, x: m.x + jx, y: m.y + jy, tilt: handState.tilt, lifted: false, color: penColorAt(active.r, p) };
    }
    if (prev && next && prev.i === next.i && next.r.e.start - prev.end <= 1.6) {
      const a0 = pointAt(prev.r, 1), b0 = pointAt(next.r, 0);
      if (!a0 || !b0) return { visible: false };
      const a = map(prev, a0), b = map(next, b0);
      const u = easeInOut(clamp((t - prev.end) / Math.max(0.001, next.r.e.start - prev.end), 0, 1));
      const liftY = -Math.sin(u * Math.PI) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
      return { visible: true, x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + liftY, tilt: handState.tilt * (1 - u), lifted: true, color: u < 0.5 ? penColorAt(prev.r, 1) : penColorAt(next.r, 0) };
    }
    if (prev && t - prev.end < 0.35) { // lift off and leave
      const a0 = pointAt(prev.r, 1); if (!a0) return { visible: false };
      const a = map(prev, a0); const u = (t - prev.end) / 0.35;
      return { visible: true, x: a.x + 90 * u * u, y: a.y + 70 * u * u, tilt: handState.tilt, lifted: true, opacity: 1 - u, color: penColorAt(prev.r, 1) };
    }
    if (next && next.r.e.start - t < 0.3) { // come in from the bottom-right
      const b0 = pointAt(next.r, 0); if (!b0) return { visible: false };
      const b = map(next, b0); const u = 1 - (next.r.e.start - t) / 0.3; const k = 1 - easeInOut(u);
      return { visible: true, x: b.x + 90 * k, y: b.y + 70 * k, tilt: 0, lifted: true, opacity: u, color: penColorAt(next.r, 0) };
    }
    return { visible: false };
  }

  function elementTransform(r, t) {
    const m = motionAt(r, t); const rot = (r.e.rotate || 0) + (m ? m.rot : 0);
    return { s: m ? m.s : 1, dy: m ? m.dy : 0, rot };
  }

  function seek(t) {
    const TR = P.defaults.transition; const camMaps = [];
    const pan = P.board.layout === 'pan' && state.scenes.length > 1;
    const bc = pan ? boardCamAt(t) : { scale: 1, tx: 0, ty: 0, panning: false };
    state.board.style.transform = pan ? `translate(${bc.tx.toFixed(2)}px,${bc.ty.toFixed(2)}px) scale(${bc.scale.toFixed(4)})` : '';
    state.boardCam = bc;
    state.scenes.forEach((srec, i) => {
      const sc = srec.sc;
      const trIn = pan ? 'cut' : (sc.transition || TR); const dur = trIn === 'cut' ? 0 : P.defaults.transitionDuration;
      let visible;
      if (pan) { // on screen if the scene's rectangle intersects the viewport
        const x0 = (srec.off.x) * bc.scale + bc.tx, y0 = (srec.off.y) * bc.scale + bc.ty, x1 = x0 + P.width * bc.scale, y1 = y0 + P.height * bc.scale;
        visible = x1 > -40 && y1 > -40 && x0 < P.width + 40 && y0 < P.height + 40;
      } else visible = t >= sc.start - dur && t < sc.end + (i < state.scenes.length - 1 ? 0 : 1e9);
      srec.div.style.display = visible ? 'block' : 'none';
      camMaps[i] = (p) => p;
      if (!visible) { srec.paint = null; return; }
      let op = 1, tx = 0;
      if (dur > 0 && i > 0 && t < sc.start + dur) {
        const p = easeInOut(clamp((t - sc.start + dur) / (2 * dur), 0, 1));
        if (trIn === 'fade') op = p; else if (trIn === 'slide') tx = (1 - p) * P.width; else if (trIn === 'slide-up') { tx = 0; srec.div.style.transform = `translateY(${(1 - p) * P.height}px)`; }
      }
      srec.div.style.opacity = op;
      if (trIn !== 'slide-up') srec.div.style.transform = tx ? `translateX(${tx}px)` : '';
      srec.div.style.zIndex = i + 1;
      const local = applyCamera(srec, t);
      camMaps[i] = (pt) => { const q = local(pt); return { x: (q.x + srec.off.x) * bc.scale + bc.tx, y: (q.y + srec.off.y) * bc.scale + bc.ty }; };
      srec.paint = { op, tx, ty: trIn === 'slide-up' && t < sc.start + dur ? (1 - easeInOut(clamp((t - sc.start + dur) / (2 * dur), 0, 1))) * P.height : 0, cam: srec.camNumbers || { scale: 1, tx: 0, ty: 0 } };
      srec.els.forEach((r) => {
        const e = r.e;
        const p = clamp((t - e.start) / Math.max(0.001, e.draw), 0, 1);
        const before = t < e.start; const gone = e.until != null && t >= e.until;
        r.div.style.visibility = before || gone ? 'hidden' : 'visible';
        r._vis = !before && !gone; r._p = p;
        if (!before && !gone) {
          drawElement(r, p);
          const tr = elementTransform(r, t); r._tr = tr;
          r.div.style.transform = (tr.dy ? `translateY(${tr.dy.toFixed(2)}px) ` : '') + (tr.rot ? `rotate(${tr.rot.toFixed(3)}deg) ` : '') + (tr.s !== 1 ? `scale(${tr.s.toFixed(4)})` : '');
        }
      });
    });
    const hs = handAt(t, camMaps);
    if (hs.visible) placeHand(hs, { visible: true, lifted: hs.lifted, tilt: hs.tilt || 0, opacity: hs.opacity ?? 1, color: hs.color || null }); else placeHand(null, { visible: false });
    return true;
  }

  // ---------- canvas painter (browser export path) ----------
  const scribCanvases = new Map();
  function paint(ctx, scale = 1, handImg = null) {
    const W = P.width, H = P.height;
    const pan = P.board.layout === 'pan' && state.scenes.length > 1; const bc = state.boardCam || { scale: 1, tx: 0, ty: 0 };
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (pan) { ctx.fillStyle = state.bg.color; ctx.fillRect(0, 0, W, H); ctx.save(); ctx.translate(bc.tx, bc.ty); ctx.scale(bc.scale, bc.scale); const b = state.boardBox; paintBoard(ctx, state.bg, b.x, b.y, b.w, b.h); ctx.restore(); }
    else paintBoard(ctx, state.bg, 0, 0, W, H);
    state.scenes.forEach((srec) => {
      if (srec.div.style.display === 'none' || !srec.paint) return;
      const { op, tx, ty, cam } = srec.paint;
      ctx.save(); ctx.globalAlpha = op;
      if (pan) { ctx.translate(bc.tx, bc.ty); ctx.scale(bc.scale, bc.scale); ctx.translate(srec.off.x, srec.off.y); }
      else { ctx.translate(tx, ty); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); if (srec.sc.background) { ctx.fillStyle = srec.sc.background; ctx.fillRect(0, 0, W, H); } }
      ctx.translate(cam.tx, cam.ty); ctx.scale(cam.scale, cam.scale);
      srec.els.forEach((r) => {
        if (!r._vis) return; const p = r._p; const e = r.e; const tr = r._tr || { s: 1, dy: 0, rot: e.rotate || 0 };
        ctx.save();
        if (tr.rot || tr.s !== 1 || tr.dy) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; ctx.translate(cx, cy + tr.dy); ctx.rotate(tr.rot * Math.PI / 180); ctx.scale(tr.s, tr.s); ctx.translate(-cx, -cy); }
        if (r.kind === 'drawing') {
          const [vx, vy, vw, vh] = r.vb; const s = r.scale; const ox = (r.w - vw * s) / 2, oy = (r.h - vh * s) / 2;
          ctx.translate(r.x + ox, r.y + oy); ctx.scale(s, s); ctx.translate(-vx, -vy);
          const { phase, q } = phaseOf(r, p);
          if (r.fillImg && r.fillImg.naturalWidth) {
            if (r.scrib) {
              const fq = phase === 'fill' ? q : 0;
              if (fq >= 1) ctx.drawImage(r.fillImg, vx, vy, vw, vh);
              else if (fq > 0 && r.scrib.path2d) {
                let oc = scribCanvases.get(r.id);
                const cw = Math.max(1, Math.round(vw)), ch = Math.max(1, Math.round(vh));
                if (!oc || oc.width !== cw || oc.height !== ch) { oc = document.createElement('canvas'); oc.width = cw; oc.height = ch; scribCanvases.set(r.id, oc); }
                const oc2 = oc.getContext('2d'); oc2.setTransform(1, 0, 0, 1, 0, 0); oc2.globalCompositeOperation = 'source-over'; oc2.clearRect(0, 0, cw, ch);
                oc2.translate(-vx, -vy); oc2.lineCap = 'round'; oc2.lineJoin = 'round'; oc2.lineWidth = r.scrib.band; oc2.strokeStyle = '#fff';
                oc2.setLineDash([fq * r.scrib.len, r.scrib.len + 10]); oc2.stroke(r.scrib.path2d); oc2.setLineDash([]);
                oc2.globalCompositeOperation = 'source-in'; oc2.drawImage(r.fillImg, vx, vy, vw, vh);
                ctx.drawImage(oc, vx, vy, vw, vh);
              }
            } else { const fo = p >= 1 ? 1 : clamp((p - 0.82) / 0.18, 0, 1); if (fo > 0) { ctx.save(); ctx.globalAlpha *= fo; ctx.drawImage(r.fillImg, vx, vy, vw, vh); ctx.restore(); } }
          }
          const target = (phase === 'outline' ? q : 1) * r.totalLen; let acc = 0;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = e.color || P.defaults.strokeColor;
          ctx.lineWidth = parseFloat(r.strokes[0]?.p.getAttribute('stroke-width') || 2);
          if (e.strokeOpacity != null) ctx.globalAlpha *= e.strokeOpacity;
          for (const st of r.strokes) {
            const local = clamp(target - acc, 0, st.len); acc += st.len;
            if (local <= 0.01 || !st.path2d) continue;
            if (local < st.len) { ctx.setLineDash([local, st.len + 10]); ctx.lineDashOffset = 0; } else ctx.setLineDash([]);
            ctx.stroke(st.path2d);
          }
          ctx.setLineDash([]);
        } else if (r.kind === 'text') {
          const t = r.div.querySelector('.text'); const cs = getComputedStyle(t);
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; ctx.fillStyle = cs.color; ctx.textBaseline = 'middle';
          ctx.direction = r.rtl ? 'rtl' : 'ltr'; ctx.textAlign = r.rtl ? 'right' : 'left';
          if (r.anim !== 'write') {
            r.words.forEach((w, k) => {
              const [op2, s, dy] = wordState(r, k, p); if (op2 <= 0.001) return;
              const rect = w.rect; const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
              ctx.save(); ctx.globalAlpha *= op2; ctx.translate(cx, cy + dy * rect.height); ctx.scale(s, s); ctx.translate(-cx, -cy);
              ctx.fillText(w.text, r.rtl ? rect.right : rect.left, rect.top + rect.height * 0.52); ctx.restore();
            });
          } else {
            const total = r.lines.reduce((a, l) => a + l.weight, 0); let acc = 0;
            for (const l of r.lines) {
              const lp = clamp((p * total - acc) / l.weight, 0, 1); acc += l.weight; if (lp <= 0) continue;
              const rect = l.rect; ctx.save(); ctx.beginPath();
              if (r.rtl) ctx.rect(rect.right - lp * rect.width, rect.top - 4, lp * rect.width + 4, rect.height + 8); else ctx.rect(rect.left - 4, rect.top - 4, lp * rect.width + 4, rect.height + 8);
              ctx.clip(); ctx.fillText(l.el.textContent, r.rtl ? rect.right : rect.left, rect.top + rect.height * 0.52); ctx.restore();
            }
          }
        } else if (r.kind === 'photo' && r.img && r.img.naturalWidth) {
          const iw = r.img.naturalWidth, ih = r.img.naturalHeight; const s = Math.min(r.w / iw, r.h / ih); const dw = iw * s, dh = ih * s;
          ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h * p); ctx.clip();
          ctx.drawImage(r.img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
        }
        ctx.restore();
      });
      ctx.restore();
    });
    if (handImg && lastHand.visible && !P.hand.hidden) {
      const hs = lastHand; const v = hs.color ? tintHand(hs.color) : null; const img = v ? v.canvas : handImg;
      const hh = hs.height, hw = hh * (img.width || img.naturalWidth) / (img.height || img.naturalHeight); const s = hs.lifted ? 1.035 : 1;
      ctx.save(); ctx.globalAlpha = hs.opacity ?? 1; ctx.filter = hs.lifted ? 'drop-shadow(18px 22px 16px rgba(0,0,0,0.22))' : 'drop-shadow(9px 11px 9px rgba(0,0,0,0.30))';
      ctx.translate(hs.x, hs.y); ctx.rotate((hs.tilt || 0) * Math.PI / 180); ctx.scale(s, s); ctx.drawImage(img, -hs.tipx, -hs.tipy, hw, hh); ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // timeline facts for the sound design (pen noise while the hand draws, whoosh while the camera pans)
  function timeline() {
    if (!P) return { duration: 0, pen: [], pans: [] };
    const pen = [];
    state.scenes.forEach((s) => s.els.forEach((r) => { if (r.kind === 'text' && r.anim !== 'write') return; pen.push({ start: r.e.start, end: r.e.start + r.e.draw, kind: r.kind === 'text' ? 'write' : (r.e.isShape ? 'shape' : 'draw'), fillFrom: r.scrib ? r.e.start + r.e.draw * OUTLINE_SHARE : null }); }));
    const pans = P.board.layout === 'pan' && state.scenes.length > 1 ? state.scenes.slice(0, -1).map((s) => ({ start: s.sc.end - PAN_BEFORE, end: s.sc.end + PAN_AFTER })) : [];
    return { duration: P.duration, pen, pans };
  }

  window.doodle = { build, seek, paint, svgToStrokes, timeline, handState: () => lastHand, duration: () => (P ? P.duration : 0) };
})();
