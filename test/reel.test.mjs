// The reel renderer: the pure half is checked directly, the composed half by rendering a real
// (very short) video and looking at what came out.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneFrames, renderReel } from '../src/reel.mjs';
import { chromiumOrNull } from './helpers.mjs';

const sum = (fr) => fr.reduce((a, f) => a + f.seconds, 0);

// ffmpeg-static downloads its binary in a postinstall hook; without it the composed test is a
// reported skip, not a failure.
let ffmpegPath = null;
try { ffmpegPath = (await import('ffmpeg-static')).default; } catch {}
const ffmpegReady = () => !!ffmpegPath && existsSync(ffmpegPath);

test('a scene lasts exactly as long as it says', () => {
  for (const sc of [
    { type: 'title', lines: ['سطر'], duration: 4 },
    { type: 'title', lines: ['سطر'], sub: 'تحت', duration: 2.5 },
    { type: 'stairs', steps: ['أ', 'ب', 'ج'], duration: 6 },
    { type: 'product', title: 'منتج', rows: [['السعر', 'ناقص']], duration: 5 },
  ]) assert.ok(Math.abs(sum(sceneFrames(sc, null)) - sc.duration) < 0.01, `${sc.type}: ${sum(sceneFrames(sc, null))} != ${sc.duration}`);
});

test('the hook replaces the scene heading while it is up', () => {
  const sc = { type: 'stairs', kicker: 'عنوان المشهد', steps: ['أ', 'ب'], duration: 3 };
  const withHook = sceneFrames(sc, { lines: ['الخطّاف'], seconds: 3.5 }).map((f) => f.html).join('');
  const alone = sceneFrames(sc, null).map((f) => f.html).join('');
  assert.ok(alone.includes('عنوان المشهد'), 'the scene heading should show on its own');
  assert.ok(withHook.includes('الخطّاف'), 'the hook should show');
  assert.ok(!withHook.includes('عنوان المشهد'), 'the heading and the hook printed over each other');
});

test('scene text cannot inject markup', () => {
  const html = sceneFrames({ type: 'title', lines: ['<img src=x onerror=alert(1)>'], tag: '</div><script>x</script>', duration: 2 }, null).map((f) => f.html).join('');
  assert.ok(!/<img|<script/i.test(html), 'raw markup survived escaping');
  assert.ok(html.includes('&lt;img'), 'the text should still be printed, escaped');
});

test('a class name from the spec stays inside its attribute', () => {
  const html = sceneFrames({ type: 'chat', header: 'x', header_variant: 'a" onload="alert(1)', bubbles: [{ who: 'me" onload="x', text: 'مرحبا' }], duration: 2 }, null).map((f) => f.html).join('');
  assert.doesNotMatch(html, /on\w+\s*=/, 'an event attribute escaped through a class name');
  assert.doesNotMatch(html, /class="[^"]*"[^>]*"/, 'a class value closed its own attribute');
});

describe('renderReel refuses a bad spec', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reel-guard-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (spec) => renderReel(spec, { out: join(dir, 'out'), dir });

  test('with no scenes', async () => { await assert.rejects(run({ scenes: [] }), /no scenes/); });
  test('with too many scenes', async () => {
    await assert.rejects(run({ scenes: Array.from({ length: 41 }, () => ({ type: 'title', lines: ['x'], duration: 1 })) }), /too many scenes/);
  });
  test('with a voice file outside the workspace', async () => {
    await assert.rejects(run({ scenes: [{ type: 'title', lines: ['x'], duration: 1, voice: '../../../../etc/hostname' }] }), /outside the workspace/);
  });
  test('with a voice file that is not there', async () => {
    await assert.rejects(run({ scenes: [{ type: 'title', lines: ['x'], duration: 1, voice: 'nope.mp3' }] }), /not found/);
  });
});

describe('renderReel produces a real video', { timeout: 180000 }, () => {
  let dir, ok;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'reel-render-')); ok = (await chromiumOrNull()) && ffmpegReady(); });
  after(() => dir && rmSync(dir, { recursive: true, force: true }));

  test('two scenes, a cover and subtitles', async (t) => {
    if (!ok) return t.skip('needs chromium (npm run setup) and ffmpeg');
    const spec = {
      slug: 'test reel/../escape',
      overlay: { lines: ['خطّاف'], seconds: 1 },
      scenes: [
        { type: 'title', lines: ['الأول'], duration: 1.5, spoken: 'الأول' },
        { type: 'title', lines: ['الثاني'], duration: 1.5, spoken: 'الثاني' },
      ],
    };
    const r = await renderReel(spec, { out: join(dir, 'out'), dir, fps: 12 });
    assert.ok(r.mp4.startsWith(join(dir, 'out')), 'the slug escaped the output directory');
    for (const f of [r.mp4, r.cover, r.srt]) assert.ok(existsSync(f), f);
    assert.ok(statSync(r.mp4).size > 5000, 'the video is suspiciously small');
    assert.equal(readFileSync(r.mp4).slice(4, 8).toString(), 'ftyp', 'not an MP4');
    assert.equal(readFileSync(r.cover).slice(1, 4).toString(), 'PNG', 'the cover is not a PNG');
    assert.ok(Math.abs(r.seconds - 3) < 0.1, `duration drifted: ${r.seconds}`);
    // 12fps over 3 seconds; the frame accounting must not drift against the clock.
    const cues = readFileSync(r.srt, 'utf8').trim().split(/\n\n/);
    assert.equal(cues.length, 2);
    assert.match(cues[0], /00:00:00,000 --> 00:00:01,500/);
    assert.match(cues[1], /00:00:01,500 --> 00:00:03,000/);
  });
});
