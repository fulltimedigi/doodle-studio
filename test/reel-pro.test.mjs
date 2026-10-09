// The pro reel: the engine's pure half (timeline, word timing, claims, sound) is checked directly;
// the stage by mounting it in a real browser; the whole path by rendering a short real video.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ReelPro, ReelProAudio, renderReelPro, checkSpec, coverTime } from '../src/reel-pro.mjs';
import { assetSource, scriptSource } from '../src/site-map.mjs';
import { ROOT, chromiumOrNull } from './helpers.mjs';

let ffmpegPath = null;
try { ffmpegPath = (await import('ffmpeg-static')).default; } catch {}
const ffmpegReady = () => !!ffmpegPath && existsSync(ffmpegPath);
const SR = ReelProAudio.SR;
const TEMPLATES = Object.keys(ReelPro.TEMPLATES);

// ---------------------------------------------------------------- timeline
test('every template has an example that lays out cleanly', () => {
  assert.ok(TEMPLATES.length >= 4);
  for (const id of TEMPLATES) {
    const spec = ReelPro.example(id), T = ReelPro.timeline(spec);
    assert.deepEqual(T.order, ReelPro.TEMPLATES[id].lines.map((l) => l.id), `${id}: line order`);
    let prev = -1;
    for (const lid of T.order) {
      const l = T.lines[lid];
      assert.ok(l.start > prev && l.dur > 0.5, `${id}/${lid}: starts after the previous line`);
      assert.ok(l.words.length && l.words.every((w, i) => i === 0 || w.at >= l.words[i - 1].at), `${id}/${lid}: words in order`);
      prev = l.end;
    }
    assert.ok(T.duration > prev, `${id}: the film holds after the last line`);
    assert.ok(T.duration > 12 && T.duration < 45, `${id}: ${T.duration}s is not a reel length`);
    for (const e of ReelPro.sfx(spec, T)) assert.ok(Number.isFinite(e.at) && e.at > -1 && e.at < T.duration + 0.5, `${id}: sfx ${e.type} at ${e.at}`);
  }
});

test('real voice timings replace the estimate', () => {
  const spec = ReelPro.example('trust');
  const T = ReelPro.timeline(spec, { hook: { dur: 5, words: [{ w: 'لا', t: 0, d: 0.3 }] } });
  assert.equal(T.lines.hook.dur, 5);
  assert.equal(T.lines.us.start.toFixed(2), (0.2 + 5 + 0.35 + 0.45).toFixed(2), 'the next line waits for the real one');
});

test('a missing line drops its scene instead of breaking the film', () => {
  const spec = ReelPro.example('questions');
  spec.lines = spec.lines.filter((l) => l.id !== 'assist');
  const T = ReelPro.timeline(spec);
  assert.ok(!T.lines.assist && T.lines.cta);
});

test('the estimate spreads a line over its whole duration, pauses included', () => {
  const ws = ReelPro.estimateWords('الوصف ناقص، المقاسات بأسماء مختلفة، والسعر مو واضح.', 4);
  assert.equal(ws.length, 8);
  const last = ws[ws.length - 1];
  assert.ok(Math.abs(last.t + last.d - 4) < 0.05, `ends at ${last.t + last.d}`);
  assert.deepEqual(ReelPro.phrases('ثلاث طرق: بالعربي، بالإنجليزي، ومرة بخطأ إملائي.'), [[0, 1], [2, 2], [3, 3], [4, 6]]);
});

// ---------------------------------------------------------------- input
test('fields merge over the defaults, and a bad image falls back', () => {
  const tpl = ReelPro.TEMPLATES.challenge;
  const f = ReelPro.fieldsFor({ fields: { hookA: 'جديد', product: { name: 'منتج', image: 'javascript:alert(1)' }, finds: ['أ'] } }, tpl);
  assert.equal(f.hookA, 'جديد');
  assert.equal(f.product.name, 'منتج');
  assert.equal(f.product.image, tpl.fields.product.image, 'an unsafe image source survived');
  assert.equal(f.finds[0], 'أ'); assert.equal(f.finds.length, 3, 'the list kept its length');
  for (const bad of ['../../etc/passwd.png', 'http://x/y.png', 'data:text/html;base64,AAAA']) assert.equal(ReelPro.okImage(bad), false, bad);
  assert.equal(ReelPro.okImage('reel-pro/abaya.jpg'), true);
});

test('checkSpec refuses what the renderer should not try', () => {
  assert.throws(() => checkSpec({ template: 'nope', lines: [{ id: 'a', text: 'b' }] }), /unknown template/);
  assert.throws(() => checkSpec({ template: 'trust', lines: [] }), /no lines/);
  assert.throws(() => checkSpec({ template: 'trust', lines: Array.from({ length: 13 }, (_, i) => ({ id: 'l' + i, text: 'x' })) }), /too many/);
  assert.throws(() => checkSpec({ template: 'trust', lines: [{ id: 'hook', text: 'x'.repeat(400) }] }), /too long/);
  assert.equal(checkSpec(ReelPro.example('trust')).template, 'trust');
});

test('the approved examples pass the claims check, and the usual slips do not', () => {
  for (const id of TEMPLATES) assert.deepEqual(ReelPro.lint(ReelPro.example(id)), [], `${id} example tripped the claims check`);
  const bad = ReelPro.lint({ lines: [{ id: 'x', text: 'ضاعف مبيعاتك 40% — قريبًا على Shopify' }] });
  const why = bad.map((w) => w.why).join(' | ');
  for (const k of ['نسبة', 'مضاعفة', 'قريبًا', 'Shopify']) assert.ok(why.includes(k), `missed: ${k}`);
  assert.equal(ReelPro.lint({ lines: [{ id: 'x', text: 'الأرخص' }] }, ['الأرخص']).length >= 1, true, 'the brand banned list is ignored');
});

// ---------------------------------------------------------------- sound
const bursts = (spec) => { // [[start, end], ...] seconds of 220 Hz tone, silence elsewhere
  const n = Math.round(spec.at(-1)[1] * SR + 0.3 * SR), x = new Float32Array(n);
  for (const [a, b] of spec) for (let i = Math.round(a * SR); i < b * SR; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  return x;
};

test('wav round-trips', () => {
  const x = bursts([[0.1, 0.4]]);
  const y = ReelProAudio.parseAudio(ReelProAudio.wav(x)).pcm;
  assert.equal(y.length, x.length);
  assert.ok(Math.abs(y[Math.round(0.2 * SR)] - x[Math.round(0.2 * SR)]) < 1e-3);
});

test('word timing follows the pauses the voice really made', () => {
  // three phrases, spoken unevenly: a long first phrase, then two short ones
  const x = bursts([[0.3, 1.9], [2.4, 2.8], [3.3, 3.7]]);
  const an = ReelProAudio.analyze(x, SR, 'كلمة أولى طويلة، ثانية، ثالثة.');
  const at = (w) => an.start + an.words.find((x) => x.w.startsWith(w)).t;
  assert.ok(Math.abs(an.start - 0.26) < 0.03, `speech starts at ${an.start}`);
  assert.ok(Math.abs(at('ثانية') - 2.4) < 0.08, `second phrase at ${at('ثانية')}`);
  assert.ok(Math.abs(at('ثالثة') - 3.3) < 0.08, `third phrase at ${at('ثالثة')}`);
});

test('the mix lands near -14 LUFS with its peaks under -1.5 dBFS', () => {
  const spec = ReelPro.example('challenge'), T = ReelPro.timeline(spec);
  const voice = bursts([[0, 2.5]]);
  const m = ReelProAudio.mix({ dur: T.duration, sfx: ReelPro.sfx(spec, T), voices: [{ at: 0.2, pcm: voice }], pulseFrom: 3, finalAt: T.lines.cta.start });
  assert.equal(m.length, Math.ceil(T.duration * SR));
  const L = ReelProAudio.lufs(m);
  assert.ok(L > -15.5 && L < -12.5, `loudness ${L.toFixed(1)} LUFS`);
  let peak = 0; for (const v of m) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= Math.pow(10, -1.5 / 20) + 1e-6, `peak ${peak}`);
});

test('similarity reads letters, not spelling noise', () => {
  assert.ok(ReelProAudio.similarity('افحص متجرك مجانًا الحين', 'افحص متجرك مجاناً الحين') > 0.95);
  assert.ok(ReelProAudio.similarity('افحص متجرك مجانًا الحين', 'افحص الحين') < 0.7);
});

describe('voiceLine keeps the take that says the script', () => {
  // a fake Gemini: TTS returns a tone as raw L16, the transcriber returns what we queue
  const fake = (heard) => {
    const queue = [...heard]; const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      const pcm16 = new Int16Array(bursts([[0.1, 0.9]]).map((v) => v * 32767));
      const b64 = Buffer.from(pcm16.buffer).toString('base64');
      const body = /tts/.test(url)
        ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=48000', data: b64 } }] } }] }
        : { candidates: [{ content: { parts: [{ text: queue.shift() }] } }] };
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
    return { fetchImpl, calls };
  };
  test('a clean first take is kept and no second take is made', async () => {
    const f = fake(['افحص متجرك الحين']);
    const r = await ReelProAudio.voiceLine('افحص متجرك الحين', { key: 'k', takes: 2, fetchImpl: f.fetchImpl });
    assert.equal(r.score, 1);
    assert.equal(f.calls.filter((u) => /tts/.test(u)).length, 1);
  });
  test('a take that dropped words is retried, and the better one wins', async () => {
    const f = fake(['افحص', 'افحص متجرك الحين']);
    const r = await ReelProAudio.voiceLine('افحص متجرك الحين', { key: 'k', takes: 2, fetchImpl: f.fetchImpl });
    assert.equal(f.calls.filter((u) => /tts/.test(u)).length, 2);
    assert.equal(r.score, 1);
    assert.ok(r.dur > 0.7 && r.dur < 1.2, `trimmed to the speech: ${r.dur}`);
  });
});

// ---------------------------------------------------------------- publishing
test('the published layout carries the pro reel', () => {
  for (const p of ['reel-pro/abaya.jpg', 'reel-pro/lock.jpg', 'reel-pro/shield.jpg', 'brand/fd-logo-night.png', 'brand/badge-salla.png', 'prompts/reel-pro.md',
    'fonts/tajawal-arabic-500-normal.woff2', 'fonts/tajawal-latin-800-normal.woff2']) assert.ok(assetSource(p), `assets/${p}`);
  for (const s of ['reel-pro.js', 'reel-pro-audio.js']) assert.ok(scriptSource(s), `js/${s}`);
  for (const id of TEMPLATES) {
    const walk = (o) => (typeof o === 'string' ? (ReelPro.okImage(o) ? [o] : []) : o && typeof o === 'object' ? Object.values(o).flatMap(walk) : []);
    for (const img of walk(ReelPro.TEMPLATES[id].fields)) assert.ok(assetSource(img), `${id}: ${img} is not published`);
  }
  const css = readFileSync(join(ROOT, 'web/css/reel-pro.css'), 'utf8');
  for (const m of css.matchAll(/url\(\.\.\/assets\/([^)]+)\)/g)) assert.ok(assetSource(m[1]), `reel-pro.css: ${m[1]}`);
});

// ---------------------------------------------------------------- browser
describe('the stage in a real browser', { timeout: 180000 }, () => {
  let dir, ok;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'reel-pro-')); ok = !!(await chromiumOrNull()); });
  after(() => dir && rmSync(dir, { recursive: true, force: true }));

  test('every template renders its frames', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup)');
    for (const id of TEMPLATES) {
      const spec = { ...ReelPro.example(id), voice: false };
      const T = ReelPro.timeline(spec);
      const at = [0.05, coverTime(T), T.duration * 0.5, T.duration - 0.2];
      const r = await renderReelPro(spec, { out: join(dir, id), stills: at, key: '' });
      assert.equal(r.stills.length, at.length);
      for (const f of r.stills) assert.ok(statSync(f).size > 30000, `${id}: ${f} looks empty`);
    }
  });

  test('spec text reaches the page as text, never as markup', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup)');
    const { openStage } = await import('../src/reel-pro.mjs');
    const spec = ReelPro.example('challenge');
    spec.fields.hookA = '<img src=x onerror="window.__pwned=1">';
    spec.lines[0].text = '<script>window.__pwned=2</script>';
    spec.brand = { accent: 'red;}</style><script>window.__pwned=3</script>', website: 'javascript:alert(1)' };
    const s = await openStage(spec, ReelPro.timeline(spec));
    try {
      await s.render(1);
      const r = await s.page.evaluate(() => ({ pwned: window.__pwned || 0, imgs: [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src') === 'x').length, hook: document.querySelector('.rp .line').textContent }));
      assert.equal(r.pwned, 0); assert.equal(r.imgs, 0);
      assert.ok(r.hook.includes('<img'), 'the text should still be shown, as text');
    } finally { await s.browser.close(); }
  });
});

describe('renderReelPro produces a real video', { timeout: 300000 }, () => {
  let dir, ok;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'reel-pro-video-')); ok = (await chromiumOrNull()) && ffmpegReady(); });
  after(() => dir && rmSync(dir, { recursive: true, force: true }));

  test('the trust template, music and effects, no voice', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup) and ffmpeg');
    const spec = { ...ReelPro.example('trust'), slug: 'trust/../escape', voice: false };
    const r = await renderReelPro(spec, { out: join(dir, 'out'), fps: 6, key: '' });
    assert.ok(r.mp4.startsWith(join(dir, 'out')), 'the slug escaped the output directory');
    for (const f of [r.mp4, r.cover, r.srt]) assert.ok(existsSync(f), f);
    assert.equal(readFileSync(r.mp4).slice(4, 8).toString(), 'ftyp', 'not an MP4');
    const info = spawnSync(ffmpegPath, ['-hide_banner', '-i', r.mp4], { encoding: 'utf8' }).stderr;
    assert.match(info, /Video: h264/); assert.match(info, /Audio: aac/);
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
    const secs = +d[1] * 3600 + +d[2] * 60 + +d[3];
    assert.ok(Math.abs(secs - r.seconds) < 0.4, `duration ${secs} vs ${r.seconds}`);
    assert.equal(readFileSync(r.srt, 'utf8').trim().split(/\n\n/).length, spec.lines.length);
  });
});
