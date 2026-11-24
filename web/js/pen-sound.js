/* Doodle — the sound of the marker.
 *
 * Plain JavaScript on Float32Arrays, so the studio page (in-browser export) and the tests in Node
 * run the same code.
 *
 * The old sound was a loop of white noise through a band-pass filter, opened and closed by the
 * pen's speed. While the hand wrote, the tip moves at one steady speed along the line, so the
 * sound was one unbroken hiss ("وش"), loud enough to sit on top of the voice. (A first rework built
 * it from tiny clicks instead; that read as crackle, not as a pen.) What makes a marker sound like
 * a marker is the shape over time, not a new texture:
 *
 *   - a soft friction noise, filtered first and only then shaped, so the shape stays crisp;
 *   - a little brighter when the tip moves fast, darker when it is slow;
 *   - the rhythm of strokes inside a word (a gentle swell, ~5–8 per second, never a click);
 *   - silence when the tip is in the air: between strokes, between words (the engine reports
 *     both as zero speed) and between elements;
 *   - ducked under the voice-over;
 *   - a volume from 0 to 1, where 1 is the old loudness and the studio's default is 0.3
 *     (70% quieter than before).
 */
(function (root) {
  'use strict';
  const SR = 48000;
  const DEFAULT_VOLUME = 0.3;
  // RMS of the old sound while drawing an outline at full speed (white noise → high-pass 1 kHz →
  // band-pass 2.7 kHz Q 0.8 → gain 0.05; measured with biquad() below). Volume 1 is calibrated to this, so the scale means
  // "share of the old loudness".
  const OLD_DRAW_RMS = 0.0127;

  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // RBJ biquad, in place
  function biquad(x, type, f, q, sr) {
    const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  }

  // how loud the pen is allowed to be at each 10 ms step: 1, or less under the voice
  function duckCurve(n, step, voices, depth = 0.3) {
    const d = new Float32Array(n).fill(1); const ramp = 0.12;
    for (const v of voices || []) {
      const a = v.at, b = v.at + v.dur;
      for (let i = Math.max(0, Math.floor((a - ramp) / step)); i < Math.min(n, Math.ceil((b + ramp) / step)); i++) {
        const t = i * step;
        const k = t < a ? (a - t) / ramp : t > b ? (t - b) / ramp : 0; // 0 inside the voice, 1 at the ramp ends
        d[i] = Math.min(d[i], depth + (1 - depth) * Math.min(1, k));
      }
    }
    return d;
  }

  /**
   * The marker track.
   *   curve   { step, speed: Float32Array (px/s), kind: Uint8Array } from window.doodle.penCurve:
   *           kind 0 = pen in the air, 1 = outline, 2 = hand-writing, 3 = colouring
   *   opts    duration (s), volume (0..1, 1 = the old loudness), voices [{ at, dur }] to duck under,
   *           sr, seed
   */
  function penTrack(curve, opts = {}) {
    const sr = opts.sr || SR; const dur = opts.duration ?? curve.speed.length * curve.step;
    const N = Math.max(1, Math.ceil(dur * sr)); const out = new Float32Array(N);
    const volume = Math.max(0, Math.min(1, opts.volume ?? DEFAULT_VOLUME));
    if (!volume || !curve.speed.length) return out;
    const n = curve.speed.length, step = curve.step;
    // per-step loudness and brightness from the tip speed; ~25 ms attack, ~20 ms release
    const env = new Float32Array(n + 1), bright = new Float32Array(n + 1), kindAt = new Uint8Array(n + 1);
    const KIND_GAIN = [0, 1, 0.8, 1.05]; let e = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const k = curve.kind[i]; const v = Math.min(1, curve.speed[i] / 1500);
      const target = k ? KIND_GAIN[k] * Math.pow(v, 0.5) : 0;
      e += (target - e) * (target > e ? 0.35 : 0.45); env[i] = e < 1e-4 ? 0 : e;
      br += ((k ? v : br) - br) * 0.15; bright[i] = br; kindAt[i] = k;
    }
    // two filtered noise beds: a dull one (the body of the tip) and a brighter one (the drag)
    const rnd = rng(opts.seed || 7);
    const low = new Float32Array(N), high = new Float32Array(N);
    for (let s = 0; s < N; s++) { low[s] = rnd() * 2 - 1; high[s] = rnd() * 2 - 1; }
    biquad(low, 'bandpass', 950, 0.8, sr); biquad(high, 'bandpass', 2100, 1.1, sr);
    const duck = duckCurve(n, step, opts.voices);
    // a slow random drift, so two strokes never sound identical
    let drift = 0, driftTarget = 0;
    for (let s = 0; s < N; s++) {
      const t = s / sr; const f = t / step; const i = Math.min(n - 1, Math.floor(f)); const u = Math.min(1, f - i);
      const a = env[i] + (env[i + 1] - env[i]) * u; // interpolated: no 10 ms steps in the sound
      if (a <= 0) continue;
      if (s % 2400 === 0) driftTarget = (rnd() - 0.5) * 0.3;
      drift += (driftTarget - drift) * 0.0004;
      const writing = kindAt[i] === 2;
      const swell = writing
        ? 0.72 + 0.17 * Math.sin(2 * Math.PI * 5.3 * t) + 0.11 * Math.sin(2 * Math.PI * 7.9 * t + 1.3)
        : 0.88 + 0.08 * Math.sin(2 * Math.PI * 3.1 * t) + 0.04 * Math.sin(2 * Math.PI * 6.7 * t + 0.7);
      const b = 0.35 + 0.5 * bright[i];
      out[s] = a * swell * (1 + drift) * duck[i] * (low[s] * (1 - b) + high[s] * b);
    }
    biquad(out, 'lowpass', 5200, 0.7, sr);
    const gain = volume * OLD_DRAW_RMS / NEW_DRAW_RMS;
    for (let s = 0; s < N; s++) out[s] *= gain;
    return out;
  }

  // RMS of penTrack's raw output (before the gain) for an outline drawn at full speed, measured once
  // with a constant curve; keeps "volume 1 = the old loudness" true when the texture is tuned
  let NEW_DRAW_RMS = 1;
  {
    const n = 200, curve = { step: 0.01, speed: new Float32Array(n).fill(1500), kind: new Uint8Array(n).fill(1) };
    const keep = NEW_DRAW_RMS; NEW_DRAW_RMS = OLD_DRAW_RMS; // gain 1 for the measurement
    const y = penTrack(curve, { duration: 2, volume: 1 }); let sum = 0; for (let i = SR * 0.2; i < y.length; i++) sum += y[i] * y[i];
    NEW_DRAW_RMS = Math.sqrt(sum / (y.length - SR * 0.2)) || keep;
  }

  function rms(y, from = 0, to = y.length) { let s = 0; for (let i = from; i < to; i++) s += y[i] * y[i]; return Math.sqrt(s / Math.max(1, to - from)); }

  root.PenSound = { SR, DEFAULT_VOLUME, OLD_DRAW_RMS, penTrack, duckCurve, biquad, rms };
})(typeof window !== 'undefined' ? window : globalThis);
