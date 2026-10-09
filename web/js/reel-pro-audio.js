/* Pro reel — sound: the voice, its word timing, and an original music bed with synced effects.
 *
 * Plain JavaScript on Float32Arrays, so the same code runs in the studio page (in-browser export)
 * and in Node (src/reel-pro.mjs). No Web Audio, no Python, no sampled music.
 *
 *  voice   Gemini TTS, one call per line, steered by a short style tag. Optionally each take is
 *          transcribed back by a Gemini Flash model and compared with the script, and the closest
 *          take wins — the person running the studio usually cannot listen to every take.
 *  timing  Gemini returns no timestamps. The line is trimmed to its speech, the pauses the voice
 *          really made are found in the waveform and matched to the line's punctuation, and the
 *          words are spread inside each phrase by length. Good enough to land a highlight on a word.
 *  music   An A-minor pad, a plucked arpeggio and a soft sub pulse, generated on the spot.
 *  mix     Voice + music ducked under it + effects, normalised to about -14 LUFS (the level the
 *          platforms play at) with a peak ceiling.
 */
(function (root) {
  'use strict';
  const SR = 48000;
  const R = () => root.ReelPro; // the engine (text helpers); loaded alongside this file

  // ------------------------------------------------------------------ bytes
  function fromB64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /** WAV (PCM16 / float32) or raw little-endian L16 → { pcm: Float32Array (mono), sr }. */
  function parseAudio(bytes, mime = '') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (bytes.length > 44 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
      let o = 12, fmt = null;
      while (o + 8 <= bytes.length) {
        const id = tag(o), size = dv.getUint32(o + 4, true);
        if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
        if (id === 'data' && fmt) {
          const end = Math.min(bytes.length, o + 8 + (size || bytes.length)), start = o + 8;
          const step = (fmt.bits / 8) * fmt.ch, n = Math.floor((end - start) / step), pcm = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const p = start + i * step;
            pcm[i] = fmt.format === 3 ? dv.getFloat32(p, true) : fmt.bits === 16 ? dv.getInt16(p, true) / 32768 : (dv.getUint8(p) - 128) / 128;
          }
          return { pcm, sr: fmt.sr };
        }
        o += 8 + size + (size & 1);
      }
      throw new Error('WAV without audio data');
    }
    const m = /rate=(\d+)/.exec(mime); const sr = m ? +m[1] : 24000;
    const n = Math.floor(bytes.length / 2), pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(i * 2, true) / 32768;
    return { pcm, sr };
  }
  /** Mono float → 16-bit WAV bytes. */
  function wav(pcm, sr = SR) {
    const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
    return new Uint8Array(buf);
  }
  /** Windowed-sinc (Lanczos-3) resampling. */
  function resample(pcm, from, to = SR) {
    if (from === to) return pcm;
    const ratio = from / to, n = Math.floor(pcm.length / ratio), out = new Float32Array(n), a = 3;
    const cut = Math.min(1, to / from); // low-pass when going down
    for (let i = 0; i < n; i++) {
      const x = i * ratio, i0 = Math.floor(x);
      let s = 0, ws = 0;
      for (let j = i0 - a + 1; j <= i0 + a; j++) {
        if (j < 0 || j >= pcm.length) continue;
        const d = (x - j) * cut;
        const w = d === 0 ? 1 : (a * Math.sin(Math.PI * d) * Math.sin((Math.PI * d) / a)) / (Math.PI * Math.PI * d * d);
        s += pcm[j] * w; ws += w;
      }
      out[i] = ws ? s / ws : 0;
    }
    return out;
  }

  // ------------------------------------------------------------------ word timing
  /**
   * Where the speech is, and when each word starts.
   * → { start, end (seconds into pcm), words: [{w, t, d}] with t relative to `start` }
   */
  function analyze(pcm, sr, text) {
    const hop = Math.round(sr * 0.01), nf = Math.max(1, Math.floor(pcm.length / hop)), rms = new Float32Array(nf);
    let peak = 0;
    for (let f = 0; f < nf; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop && i < pcm.length; i++) s += pcm[i] * pcm[i]; rms[f] = Math.sqrt(s / hop); if (rms[f] > peak) peak = rms[f]; }
    const thr = Math.max(peak * 0.07, 0.004), on = (f) => rms[f] > thr;
    let a = 0; while (a < nf && !on(a)) a++;
    let b = nf - 1; while (b > a && !on(b)) b--;
    if (a >= nf) return { start: 0, end: pcm.length / sr, words: R().estimateWords(text, pcm.length / sr) };
    const start = Math.max(0, a * 0.01 - 0.04), end = Math.min(pcm.length / sr, (b + 1) * 0.01 + 0.18);
    // pauses: ≥ 110 ms of silence between a and b
    const pauses = [];
    for (let f = a; f <= b; f++) {
      if (on(f)) continue;
      let g = f; while (g <= b && !on(g)) g++;
      if ((g - f) * 0.01 >= 0.11) pauses.push([f * 0.01, g * 0.01]);
      f = g;
    }
    const sa = a * 0.01, sb = (b + 1) * 0.01;
    const ws = R().wordsOf(text), ph = R().phrases(text);
    // where the phrase boundaries would fall if the speech were even, then the nearest real pause
    const est = R().estimateWords(text, sb - sa);
    const bounds = ph.slice(0, -1).map(([, e]) => sa + est[e].t + est[e].d);
    const cuts = []; let from = 0;
    // a phrase break is usually the longest silence near where it is expected: score each pause by
    // its length, minus how far it is from the expected spot; keep the order
    bounds.forEach((exp, bi) => {
      let best = -1, bs = -Infinity;
      const left = bounds.length - bi - 1; // leave enough pauses for the breaks still to come
      for (let i = from; i < pauses.length - left; i++) {
        const mid = (pauses[i][0] + pauses[i][1]) / 2, d = Math.abs(mid - exp);
        if (d > 1.4) continue;
        const sc = (pauses[i][1] - pauses[i][0]) - 0.35 * d;
        if (sc > bs) { bs = sc; best = i; }
      }
      if (best >= 0) { cuts.push(pauses[best]); from = best + 1; } else cuts.push([exp, exp]);
    });
    const out = [];
    ph.forEach(([i0, i1], k) => {
      const s = k === 0 ? sa : cuts[k - 1][1], e = k === ph.length - 1 ? sb : cuts[k][0];
      const seg = ws.slice(i0, i1 + 1), wt = seg.map((w) => Math.max(1, R().norm(w).length) + 1.2), tot = wt.reduce((x, y) => x + y, 0);
      let t = s;
      seg.forEach((w, j) => { const d = Math.max(0.05, ((e - s) * wt[j]) / tot); out.push({ w, t: +(t - start).toFixed(3), d: +d.toFixed(3) }); t += d; });
    });
    return { start, end, words: out };
  }

  // ------------------------------------------------------------------ Gemini
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function call(model, body, { key, fetchImpl, onWait } = {}) {
    if (!key) throw new Error('needs a Gemini API key');
    const f = fetchImpl || fetch, waits = [6, 12, 20, 30, 45];
    for (let attempt = 0; ; attempt++) {
      const r = await f(API + model + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
      if ((r.status === 429 || r.status >= 500) && attempt < waits.length) {
        if (onWait) onWait(`⏳ Gemini مشغول — إعادة المحاولة خلال ${waits[attempt]} ث`);
        await sleep(waits[attempt] * 1000); continue;
      }
      if (!r.ok) { const e = new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 240)}`); e.status = r.status; throw e; }
      return r.json();
    }
  }
  const DEFAULT_VOICE = { model: 'gemini-3.8-flash-tts', voice: 'Charon', style: 'Saudi dialect, Riyadh accent, warm confident social-media ad voice-over' };
  /** One line through Gemini TTS → { pcm (mono, SR), sr: SR }. */
  async function tts(text, { key, model = DEFAULT_VOICE.model, voice = DEFAULT_VOICE.voice, style = DEFAULT_VOICE.style, fetchImpl, onWait } = {}) {
    // The 3.x speech models take the direction as a leading [tag] and refuse a system instruction;
    // a plain sentence of direction gets read aloud. The 2.5 models take "direction: text".
    const prompt = /2\.5/.test(model) ? `${style}: ${text}` : `[${style}] ${text}`;
    const j = await call(model, { contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }, { key, fetchImpl, onWait });
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!part) throw new Error('Gemini returned no audio');
    const a = parseAudio(fromB64(part.data), part.mimeType || '');
    return { pcm: resample(a.pcm, a.sr, SR), sr: SR };
  }
  const TRANSCRIBERS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];
  /** What a take actually says, in Arabic letters. */
  async function transcribe(pcm, sr, { key, fetchImpl, onWait } = {}) {
    const small = resample(pcm, sr, 16000), b64 = toB64(wav(small, 16000));
    const body = { contents: [{ role: 'user', parts: [
      { text: 'Transcribe this Arabic speech exactly as spoken, word for word. Write every word in Arabic letters, including brand names, English words and website addresses. Output only the transcript.' },
      { inlineData: { mimeType: 'audio/wav', data: b64 } }] }], generationConfig: { temperature: 0 } };
    let last;
    for (const m of TRANSCRIBERS) {
      try { const j = await call(m, body, { key, fetchImpl, onWait }); return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim(); }
      catch (e) { last = e; if (e.status !== 404 && e.status !== 400) throw e; }
    }
    throw last;
  }
  /** 0–1: how close two Arabic strings are, letters only. */
  function similarity(a, b) {
    const x = R().norm(a).replace(/[a-z0-9]/g, ''), y = R().norm(b).replace(/[a-z0-9]/g, '');
    if (!x.length || !y.length) return 0;
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      const cur = [i];
      for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[y.length] / Math.max(x.length, y.length);
  }
  /**
   * A finished line: the best of up to `takes` takes, trimmed to its speech, with word timings.
   * → { pcm, dur, words, score (null when not verified), heard }
   */
  async function voiceLine(text, opts = {}) {
    const takes = Math.max(1, Math.min(4, +(opts.takes ?? 2))), verify = opts.verify !== false;
    let best = null;
    for (let k = 0; k < takes; k++) {
      const { pcm } = await tts(text, opts);
      const an = analyze(pcm, SR, text);
      const cut = pcm.slice(Math.floor(an.start * SR), Math.ceil(an.end * SR));
      const take = { pcm: cut, dur: +(cut.length / SR).toFixed(3), words: an.words, score: null, heard: '' };
      if (verify) {
        try { take.heard = await transcribe(cut, SR, opts); take.score = +similarity(text, take.heard).toFixed(3); }
        catch (e) { take.score = null; if (opts.onWait) opts.onWait('ℹ️ تعذّر التحقق من النطق: ' + e.message.slice(0, 80)); }
      }
      if (!best || (take.score ?? 0) > (best.score ?? 0)) best = take;
      if (!verify || take.score == null || take.score >= 0.9) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ synthesis
  function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function biquad(x, type, f0, q) {
    const w = (2 * Math.PI * f0) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  function noise(n, seed = 7) { const r = seeded(seed), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; }
  function bandnoise(n, lo, hi, seed) { let y = biquad(noise(n, seed), 'hp', lo, 0.7); y = biquad(y, 'lp', hi, 0.7); let m = 1e-9; for (const v of y) m = Math.max(m, Math.abs(v)); for (let i = 0; i < n; i++) y[i] /= m; return y; }
  /** Schroeder reverb: four combs into two all-passes. */
  function reverb(x, wet = 0.25, size = 1) {
    const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * size * SR / 44100)), aps = [225, 556].map((d) => Math.round(d * SR / 44100));
    const y = new Float32Array(x.length);
    for (const d of combs) { const buf = new Float32Array(d); let k = 0; for (let i = 0; i < x.length; i++) { const o = buf[k]; buf[k] = x[i] + o * 0.8; y[i] += o; k = (k + 1) % d; } }
    let z = y;
    for (const d of aps) { const buf = new Float32Array(d), o2 = new Float32Array(z.length); let k = 0; for (let i = 0; i < z.length; i++) { const b = buf[k]; const v = -0.5 * z[i] + b; buf[k] = z[i] + 0.5 * v; o2[i] = v; k = (k + 1) % d; } z = o2; }
    const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[i] * (1 - wet) + z[i] * wet * 0.25;
    return out;
  }
  const place = (dst, src, at, gain = 1) => { let i0 = Math.round(at * SR); let s0 = 0; if (i0 < 0) { s0 = -i0; i0 = 0; } for (let i = s0; i < src.length && i0 + i - s0 < dst.length; i++) dst[i0 + i - s0] += src[i] * gain; };
  const env = (n, a, r) => { const e = new Float32Array(n).fill(1), na = Math.round(a * SR), nr = Math.round(r * SR); for (let i = 0; i < na && i < n; i++) e[i] = i / na; for (let i = 0; i < nr && i < n; i++) e[n - 1 - i] *= i / nr; return e; };

  const CHIME = [659.25, 783.99, 880, 1046.5, 1174.66];
  const SFX = {
    whoosh() { const n = Math.round(0.7 * SR), y = bandnoise(n, 400, 6000, 11); for (let i = 0; i < n; i++) y[i] *= Math.pow(Math.sin((Math.PI * i) / n), 2.2); return [y, -0.38, 0.35]; },
    chime(note = 0) { const n = Math.round(1.4 * SR), f = CHIME[(note | 0) % 5], y = new Float32Array(n), e = env(n, 0.003, 0.2);
      for (let i = 0; i < n; i++) { const x = i / SR; y[i] = (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * x) * Math.exp(-x * 6)) * Math.exp(-x * 3.2) * e[i] * 0.8; } return [y, 0, 0.28]; },
    pop() { const n = Math.round(0.12 * SR), y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (380 + 900 * x / 0.12)) / SR; y[i] = Math.sin(ph) * Math.exp(-x * 30) * 0.9; } return [y, 0, 0.3]; },
    tap() { const n = Math.round(0.05 * SR), nz = bandnoise(n, 1500, 7000, 5), y = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / SR; y[i] = nz[i] * Math.exp(-x * 120) + Math.sin(2 * Math.PI * 1800 * x) * Math.exp(-x * 90) * 0.5; } return [y, 0, 0.35]; },
    impact() { const n = Math.round(1.6 * SR), nz = bandnoise(n, 5000, 12000, 3), y = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (50 + 70 * Math.exp(-x * 12))) / SR; y[i] = (Math.sin(ph) * Math.exp(-x * 3.5) + nz[i] * Math.exp(-x * 2.2) * 0.25) * 1.4; } return [y, 0, 0.5]; },
    tick() { const n = Math.round(0.09 * SR), nz = bandnoise(n, 3000, 9000, 9), y = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / SR; y[i] = Math.sin(2 * Math.PI * 2400 * x) * Math.exp(-x * 70) + nz[i] * Math.exp(-x * 160) * 0.6; } return [y, 0, 0.4]; },
    ding() { const n = Math.round(0.9 * SR), y = new Float32Array(n), k = Math.round(0.09 * SR), e = env(n, 0.002, 0.2);
      for (let i = 0; i < n; i++) { const x = i / SR; y[i] = Math.sin(2 * Math.PI * 1318.5 * x) * Math.exp(-x * 5); if (i >= k) { const x2 = (i - k) / SR; y[i] += Math.sin(2 * Math.PI * 1760 * x2) * Math.exp(-x2 * 4.5); } y[i] *= e[i] * 0.6; } return [y, 0, 0.35]; },
    notify() { const n = Math.round(0.5 * SR), y = new Float32Array(n), e = env(n, 0.003, 0.15); let ph = 0;
      for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (x < 0.08 ? 987.8 : 1479.98)) / SR; y[i] = Math.sin(ph) * Math.exp(-x * 7) * e[i] * 0.7; } return [y, 0, 0.4]; },
    type(keys = 8) { const r = seeded(13), n = Math.round((0.07 * keys + 0.1) * SR), y = new Float32Array(n), m = Math.round(0.03 * SR);
      for (let j = 0; j < keys; j++) { const k0 = Math.max(0, Math.round((j * 0.07 + (r() - 0.5) * 0.02) * SR)), nz = bandnoise(m, 2000, 8000, 20 + j), g = 0.6 + r() * 0.4; for (let i = 0; i < m && k0 + i < n; i++) y[k0 + i] += nz[i] * Math.exp(-(i / SR) * 200) * g; }
      return [y, 0, 0.3]; },
    thud() { const n = Math.round(0.5 * SR), y = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (140 - 60 * x)) / SR; y[i] = Math.sin(ph) * Math.exp(-x * 9) * 1.1; } return [y, 0, 0.45]; },
  };

  const CHORDS = { Am: [110, 220, 261.63, 329.63], F: [87.31, 174.61, 220, 261.63], C: [130.81, 164.81, 196, 261.63, 329.63], G: [98, 196, 246.94, 293.66] };
  function padVoice(freqs, n) {
    const y = new Float32Array(n);
    for (const f of freqs) for (const det of [-0.0023, 0.0023]) for (let h = 1; h <= 5; h++) {
      const w = (2 * Math.PI * f * (1 + det) * h) / SR, amp = 1 / Math.pow(h, 1.7) / freqs.length;
      for (let i = 0; i < n; i++) y[i] += Math.sin(w * i + h) * amp;
    }
    return y;
  }
  /** The music bed: pad Am→F→C→G from the second line, plucked arpeggio, sub pulse, a brighter last chord. */
  function music(dur, { pulseFrom = 3, finalAt = null } = {}) {
    const N = Math.ceil(dur * SR), out = new Float32Array(N);
    finalAt = finalAt ?? Math.max(0, dur - 5);
    const prog = [[0, 'Am']]; let t = pulseFrom, k = 0; const cyc = ['F', 'C', 'G', 'Am'];
    while (t < finalAt - 1) { prog.push([t, cyc[k % 4]]); t += 4; k++; }
    prog.push([finalAt, 'C']);
    const pad = new Float32Array(N);
    prog.forEach(([s, name], i) => { const e = i + 1 < prog.length ? prog[i + 1][0] : dur; const n = Math.round((e - s + 0.8) * SR); const v = padVoice(CHORDS[name], n), en = env(n, 0.7, 0.8); for (let j = 0; j < n; j++) v[j] *= en[j]; place(pad, v, Math.max(0, s - 0.1), 0.18); });
    const arp = new Float32Array(N);
    let idx = 0;
    for (let tt = pulseFrom; tt < dur - 0.4; tt += 0.3, idx++) {
      const name = prog.filter(([s]) => s <= tt).pop()[1], tones = CHORDS[name].slice(1).map((f) => f * 2);
      const f = tones[idx % tones.length] * (idx % 8 === 3 || idx % 8 === 7 ? 2 : 1), n = Math.round(0.45 * SR), v = new Float32Array(n), en = env(n, 0.004, 0.05);
      for (let i = 0; i < n; i++) { const x = i / SR; v[i] = (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(4 * Math.PI * f * x)) * Math.exp(-x * 9) * en[i]; }
      place(arp, v, tt, tt < finalAt ? 0.1 : 0.14);
    }
    const sub = new Float32Array(N);
    for (let b = pulseFrom; b < dur - 0.5; b += 0.6) { const n = Math.round(0.35 * SR), v = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const x = i / SR; ph += (2 * Math.PI * (55 + 60 * Math.exp(-x * 30))) / SR; v[i] = Math.sin(ph) * Math.exp(-x * 11); } place(sub, v, b, b < finalAt ? 0.22 : 0.3); }
    const p2 = reverb(pad, 0.35, 1.3), a2 = reverb(arp, 0.3, 1);
    for (let i = 0; i < N; i++) { const x = i / SR; out[i] = (p2[i] + a2[i] + sub[i]) * Math.min(1, x / 1.2) * Math.min(1, Math.max(0, (dur - x) / 1.4)); }
    return out;
  }

  // ------------------------------------------------------------------ loudness
  // ITU-R BS.1770 K-weighting (48 kHz coefficients) and gated integrated loudness.
  function kweight(x) {
    const f = (b, a, s) => { const y = new Float32Array(s.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < s.length; i++) { const v = b[0] * s[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = s[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
    const s1 = f([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x);
    return f([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], s1);
  }
  function lufs(x) {
    const y = kweight(x), blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), ms = [];
    for (let i = 0; i + blk <= y.length; i += hop) { let s = 0; for (let j = i; j < i + blk; j++) s += y[j] * y[j]; ms.push(s / blk); }
    const L = (m) => -0.691 + 10 * Math.log10(m + 1e-12);
    let g = ms.filter((m) => L(m) > -70); if (!g.length) return -70;
    const rel = L(g.reduce((a, b) => a + b, 0) / g.length) - 10;
    g = g.filter((m) => L(m) > rel);
    return g.length ? L(g.reduce((a, b) => a + b, 0) / g.length) : -70;
  }

  /**
   * The finished soundtrack.
   *   voices: [{ at, pcm }]  sfx: [{type, at, note?, keys?}]  music: bool  pulseFrom, finalAt: seconds
   * → Float32Array (mono, SR), about -14 LUFS, peaks under -1.5 dBFS.
   */
  function mix({ dur, voices = [], sfx = [], music: withMusic = true, pulseFrom = 3, finalAt = null, target = -14 }) {
    const N = Math.ceil(dur * SR), vo = new Float32Array(N), fx = new Float32Array(N);
    for (const v of voices) place(vo, v.pcm, v.at, 1);
    for (const e of sfx) { const make = SFX[e.type]; if (!make) continue; const [y, shift, gain] = make(e.type === 'chime' ? e.note : e.keys); place(fx, y, e.at + shift, gain); }
    const fxr = reverb(fx, 0.22, 0.8);
    const bed = withMusic ? music(dur, { pulseFrom, finalAt }) : new Float32Array(N);
    // duck the bed and the effects under the voice (smoothed voice envelope)
    const hop = Math.round(0.01 * SR), nf = Math.ceil(N / hop), ve = new Float32Array(nf); let mx = 1e-9;
    for (let f = 0; f < nf; f++) { let s = 0; for (let i = f * hop; i < Math.min(N, (f + 1) * hop); i++) s += Math.abs(vo[i]); ve[f] = s / hop; }
    const sm = new Float32Array(nf); let acc = 0; const W = 25;
    for (let f = 0; f < nf; f++) { acc += ve[f] - (f >= W ? ve[f - W] : 0); sm[f] = acc / W; if (sm[f] > mx) mx = sm[f]; }
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) { const d = Math.min(1, (sm[Math.floor(i / hop)] / mx) * 3); out[i] = vo[i] + bed[i] * 0.55 * (1 - 0.6 * d) + fxr[i] * 0.55 * (1 - 0.35 * d); }
    // loudness to target, then a gentle ceiling
    const g = Math.pow(10, (target - lufs(out)) / 20);
    const ceil = Math.pow(10, -1.5 / 20);
    for (let i = 0; i < N; i++) { const v = out[i] * g; out[i] = Math.abs(v) <= ceil * 0.8 ? v : Math.sign(v) * (ceil * 0.8 + (ceil * 0.2) * Math.tanh((Math.abs(v) - ceil * 0.8) / (ceil * 0.2))); }
    return out;
  }

  root.ReelProAudio = { SR, parseAudio, wav, resample, analyze, tts, transcribe, similarity, voiceLine, music, mix, lufs, SFX, DEFAULT_VOICE, fromB64, toB64 };
})(globalThis);
