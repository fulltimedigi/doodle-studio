// Drives the browser engine frame by frame and pipes frames into ffmpeg together with the audio.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { ROOT, fontCss } from './project.mjs';
import { readFileSync } from 'node:fs';

function skeletonScript() {
  const src = readFileSync(join(ROOT, 'node_modules/skeleton-tracing-js/trace_skeleton.vanilla.js'), 'utf8');
  return src.replace(/export\s+default\s+TraceSkeleton\s*;?/, 'window.TraceSkeleton = TraceSkeleton;');
}

function browserOptions() {
  const opts = { headless: true, args: ['--disable-gpu', '--font-render-hinting=none', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else if (process.env.DOODLE_BROWSER_CHANNEL) opts.channel = process.env.DOODLE_BROWSER_CHANNEL; // "chrome" | "msedge"
  return opts;
}

export async function renderVideo(compiled, { out, fps = 30, scale = 1, quality = 'good', log = () => {} }) {
  mkdirSync(dirname(out), { recursive: true });
  const W = Math.round(compiled.width * scale / 2) * 2, H = Math.round(compiled.height * scale / 2) * 2;
  const totalFrames = Math.ceil(compiled.duration * fps);

  // ---- ffmpeg: video from stdin + narration clips (+ optional music) ----
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  const filters = []; const mixInputs = [];
  compiled.audio.forEach((a, i) => { args.push('-i', a.file); filters.push(`[${i + 1}]adelay=${Math.round(a.at * 1000)}:all=1[a${i}]`); mixInputs.push(`[a${i}]`); });
  let musicIdx = -1;
  if (compiled.music) { musicIdx = compiled.audio.length + 1; args.push('-stream_loop', '-1', '-i', compiled.music.file); filters.push(`[${musicIdx}]volume=${compiled.music.volume},afade=t=out:st=${Math.max(0, compiled.duration - 2)}:d=2[m]`); mixInputs.push('[m]'); }
  if (mixInputs.length) {
    filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,apad=whole_dur=${compiled.duration.toFixed(3)}[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  } else args.push('-an');
  const crf = quality === 'draft' ? '28' : quality === 'best' ? '16' : '19';
  args.push('-c:v', 'libx264', '-preset', quality === 'draft' ? 'veryfast' : 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', compiled.duration.toFixed(3), out);
  const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited with ${c}`)))); ff.on('error', rej); });
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

  // ---- browser ----
  const browser = await chromium.launch(browserOptions());
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(ROOT, 'src/renderer/page.html')).href);
    await page.addStyleTag({ content: fontCss() });
    await page.addScriptTag({ content: skeletonScript() });
    await page.evaluate(() => document.fonts.ready);
    const scaled = { ...compiled, width: W, height: H, hand: { ...compiled.hand, height: compiled.hand.height * scale } };
    // element boxes are percent/px in the unscaled canvas -> scale px values
    const s = scale;
    scaled.scenes = compiled.scenes.map((sc) => ({ ...sc, elements: sc.elements.map((e) => ({ ...e, x: px(e.x, compiled.width, s), y: px(e.y, compiled.height, s), w: px(e.w, compiled.width, s), h: px(e.h, compiled.height, s), size: e.size, strokeWidth: e.strokeWidth ? e.strokeWidth * s : undefined })) }));
    scaled.defaults = { ...compiled.defaults, strokeWidth: compiled.defaults.strokeWidth * s };
    const info = await page.evaluate((p) => window.doodle.build(p), scaled);
    if (!info.ok) throw new Error('engine build failed');
    await page.evaluate(() => document.fonts.ready);
    const t0 = Date.now();
    for (let f = 0; f < totalFrames; f++) {
      const t = f / fps;
      await page.evaluate((tt) => window.doodle.seek(tt), t);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'disabled', caret: 'hide' });
      await write(buf);
      if (f % Math.max(1, Math.round(fps)) === 0 || f === totalFrames - 1) {
        const pctDone = Math.round(((f + 1) / totalFrames) * 100); const el = (Date.now() - t0) / 1000;
        log(`🎬 ${pctDone}%  frame ${f + 1}/${totalFrames}  (${el.toFixed(0)}s)`);
      }
    }
  } finally { await browser.close(); }
  ff.stdin.end();
  await ffDone;
  return { out, width: W, height: H, fps, frames: totalFrames, duration: compiled.duration };
}

function px(v, total, s) { return (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * total : +v) * s; }

export async function renderStill(compiled, t, out) {
  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch(browserOptions());
  try {
    const page = await browser.newPage({ viewport: { width: compiled.width, height: compiled.height } });
    await page.goto(pathToFileURL(join(ROOT, 'src/renderer/page.html')).href);
    await page.addStyleTag({ content: fontCss() });
    await page.addScriptTag({ content: skeletonScript() });
    await page.evaluate(() => document.fonts.ready);
    const p = { ...compiled, scenes: compiled.scenes.map((sc) => ({ ...sc, elements: sc.elements.map((e) => ({ ...e, x: px(e.x, compiled.width, 1), y: px(e.y, compiled.height, 1), w: px(e.w, compiled.width, 1), h: px(e.h, compiled.height, 1) })) })) };
    await page.evaluate((pp) => window.doodle.build(pp), p);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((tt) => window.doodle.seek(tt), t);
    await page.screenshot({ path: out, type: 'png' });
  } finally { await browser.close(); }
  return out;
}
