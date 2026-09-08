/* doodle-studio in-browser engine. Deterministic: window.doodle.seek(t) sets the whole
   picture for time t (seconds). Node drives it frame by frame and screenshots. */
(function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const isRTL = (s) => /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(s);

  let P = null;            // compiled project
  const stage = document.getElementById('stage');
  const hand = document.getElementById('hand');
  const state = { scenes: [] };

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
      // matrix from element space to root viewBox space
      const toRoot = rootCTM.inverse().multiply(m);
      const step = Math.max(1.2, len / 600);
      const pts = [];
      for (let d = 0; d <= len; d += step) {
        const p = el.getPointAtLength(d);
        const x = toRoot.a * p.x + toRoot.c * p.y + toRoot.e;
        const y = toRoot.b * p.x + toRoot.d * p.y + toRoot.f;
        pts.push([x, y]);
      }
      const last = el.getPointAtLength(len);
      pts.push([toRoot.a * last.x + toRoot.c * last.y + toRoot.e, toRoot.b * last.x + toRoot.d * last.y + toRoot.f]);
      // split into sub-strokes on big jumps (subpaths / moveTo)
      let cur = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (Math.hypot(x1 - x0, y1 - y0) > step * 6) { if (cur.length > 1) paths.push(cur); cur = [pts[i]]; }
        else cur.push(pts[i]);
      }
      if (cur.length > 1) paths.push(cur);
    });
    holder.remove();
    // order strokes roughly top-left -> bottom-right so the hand moves naturally
    paths.sort((a, b) => (a[0][1] * 0.35 + a[0][0] * 0.65) - (b[0][1] * 0.35 + b[0][0] * 0.65));
    return { paths: paths.map((pts) => 'M' + pts.map(([x, y]) => x.toFixed(2) + ' ' + y.toFixed(2)).join('L')), vb };
  }

  // ---------- in-browser centerline tracing (raster or filled SVG -> ordered pen strokes) ----------
  function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
  async function traceCenterline(src, opts) {
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
    const minLen = Math.max(10, Math.min(w, h) * 0.012);
    const { lines, width } = window.StrokesCore.extract(gray, w, h, window.TraceSkeleton.fromBoolArray, { threshold: opts.threshold || 150, minLen });
    const paths = lines.map((l) => `<path d="M${l.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L')}"/>`).join('');
    let fill = '';
    if (opts.fill !== 'none') {
      // colour layer: the original picture with its (near-)white paper made transparent so it sits on any background
      for (let i = 0; i < w * h; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mn > 225 && mx - mn < 22) d[i * 4 + 3] = Math.round(clamp((248 - mn) / 23, 0, 1) * 255);
      }
      ctx.putImageData(id, 0, 0);
      fill = `<image href="${c.toDataURL('image/png')}" x="0" y="0" width="${w}" height="${h}"/>`;
    }
    const penW = width * 1.25;
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${fill}<g class="strokes" fill="none" stroke="${opts.color || '#1a1a1a'}" stroke-width="${penW.toFixed(2)}">${paths}</g></svg>`, width: penW, size: [w, h] };
  }

  // ---------- building ----------
  function px(v, total) { return typeof v === 'string' && v.endsWith('%') ? parseFloat(v) / 100 * total : +v; }

  async function buildElement(sc, e) {
    const W = P.width, H = P.height;
    if (e.kind === 'drawing' && e.trace === 'centerline') {
      const src = e.src || ('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(e.svg))));
      const t = await traceCenterline(src, { threshold: e.threshold, color: e.color || P.defaults.strokeColor, fill: e.style === 'line' ? 'none' : 'original', traceSize: e.traceSize });
      e.svg = t.svg; e.style = e.style === 'line' ? 'line' : 'color';
      if (!e.strokeWidth) { const s = Math.min(px(e.w, W) / t.size[0], px(e.h, H) / t.size[1]); e.strokeWidth = Math.max(3, t.width * s * (e.strokeScale || 1)); }
    }
    const div = document.createElement('div');
    div.className = 'el';
    const x = px(e.x, W), y = px(e.y, H), w = px(e.w, W), h = px(e.h, H);
    div.style.left = x + 'px'; div.style.top = y + 'px'; div.style.width = w + 'px'; div.style.height = h + 'px';
    if (e.rotate) div.style.transform = `rotate(${e.rotate}deg)`;
    const rec = { e, div, x, y, w, h, kind: e.kind, strokes: [], totalLen: 0 };

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
      // each line is sized to its own ink so the reveal (and the hand) follow the real text edge
      t.style.alignItems = align === 'center' ? 'center' : ((align === 'right') === rtl ? 'flex-start' : 'flex-end');
      const lines = String(e.content).split('\n');
      rec.lines = lines.map((s) => { const l = document.createElement('span'); l.className = 'line'; l.textContent = s || ' '; t.appendChild(l); return { el: l, weight: Math.max(1, s.length) }; });
      rec.rtl = rtl;
      div.appendChild(t);
    } else if (e.kind === 'drawing') {
      const { paths, vb } = svgToStrokes(e.svg, { w, h });
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', vb.join(' '));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      // fill layer = the original artwork (colors), revealed after the outline is drawn
      if (e.style !== 'line') {
        const g = document.createElementNS(svgNS, 'g'); g.setAttribute('class', 'fill');
        const holder = document.createElement('div'); holder.innerHTML = e.svg;
        const inner = holder.querySelector('svg');
        if (inner) { inner.removeAttribute('width'); inner.removeAttribute('height'); inner.setAttribute('viewBox', vb.join(' ')); inner.setAttribute('x', 0); inner.setAttribute('y', 0); inner.setAttribute('width', vb[2]); inner.setAttribute('height', vb[3]); g.appendChild(inner); }
        svg.appendChild(g); rec.fillLayer = g;
      }
      const gs = document.createElementNS(svgNS, 'g'); gs.setAttribute('class', 'strokes');
      // stroke width in viewBox units so it looks the same regardless of icon size
      const scale = Math.min(w / vb[2], h / vb[3]);
      const sw = (e.strokeWidth || P.defaults.strokeWidth) / scale;
      paths.forEach((d) => {
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d); p.setAttribute('stroke', e.color || P.defaults.strokeColor); p.setAttribute('stroke-width', sw);
        if (e.strokeOpacity != null && e.strokeOpacity !== 1) p.setAttribute('stroke-opacity', e.strokeOpacity);
        gs.appendChild(p);
        const len = p.getTotalLength ? 0 : 0; // computed after attach
        rec.strokes.push({ p, len: 0 });
      });
      svg.appendChild(gs); div.appendChild(svg); rec.svg = svg; rec.vb = vb; rec.scale = scale;
    } else if (e.kind === 'photo') {
      const img = document.createElement('img'); img.className = 'photo'; img.src = e.src; div.appendChild(img); rec.img = img;
    }
    return rec;
  }

  async function build(project) {
    P = project;
    stage.style.width = P.width + 'px'; stage.style.height = P.height + 'px';
    stage.innerHTML = '';
    state.scenes = [];
    P.scenes.forEach((sc) => {
      const sdiv = document.createElement('div'); sdiv.className = 'scene';
      sdiv.style.background = sc.background || P.defaults.background;
      if (sc.backgroundImage) { sdiv.style.backgroundImage = `url(${sc.backgroundImage})`; }
      const cam = document.createElement('div'); cam.className = 'cam'; sdiv.appendChild(cam);
      const srec = { sc, div: sdiv, cam, els: [] };
      stage.appendChild(sdiv); state.scenes.push(srec);
    });
    for (const srec of state.scenes) for (const e of srec.sc.elements) { const r = await buildElement(srec.sc, e); srec.cam.appendChild(r.div); srec.els.push(r); }
    // measure stroke lengths now that everything is attached (+ canvas paths / colour layer for paint())
    const fillLoads = [];
    state.scenes.forEach((s) => s.els.forEach((r) => {
      if (r.kind === 'drawing') {
        r.strokes.forEach((st) => { st.len = st.p.getTotalLength(); st.p.style.strokeDasharray = st.len; st.p.style.strokeDashoffset = st.len; if (typeof Path2D !== 'undefined') st.path2d = new Path2D(st.p.getAttribute('d')); });
        r.totalLen = r.strokes.reduce((a, s) => a + s.len, 0);
        if (r.fillLayer && r.e.svg) {
          const [vx, vy, vw, vh] = r.vb;
          const norm = r.e.svg.replace(/<svg([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${vw}" height="${vh}">`);
          const im = new Image(); r.fillImg = im;
          fillLoads.push(new Promise((ok) => { im.onload = ok; im.onerror = ok; im.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(norm))); }));
        }
      }
      if (r.kind === 'text') {
        // measure relative to the stage so the stage may be placed/scaled anywhere in the page
        const sr = stage.getBoundingClientRect(); const k = sr.width / P.width || 1;
        r.lines.forEach((l) => { const b = l.el.getBoundingClientRect(); l.rect = { left: (b.left - sr.left) / k, right: (b.right - sr.left) / k, top: (b.top - sr.top) / k, width: b.width / k, height: b.height / k }; });
      }
    }));
    hand.src = P.hand.src;
    const hs = P.hand.height;
    hand.style.height = hs + 'px';
    hand.style.width = 'auto';
    hand.dataset.tipx = P.hand.tip[0] * (hs / P.hand.naturalHeight);
    hand.dataset.tipy = P.hand.tip[1] * (hs / P.hand.naturalHeight);
    hand.style.transformOrigin = `${hand.dataset.tipx}px ${hand.dataset.tipy}px`;
    hand.style.display = P.hand.hidden ? 'none' : 'block';
    const result = { ok: true, strokes: state.scenes.map((s) => s.els.map((r) => r.strokes.length)) };
    // make sure the hand bitmap and every embedded image are decoded before the first frame
    const imgs = [hand, ...stage.querySelectorAll('img')];
    return Promise.all([...imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())), ...fillLoads]).then(() => result);
  }

  // ---------- seeking ----------
  const handState = { lastT: -1, tilt: 0 };
  let lastHand = { visible: false };
  function placeHand(pt, { visible, lifted = false, tilt = 0, opacity = 1 }) {
    lastHand = visible ? { visible: true, x: pt.x, y: pt.y, lifted, tilt, opacity, tipx: parseFloat(hand.dataset.tipx), tipy: parseFloat(hand.dataset.tipy), height: P.hand.height } : { visible: false };
    if (!visible) { hand.style.opacity = 0; return; }
    hand.style.opacity = opacity;
    const tx = pt.x - parseFloat(hand.dataset.tipx), ty = pt.y - parseFloat(hand.dataset.tipy);
    hand.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${lifted ? 1.035 : 1})`;
    hand.style.filter = lifted ? 'drop-shadow(18px 22px 16px rgba(0,0,0,0.22))' : 'drop-shadow(9px 11px 9px rgba(0,0,0,0.30))';
  }

  // pure: where is the pen for element r at progress p (stage px, before camera)
  function pointAt(r, p) {
    p = clamp(p, 0, 1);
    if (r.kind === 'drawing') {
      if (!r.strokes.length) return null;
      const target = p * r.totalLen; let acc = 0;
      for (const st of r.strokes) {
        if (target <= acc + st.len) return svgPointToStage(r, st.p.getPointAtLength(clamp(target - acc, 0, st.len)));
        acc += st.len;
      }
      const last = r.strokes[r.strokes.length - 1];
      return svgPointToStage(r, last.p.getPointAtLength(last.len));
    }
    if (r.kind === 'text') {
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

  // mutate the DOM for element r at progress p
  function drawElement(r, p) {
    if (r.kind === 'drawing') {
      const target = p * r.totalLen; let acc = 0;
      for (const st of r.strokes) { st.p.style.strokeDashoffset = st.len - clamp(target - acc, 0, st.len); acc += st.len; }
      if (r.fillLayer) r.fillLayer.style.opacity = p >= 1 ? 1 : clamp((p - 0.82) / 0.18, 0, 1);
    } else if (r.kind === 'text') {
      const total = r.lines.reduce((a, l) => a + l.weight, 0); let acc = 0;
      for (const l of r.lines) {
        const lp = clamp((p * total - acc) / l.weight, 0, 1); acc += l.weight;
        l.el.style.clipPath = r.rtl ? `inset(0 0 0 ${((1 - lp) * 100).toFixed(2)}%)` : `inset(0 ${((1 - lp) * 100).toFixed(2)}% 0 0)`;
      }
    } else if (r.kind === 'photo') {
      r.img.style.clipPath = `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`;
    }
  }

  function svgPointToStage(r, pt) {
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
      return { visible: true, x: m.x + jx, y: m.y + jy, tilt: handState.tilt, lifted: false };
    }
    if (prev && next && prev.i === next.i && next.r.e.start - prev.end <= 1.6) {
      const a = map(prev, pointAt(prev.r, 1)), b = map(next, pointAt(next.r, 0));
      if (!a || !b) return { visible: false };
      const u = easeInOut(clamp((t - prev.end) / Math.max(0.001, next.r.e.start - prev.end), 0, 1));
      const liftY = -Math.sin(u * Math.PI) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
      return { visible: true, x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + liftY, tilt: handState.tilt * (1 - u), lifted: true };
    }
    if (prev && t - prev.end < 0.35) { // lift off and leave
      const a = map(prev, pointAt(prev.r, 1)); if (!a) return { visible: false };
      const u = (t - prev.end) / 0.35;
      return { visible: true, x: a.x + 90 * u * u, y: a.y + 70 * u * u, tilt: handState.tilt, lifted: true, opacity: 1 - u };
    }
    if (next && next.r.e.start - t < 0.3) { // come in from the bottom-right
      const b = map(next, pointAt(next.r, 0)); if (!b) return { visible: false };
      const u = 1 - (next.r.e.start - t) / 0.3; const k = 1 - easeInOut(u);
      return { visible: true, x: b.x + 90 * k, y: b.y + 70 * k, tilt: 0, lifted: true, opacity: u };
    }
    return { visible: false };
  }

  function seek(t) {
    const TR = P.defaults.transition; const camMaps = [];
    state.scenes.forEach((srec, i) => {
      const sc = srec.sc;
      const trIn = sc.transition || TR; const dur = trIn === 'cut' ? 0 : P.defaults.transitionDuration;
      const visible = t >= sc.start - dur && t < sc.end + (i < state.scenes.length - 1 ? 0 : 1e9);
      srec.div.style.display = visible ? 'block' : 'none';
      camMaps[i] = (p) => p;
      if (!visible) return;
      let op = 1, tx = 0;
      if (dur > 0 && i > 0 && t < sc.start + dur) {
        const p = easeInOut(clamp((t - sc.start + dur) / (2 * dur), 0, 1));
        if (trIn === 'fade') op = p; else if (trIn === 'slide') tx = (1 - p) * P.width; else if (trIn === 'slide-up') { tx = 0; srec.div.style.transform = `translateY(${(1 - p) * P.height}px)`; }
      }
      srec.div.style.opacity = op;
      if (trIn !== 'slide-up') srec.div.style.transform = tx ? `translateX(${tx}px)` : '';
      srec.div.style.zIndex = i + 1;
      camMaps[i] = applyCamera(srec, t);
      srec.paint = { op, tx, ty: trIn === 'slide-up' && t < sc.start + dur ? (1 - easeInOut(clamp((t - sc.start + dur) / (2 * dur), 0, 1))) * P.height : 0, cam: srec.camNumbers || { scale: 1, tx: 0, ty: 0 } };
      srec.els.forEach((r) => {
        const e = r.e;
        const p = clamp((t - e.start) / Math.max(0.001, e.draw), 0, 1);
        const before = t < e.start; const gone = e.until != null && t >= e.until;
        r.div.style.visibility = before || gone ? 'hidden' : 'visible';
        r._vis = !before && !gone; r._p = p;
        if (!before && !gone) drawElement(r, p);
      });
    });
    const hs = handAt(t, camMaps);
    if (hs.visible) placeHand(hs, { visible: true, lifted: hs.lifted, tilt: hs.tilt || 0, opacity: hs.opacity ?? 1 }); else placeHand(null, { visible: false });
    return true;
  }


  // ---------- canvas painter (browser export path) ----------
  function paint(ctx, scale = 1, handImg = null) {
    const W = P.width, H = P.height;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = P.defaults.background; ctx.fillRect(0, 0, W, H);
    state.scenes.forEach((srec) => {
      if (srec.div.style.display === 'none' || !srec.paint) return;
      const { op, tx, ty, cam } = srec.paint;
      ctx.save(); ctx.globalAlpha = op; ctx.translate(tx, ty);
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      ctx.fillStyle = srec.sc.background || P.defaults.background; ctx.fillRect(0, 0, W, H);
      ctx.translate(cam.tx, cam.ty); ctx.scale(cam.scale, cam.scale);
      srec.els.forEach((r) => {
        if (!r._vis) return; const p = r._p; const e = r.e;
        ctx.save();
        if (e.rotate) { ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(e.rotate * Math.PI / 180); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2)); }
        if (r.kind === 'drawing') {
          const [vx, vy, vw, vh] = r.vb; const s = r.scale; const ox = (r.w - vw * s) / 2, oy = (r.h - vh * s) / 2;
          ctx.translate(r.x + ox, r.y + oy); ctx.scale(s, s); ctx.translate(-vx, -vy);
          const fo = r.fillLayer ? (p >= 1 ? 1 : clamp((p - 0.82) / 0.18, 0, 1)) : 0;
          if (fo > 0 && r.fillImg && r.fillImg.naturalWidth) { ctx.save(); ctx.globalAlpha *= fo; ctx.drawImage(r.fillImg, vx, vy, vw, vh); ctx.restore(); }
          const target = p * r.totalLen; let acc = 0;
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
          const total = r.lines.reduce((a, l) => a + l.weight, 0); let acc = 0;
          for (const l of r.lines) {
            const lp = clamp((p * total - acc) / l.weight, 0, 1); acc += l.weight; if (lp <= 0) continue;
            const rect = l.rect; ctx.save(); ctx.beginPath();
            if (r.rtl) ctx.rect(rect.right - lp * rect.width, rect.top - 4, lp * rect.width + 4, rect.height + 8); else ctx.rect(rect.left - 4, rect.top - 4, lp * rect.width + 4, rect.height + 8);
            ctx.clip(); ctx.fillText(l.el.textContent, r.rtl ? rect.right : rect.left, rect.top + rect.height * 0.52); ctx.restore();
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
      const hs = lastHand; const hh = hs.height, hw = hh * (handImg.naturalWidth / handImg.naturalHeight); const s = hs.lifted ? 1.035 : 1;
      ctx.save(); ctx.globalAlpha = hs.opacity ?? 1; ctx.filter = hs.lifted ? 'drop-shadow(18px 22px 16px rgba(0,0,0,0.22))' : 'drop-shadow(9px 11px 9px rgba(0,0,0,0.30))';
      ctx.translate(hs.x, hs.y); ctx.rotate((hs.tilt || 0) * Math.PI / 180); ctx.scale(s, s); ctx.drawImage(handImg, -hs.tipx, -hs.tipy, hw, hh); ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  window.doodle = { build, seek, paint, svgToStrokes, handState: () => lastHand, duration: () => (P ? P.duration : 0) };
})();
