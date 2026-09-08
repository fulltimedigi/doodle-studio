// Loads a script JSON and compiles it into what the browser engine needs:
// absolute timings, embedded assets (data URLs), traced images, generated shapes.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import { shapeSvg } from './shapes.mjs';
import { imageToSvg } from './trace.mjs';
import { synthesize } from './tts.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf' };

export function dataUrl(file) {
  const ext = extname(file).toLowerCase();
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
}
const pct = (v, total) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * total : +v);

export function fontCss() {
  const faces = [['Patrick Hand', 'PatrickHand.ttf'], ['Aref Ruqaa', 'ArefRuqaa.ttf'], ['Cairo', 'Cairo.ttf']];
  return faces.filter(([, f]) => existsSync(join(ROOT, 'assets/fonts', f)))
    .map(([name, f]) => `@font-face{font-family:"${name}";src:url(${dataUrl(join(ROOT, 'assets/fonts', f))});}`).join('\n');
}

export function loadProject(file) {
  const abs = resolve(file);
  const p = JSON.parse(readFileSync(abs, 'utf8'));
  p.__dir = dirname(abs);
  return p;
}

function resolveAsset(p, src) {
  if (/^(data:|https?:)/.test(src)) return src;
  const candidates = [resolve(p.__dir, src), resolve(ROOT, src), resolve(ROOT, 'assets', src)];
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error(`Asset not found: ${src} (looked in ${candidates.join(', ')})`);
  return hit;
}

async function compileElement(p, e, W, H, seed) {
  const box = { x: e.x ?? '10%', y: e.y ?? '10%', w: e.w ?? '30%', h: e.h ?? '30%' };
  const base = { ...box, rotate: e.rotate || 0, draw: e.draw, at: e.at, until: e.until, color: e.color, strokeWidth: e.strokeWidth };
  switch (e.type) {
    case 'text':
      return { ...base, kind: 'text', content: String(e.text ?? ''), size: e.size, font: e.font, align: e.align, weight: e.weight, dir: e.dir };
    case 'icon': {
      const file = resolveAsset(p, `icons/${e.name}.svg`);
      let svg = readFileSync(file, 'utf8');
      if (e.color) svg = svg.replace(/#222222|#222\b/g, e.color);
      return { ...base, kind: 'drawing', svg, style: e.style || 'line' };
    }
    case 'svg': {
      const file = resolveAsset(p, e.src);
      const svg = readFileSync(file, 'utf8');
      if (e.mode === 'draw') return { ...base, kind: 'drawing', svg, trace: 'centerline', style: e.style || 'color', traceSize: e.traceSize };
      return { ...base, kind: 'drawing', svg, style: e.style || 'color' };
    }
    case 'image': {
      const file = resolveAsset(p, e.src);
      const mode = e.mode || 'draw';
      const isSvg = extname(file).toLowerCase() === '.svg';
      if (mode === 'reveal') return { ...base, kind: 'photo', src: dataUrl(file) };
      if (mode === 'outline' && isSvg) return { ...base, kind: 'drawing', svg: readFileSync(file, 'utf8'), style: e.style || 'color' };
      if (mode === 'logo' && !isSvg) {
        const svg = await imageToSvg(file, { mode: 'silhouette', threshold: e.threshold ?? 128, color: e.color || '#222' });
        return { ...base, kind: 'drawing', svg, style: e.style || 'color' };
      }
      // default "draw": the renderer extracts centerline pen strokes from the picture (line art, cartoon, logo,
      // photo turned into a sketch) and the hand draws them one by one, then the original colors fade in.
      return { ...base, kind: 'drawing', src: dataUrl(file), trace: 'centerline', threshold: e.threshold, traceSize: e.traceSize, strokeScale: e.strokeScale, style: e.style || 'color' };
    }
    case 'doodle': { // Open Doodles (CC0) hand-drawn people — assets/illustrations/open-doodles/<name>.svg
      const file = resolveAsset(p, `illustrations/open-doodles/${e.name}.svg`);
      let svg = readFileSync(file, 'utf8');
      if (e.accent) svg = svg.replace(/#f4a261/gi, e.accent);
      return { ...base, kind: 'drawing', svg, trace: 'centerline', style: e.style || 'color', traceSize: e.traceSize || 1200 };
    }
    case 'peep': { // Open Peeps (CC0) — a random hand-drawn person from a seed word
      const { createAvatar } = await import('@dicebear/core');
      const style = await import('@dicebear/open-peeps');
      const svg = createAvatar(style, { seed: String(e.seed || e.name || 'peep'), size: 800, ...(e.options || {}) }).toString();
      return { ...base, kind: 'drawing', svg, trace: 'centerline', style: e.style || 'color', traceSize: e.traceSize || 1000 };
    }
    case 'tabler': { // Tabler Icons (MIT) — 5,000+ clean stroke icons: { "type":"tabler", "name":"home" }
      const file = resolveAsset(p, `node_modules/@tabler/icons/icons/outline/${e.name}.svg`);
      let svg = readFileSync(file, 'utf8').replace(/stroke="currentColor"/g, `stroke="${e.color || '#222222'}"`);
      return { ...base, kind: 'drawing', svg, style: 'line' };
    }
    case 'shape':
      // highlight = a marker band ~72% of the element height; the engine converts px -> viewBox units
      return { ...base, kind: 'drawing', svg: shapeSvg(e, seed, { w: pct(box.w, W), h: pct(box.h, H) }), style: 'line',
        strokeWidth: e.strokeWidth || (e.shape === 'highlight' ? 0.72 * pct(box.h, H) : undefined), strokeOpacity: e.shape === 'highlight' ? (e.opacity ?? 0.45) : (e.opacity ?? 1) };
    default:
      throw new Error(`Unknown element type: ${e.type}`);
  }
}

async function handAsset(p) {
  const presets = JSON.parse(readFileSync(join(ROOT, 'assets/hands/hands.json'), 'utf8'));
  let h = p.hand || {};
  if (typeof h === 'string') h = presets[h] ? { ...presets[h] } : { src: h };
  else if (!h.src) h = { ...presets[h.preset || 'marker-a'], ...h };
  const file = resolveAsset(p, h.src);
  let naturalHeight = 520, naturalWidth = 420;
  if (extname(file).toLowerCase() === '.svg') {
    const m = readFileSync(file, 'utf8').match(/viewBox="([\d.\s-]+)"/);
    if (m) { const v = m[1].trim().split(/\s+/).map(Number); naturalWidth = v[2]; naturalHeight = v[3]; }
  } else { const img = await Jimp.read(file); naturalWidth = img.bitmap.width; naturalHeight = img.bitmap.height; }
  return { src: dataUrl(file), naturalHeight, naturalWidth, tip: h.tip || [14, 14], heightPct: h.height || '58%', hidden: h.hidden === true };
}

export async function compile(p, { cacheDir, noAudio = false, log = () => {} } = {}) {
  p.__cacheDir = cacheDir;
  const [W, H] = FORMATS[p.format || '16:9'] || FORMATS['16:9'];
  const d = p.defaults || {};
  const defaults = {
    font: d.font || '"Patrick Hand","Aref Ruqaa","Cairo",cursive',
    fontSize: d.fontSize || '7%', textColor: d.textColor || '#1d1d1d', strokeColor: d.strokeColor || '#222222',
    strokeWidth: d.strokeWidth || 9, background: d.background || '#ffffff',
    transition: d.transition || 'fade', transitionDuration: d.transitionDuration ?? 0.45,
    hold: d.hold ?? 0.9, gap: d.gap ?? 0.15, minDraw: d.minDraw ?? 0.7, maxDraw: d.maxDraw ?? 4,
  };
  const voice = p.voice || 'ar-EG-Shakir';
  const hand = await handAsset(p);
  hand.height = pct(hand.heightPct, H);

  const scenes = []; const audio = []; let clock = 0; let seed = 1;
  for (let si = 0; si < (p.scenes || []).length; si++) {
    const sc = p.scenes[si];
    let narrationDur = 0;
    if (sc.narration && !noAudio && !p.mute) {
      log(`🎙️  scene ${si + 1}: narration`);
      const { file, duration } = await synthesize(sc.narration, { provider: p.tts, voice: sc.voice || voice, rate: sc.rate || p.rate, pitch: p.pitch, style: sc.style || p.voiceStyle, cacheDir: join(cacheDir, 'tts') });
      narrationDur = duration; audio.push({ file, at: clock + (sc.narrationDelay ?? 0.25) });
    } else if (sc.narration) {
      narrationDur = Math.max(2, sc.narration.split(/\s+/).length / 2.6); // ~ reading speed estimate when muted
    }
    const els = [];
    for (const e of sc.elements || []) { els.push(await compileElement(p, e, W, H, seed++)); }
    // timing inside the scene
    const explicit = els.filter((e) => e.draw != null).reduce((a, e) => a + e.draw, 0);
    const autoCount = els.filter((e) => e.draw == null).length;
    const budget = Math.max(narrationDur - explicit - 0.3, autoCount * defaults.minDraw);
    const autoDraw = autoCount ? Math.min(defaults.maxDraw, Math.max(defaults.minDraw, budget / autoCount)) : 0;
    let cursor = sc.startDelay ?? 0.2; let lastEnd = 0;
    for (const e of els) {
      e.draw = e.draw ?? autoDraw;
      const at = e.at != null ? e.at : cursor;
      e.start = clock + at; cursor = at + e.draw + defaults.gap; lastEnd = Math.max(lastEnd, at + e.draw);
      if (e.until != null) e.until = clock + e.until;
    }
    const duration = sc.duration ?? Math.max(narrationDur + 0.6, lastEnd + (sc.hold ?? defaults.hold));
    scenes.push({ start: clock, end: clock + duration, background: sc.background, backgroundImage: sc.backgroundImage ? dataUrl(resolveAsset(p, sc.backgroundImage)) : null, transition: sc.transition, camera: sc.camera, elements: els });
    clock += duration;
  }
  return { width: W, height: H, defaults, hand, scenes, audio, duration: clock, title: p.title || 'doodle', music: p.music ? { file: resolveAsset(p, p.music), volume: p.musicVolume ?? 0.12 } : null };
}
