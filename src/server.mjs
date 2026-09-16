#!/usr/bin/env node
// Doodle Studio web UI — a small local server (no framework) that wraps the engine:
//   brief -> AI script -> edit scenes -> preview stills -> voice preview -> render -> download.
// Works on a laptop (npm start) and inside Docker (Hugging Face Spaces / any VPS).
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadProject, compile } from './project.mjs';
import { renderVideo, renderStill } from './render.mjs';
import { renderReel } from './reel.mjs';
import { VOICES, synthesize } from './tts.mjs';
import { generateScript } from './ai.mjs';

const PORT = +(process.env.PORT || 7860);
const WORK = process.env.DOODLE_WORKSPACE || join(ROOT, 'workspace');
for (const d of ['art', 'output', 'scripts', 'hands']) mkdirSync(join(WORK, d), { recursive: true });
// first run: seed the workspace with the example illustrations so the example script renders out of the box
if (!readdirSync(join(WORK, 'art')).length) for (const f of readdirSync(join(ROOT, 'examples/art'))) writeFileSync(join(WORK, 'art', f), readFileSync(join(ROOT, 'examples/art', f)));
const CACHE = process.env.DOODLE_CACHE || join(ROOT, '.cache');
const ENV_FILE = join(WORK, '.env');
const SETTABLE = ['GEMINI_API_KEY', 'GOOGLE_TTS_KEY', 'AZURE_TTS_KEY', 'AZURE_TTS_REGION', 'TTS_ENDPOINT', 'TTS_KEY', 'TTS_MODEL', 'DOODLE_AI_ENDPOINT', 'DOODLE_AI_MODEL', 'DOODLE_AI_KEY', 'DOODLE_TTS'];
if (existsSync(ENV_FILE)) for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }

const MIME = { '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.ttf': 'font/ttf' };
const jobs = new Map();
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, bad) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 80e6) bad(new Error('too large')); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });
const safe = (p) => { const r = resolve(WORK, p.replace(/^\/+/, '')); if (!r.startsWith(WORK)) throw new Error('bad path'); return r; };
// Same containment check for paths served out of the repo: a decoded request path can still
// carry ../ segments, so resolve first and refuse anything that lands outside the base.
const under = (base, p) => { const r = resolve(base, p.replace(/^\/+/, '')); return r.startsWith(base + '/') || r === base ? r : null; };
const serveUnder = (res, base, p) => { const f = under(base, p); if (!f) { res.writeHead(403); return res.end('forbidden'); } return sendFile(res, f); };
const slug = (s) => String(s || 'file').replace(/[^\w.\-؀-ۿ]+/g, '-').slice(0, 80);

function sendFile(res, file) {
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

function scriptFromBody(b) {
  // scripts edited in the UI live in workspace/scripts; assets resolve relative to the workspace
  const p = JSON.parse(JSON.stringify(b.script)); p.__dir = WORK; return p;
}

function meta() {
  const doodles = readdirSync(join(ROOT, 'assets/illustrations/open-doodles')).map((f) => f.replace('.svg', ''));
  const icons = readFileSync(join(ROOT, 'assets/icons/INDEX.txt'), 'utf8').trim().split(/,\s*/);
  const tab = join(ROOT, 'node_modules/@tabler/icons/icons/outline');
  const tabler = existsSync(tab) ? readdirSync(tab).map((f) => f.replace('.svg', '')) : [];
  const hands = Object.keys(JSON.parse(readFileSync(join(ROOT, 'assets/hands/hands.json'), 'utf8')));
  const userHands = readdirSync(join(WORK, 'hands')).filter((f) => /\.png$/i.test(f)).map((f) => 'hands/' + f);
  const art = readdirSync(join(WORK, 'art')).filter((f) => /\.(png|jpe?g|svg|webp)$/i.test(f)).map((f) => 'art/' + f);
  const outputs = readdirSync(join(WORK, 'output')).filter((f) => f.endsWith('.mp4')).sort((a, b) => statSync(join(WORK, 'output', b)).mtimeMs - statSync(join(WORK, 'output', a)).mtimeMs).slice(0, 20);
  const example = JSON.parse(readFileSync(join(ROOT, 'examples/demo-ar.json'), 'utf8'));
  const settings = Object.fromEntries(SETTABLE.map((k) => [k, process.env[k] ? (k.includes('KEY') ? '••••' + process.env[k].slice(-4) : process.env[k]) : '']));
  return { doodles, icons, tabler, hands, userHands, art, outputs, voices: VOICES, example, settings, provider: process.env.DOODLE_TTS || 'edge' };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return sendFile(res, join(ROOT, 'web/local.html'));
    // The suite pages (carousel/reel/ad/…) are written against the static build's layout, where
    // prompts and assets sit under assets/. Map that layout onto the source tree so the same
    // pages work unchanged when the server is the one serving them.
    if (req.method === 'GET' && path.startsWith('/web/assets/prompts/')) return serveUnder(res, join(ROOT, 'prompts'), decodeURIComponent(path.slice(20)));
    if (req.method === 'GET' && path.startsWith('/web/assets/')) {
      const rel = decodeURIComponent(path.slice(12));
      const direct = under(join(ROOT, 'assets'), rel);
      if (!direct) { res.writeHead(403); return res.end('forbidden'); }
      if (existsSync(direct)) return sendFile(res, direct);
      // The webfonts are copied out of @fontsource by the static build; serve them from the
      // package so the suite pages look the same before a build has ever run.
      const m = rel.match(/^fonts\/((cairo|tajawal)-[\w-]+\.woff2)$/);
      if (m) return sendFile(res, join(ROOT, 'node_modules/@fontsource', m[2], 'files', m[1]));
      res.writeHead(404); return res.end('not found');
    }
    if (req.method === 'GET' && path.startsWith('/web/')) return serveUnder(res, join(ROOT, 'web'), decodeURIComponent(path.slice(5)));
    if (req.method === 'GET' && path.startsWith('/files/')) return sendFile(res, safe(decodeURIComponent(path.slice(7))));
    if (req.method === 'GET' && path.startsWith('/assets/')) return serveUnder(res, join(ROOT, 'assets'), decodeURIComponent(path.slice(8)));
    if (req.method === 'GET' && path === '/api/meta') return json(res, 200, meta());
    if (req.method === 'GET' && path.startsWith('/api/jobs/')) { const j = jobs.get(path.split('/').pop()); return j ? json(res, 200, j) : json(res, 404, { error: 'no such job' }); }

    if (req.method === 'POST' && path === '/api/settings') {
      const b = await body(req); const lines = [];
      for (const k of SETTABLE) { if (typeof b[k] === 'string' && !b[k].startsWith('••••')) { if (b[k]) process.env[k] = b[k]; else delete process.env[k]; } if (process.env[k]) lines.push(`${k}=${process.env[k]}`); }
      writeFileSync(ENV_FILE, lines.join('\n') + '\n'); return json(res, 200, { ok: true, settings: meta().settings });
    }
    if (req.method === 'POST' && path === '/api/upload') {
      const b = await body(req); const kind = b.kind === 'hand' ? 'hands' : 'art';
      const name = slug(b.name); const file = join(WORK, kind, name);
      writeFileSync(file, Buffer.from(String(b.data).replace(/^data:[^,]+,/, ''), 'base64'));
      return json(res, 200, { ok: true, path: `${kind}/${name}` });
    }
    if (req.method === 'POST' && path === '/api/ai') {
      const b = await body(req);
      const script = await generateScript(b.brief, { format: b.format || '16:9', language: b.lang || 'ar', voice: b.voice });
      return json(res, 200, { script });
    }
    if (req.method === 'POST' && path === '/api/tts') {
      const b = await body(req);
      const r = await synthesize(b.text, { provider: b.provider || process.env.DOODLE_TTS, voice: b.voice, rate: b.rate, style: b.style, cacheDir: join(CACHE, 'tts') });
      const out = join(WORK, 'output', 'preview-' + basename(r.file)); writeFileSync(out, readFileSync(r.file));
      return json(res, 200, { url: '/files/output/' + basename(out), duration: r.duration });
    }
    if (req.method === 'POST' && path === '/api/still') {
      const b = await body(req); const p = scriptFromBody(b);
      const c = await compile(p, { cacheDir: CACHE, noAudio: true });
      const out = join(WORK, 'output', `still-${Date.now()}.png`);
      await renderStill(c, +(b.t || 0), out);
      return json(res, 200, { url: '/files/output/' + basename(out), duration: c.duration, scenes: c.scenes.map((s) => ({ start: s.start, end: s.end })) });
    }
    if (req.method === 'POST' && path === '/api/save') {
      const b = await body(req); const name = slug(b.name || 'script') + '.json';
      writeFileSync(join(WORK, 'scripts', name), JSON.stringify(b.script, null, 2)); return json(res, 200, { ok: true, name });
    }
    if (req.method === 'POST' && path === '/api/reel') {
      const b = await body(req); const id = Math.random().toString(36).slice(2, 10);
      const job = { id, status: 'queued', progress: 0, log: [], url: null, started: Date.now() }; jobs.set(id, job);
      const spec = b.spec || {};
      spec.slug = slug(spec.slug || spec.title || 'reel');
      (async () => {
        try {
          job.status = 'rendering';
          const r = await renderReel(spec, {
            out: join(WORK, 'output'), dir: WORK, cacheDir: CACHE, fps: +(b.fps || 30),
            log: (m) => { job.log.push(m); if (job.log.length > 40) job.log.shift(); },
          });
          job.status = 'done'; job.progress = 100; job.duration = r.seconds;
          job.url = '/files/output/' + basename(r.mp4);
          job.cover = '/files/output/' + basename(r.cover);
          job.srt = '/files/output/' + basename(r.srt);
        } catch (e) { job.status = 'error'; job.error = e.message; job.log.push('❌ ' + e.message); }
      })();
      return json(res, 200, { id });
    }
    if (req.method === 'POST' && path === '/api/render') {
      const b = await body(req); const id = Math.random().toString(36).slice(2, 10);
      const job = { id, status: 'queued', progress: 0, log: [], url: null, started: Date.now() }; jobs.set(id, job);
      const name = slug(b.name || b.script?.title || 'video') + (b.draft ? '-draft' : '') + '.mp4';
      const out = join(WORK, 'output', name);
      (async () => {
        try {
          job.status = 'compiling';
          const p = scriptFromBody(b);
          const c = await compile(p, { cacheDir: CACHE, log: (m) => job.log.push(m) });
          job.status = 'rendering'; job.duration = c.duration;
          await renderVideo(c, { out, fps: b.draft ? 15 : 30, scale: b.draft ? 0.5 : 1, quality: b.draft ? 'draft' : 'good', log: (m) => { const pm = m.match(/(\d+)%/); if (pm) job.progress = +pm[1]; job.log.push(m); if (job.log.length > 40) job.log.shift(); } });
          job.status = 'done'; job.progress = 100; job.url = '/files/output/' + name;
        } catch (e) { job.status = 'error'; job.error = e.message; job.log.push('❌ ' + e.message); }
      })();
      return json(res, 200, { id });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎨 Doodle Studio  →  http://localhost:${PORT}\n   workspace: ${WORK}\n`);
  if (process.env.DOODLE_OPEN !== '0' && process.platform !== 'linux') {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', `http://localhost:${PORT}`]] : ['open', [`http://localhost:${PORT}`]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }
});
