// The pro reel: the engine's pure half (timeline, word timing, claims, sound) is checked directly;
// the stage by mounting it in a real browser; the whole path by rendering a short real video.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ReelPro, ReelProAudio, renderReelPro, checkSpec, coverTime, voiceOf } from '../src/reel-pro.mjs';
import { assetSource, scriptSource } from '../src/site-map.mjs';
import { ROOT, chromiumOrNull, startServer } from './helpers.mjs';

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
  // a line the template has no place for would be voiced and paid for, then never shown
  const typo = ReelPro.example('trust'); typo.lines.push({ id: 'cta2', text: 'سطر زائد' });
  assert.throws(() => checkSpec(typo), /"cta2" is not part of the trust template/);
  const twice = ReelPro.example('trust'); twice.lines.push({ ...twice.lines[1] });
  assert.throws(() => checkSpec(twice), /appears twice/);
  // every template draws from the hook: a spec without it is refused before any voice is made
  for (const id of TEMPLATES) {
    const noHook = ReelPro.example(id); noHook.lines = noHook.lines.filter((l) => l.id !== 'hook');
    assert.throws(() => checkSpec(noHook), /required line.*hook/, id);
    const blank = ReelPro.example(id); blank.lines.find((l) => l.id === 'hook').text = '  ';
    assert.throws(() => checkSpec(blank), /hook/, id);
  }
});

test('the approved examples pass the claims check, and the usual slips do not', () => {
  // the approved examples raise one thing only: they name Salla/Zid, so they wait for the app-store listing
  for (const id of TEMPLATES) {
    const w = ReelPro.lint(ReelPro.example(id));
    assert.equal(w.length, 1, `${id} example tripped the claims check: ${JSON.stringify(w)}`); assert.match(w[0].why, /سلة\/زد/);
  }
  assert.deepEqual(ReelPro.lint({ lines: [{ id: 'x', text: 'أضف للسلة الحين' }] }), [], '«للسلة» is the cart, not Salla');
  for (const t of ['نحن شريك رسمي لسلة', 'معتمد من زد', 'سلة توصي بنا']) assert.ok(ReelPro.lint({ lines: [{ id: 'x', text: t }] }).some((w) => /شراكة/.test(w.why)), `missed: ${t}`);
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

describe('Gemini quota errors', () => {
  const body = (quotaId, quotaValue = '20', delay = '27s') => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Please retry in 27.9s.',
    details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue, quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] } });
  test('per-minute: wait the server delay and retry', () => {
    const e = ReelProAudio.geminiError(429, body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'));
    assert.equal(e.kind, 'minute'); assert.equal(e.retry, true); assert.equal(e.wait, 27);
  });
  test('per-day: stop and say when it resets', () => {
    const e = ReelProAudio.geminiError(429, body('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), 'gemini-3.8-flash-tts');
    assert.equal(e.kind, 'daily'); assert.equal(e.retry, false); assert.match(e.message, /السعودية/); assert.match(e.message, /gemini-3\.8-flash-tts/);
  });
  test('a zero quota is a setup problem, not a wait', () => {
    assert.equal(ReelProAudio.geminiError(429, body('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '0')).kind, 'noquota');
  });
  test('busy servers and bad keys', () => {
    assert.equal(ReelProAudio.geminiError(503, '{"error":{"code":503,"status":"UNAVAILABLE","message":"The model is overloaded."}}').kind, 'busy');
    assert.equal(ReelProAudio.geminiError(403, '{"error":{"code":403,"message":"Your API key was reported as leaked."}}').kind, 'key');
    assert.equal(ReelProAudio.geminiError(400, '{"error":{"code":400,"message":"Invalid JSON payload"}}').kind, 'fatal');
    assert.equal(ReelProAudio.geminiError(429, 'not json').kind, 'minute');
  });
  const replay = (...responses) => { const calls = []; return { calls, fetchImpl: async (url) => { calls.push(url); const [status, text] = responses.shift() || [200, '{"ok":1}']; return { ok: status === 200, status, text: async () => text, json: async () => JSON.parse(text) }; } }; };
  test('call() waits on a per-minute 429 then succeeds', async () => {
    const f = replay([429, body('GenerateRequestsPerMinutePerProjectPerModel', '10', '3s')], [200, '{"ok":1}']); const waits = [];
    const j = await ReelProAudio.call('m', {}, { key: 'k', fetchImpl: f.fetchImpl, wait: async (ms) => waits.push(ms) });
    assert.deepEqual(j, { ok: 1 }); assert.equal(f.calls.length, 2); assert.ok(waits[0] >= 3000 && waits[0] <= 3700, `waited ${waits[0]}`);
  });
  test('call() stops at once on a per-day 429', async () => {
    const f = replay([429, body('GenerateRequestsPerDayPerProjectPerModel')]);
    await assert.rejects(ReelProAudio.call('m', {}, { key: 'k', fetchImpl: f.fetchImpl, wait: async () => assert.fail('must not wait') }), (e) => e.kind === 'daily');
    assert.equal(f.calls.length, 1);
  });
  test('the checker running out of quota keeps the voice and stops checking', async () => {
    const pcm16 = new Int16Array(bursts([[0.1, 0.9]]).map((v) => v * 32767)), b64 = Buffer.from(pcm16.buffer).toString('base64'); const calls = [];
    const fetchImpl = async (url) => { calls.push(url);
      if (/tts/.test(url)) { const t = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=48000', data: b64 } }] } }] }); return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) }; }
      const t = body('GenerateRequestsPerDayPerProjectPerModel'); return { ok: false, status: 429, text: async () => t }; };
    const opts = { key: 'k', takes: 2, fetchImpl };
    const r = await ReelProAudio.voiceLine('افحص متجرك الحين', opts);
    assert.ok(r.pcm.length > 0); assert.equal(r.score, null); assert.equal(opts.skipVerify, true);
    assert.equal(calls.filter((u) => /tts/.test(u)).length, 1, 'no second take once checking is off');
  });
});

test('the voice is made line by line unless a continuous take is asked for', () => {
  assert.equal(voiceOf({}).mode, 'lines');
  assert.equal(voiceOf({ voice: { mode: 'script' } }).mode, 'script');
  assert.equal(voiceOf({ voice: { mode: 'nonsense' } }).mode, 'lines');
});

describe('one take for the whole script', () => {
  // a fake take: line 1, a short pause, a countdown with LONGER pauses inside it, a pause, line 3
  const texts = ['افحص متجرك.', 'ثلاث… ثنتين… وحدة!', 'الحين على الموقع.'];
  const take = () => bursts([[0.3, 1.3], [1.55, 2.0], [2.55, 3.0], [3.55, 4.0], [4.3, 6.0]]);
  test('the lines are cut at the line ends, not at the longest pauses', () => {
    const cuts = ReelProAudio.splitLines(take(), SR, texts);
    const near = (a, b) => Math.abs(a - b) < 0.08;
    assert.ok(near(cuts[0].start, 0.3) && near(cuts[0].end, 1.3), JSON.stringify(cuts[0]));
    assert.ok(near(cuts[1].start, 1.55) && near(cuts[1].end, 4.0), JSON.stringify(cuts[1]));
    assert.ok(near(cuts[2].start, 4.3) && near(cuts[2].end, 6.0), JSON.stringify(cuts[2]));
  });
  const fakeGemini = (heardFor) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url); const body = JSON.parse(init.body);
      let out;
      if (/tts/.test(url)) {
        const said = body.contents[0].parts[0].text, pcm = said.includes('ثنتين') ? take() : bursts([[0.1, 1.1]]);
        out = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=48000', data: Buffer.from(new Int16Array(pcm.map((v) => v * 32767)).buffer).toString('base64') } }] } }] };
      } else {
        const n = ReelProAudio.parseAudio(Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64')).pcm.length / 16000;
        out = { candidates: [{ content: { parts: [{ text: heardFor(n) }] } }] };
      }
      const t = JSON.stringify(out); return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) };
    };
    return { calls, fetchImpl };
  };
  test('a take whose pieces say their lines is kept whole', async () => {
    // the transcriber tells the pieces apart by length: line 1 ≈ 1.2 s, line 3 ≈ 1.9 s, line 2 ≈ 2.7 s
    const f = fakeGemini((sec) => (sec < 1.5 ? texts[0] : sec < 2.3 ? texts[2] : texts[1]));
    const r = await ReelProAudio.voiceScript(texts, { key: 'k', fetchImpl: f.fetchImpl, takes: 1 });
    assert.deepEqual(r.map((x) => x.mode), ['script', 'script', 'script']);
    assert.equal(f.calls.filter((u) => /tts/.test(u)).length, 1, 'one call for the whole script');
    assert.ok(r[1].words.length === 3 && r[1].dur > 2 && r[1].dur < 2.8, JSON.stringify({ dur: r[1].dur, words: r[1].words }));
  });
  test('a line the take got wrong is made again on its own', async () => {
    // the last piece is heard as something else: it is re-made alone, the others stay from the take
    let made = 0;
    const f = fakeGemini((sec) => (sec < 1.5 ? (made++ < 1 ? texts[0] : texts[2]) : sec < 2.3 ? 'سعودي دايلكت رياض اكسنت' : texts[1]));
    const r = await ReelProAudio.voiceScript(texts, { key: 'k', fetchImpl: f.fetchImpl, takes: 1 });
    assert.deepEqual(r.map((x) => x.mode), ['script', 'script', 'line']);
    assert.equal(r[2].score, 1);
  });
});

// ---------------------------------------------------------------- publishing
test('the published layout carries the pro reel', () => {
  for (const p of ['reel-pro/abaya.jpg', 'reel-pro/lock.jpg', 'reel-pro/shield.jpg', 'brand/fd-logo-night.png', 'prompts/reel-pro.md',
    'fonts/tajawal-arabic-500-normal.woff2', 'fonts/tajawal-latin-800-normal.woff2']) assert.ok(assetSource(p), `assets/${p}`);
  for (const s of ['reel-pro.js', 'reel-pro-audio.js', 'snapdom.js', 'html-to-image.js']) assert.ok(scriptSource(s), `js/${s}`);
  // Salla's and Zid's logos are not ours to restyle: the platforms are named in our own type instead
  for (const p of ['brand/badge-salla.png', 'brand/badge-zid.png']) assert.ok(!assetSource(p), `${p} should not ship`);
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

  test('every glyph stays inside the platforms\' safe area, and no platform logo is drawn', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup)');
    const { openStage } = await import('../src/reel-pro.mjs');
    for (const id of TEMPLATES) {
      const spec = ReelPro.example(id);
      // a headline far longer than the example: the type shrinks instead of spilling out
      if (spec.fields.hookA) spec.fields.hookA = spec.fields.hookA + ' ' + spec.fields.hookA;
      const T = ReelPro.timeline(spec), s = await openStage(spec, T);
      try {
        const bad = await s.page.evaluate(([dur, S]) => {
          const out = [], run = {};
          const vis = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
          const root = window.__rp.root;
          for (let t = 0; t <= dur; t += 0.25) {
            window.__rp.render(t); const seen = new Set();
            const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; const items = [];
            while ((n = tw.nextNode())) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) items.push([n.parentElement, b, n.textContent.trim()]); }
            for (const b of root.querySelectorAll('.btn')) items.push([b, b.getBoundingClientRect(), 'BUTTON']);
            for (const [el, r, txt] of items) {
              if (r.width < 2 || r.height < 2 || vis(el) < 0.3) continue;
              let { top, bottom, left, right } = r;
              for (let e = el.parentElement; e && e !== root; e = e.parentElement) if (getComputedStyle(e).overflow === 'hidden') { const c = e.getBoundingClientRect(); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); left = Math.max(left, c.left); right = Math.min(right, c.right); }
              if (bottom - top < 4 || right - left < 4) continue;
              const over = Math.max(0, S.top - top, bottom - S.bottom, S.left - left, right - S.right);
              if (over <= 3) continue;
              // passing through on the way in or out is fine; staying outside for 3/4 of a second is not
              const k = txt.slice(0, 30); if (!seen.has(k)) { seen.add(k); run[k] = (run[k] || 0) + 1; }
              if (run[k] >= 4) out.push(`${k} @${t.toFixed(2)}s: ${Math.round(over)}px out`);
            }
            for (const k in run) if (!seen.has(k)) run[k] = 0;
          }
          const logos = [...root.querySelectorAll('.badge, img[src*="badge-"]')].map((e) => e.className || e.getAttribute('src'));
          return { out: [...new Set(out)].slice(0, 6), logos };
        }, [T.duration, ReelPro.SAFE]);
        assert.deepEqual(bad.out, [], `${id}: outside the safe area`);
        assert.deepEqual(bad.logos, [], `${id}: a platform logo is drawn`);
      } finally { await s.browser.close(); }
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

describe('the studio page', { timeout: 240000 }, () => {
  let c, base, stop, browser;
  before(async () => { c = await chromiumOrNull(); if (!c) return; ({ base, stop } = await startServer()); browser = await c.chromium.launch(c.options); });
  after(async () => { if (browser) await browser.close(); if (stop) stop(); });
  const open = async () => {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/web/reel-pro.html'); await page.waitForFunction(() => typeof STAGE !== 'undefined' && STAGE);
    return { page, errors };
  };

  test('a cleared hook keeps the last good preview instead of breaking it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const { page, errors } = await open();
    try {
      for (const tpl of ['challenge', 'brand', 'questions', 'trust']) {
        const r = await page.evaluate((tpl) => {
          pickTemplate(tpl); const st = STAGE;
          SPEC.lines.find((l) => l.id === 'hook').text = ''; rebuild();
          const kept = STAGE === st, warned = /الهوك/.test(document.getElementById('warns').textContent);
          STAGE.render(5);
          return { kept, warned };
        }, tpl);
        assert.deepEqual(r, { kept: true, warned: true }, tpl);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('the soundtrack is mixed again once the voice settings change', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const { page, errors } = await open();
    try {
      const r = await page.evaluate(async () => {
        pickTemplate('trust');
        for (const l of SPEC.lines) VOICE[l.id] = { key: voiceKey(l.text), dur: 1, words: [], pcm: new Float32Array(SR).fill(0.2) };
        rebuild();
        const a = await soundtrack(), again = await soundtrack();
        document.getElementById('vStyle').value += ' (changed)'; // every take is now stale
        const b = await soundtrack();
        return { cached: a === again, remixed: a !== b, voicedAfter: Object.keys(voiced()).length };
      });
      assert.deepEqual(r, { cached: true, remixed: true, voicedAfter: 0 });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('two server renders of the same template do not share files', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    // a short spec (the hook and the call to action), no voice, low frame rate: two at once
    const spec = ReelPro.example('trust'); spec.lines = spec.lines.filter((l) => l.id === 'hook' || l.id === 'cta'); spec.voice = false;
    const start = async () => (await (await fetch(base + '/api/reel-pro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec, fps: 12, music: false }) })).json()).id;
    const ids = await Promise.all([start(), start()]);
    const done = async (id) => { for (let i = 0; i < 240; i++) { const j = await (await fetch(base + '/api/jobs/' + id)).json(); if (j.status === 'done' || j.status === 'error') return j; await new Promise((ok) => setTimeout(ok, 500)); } throw new Error('render timed out'); };
    const jobs = await Promise.all(ids.map(done));
    for (const [i, j] of jobs.entries()) { assert.equal(j.status, 'done', j.error); assert.ok(j.url.includes(ids[i]), `${j.url} should carry its job id`); }
    assert.notEqual(jobs[0].url, jobs[1].url); assert.notEqual(jobs[0].cover, jobs[1].cover);
    for (const j of jobs) { const r = await fetch(base + j.url); assert.equal(r.status, 200); assert.ok((await r.arrayBuffer()).byteLength > 10000); }
  });

  test('changing the recording mode asks for a new voice', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const { page, errors } = await open();
    try {
      const r = await page.evaluate(() => {
        const l = SPEC.lines[0]; VOICE[l.id] = { key: voiceKey(l.text), dur: 2, words: [], pcm: new Float32Array(10) };
        const before = Object.keys(voiced()).length;
        document.getElementById('vMode').value = document.getElementById('vMode').value === 'lines' ? 'script' : 'lines';
        return { before, after: Object.keys(voiced()).length };
      });
      assert.deepEqual(r, { before: 1, after: 0 });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('an export renders and captures one stage: the edit just made, and none made during it', async (t) => {
    if (!browser) return t.skip('needs chromium (npm run setup)');
    const { page, errors } = await open();
    try {
      const r = await page.evaluate(async () => {
        pickTemplate('trust');
        const seen = [];
        // stand-in capture: records which stage each frame comes from, returns a blank frame quickly
        window.frameGrabber = async (st, W, H) => {
          const blank = document.createElement('canvas'); blank.width = W; blank.height = H;
          return async (t) => {
            st.render(t);
            if (!seen.length) { SPEC.fields.hookA = 'تعديل أثناء الإخراج'; changed(); await new Promise((ok) => setTimeout(ok, 450)); }
            seen.push({ same: st === STAGE, text: st.root.querySelector('.line').textContent });
            return blank;
          };
        };
        SPEC.fields.hookA = 'تعديل قبل الإخراج'; changed(); // still inside the 350 ms debounce
        await exportBrowser();
        return { frames: seen.length, allSame: seen.every((x) => x.same), texts: [...new Set(seen.map((x) => x.text))], after: STAGE.root.querySelector('.line').textContent, exported: !!document.querySelector('#result video') };
      });
      assert.ok(r.exported, 'the export finished');
      assert.ok(r.frames > 100, `${r.frames} frames`);
      assert.ok(r.allSame, 'the stage was replaced in the middle of the export');
      assert.deepEqual(r.texts.map((x) => x.replace(/\s+/g, '')), ['تعديلقبلالإخراج'], 'every frame shows the edit made just before export');
      assert.equal(r.after.replace(/\s+/g, ''), 'تعديلأثناءالإخراج', 'the edit made during the export is applied once it ends');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
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
