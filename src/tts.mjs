// Narration with pluggable providers. Every provider returns an mp3/wav file + duration and is cached.
//
//   edge     (default, free, no key)  Microsoft Edge neural voices via msedge-tts. Sentence-split + natural pauses.
//   azure    (free F0 tier: 500k chars/month, needs AZURE_TTS_KEY + AZURE_TTS_REGION) same voices + real SSML.
//   google   (free tier: 1M chars/month, needs GOOGLE_TTS_KEY) Chirp3-HD Arabic voices (ar-XA-Chirp3-HD-*).
//   gemini   (free tier, needs GEMINI_API_KEY) gemini-2.5-flash-preview-tts, style-promptable.
//   openai   any OpenAI-compatible /v1/audio/speech server (TTS_ENDPOINT, TTS_KEY) — this is how you plug in the
//            open-weight Arabic models that run locally on a GPU: Habibi-TTS (Apache-2.0), Chatterbox Egyptian (MIT),
//            SILMA-TTS (Apache-2.0) through any OpenAI-compatible wrapper (e.g. chatterbox-tts-api, openedai-speech).
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, createWriteStream, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

export const VOICES = {
  // Edge (free). Shakir / Hamed usually sound less flat than Salma for narration.
  'ar-EG-Salma': 'ar-EG-SalmaNeural', 'ar-EG-Shakir': 'ar-EG-ShakirNeural',
  'ar-SA-Zariyah': 'ar-SA-ZariyahNeural', 'ar-SA-Hamed': 'ar-SA-HamedNeural',
  'ar-AE-Fatima': 'ar-AE-FatimaNeural', 'ar-AE-Hamdan': 'ar-AE-HamdanNeural',
  'ar-KW-Fahed': 'ar-KW-FahedNeural', 'ar-QA-Moaz': 'ar-QA-MoazNeural', 'ar-JO-Taim': 'ar-JO-TaimNeural',
  // multilingual voices: better prosody, slight foreign accent; good for MSA, weaker for dialect
  'Andrew': 'en-US-AndrewMultilingualNeural', 'Ava': 'en-US-AvaMultilingualNeural', 'Brian': 'en-US-BrianMultilingualNeural', 'Emma': 'en-US-EmmaMultilingualNeural',
  'en-US-Aria': 'en-US-AriaNeural', 'en-US-Guy': 'en-US-GuyNeural', 'en-GB-Sonia': 'en-GB-SoniaNeural',
};
export function resolveVoice(v) { return VOICES[v] || v || 'ar-EG-ShakirNeural'; }

export async function audioDuration(file) {
  let text = '';
  try { const r = await run(ffmpegPath, ['-i', file, '-f', 'null', '-'], { maxBuffer: 1 << 24 }); text = r.stderr; }
  catch (e) { text = String(e.stderr || ''); }
  const m = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const d = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : 0;
}

// Split narration into sentences so each gets its own intonation contour, then join with short silences.
export function splitSentences(text) {
  const parts = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?؟।؛;:…])\s+|(?<=،)\s+(?=\S{12,})/).map((s) => s.trim()).filter(Boolean);
  // re-join very short fragments to the previous one
  const out = [];
  for (const p of parts) { if (out.length && p.split(' ').length < 3) out[out.length - 1] += ' ' + p; else out.push(p); }
  return out.length ? out : [String(text).trim()];
}

async function concatWithPauses(files, pauseMs, out) {
  // ffmpeg concat with silences between clips
  const inputs = []; const filters = []; let idx = 0;
  files.forEach((f, i) => {
    inputs.push('-i', f); filters.push(`[${idx}:a]`); idx++;
    if (i < files.length - 1) { inputs.push('-f', 'lavfi', '-t', (pauseMs / 1000).toFixed(3), '-i', 'anullsrc=r=24000:cl=mono'); filters.push(`[${idx}:a]`); idx++; }
  });
  await run(ffmpegPath, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${filters.join('')}concat=n=${filters.length}:v=0:a=1,aresample=24000[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
}

// ---------------- providers ----------------
async function edgeSynth(text, { voice, rate, pitch }, file) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(resolveVoice(voice), OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate: rate || '-6%', pitch: pitch || '+0Hz' });
  await new Promise((resolve, reject) => { const ws = createWriteStream(file); audioStream.pipe(ws); audioStream.on('error', reject); ws.on('finish', resolve); ws.on('error', reject); });
}

async function azureSynth(text, { voice, rate, pitch, style }, file) {
  const key = process.env.AZURE_TTS_KEY, region = process.env.AZURE_TTS_REGION;
  if (!key || !region) throw new Error('azure provider needs AZURE_TTS_KEY and AZURE_TTS_REGION');
  const v = resolveVoice(voice); const lang = v.split('-').slice(0, 2).join('-');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${v}">${style ? `<mstts:express-as style="${style}">` : ''}<prosody rate="${rate || '-6%'}" pitch="${pitch || '+0Hz'}">${esc(text)}</prosody>${style ? '</mstts:express-as>' : ''}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3' }, body });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text()}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function googleSynth(text, { voice, rate }, file) {
  const key = process.env.GOOGLE_TTS_KEY; if (!key) throw new Error('google provider needs GOOGLE_TTS_KEY');
  const name = voice && voice.includes('Chirp') ? voice : 'ar-XA-Chirp3-HD-Charon';
  const languageCode = name.split('-').slice(0, 2).join('-');
  const speakingRate = rate ? 1 + parseFloat(rate) / 100 : 0.95;
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { text }, voice: { languageCode, name }, audioConfig: { audioEncoding: 'MP3', speakingRate } }) });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
  const j = await res.json(); writeFileSync(file, Buffer.from(j.audioContent, 'base64'));
}

async function geminiSynth(text, { voice, style }, file) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('gemini provider needs GEMINI_API_KEY');
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const prompt = `${style || 'Read this Arabic narration naturally, warm and clear, like a professional explainer-video narrator'}: ${text}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice && !voice.includes('-') ? voice : 'Charon' } } } } }) });
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
  const j = await res.json(); const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('Gemini returned no audio');
  // raw PCM 24k mono 16-bit -> mp3
  const pcm = file.replace(/\.mp3$/, '.pcm'); writeFileSync(pcm, Buffer.from(part.inlineData.data, 'base64'));
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-c:a', 'libmp3lame', '-b:a', '128k', file]); unlinkSync(pcm);
}

async function openaiSynth(text, { voice, rate }, file) {
  const endpoint = (process.env.TTS_ENDPOINT || 'http://localhost:8004/v1').replace(/\/$/, '');
  const res = await fetch(`${endpoint}/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TTS_KEY || 'local'}` }, body: JSON.stringify({ model: process.env.TTS_MODEL || 'tts-1', input: text, voice: voice || 'default', response_format: 'mp3', speed: rate ? 1 + parseFloat(rate) / 100 : 1 }) });
  if (!res.ok) throw new Error(`TTS endpoint ${endpoint} ${res.status}: ${await res.text()}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const PROVIDERS = { edge: edgeSynth, azure: azureSynth, google: googleSynth, gemini: geminiSynth, openai: openaiSynth };

export async function synthesize(text, { provider, voice, rate, pitch, style, pauseMs = 380, cacheDir }) {
  provider = provider || process.env.DOODLE_TTS || 'edge';
  const synth = PROVIDERS[provider]; if (!synth) throw new Error(`Unknown TTS provider: ${provider}`);
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash('sha1').update(['v2', provider, voice, rate, pitch, style, pauseMs, text].join('|')).digest('hex').slice(0, 16);
  const file = join(cacheDir, `${key}.mp3`);
  if (!existsSync(file)) {
    const sentences = splitSentences(text);
    const parts = [];
    try {
      for (let i = 0; i < sentences.length; i++) {
        const part = join(cacheDir, `${key}-${i}.mp3`);
        await synth(sentences[i], { voice, rate, pitch, style }, part); parts.push(part);
      }
      if (parts.length === 1) { writeFileSync(file, readFileSync(parts[0])); }
      else await concatWithPauses(parts, pauseMs, file);
    } catch (e) { try { unlinkSync(file); } catch {} throw e; }
    finally { for (const p of parts) { try { unlinkSync(p); } catch {} } }
  }
  return { file, duration: await audioDuration(file) };
}
