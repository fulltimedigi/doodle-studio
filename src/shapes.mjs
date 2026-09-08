// Hand-drawn looking primitive shapes as SVG. Deterministic jitter (seeded) so re-renders match.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function jitterPath(points, r, amp, closed) {
  const pts = points.map(([x, y]) => [x + (r() - 0.5) * amp, y + (r() - 0.5) * amp]);
  if (closed) pts.push(pts[0]);
  return 'M' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L');
}
function sample(fn, n) { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; }

export function shapeSvg(e, seed = 7, box = { w: 400, h: 400 }) {
  const r = rng(seed);
  // drawn at the element's real pixel size so nothing is stretched and stroke widths stay true
  const W = Math.max(8, Math.round(box.w)), H = Math.max(8, Math.round(box.h));
  const amp = e.rough === 0 ? 0 : (e.rough ?? Math.max(1.5, Math.min(W, H) * 0.012));
  const stroke = e.color || '#222';
  let d = '';
  const pad = Math.max(4, Math.min(W, H) * 0.03);
  switch (e.shape) {
    case 'rect': case 'box':
      d = jitterPath(sample((t) => {
        const per = t * 4; const side = Math.floor(per), f = per - side;
        const x0 = pad, y0 = pad, x1 = W - pad, y1 = H - pad;
        if (side === 0) return [x0 + f * (x1 - x0), y0]; if (side === 1) return [x1, y0 + f * (y1 - y0)];
        if (side === 2) return [x1 - f * (x1 - x0), y1]; return [x0, y1 - f * (y1 - y0)];
      }, 64), r, amp, true); break;
    case 'circle': case 'ellipse':
      d = jitterPath(sample((t) => [W / 2 + (W / 2 - pad) * Math.cos(t * Math.PI * 2 - Math.PI / 2), H / 2 + (H / 2 - pad) * Math.sin(t * Math.PI * 2 - Math.PI / 2)], 72), r, amp, true);
      // a second short loop, like a real marker overshoot
      d += ' ' + jitterPath(sample((t) => [W / 2 + (W / 2 - pad - 2) * Math.cos(t * Math.PI * 0.6 - Math.PI / 2), H / 2 + (H / 2 - pad - 2) * Math.sin(t * Math.PI * 0.6 - Math.PI / 2)], 20), r, amp, false);
      break;
    case 'line':
      d = jitterPath(sample((t) => [pad + t * (W - 2 * pad), H / 2], 24), r, amp, false); break;
    case 'underline':
      d = jitterPath(sample((t) => [pad + t * (W - 2 * pad), H / 2 + Math.sin(t * Math.PI) * 6], 24), r, amp, false)
        + ' ' + jitterPath(sample((t) => [W - pad - t * (W - 2 * pad) * 0.9, H / 2 + 14 + Math.sin(t * Math.PI) * 4], 20), r, amp, false); break;
    case 'arrow': {
      const y = H / 2, x0 = pad, x1 = W - pad, hl = Math.min(W * 0.28, H * 0.5);
      d = jitterPath(sample((t) => [x0 + t * (x1 - x0), y + Math.sin(t * Math.PI * 2) * 4], 30), r, amp, false)
        + ' ' + jitterPath([[x1 - hl, y - hl * 0.6], [x1, y], [x1 - hl, y + hl * 0.6]], r, amp, false); break;
    }
    case 'check':
      d = jitterPath(sample((t) => t < 0.35 ? [W * 0.12 + (t / 0.35) * W * 0.26, H * 0.52 + (t / 0.35) * H * 0.33] : [W * 0.38 + ((t - 0.35) / 0.65) * W * 0.52, H * 0.85 - ((t - 0.35) / 0.65) * H * 0.72], 30), r, amp, false); break;
    case 'cross': case 'x':
      d = jitterPath(sample((t) => [W * 0.15 + t * W * 0.7, H * 0.15 + t * H * 0.7], 16), r, amp, false)
        + ' ' + jitterPath(sample((t) => [W * 0.85 - t * W * 0.7, H * 0.15 + t * H * 0.7], 16), r, amp, false); break;
    case 'highlight':
      // one wide translucent marker stroke, drawn left to right behind the text
      d = jitterPath(sample((t) => [H * 0.36 + t * (W - H * 0.72), H / 2 + Math.sin(t * Math.PI) * H * 0.02], 30), r, amp, false); break;
    case 'bubble': {
      d = jitterPath(sample((t) => [W / 2 + (W / 2 - pad) * Math.cos(t * Math.PI * 2), H * 0.42 + (H * 0.38) * Math.sin(t * Math.PI * 2)], 72), r, amp, true)
        + ' ' + jitterPath([[W * 0.3, H * 0.76], [W * 0.22, H - pad], [W * 0.46, H * 0.79]], r, amp, false); break;
    }
    default:
      d = jitterPath(sample((t) => [pad + t * (W - 2 * pad), H / 2], 24), r, amp, false);
  }
  const sw = e.shape === 'highlight' ? Math.round(H * 0.72) : (e.strokeWidth || 9);
  const op = e.shape === 'highlight' ? 0.45 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-opacity="${op}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
