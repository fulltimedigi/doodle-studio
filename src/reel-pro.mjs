// Pro reel renderer: a template spec -> a voice-synced 1080x1920 MP4, a cover and an SRT.
//
// The engine (web/js/reel-pro.js) and the sound (web/js/reel-pro-audio.js) are the same files the
// studio page runs in the browser. Here Chromium draws each frame — render(t), then a screenshot —
// and ffmpeg encodes them with the mixed soundtrack. The voice is Gemini TTS; with no
// GEMINI_API_KEY (or `voice: false` in the spec) the film is timed by reading speed and has music
// and effects only.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { ROOT, dataUrl } from './project.mjs';
import { assetSource } from './site-map.mjs';
import { browserOptions } from './reel.mjs';

// The shared engine attaches itself to globalThis (it is a plain script in the browser).
await import('../web/js/reel-pro.js');
await import('../web/js/reel-pro-audio.js');
const { ReelPro, ReelProAudio } = globalThis;
export { ReelPro, ReelProAudio };

export const W = 1080, H = 1920;
const MAX_LINES = 12, MAX_LINE_CHARS = 280, MAX_SPEC_BYTES = 6e6;
const fileSlug = (s) => (String(s ?? '').replace(/[^\w؀-ۿ.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80) || 'reel-pro');

/** Throw on a spec the renderer should not try. Returns the spec, normalised. */
export function checkSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');
  if (JSON.stringify(spec).length > MAX_SPEC_BYTES) throw new Error('spec too large');
  if (!ReelPro.TEMPLATES[spec.template]) throw new Error(`unknown template: ${spec.template} (one of ${Object.keys(ReelPro.TEMPLATES).join(', ')})`);
  if (!Array.isArray(spec.lines) || !spec.lines.length) throw new Error('spec has no lines');
  if (spec.lines.length > MAX_LINES) throw new Error(`too many lines (max ${MAX_LINES})`);
  // a line the template has no place for would be voiced (and paid for) and then never shown
  const known = new Set(ReelPro.TEMPLATES[spec.template].lines.map((l) => l.id)), seen = new Set();
  for (const l of spec.lines) {
    if (!l || typeof l.id !== 'string' || typeof l.text !== 'string') throw new Error('every line needs an id and a text');
    if (l.text.length > MAX_LINE_CHARS) throw new Error(`line "${l.id}" is too long`);
    if (!known.has(l.id)) throw new Error(`line "${l.id}" is not part of the ${spec.template} template (${[...known].join(', ')})`);
    if (seen.has(l.id)) throw new Error(`line "${l.id}" appears twice`);
    seen.add(l.id);
  }
  // checked here, before any voice is paid for, rather than failing half-way through the render
  const missing = ReelPro.missingLines(spec);
  if (missing.length) throw new Error(`spec is missing required line(s): ${missing.join(', ')}`);
  return spec;
}

/** The voice settings a spec asks for, with the house voice as the default. */
export function voiceOf(spec) {
  const v = spec.voice && typeof spec.voice === 'object' ? spec.voice : {};
  const D = ReelProAudio.DEFAULT_VOICE;
  const clean = (s, d, re) => (typeof s === 'string' && re.test(s) ? s : d);
  return {
    model: clean(v.model, D.model, /^[a-z0-9.\-]{3,60}$/),
    voice: clean(v.voice, D.voice, /^[A-Za-z]{2,30}$/),
    style: typeof v.style === 'string' && v.style.length < 300 ? v.style : D.style,
    takes: Math.max(1, Math.min(4, +(v.takes ?? 2) || 2)),
    verify: v.verify !== false,
    // 'lines': one take per line (the default — each line gets its own energy, which the founder preferred
    // by ear over the continuous take); 'script': one continuous take for the whole script, split into lines
    mode: v.mode === 'script' ? 'script' : 'lines',
  };
}

/**
 * Generate (or load from cache) every line's voice.
 * → { voiced: {id: {dur, words}}, pcm: {id: Float32Array}, scores: {id: number|null} }
 */
export async function prepareVoice(spec, { key = process.env.GEMINI_API_KEY, cacheDir = join(ROOT, '.cache'), log = () => {} } = {}) {
  const voiced = {}, pcm = {}, scores = {};
  if (spec.voice === false) return { voiced, pcm, scores, used: false, reason: 'off' };
  if (!key) { log('ℹ️ لا يوجد GEMINI_API_KEY — الفيديو بلا تعليق صوتي (موسيقى ومؤثرات)'); return { voiced, pcm, scores, used: false, reason: 'no key' }; }
  const v = voiceOf(spec);
  const dir = join(cacheDir, 'reel-pro'); mkdirSync(dir, { recursive: true });
  // in the order they are heard, so a continuous take reads the script as the film plays it
  const order = (ReelPro.TEMPLATES[spec.template]?.lines || []).map((l) => l.id), at = (id) => (order.indexOf(id) + 1 || 99);
  const lines = spec.lines.map((l) => ({ id: l.id, text: String(l.text || '').trim() })).filter((l) => l.text).sort((a, b) => at(a.id) - at(b.id)).map((l) => {
    const h = createHash('sha1').update(['rp1', v.mode === 'script' ? 's' : '', v.model, v.voice, v.style, l.text].join('|')).digest('hex').slice(0, 16);
    return { ...l, wavFile: join(dir, h + '.wav'), meta: join(dir, h + '.json') };
  });
  const keep = (l, r) => {
    writeFileSync(l.wavFile, ReelProAudio.wav(r.pcm));
    writeFileSync(l.meta, JSON.stringify({ dur: r.dur, words: r.words, score: r.score, heard: r.heard }));
    if (r.score != null) log(`   ✓ ${l.id}: مطابقة النطق ${(r.score * 100).toFixed(0)}%${r.mode === 'line' ? ' (أُعيد لوحده)' : ''}`);
  };
  const todo = lines.filter((l) => !(existsSync(l.wavFile) && existsSync(l.meta)));
  if (v.mode === 'script' && todo.length >= 2) {
    const rs = await ReelProAudio.voiceScript(todo.map((l) => l.text), { key, ...v, onWait: log });
    todo.forEach((l, i) => keep(l, rs[i]));
  } else for (const l of todo) {
    log(`🎙 ${l.id}: ${l.text.slice(0, 40)}…`);
    keep(l, await ReelProAudio.voiceLine(l.text, { key, ...v, onWait: log }));
  }
  for (const l of lines) {
    const { wavFile, meta } = l;
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    pcm[l.id] = ReelProAudio.parseAudio(new Uint8Array(readFileSync(wavFile))).pcm;
    voiced[l.id] = { dur: m.dur, words: m.words };
    scores[l.id] = m.score ?? null;
  }
  return { voiced, pcm, scores, used: true };
}

/** Every bundled image the stage may ask for, as data: URLs (the page has no file access). */
function assetMap(spec) {
  const want = new Set(['brand/fd-logo-night.png', 'reel-pro/lock.jpg', 'reel-pro/shield.jpg']);
  const tpl = ReelPro.TEMPLATES[spec.template];
  const walk = (o) => { if (typeof o === 'string') { if (ReelPro.okImage(o) && !o.startsWith('data:')) want.add(o); } else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
  walk(tpl.fields); walk(ReelPro.fieldsFor(spec, tpl));
  const out = {};
  for (const p of want) { const f = assetSource(p); if (f) out[p] = dataUrl(f); }
  return out;
}

/** The stage's stylesheet with its webfonts inlined. */
function stageCss() {
  return readFileSync(join(ROOT, 'web/css/reel-pro.css'), 'utf8').replace(/url\(\.\.\/assets\/([^)]+)\)/g, (m, p) => {
    const f = assetSource(p); return f ? `url(${dataUrl(f)})` : m;
  });
}

/** A page with the stage mounted for `spec` on timeline `T`. Caller closes the browser. */
export async function openStage(spec, T) {
  const browser = await chromium.launch(browserOptions());
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${stageCss()}html,body{margin:0;background:#03140f}</style></head><body><div id="host"></div></body></html>`);
  await page.addScriptTag({ content: readFileSync(join(ROOT, 'web/js/reel-pro.js'), 'utf8') });
  const assets = assetMap(spec);
  await page.evaluate(async ([s, t, a]) => {
    // load the stage's faces before anything is measured (fonts.ready alone resolves before any is asked for)
    await Promise.all(['500', '700', '800'].map((w) => document.fonts.load(`${w} 60px RP`, 'ابت abc').catch(() => {})));
    window.__rp = ReelPro.mount(document.getElementById('host'), s, t, { asset: (p) => a[p] || '' });
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    await document.fonts.ready;
    window.__rp.fit();
  }, [spec, T, assets]);
  return { browser, page, render: (t) => page.evaluate((tt) => window.__rp.render(tt), t) };
}

const ff = (args) => new Promise((ok, bad) => {
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited with ${c}: ${err.slice(-300)}`))));
  p.on('error', bad);
});
const srtTime = (x) => {
  const ms = Math.max(0, Math.round(x * 1000)), p2 = (n) => String(n).padStart(2, '0');
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
};

/** The moment the hook is fully on screen and the next scene has not started: the thumbnail. */
export function coverTime(T) {
  const a = T.lines[T.order[0]], b = T.lines[T.order[1]];
  if (!a) return 0.5;
  return Math.max(0.3, Math.min(a.end + 0.15, b ? b.start - 0.42 : a.end + 0.5));
}

/**
 * Render `spec` to `out/<slug>.mp4` (+ `-cover.jpg`, `.srt`).
 * `stills: [t, ...]` renders only those frames as PNGs (for review) and skips the video.
 * Returns { mp4, cover, srt, seconds, frames, voice, scores, warnings, stills }.
 */
export async function renderReelPro(spec, { out, fps = 30, key = process.env.GEMINI_API_KEY, cacheDir = join(ROOT, '.cache'), music = true, stills = null, log = () => {} } = {}) {
  checkSpec(spec);
  mkdirSync(out, { recursive: true });
  const slug = fileSlug(spec.slug || spec.template);
  const warnings = ReelPro.lint(spec);
  for (const w of warnings) log(`⚠️ ${w.where}: ${w.why}`);
  const V = await prepareVoice(spec, { key, cacheDir, log });
  const T = ReelPro.timeline(spec, V.voiced);
  log(`🧭 ${T.order.length} أسطر · ${T.duration.toFixed(1)} ث`);

  const stage = await openStage(spec, T);
  try {
    if (stills) {
      const files = [];
      for (const t of stills) { await stage.render(t); const f = join(out, `${slug}-${t.toFixed(2)}.png`); await stage.page.screenshot({ path: f }); files.push(f); }
      return { stills: files, seconds: T.duration, timeline: T, voice: V.used, scores: V.scores, warnings };
    }
    // ---- sound
    const first = T.lines[T.order[1]] || T.lines[T.order[0]], cta = T.lines.cta;
    const mix = ReelProAudio.mix({
      dur: T.duration, music, sfx: ReelPro.sfx(spec, T),
      voices: T.order.filter((id) => V.pcm[id]).map((id) => ({ at: T.lines[id].start, pcm: V.pcm[id] })),
      pulseFrom: first ? first.start : 2, finalAt: cta ? cta.start - 0.3 : null,
    });
    const wavFile = join(out, `.${slug}-mix.wav`);
    writeFileSync(wavFile, ReelProAudio.wav(mix));

    // ---- frames → ffmpeg
    const mp4 = join(out, `${slug}.mp4`), frames = Math.ceil(T.duration * fps);
    const enc = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-i', wavFile,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encErr = ''; enc.stderr.on('data', (d) => { encErr += d; });
    const done = new Promise((ok, bad) => { enc.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited with ${c}: ${encErr.slice(-300)}`)))); enc.on('error', bad); enc.stdin.on('error', bad); });
    const write = (buf) => new Promise((ok) => (enc.stdin.write(buf) ? ok() : enc.stdin.once('drain', ok)));
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await stage.render(f / fps);
      await write(await stage.page.screenshot({ type: 'jpeg', quality: 92 }));
      if (f % fps === 0) log(`🎬 ${Math.round((f / frames) * 100)}% (${((Date.now() - t0) / 1000).toFixed(0)} ث)`);
    }
    enc.stdin.end();
    await done;
    try { unlinkSync(wavFile); } catch {}

    // ---- cover + subtitles
    const cover = join(out, `${slug}-cover.jpg`);
    await stage.render(coverTime(T));
    await stage.page.screenshot({ path: cover, type: 'jpeg', quality: 90 });
    const srt = join(out, `${slug}.srt`);
    writeFileSync(srt, T.order.map((id, i) => `${i + 1}\n${srtTime(T.lines[id].start)} --> ${srtTime(T.lines[id].end)}\n${T.lines[id].text}\n`).join('\n'), 'utf8');
    log(`✅ ${T.duration.toFixed(1)} ث`);
    return { mp4, cover, srt, seconds: +T.duration.toFixed(2), frames, voice: V.used, scores: V.scores, warnings };
  } finally { await stage.browser.close(); }
}
