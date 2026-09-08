#!/usr/bin/env node
// doodle-studio CLI — free doodle / whiteboard videos from a JSON script.
import { writeFileSync, mkdirSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { ROOT, loadProject, compile } from './project.mjs';
import { renderVideo, renderStill } from './render.mjs';
import { VOICES } from './tts.mjs';
import { imageToStrokes } from './strokes.mjs';
import { generateScript } from './ai.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {}; const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const nxt = argv[i + 1]; if (nxt !== undefined && !nxt.startsWith('-')) { flags[k] = nxt; i++; } else flags[k] = true; }
  else if (a === '-o') { flags.out = argv[++i]; }
  else pos.push(a);
}
const log = (m) => process.stderr.write(m + '\n');
const CACHE = process.env.DOODLE_CACHE || join(ROOT, '.cache');

const HELP = `
doodle-studio — فيديوهات Doodle مجانية، بدون اشتراكات

  doodle render <script.json> [-o out.mp4] [--fps 30] [--draft] [--no-audio] [--quality good|best|draft]
  doodle still  <script.json> --at 3.5 [-o frame.png]      لقطة واحدة عند ثانية معينة (للمعاينة السريعة)
  doodle ai     <brief.txt> [-o script.json] [--format 16:9|9:16|1:1] [--lang ar|en] [--model qwen2.5:7b]
  doodle new    <folder>                                      مشروع جديد يحتوي مثالًا جاهزًا
  doodle hand   <photo.jpg> [-o assets/hands/my-hand.png]     قصّ يدك من صورة (يحتاج rembg: pip install "rembg[cpu,cli]")
  doodle voices                                               الأصوات المجانية المتاحة
  doodle icons                                                الأيقونات والرسومات المتاحة (doodles / tabler / icons)
  doodle trace  <image> ...                                   معاينة تحويل صورة إلى خطوط (مرجعي؛ الرسم الفعلي يتم داخل المحرّك)

  TTS providers (DOODLE_TTS=edge|azure|google|gemini|openai):  edge is free with no key; see README for the others.

  Environment: CHROME_PATH (use an installed Chrome/Edge instead of Playwright's Chromium)
               DOODLE_AI_ENDPOINT / DOODLE_AI_MODEL / DOODLE_AI_KEY (any OpenAI-compatible API; default Ollama)
`;

async function main() {
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return; }
  if (cmd === 'voices') { for (const [k, v] of Object.entries(VOICES)) console.log(`${k.padEnd(14)} ${v}`); console.log('\nAny other Edge voice id (e.g. ar-EG-ShakirNeural) works too.'); return; }
  if (cmd === 'icons') {
    const { readdirSync } = await import('node:fs');
    console.log('icons (type "icon"):\n  ' + readFileSync(join(ROOT, 'assets/icons/INDEX.txt'), 'utf8').trim());
    console.log('\nopen-doodles people (type "doodle", CC0):\n  ' + readdirSync(join(ROOT, 'assets/illustrations/open-doodles')).map((f) => f.replace('.svg', '')).join(', '));
    console.log('\npeeps (type "peep", CC0): any "seed" word gives a different hand-drawn person, e.g. {"type":"peep","seed":"ahmed"}');
    const tab = join(ROOT, 'node_modules/@tabler/icons/icons/outline');
    if (existsSync(tab)) console.log(`\ntabler icons (type "tabler", MIT): ${readdirSync(tab).length} names, e.g. home, shopping-cart, device-laptop, rocket, bulb, chart-line, coins, truck, gift, users — browse https://tabler.io/icons`);
    return;
  }
  if (cmd === 'hand') {
    const { execFileSync } = await import('node:child_process');
    const src = resolve(pos[0]); const out = flags.out || join(ROOT, 'assets/hands', basename(src).replace(/\.[^.]+$/, '') + '.png');
    try { execFileSync('rembg', ['i', '-m', 'isnet-general-use', '-a', src, out], { stdio: 'inherit' }); }
    catch (e) { throw new Error('rembg is not installed. Install once with:  pip install "rembg[cpu,cli]"   (MIT, runs on CPU)'); }
    log(`✅ ${out}\n   أضف في السيناريو:  "hand": { "src": "${out}", "tip": [x, y] }   حيث x,y موضع طرف القلم داخل الصورة بالبكسل.`); return;
  }
  if (cmd === 'new') {
    const dir = resolve(pos[0] || 'my-doodle'); mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'examples/demo-ar.json'), join(dir, 'script.json'));
    cpSync(join(ROOT, 'examples/brief-example.txt'), join(dir, 'brief.txt'));
    log(`✅ ${dir}\n   عدّل script.json ثم:  doodle render ${join(basename(dir), 'script.json')} -o ${basename(dir)}.mp4`); return;
  }
  if (cmd === 'trace') {
    const r = await imageToStrokes(resolve(pos[0]), { threshold: +(flags.threshold || 150), fill: flags.fill || 'none' });
    const out = flags.out || pos[0].replace(/\.[^.]+$/, '') + '.svg'; writeFileSync(out, r.svg);
    log(`✅ ${out}  (${r.strokes} strokes, pen ${r.stroke_width.toFixed(1)}px)`); return;
  }
  if (cmd === 'ai') {
    const brief = existsSync(resolve(pos[0] || '')) ? readFileSync(resolve(pos[0]), 'utf8') : pos.join(' ');
    if (!brief.trim()) throw new Error('Give a brief file or text.');
    log('🤖 asking the model for a script…');
    const script = await generateScript(brief, { endpoint: flags.endpoint, model: flags.model, apiKey: flags.key, format: flags.format || '16:9', language: flags.lang || 'ar', voice: flags.voice });
    const out = flags.out || 'script.json'; writeFileSync(out, JSON.stringify(script, null, 2)); log(`✅ ${out}  (${script.scenes.length} scenes) — راجعه ثم: doodle render ${out}`); return;
  }
  if (cmd === 'still') {
    const p = loadProject(pos[0]); const c = await compile(p, { cacheDir: CACHE, noAudio: true, log });
    const out = flags.out || 'output/still.png';
    await renderStill(c, +(flags.at || 0), out); log(`✅ ${out}`); return;
  }
  if (cmd === 'render') {
    if (!pos[0]) throw new Error('script.json path is required');
    const p = loadProject(pos[0]);
    const c = await compile(p, { cacheDir: CACHE, noAudio: !!flags['no-audio'], log });
    log(`📝 ${c.scenes.length} scenes · ${c.duration.toFixed(1)}s · ${c.width}x${c.height}`);
    const draft = !!flags.draft;
    const out = flags.out || join('output', basename(pos[0]).replace(/\.json$/, '') + (draft ? '-draft' : '') + '.mp4');
    const r = await renderVideo(c, { out, fps: +(flags.fps || (draft ? 15 : 30)), scale: draft ? 0.5 : +(flags.scale || 1), quality: draft ? 'draft' : (flags.quality || 'good'), log });
    log(`✅ ${r.out}  ${r.width}x${r.height} @${r.fps}fps  ${r.duration.toFixed(1)}s`); return;
  }
  console.log(HELP); process.exitCode = 1;
}
main().catch((e) => { log('❌ ' + (e.stack || e.message)); process.exit(1); });
