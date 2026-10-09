// The Gemini narration path of src/tts.mjs, against a fake Gemini: which model it asks, how the
// direction is phrased (the 3.x speech models read «direction: text» aloud), and that both answer
// formats — a WAV file (3.x) and raw 16-bit PCM (2.5) — come out as a playable mp3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synthesize, audioDuration } from '../src/tts.mjs';

let dir, realFetch;
const env = {};
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tts-test-')); realFetch = globalThis.fetch;
  for (const k of ['GEMINI_API_KEY', 'GEMINI_TTS_MODEL']) env[k] = process.env[k];
  process.env.GEMINI_API_KEY = 'test-key'; delete process.env.GEMINI_TTS_MODEL;
});
after(() => {
  globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
});

// one second of a 220 Hz tone at 24 kHz, as Gemini would send it
function tone() {
  const n = 24000, pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 24000) * 12000), i * 2);
  return pcm;
}
function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function fakeGemini(audio, mimeType) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const j = { candidates: [{ content: { parts: [{ inlineData: { mimeType, data: audio.toString('base64') } }] } }] };
    return { ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) };
  };
  return calls;
}

test('narration asks a current model, with the direction as a [tag], and reads its WAV answer', async () => {
  const calls = fakeGemini(wav(tone()), 'audio/wav');
  const r = await synthesize('مرحبا بكم.', { provider: 'gemini', voice: 'Charon', style: 'اقرأ بلهجة مصرية [دافئة]', cacheDir: join(dir, 'a') });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-3\.8-flash-tts:generateContent$/, 'the 2.5 preview models are shut down on 2026-11-17');
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-key', 'the key travels in a header, not the URL');
  assert.equal(calls[0].body.contents[0].parts[0].text, '[اقرأ بلهجة مصرية  دافئة] مرحبا بكم.');
  const d = await audioDuration(r.file);
  assert.ok(d > 0.9 && d < 1.2, `the WAV header is not read as sound: ${d}s`);
});

test('a 2.5 model still gets «direction: text» and raw PCM', async () => {
  process.env.GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  try {
    const calls = fakeGemini(tone(), 'audio/L16;codec=pcm;rate=24000');
    const r = await synthesize('مرحبا.', { provider: 'gemini', voice: 'Charon', style: 'اقرأ بهدوء', cacheDir: join(dir, 'b') });
    assert.equal(calls[0].body.contents[0].parts[0].text, 'اقرأ بهدوء: مرحبا.');
    const d = await audioDuration(r.file);
    assert.ok(d > 0.9 && d < 1.2, `${d}s`);
  } finally { delete process.env.GEMINI_TTS_MODEL; }
});
