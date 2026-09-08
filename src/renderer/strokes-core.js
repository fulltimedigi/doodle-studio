/* Shared centerline-stroke logic (browser + Node). Pure functions on typed arrays.
   Input: grayscale Float32Array (0..255), width, height. Output: ordered polylines + pen width.
   Skeletonisation itself is done by skeleton-tracing-js (MIT), exposed as window.TraceSkeleton in the
   browser or passed in explicitly in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StrokesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function inkMask(gray, w, h, threshold) {
    const r = Math.max(8, Math.round(Math.min(w, h) * 0.02));
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + (x - 1)]; integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x] + row; } }
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const g = gray[y * w + x];
      mask[y * w + x] = g < threshold && g < mean - 12 ? 1 : 0;
    }
    return mask;
  }

  function dilate(mask, w, h, k) {
    const out = new Uint8Array(w * h); const r = k >> 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; } }
    }
    return out;
  }

  function label(mask, w, h) {
    const lab = new Int32Array(w * h); let n = 0; const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      n++; lab[i] = n; stack.push(i);
      while (stack.length) {
        const p = stack.pop(); const x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx; if (mask[q] && !lab[q]) { lab[q] = n; stack.push(q); }
        }
      }
    }
    return lab;
  }

  function strokeWidth(mask, w, h, lines) {
    const samples = [];
    for (const l of lines) for (let i = 0; i < l.length; i += 3) {
      const x = Math.round(l[i][0]), y = Math.round(l[i][1]); let rad = 0;
      while (rad < 20) { rad++; let ok = true; for (const [dx, dy] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) { ok = false; break; } } if (!ok) break; }
      samples.push(rad);
    }
    samples.sort((a, b) => a - b);
    return samples.length ? Math.max(1.5, samples[samples.length >> 1] * 2 - 1) : 3;
  }

  function mergeChains(lines, tol) {
    lines = lines.filter((l) => l.length > 1);
    let changed = true;
    while (changed) {
      changed = false; const out = []; const used = new Array(lines.length).fill(false);
      for (let i = 0; i < lines.length; i++) {
        if (used[i]) continue; used[i] = true; let cur = lines[i].slice(); let merged = true;
        while (merged) {
          merged = false;
          for (let j = 0; j < lines.length; j++) {
            if (used[j]) continue; const b = lines[j];
            if (dist(cur[cur.length - 1], b[0]) <= tol) { cur = cur.concat(b.slice(1)); used[j] = true; merged = changed = true; break; }
            if (dist(cur[cur.length - 1], b[b.length - 1]) <= tol) { cur = cur.concat(b.slice(0, -1).reverse()); used[j] = true; merged = changed = true; break; }
            if (dist(cur[0], b[b.length - 1]) <= tol) { cur = b.slice(0, -1).concat(cur); used[j] = true; merged = changed = true; break; }
            if (dist(cur[0], b[0]) <= tol) { cur = b.slice(1).reverse().concat(cur); used[j] = true; merged = changed = true; break; }
          }
        }
        out.push(cur);
      }
      lines = out;
    }
    return lines;
  }

  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1]; let maxD = 0, idx = 0;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
    for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len; if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > eps) return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
    return [a, b];
  }
  const arcLen = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += dist(l[i - 1], l[i]); return s; };

  function orderStrokes(lines, mask, w, h) {
    if (!lines.length) return lines;
    const k = Math.max(9, Math.round(Math.min(w, h) * 0.035)) | 1;
    const lab = label(dilate(mask, w, h, k), w, h);
    const groups = new Map();
    for (const l of lines) {
      const [mx, my] = l[l.length >> 1];
      const g = lab[Math.min(h - 1, Math.round(my)) * w + Math.min(w - 1, Math.round(mx))];
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l);
    }
    const key = (ls) => { let minx = 1e9, miny = 1e9; for (const l of ls) for (const p of l) { if (p[0] < minx) minx = p[0]; if (p[1] < miny) miny = p[1]; } return minx * 0.65 + miny * 0.35; };
    const ordered = []; let cur = [0, 0];
    for (const ls of [...groups.values()].sort((a, b) => key(a) - key(b))) {
      const remaining = ls.slice();
      while (remaining.length) {
        let best = Infinity, bi = -1, brev = false;
        for (let i = 0; i < remaining.length; i++) { const l = remaining[i]; const d0 = dist(cur, l[0]), d1 = dist(cur, l[l.length - 1]); const d = Math.min(d0, d1); if (d < best) { best = d; bi = i; brev = d1 < d0; } }
        let l = remaining.splice(bi, 1)[0]; if (brev) l = l.slice().reverse();
        ordered.push(l); cur = l[l.length - 1];
      }
    }
    return ordered;
  }

  /** gray: Float32Array; traceSkeleton: fn(boolArray,w,h)->{polylines}. Returns {lines, width}. */
  function extract(gray, w, h, traceSkeleton, { threshold = 150, minLen = 12, simplifyEps = 1.2 } = {}) {
    const mask = inkMask(gray, w, h, threshold);
    const { polylines } = traceSkeleton(Array.from(mask), w, h);
    let lines = mergeChains(polylines.map((p) => p.map(([x, y]) => [x, y])), 2.5);
    lines = lines.filter((l) => arcLen(l) >= minLen).map((l) => simplify(l, simplifyEps));
    const width = strokeWidth(mask, w, h, lines);
    lines = orderStrokes(lines, mask, w, h);
    return { lines, width, totalLength: lines.reduce((a, l) => a + arcLen(l), 0) };
  }

  return { extract, inkMask, mergeChains, simplify, orderStrokes, strokeWidth, arcLen };
});
