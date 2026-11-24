// The marker sound (web/js/pen-sound.js): quieter than before by default, silent when the tip is
// in the air, ducked under the voice, scratchy rather than a steady hiss, and a 0–100% volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../web/js/pen-sound.js';

const { penTrack, rms, biquad, SR, DEFAULT_VOLUME, OLD_DRAW_RMS } = globalThis.PenSound;
const curve = (secs, fill) => { const n = Math.round(secs / 0.01); const speed = new Float32Array(n), kind = new Uint8Array(n); for (let i = 0; i < n; i++) { const [s, k] = fill(i * 0.01); speed[i] = s; kind[i] = k; } return { step: 0.01, speed, kind }; };
const at = (y, a, b) => rms(y, Math.round(a * SR), Math.round(b * SR));

test('volume 1 is the old loudness; the default is 30% of it', () => {
  const c = curve(2, () => [1500, 1]);
  assert.ok(Math.abs(at(penTrack(c, { duration: 2, volume: 1 }), 0.2, 2) / OLD_DRAW_RMS - 1) < 0.15);
  assert.equal(DEFAULT_VOLUME, 0.3);
  assert.ok(Math.abs(at(penTrack(c, { duration: 2 }), 0.2, 2) / OLD_DRAW_RMS - 0.3) < 0.06);
  assert.equal(at(penTrack(c, { duration: 2, volume: 0 }), 0, 2), 0, 'volume 0 is off');
});

test('the old loudness really was what volume 1 claims', () => {
  let s = 22222; const x = new Float32Array(SR * 2); for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = (s / 4294967296) * 2 - 1; }
  biquad(x, 'highpass', 1000, 1, SR); biquad(x, 'bandpass', 2700, 0.8, SR);
  assert.ok(Math.abs(rms(x, SR * 0.2) * 0.05 / OLD_DRAW_RMS - 1) < 0.1);
});

test('silent the moment the pen lifts', () => {
  const c = curve(3, (t) => [t < 1 || t >= 2 ? 1200 : 0, t < 1 || t >= 2 ? 2 : 0]);
  const y = penTrack(c, { duration: 3, volume: 1 });
  assert.ok(at(y, 0.2, 0.9) > 0.003);
  assert.ok(at(y, 1.1, 1.9) < at(y, 0.2, 0.9) * 0.01, 'lifted = silence');
});

test('ducked under the voice', () => {
  const c = curve(4, () => [1500, 1]);
  const y = penTrack(c, { duration: 4, volume: 1, voices: [{ at: 2, dur: 1.5 }] });
  const ratio = at(y, 2.3, 3.3) / at(y, 0.3, 1.7);
  assert.ok(ratio < 0.4 && ratio > 0.2, `about -10 dB under the voice (${ratio.toFixed(2)})`);
});

test('hand-writing swells with the strokes, without clicks', () => {
  const y = penTrack(curve(2, () => [1500, 2]), { duration: 2, volume: 1 });
  const w = []; for (let t = 0.3; t < 1.9; t += 0.04) w.push(at(y, t, t + 0.04));
  const m = w.reduce((a, b) => a + b) / w.length; const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  assert.ok(sd / m > 0.1 && sd / m < 0.45, `a gentle swell, not a flat hiss or a stutter (${(sd / m).toFixed(2)})`);
  let peak = 0; for (let i = Math.round(0.3 * SR); i < 1.9 * SR; i++) peak = Math.max(peak, Math.abs(y[i]));
  assert.ok(peak / at(y, 0.3, 1.9) < 5, `no clicks: crest factor ${(peak / at(y, 0.3, 1.9)).toFixed(1)}`);
});
