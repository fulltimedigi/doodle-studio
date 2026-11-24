/* Doodle — the sound of the marker.
 *
 * Plain JavaScript on Float32Arrays, so the studio page (in-browser export) and the tests in Node
 * run the same code.
 *
 * The old sound was a loop of white noise through a band-pass filter, opened and closed by the
 * pen's speed: while the hand drew it was one steady hiss ("وش"), loud enough to sit on top of the
 * voice. A marker on a board does not hiss; it scratches: many tiny, uneven catches of the tip on
 * the surface, louder and denser when the tip moves fast, with the rhythm of the strokes in it, and
 * nothing at all when the tip is in the air. So the track is built from short grains of friction:
 *
 *   - grains, not a continuous noise: each is a 2–7 ms burst, their density and strength follow
 *     the tip speed the engine samples every 10 ms (window.doodle.penCurve);
 *   - stroke rhythm: hand-writing pulses at letter rate (~6–9 per second), outlines more slowly;
 *   - silence as soon as the tip lifts (the engine reports a lift as zero speed);
 *   - a darker band (600 Hz – 4.2 kHz) than before, without the 2.7 kHz whistle;
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
   *           taps [seconds] where the marker lands, sr, seed
   */
  function penTrack(curve, opts = {}) {
    const sr = opts.sr || SR; const dur = opts.duration ?? curve.speed.length * curve.step;
    const N = Math.max(1, Math.ceil(dur * sr)); const out = new Float32Array(N);
    const volume = Math.max(0, Math.min(1, opts.volume ?? DEFAULT_VOLUME));
    if (!volume || !curve.speed.length) return out;
    const n = curve.speed.length, step = curve.step;
    // per-step envelope: speed → loudness, by what the pen is doing; fast attack, faster release
    const env = new Float32Array(n), kindAt = new Uint8Array(n); let e = 0;
    const KIND_GAIN = [0, 1, 0.75, 1.1];
    for (let i = 0; i < n; i++) {
      const k = curve.kind[i]; const target = k ? KIND_GAIN[k] * Math.pow(Math.min(1, curve.speed[i] / 1500), 0.6) : 0;
      e += (target - e) * (target > e ? 0.5 : 0.6); // ~15 ms attack, ~12 ms release: quiet the moment the tip lifts
      env[i] = e < 1e-4 ? 0 : e; kindAt[i] = k;
    }
    const duck = duckCurve(n, step, opts.voices);
    const rnd = rng(opts.seed || 7);
    // stroke rhythm: a pulse whose rate drifts a little, so it never sounds like a machine
    let phase = 0, rate = 7;
    let g = 0; const grainDecay = Math.exp(-1 / (0.0032 * sr));
    for (let s = 0; s < N; s++) {
      const t = s / sr; const fi = Math.min(n - 1, Math.floor(t / step));
      const a = env[fi];
      if (s % 480 === 0) rate += ((kindAt[fi] === 2 ? 7.5 : 4) - rate) * 0.2 + (rnd() - 0.5) * 0.8;
      phase += rate / sr;
      if (a > 0) {
        const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(2 * Math.PI * phase)) ** 1.5;
        const density = 90 + 520 * a; // grains per second
        if (rnd() < density / sr) g += a * pulse * (0.35 + 0.65 * rnd()) * duck[fi];
      }
      g *= grainDecay;
      const nz = rnd() * 2 - 1;
      out[s] = g * nz + 0.12 * a * duck[fi] * nz; // grains + a faint body under them
    }
    // the marker landing on the board: a short, dull tap
    for (const at of opts.taps || []) {
      const s0 = Math.round(at * sr), len = Math.round(0.045 * sr); const fi = Math.min(n - 1, Math.max(0, Math.floor(at / step)));
      let lp = 0;
      for (let i = 0; i < len && s0 + i < N; i++) { lp += ((rnd() * 2 - 1) - lp) * 0.12; out[s0 + i] += lp * 1.6 * Math.exp(-i / (0.009 * sr)) * duck[fi]; }
    }
    biquad(out, 'highpass', 600, 0.7, sr); biquad(out, 'lowpass', 4200, 0.7, sr);
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
