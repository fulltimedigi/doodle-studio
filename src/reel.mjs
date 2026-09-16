// Reel renderer: a scene spec -> 1080x1920 mp4 (faceless, text-on-screen) + a 4:5 cover + an SRT.
//
// Same shape as the doodle pipeline — build HTML inside Chromium, pipe frames to ffmpeg — but the
// scenes are composed from a fixed set of layouts instead of hand-drawn strokes, so a reel renders
// in seconds rather than minutes. Narration comes from src/tts.mjs, so a scene can carry the text
// to speak and the voice is generated at render time.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { ROOT, dataUrl } from './project.mjs';
import { synthesize, audioDuration } from './tts.mjs';

export const W = 1080, H = 1920;

// The reel palette. `spec.brand` overrides any key, which is how the studio's brand identity
// (primary / accent / background) reaches the renderer.
export const REEL_BRAND = {
  bg: '#ffffff', ink: '#0b2a33', navy: '#004d5b', muted: '#5c6f75',
  green: '#0e9a7a', greenSoft: '#e3f5ef', greyBubble: '#eef1f1', bad: '#c0392b',
};

const FONT = (name, file, weight) =>
  `@font-face{font-family:${name};src:url(${dataUrl(join(ROOT, 'assets/fonts', file))});font-weight:${weight}}`;

export function browserOptions() {
  const opts = { headless: true, args: ['--disable-gpu', '--font-render-hinting=none', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else if (process.env.DOODLE_BROWSER_CHANNEL) opts.channel = process.env.DOODLE_BROWSER_CHANNEL;
  return opts;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap each highlight substring in the accent colour. Longest first, so a phrase wins over a word.
function mark(text, highlight) {
  let out = esc(text);
  for (const h of [...(highlight || [])].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(esc(h)).join(`<b class="hl">${esc(h)}</b>`);
  }
  return out;
}

// Font size that keeps the longest line on one line. 0.55 ~ average glyph width / size for Almarai bold.
function fit(lines, width, maxPx, ratio = 0.55) {
  const n = Math.max(1, ...lines.filter(Boolean).map((l) => l.length));
  return Math.floor(Math.min(maxPx, width / (n * ratio)));
}

const linesHtml = (lines, highlight) =>
  (lines || []).filter(Boolean).map((l) => `<div class="line">${mark(l, highlight)}</div>`).join('');

function css(B, logo) {
  return `
${FONT('Almarai', 'Almarai-ExtraBold.ttf', 800)}
${FONT('Almarai', 'Almarai-Bold.ttf', 700)}
${FONT('Almarai', 'Almarai-Regular.ttf', 400)}
${FONT('Plex', 'IBMPlexSansArabic-Regular.ttf', 400)}
${FONT('Plex', 'IBMPlexSansArabic-SemiBold.ttf', 600)}
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${B.bg};color:${B.ink};font-family:Plex,Almarai,sans-serif;direction:rtl}
.frame{position:relative;width:${W}px;height:${H}px;padding:140px 90px 160px}
.logo{position:absolute;top:60px;left:60px;width:120px;height:120px;background:url(${logo}) center/contain no-repeat}
.hl{color:${B.green};font-weight:inherit}
.title{font-family:Almarai;font-weight:800;line-height:1.25;text-align:center;color:${B.navy}}
.sub{margin-top:44px;font-size:48px;line-height:1.5;text-align:center;color:${B.muted}}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 90px}
.line{white-space:nowrap}
.overlay{position:absolute;top:200px;left:70px;right:70px;text-align:center;font-family:Almarai;font-weight:800;line-height:1.3;color:${B.navy}}
.tag{position:absolute;bottom:96px;left:0;right:0;text-align:center;font-size:40px;color:${B.muted};font-weight:600;unicode-bidi:plaintext}
.chat{position:absolute;top:380px;left:90px;right:90px;bottom:220px;display:flex;flex-direction:column;justify-content:center;gap:40px}
.header{font-family:Almarai;font-weight:800;font-size:64px;color:${B.navy};text-align:center;margin-bottom:30px}
.header .pill{display:inline-block;padding:10px 36px;border-radius:999px;background:${B.greyBubble}}
.header.good .pill{background:${B.greenSoft};color:${B.green}}
.b{max-width:88%;padding:42px 50px;border-radius:46px;font-size:62px;line-height:1.45;font-weight:600;position:relative}
.b.user{align-self:flex-start;background:${B.greyBubble};border-bottom-left-radius:12px}
.b.bot{align-self:flex-end;background:${B.greyBubble};border-bottom-right-radius:12px}
.b.bot.good{background:${B.greenSoft};border:4px solid ${B.green}}
.b.note{align-self:center;background:transparent;color:${B.muted};font-size:40px;font-weight:400;padding:10px 20px;border:2px dashed #cfd8d7;border-radius:20px}
.b.bot.silent{color:${B.muted};letter-spacing:10px;font-weight:400}
.typing{align-self:flex-end;background:${B.greyBubble};border-radius:44px;padding:30px 46px;font-size:54px;color:${B.muted};letter-spacing:8px}
.stamp{position:absolute;top:-48px;left:30px;transform:rotate(-8deg);border:6px solid ${B.bad};color:${B.bad};font-family:Almarai;font-weight:800;font-size:40px;padding:8px 22px;border-radius:14px;background:rgba(255,255,255,.85)}
.check{position:absolute;top:-34px;left:24px;width:84px;height:84px;border-radius:50%;background:${B.green};color:#fff;font-size:54px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:Almarai}
.anim{opacity:calc(var(--p));transform:translateY(calc((1 - var(--p)) * 60px))}
.top{position:absolute;top:200px;left:70px;right:70px;text-align:center}
.center .kicker{margin-bottom:26px}
.kicker{display:inline-block;font-family:Almarai;font-weight:800;font-size:34px;color:${B.green};background:${B.greenSoft};padding:8px 28px;border-radius:999px;margin-bottom:22px}
.top .title{font-size:80px}
.top .sub{margin-top:22px;font-size:40px}
.chips{margin-top:26px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
.chip{font-size:32px;font-weight:600;color:${B.navy};background:${B.greyBubble};padding:10px 26px;border-radius:999px}
.chip.on{background:${B.greenSoft};color:${B.green}}
.chip.bad{background:#fbecea;color:${B.bad}}
.st{position:absolute;border-radius:10px 10px 0 0;background:linear-gradient(180deg,${B.green},#0b4d40)}
.st.dim{background:linear-gradient(180deg,#d9efe8,#c5e3da)}
.st .n{position:absolute;top:14px;left:0;right:0;text-align:center;color:#fff;font-family:Almarai;font-weight:800;font-size:30px;opacity:.9}
.st .coin{position:absolute;top:-52px;left:0;right:0;text-align:center;font-size:40px}
.floor{position:absolute;left:0;right:0;height:6px;background:#dfe7e6}
.door{position:absolute;width:92px;height:150px;border-radius:46px 46px 0 0;background:linear-gradient(180deg,#eafff6,#bff0dc);border:5px solid ${B.green};box-shadow:0 0 60px 16px rgba(14,154,122,.25)}
.door .lbl{position:absolute;top:-58px;left:-60px;right:-60px;text-align:center;font-size:32px;font-weight:600;color:${B.navy};white-space:nowrap}
.man{position:absolute;width:70px}
.man .h{width:44px;height:44px;border-radius:50%;background:${B.navy};margin:0 auto}
.man .bd{width:70px;height:78px;border-radius:26px 26px 12px 12px;background:${B.green};margin-top:6px}
.man.bad .bd{background:${B.bad}}
.man.big{width:150px}
.man.big .h{width:94px;height:94px}
.man.big .bd{width:150px;height:170px;border-radius:54px 54px 24px 24px}
.man.fade{opacity:.25}
.q{position:absolute;width:70px;height:70px;border-radius:50%;background:#fff;border:5px solid ${B.bad};color:${B.bad};font-family:Almarai;font-weight:800;font-size:44px;display:flex;align-items:center;justify-content:center}
.biglogo{position:absolute;width:230px;height:230px;background:url(${logo}) center/contain no-repeat}
.tags{position:absolute;display:flex;flex-direction:column;gap:14px;align-items:flex-start}
.tags .t{font-size:34px;font-weight:600;color:${B.bad};background:#fbecea;padding:8px 24px;border-radius:14px;white-space:nowrap}
.shop{position:absolute;width:360px;height:520px;border-radius:180px 180px 0 0;background:linear-gradient(180deg,#eafff6,#bff0dc);border:6px solid ${B.green};box-shadow:0 0 90px 24px rgba(14,154,122,.22)}
.shop .lbl{position:absolute;top:-80px;left:-80px;right:-80px;text-align:center;font-family:Almarai;font-weight:800;font-size:48px;color:${B.navy};white-space:nowrap}
.tagpill{position:absolute;font-size:36px;font-weight:600;color:${B.bad};background:#fbecea;padding:10px 26px;border-radius:14px;white-space:nowrap}
.card{position:absolute;left:90px;right:90px;top:640px;background:#fff;border:4px solid #e3e9e8;border-radius:48px;padding:56px 56px 48px;box-shadow:0 30px 80px rgba(11,42,51,.10)}
.card .badge{position:absolute;top:-30px;right:48px;background:${B.navy};color:#fff;font-size:30px;font-weight:600;padding:10px 28px;border-radius:999px}
.card .pname{font-family:Almarai;font-weight:800;font-size:56px;color:${B.navy};margin-bottom:10px}
.card .plat{font-size:32px;color:${B.muted};margin-bottom:34px}
.row{display:flex;align-items:center;gap:22px;padding:22px 0;border-top:3px solid #eef1f1;font-size:44px}
.row .k{color:${B.muted};min-width:300px}
.row .v{font-weight:600;color:${B.ink}}
.row.miss .v{color:${B.bad};font-weight:600}
.row .mark{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;background:${B.green};font-family:Almarai;flex:0 0 auto}
.row.miss .mark{background:${B.bad}}
.ask{margin-top:34px;background:${B.greyBubble};border-radius:28px;padding:26px 32px;font-size:40px;color:${B.navy}}
.rep{position:absolute;left:90px;right:90px;top:560px;background:#fff;border:4px solid ${B.green};border-radius:48px;padding:0 0 46px;overflow:hidden;box-shadow:0 30px 80px rgba(14,154,122,.16)}
.rep .hd{background:${B.greenSoft};padding:40px 48px;font-family:Almarai;font-weight:800;font-size:52px;color:${B.navy}}
.rep .hd small{display:block;font-family:Plex;font-weight:400;font-size:32px;color:${B.muted};margin-top:10px}
.rep .it{display:flex;align-items:flex-start;gap:24px;padding:34px 48px 0;font-size:44px;line-height:1.4;font-weight:600;color:${B.ink}}
.rep .it .dot{width:50px;height:50px;border-radius:50%;background:${B.green};color:#fff;font-size:30px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:Almarai;flex:0 0 auto;margin-top:6px}
.rep .ft{margin:36px 48px 0;padding-top:28px;border-top:3px solid #eef1f1;font-size:34px;color:${B.muted}}
.cta{position:absolute;left:90px;right:90px;bottom:250px;text-align:center}
.cta .word{display:inline-block;background:${B.green};color:#fff;font-family:Almarai;font-weight:800;font-size:64px;padding:26px 70px;border-radius:999px;box-shadow:0 20px 50px rgba(14,154,122,.35)}
.cta .how{margin-top:28px;font-size:38px;color:${B.muted}}
`;
}

const page = (body, p = 1) =>
  `<body style="--p:${p}"><div class="frame"><div class="logo"></div>${body}</div></body>`;

function overlayHtml(ov) {
  if (!ov || !(ov.lines || []).some(Boolean)) return '';
  return `<div class="overlay" style="font-size:${fit(ov.lines, 940, 84)}px">${linesHtml(ov.lines, ov.highlight)}</div>`;
}

// A heading block shared by the stairs / walk / product / report scenes.
function topHtml(sc) {
  const tl = (sc.lines || []).filter(Boolean);
  const kick = sc.kicker ? `<div class="kicker">${esc(sc.kicker)}</div><br>` : '';
  const title = tl.length ? `<div class="title" style="font-size:${fit(tl, 940, 80)}px">${linesHtml(tl, sc.highlight)}</div>` : '';
  const sub = sc.sub ? `<div class="sub">${mark(sc.sub, sc.highlight)}</div>` : '';
  const chips = (sc.chips || []).length
    ? `<div class="chips">${sc.chips.map((c) => `<div class="chip ${typeof c === 'object' ? c.cls || '' : ''}">${esc(typeof c === 'object' ? c.text : c)}</div>`).join('')}</div>`
    : '';
  return (tl.length || kick || sub || chips) ? `<div class="top anim">${kick}${title}${sub}${chips}</div>` : '';
}

/** Build the frames of one scene: [{ html, seconds }, ...], entrance animation included. */
export function sceneFrames(sc, overlay) {
  const kind = sc.type || 'title';
  const dur = +(sc.duration ?? 3.5);
  const ov = overlayHtml(sc.overlay === undefined ? overlay : sc.overlay);
  const tag = sc.tag ? `<div class="tag">${esc(sc.tag)}</div>` : '';
  const entrance = 0.5, steps = Math.max(2, Math.round(entrance * 12));
  const out = [];
  const add = (html, seconds, p = 1) => out.push({ html: page(html, p), seconds });

  if (kind === 'title' || kind === 'outro') {
    const tl = (sc.lines || []).filter(Boolean);
    const kick = sc.kicker ? `<div class="kicker">${esc(sc.kicker)}</div>` : '';
    const body = kick + (tl.length ? `<div class="title" style="font-size:${fit(tl, 900, 112)}px">${linesHtml(tl, sc.highlight)}</div>` : '');
    const sub = sc.sub ? `<div class="sub">${mark(sc.sub, sc.highlight)}</div>` : '';
    for (let i = 0; i < steps; i++) {
      const p = (i + 1) / steps;
      add(`${ov}<div class="center"><div class="anim">${body}${(p > 0.7 || !tl.length) ? sub : ''}</div></div>${tag}`, entrance / steps, p);
    }
    add(`${ov}<div class="center">${body}${sub}</div>${tag}`, Math.max(0.2, dur - entrance));

  } else if (kind === 'chat') {
    const bubbles = sc.bubbles || [];
    const hdr = sc.header ? `<div class="header ${sc.header_variant || ''}"><span class="pill">${esc(sc.header)}</span></div>` : '';
    const per = dur / Math.max(1, bubbles.length);
    const bubble = (b) => {
      let extra = '';
      if (b.stamp) extra += `<div class="stamp">${esc(b.stamp)}</div>`;
      if (b.check) extra += '<div class="check">✓</div>';
      return `<div class="b ${b.who || 'bot'} ${b.variant || ''}">${mark(b.text || '', b.highlight)}${extra}</div>`;
    };
    for (let k = 0; k < bubbles.length; k++) {
      const shown = bubbles.slice(0, k).map(bubble).join('');
      const nxt = bubbles[k];
      const typing = nxt.who === 'bot' ? Math.min(0.9, per * 0.35) : 0;
      if (typing) add(`${ov}<div class="chat">${hdr}${shown}<div class="typing">•••</div></div>${tag}`, typing);
      for (let i = 0; i < steps; i++) {
        const p = (i + 1) / steps;
        add(`${ov}<div class="chat">${hdr}${shown}<div class="anim">${bubble(nxt)}</div></div>${tag}`, entrance / steps, p);
      }
      add(`${ov}<div class="chat">${hdr}${shown}${bubble(nxt)}</div>${tag}`, Math.max(0.3, per - entrance - typing));
    }

  } else if (kind === 'stairs') {
    const n = +(sc.steps ?? 8);
    const doorAt = sc.door_at === undefined ? Math.floor(n / 2) - 1 : sc.door_at;
    const L = 60, R = 1020, FLOOR = 1580, TOP = 760;
    const w = (R - L) / n, rise = (FLOOR - TOP) / n;
    const topY = (k) => FLOOR - (k + 1) * rise;
    const lit = sc.lit ?? n, coins = sc.coins || [];
    const stairs = (p) => {
      let s = '';
      for (let k = 0; k < n; k++) {
        const dim = k >= lit ? ' dim' : '';
        const coin = coins.includes(k) ? '<div class="coin">💰</div>' : '';
        s += `<div class="st${dim}" style="left:${Math.round(L + k * w)}px;top:${Math.round(topY(k))}px;width:${Math.round(w - 6)}px;height:${Math.round(FLOOR - topY(k))}px"><div class="n">${k + 1}</div>${coin}</div>`;
      }
      s += `<div class="floor" style="top:${FLOOR}px"></div>`;
      if (doorAt !== null && doorAt >= 0) {
        const dx = L + doorAt * w + w / 2 - 46;
        s += `<div class="door" style="left:${Math.round(dx)}px;top:${Math.round(topY(doorAt) - 150)}px"><div class="lbl">${esc(sc.door_label || 'متجرك')}</div></div>`;
      }
      const k0 = +(sc.from ?? 0), k1 = +(sc.to ?? k0), k = k0 + (k1 - k0) * p;
      const mx = L + k * w + w / 2 - 35, my = topY(k) - 128;
      const state = sc.state || '';
      if (!sc.logo_big) s += `<div class="man ${state}" style="left:${Math.round(mx)}px;top:${Math.round(my)}px"><div class="h"></div><div class="bd"></div></div>`;
      if (state === 'bad') s += `<div class="q" style="left:${Math.round(mx + 60)}px;top:${Math.round(my - 70)}px">؟</div>`;
      if ((sc.tags || []).length) s += `<div class="tags" style="left:${L}px;top:${Math.round(topY(n - 1) + 20)}px">${sc.tags.map((t) => `<div class="t">${esc(t)}</div>`).join('')}</div>`;
      if (sc.logo_big) s += `<div class="biglogo" style="left:${Math.round(Math.min(R - 230, L + (n - 1) * w + w / 2 - 115))}px;top:${Math.round(topY(n - 1) - 236)}px"></div>`;
      return s;
    };
    const move = +(sc.move_seconds ?? 1.6), ms = Math.max(2, Math.round(move * 12));
    for (let i = 0; i < ms; i++) { const p = (i + 1) / ms; add(`${ov}${topHtml(sc)}${stairs(p)}${tag}`, move / ms, p); }
    add(`${ov}${topHtml(sc)}${stairs(1)}${tag}`, Math.max(0.3, dur - move));

  } else if (kind === 'walk') {
    const FLOOR = +(sc.floor ?? 1400);
    const kf = sc.keyframes || [{ x: 120 }, { x: 540 }, { x: 900, state: 'bad' }];
    const door = sc.door === undefined ? { x: 540, label: 'متجرك' } : sc.door;
    const walk = (p) => {
      let s = `<div class="floor" style="top:${FLOOR}px"></div>`;
      if (door) s += `<div class="shop" style="left:${Math.round(door.x - 180)}px;top:${FLOOR - 520}px"><div class="lbl">${esc(door.label || '')}</div></div>`;
      const seg = Math.max(1, kf.length - 1), q = p * seg;
      const i = Math.min(Math.floor(q), seg - 1), f = q - i;
      const nxt = kf[Math.min(i + 1, kf.length - 1)];
      const x = kf[i].x + (nxt.x - kf[i].x) * f;
      const cur = f > 0.5 ? nxt : kf[i];
      s += `<div class="man big ${cur.state || ''}${cur.fade ? ' fade' : ''}" style="left:${Math.round(x - 75)}px;top:${FLOOR - 270}px"><div class="h"></div><div class="bd"></div></div>`;
      if (cur.state === 'bad') s += `<div class="q" style="left:${Math.round(x + 60)}px;top:${FLOOR - 360}px">؟</div>`;
      if (p >= 0.999 && sc.end_pill) s += `<div class="tagpill" style="left:${Math.round(Math.min(W - 440, x - 210))}px;top:${FLOOR - 470}px">${esc(sc.end_pill)}</div>`;
      return s;
    };
    const move = +(sc.move_seconds ?? 2.4), ms = Math.max(2, Math.round(move * 12));
    for (let i = 0; i < ms; i++) { const p = (i + 1) / ms; add(`${ov}${topHtml(sc)}${walk(p)}${tag}`, move / ms, p); }
    add(`${ov}${topHtml(sc)}${walk(1)}${tag}`, Math.max(0.3, dur - move));

  } else if (kind === 'product' || kind === 'report') {
    const items = sc.rows || [], n = Math.max(1, items.length);
    const reveal = +(sc.reveal_seconds ?? Math.min(2.4, dur * 0.6));
    const body = (k) => {
      if (kind === 'product') {
        const badge = sc.badge ? `<div class="badge">${esc(sc.badge)}</div>` : '';
        const rows = items.slice(0, k).map((r) =>
          `<div class="row${r.missing ? ' miss' : ''}"><div class="mark">${r.missing ? '✕' : '✓'}</div><div class="k">${esc(r.k || '')}</div><div class="v">${esc(r.v || '')}</div></div>`).join('');
        const ask = (sc.ask && k >= n) ? `<div class="ask">${mark(sc.ask, sc.highlight)}</div>` : '';
        return `<div class="card">${badge}<div class="pname">${esc(sc.pname || '')}</div><div class="plat">${esc(sc.plat || '')}</div>${rows}${ask}</div>`;
      }
      const hd = `<div class="hd">${esc(sc.title || '')}<small>${esc(sc.subtitle || '')}</small></div>`;
      const its = items.slice(0, k).map((r, i) =>
        `<div class="it"><div class="dot">${i + 1}</div><div>${mark(typeof r === 'string' ? r : r.t || '', sc.highlight)}</div></div>`).join('');
      const ft = (sc.note && k >= n) ? `<div class="ft">${esc(sc.note)}</div>` : '';
      return `<div class="rep">${hd}${its}${ft}</div>`;
    };
    const cta = sc.cta
      ? `<div class="cta"><div class="word">${esc(sc.cta.word)}</div>${sc.cta.how ? `<div class="how">${esc(sc.cta.how)}</div>` : ''}</div>`
      : '';
    const rs = Math.max(n, Math.round(reveal * 8));
    for (let i = 0; i < rs; i++) {
      const p = (i + 1) / rs, k = Math.max(1, Math.min(n, Math.round(p * n)));
      add(`${ov}${topHtml(sc)}${body(k)}${p > 0.9 ? cta : ''}${tag}`, reveal / rs, Math.min(1, p * 2));
    }
    add(`${ov}${topHtml(sc)}${body(n)}${cta}${tag}`, Math.max(0.3, dur - reveal));

  } else {
    throw new Error(`unknown scene type: ${kind}`);
  }
  return out;
}

// A scene's `voice` is either a path to an audio file, or { text, voice, provider, rate } to
// synthesize now. Either way the scene is stretched so the line always finishes inside it.
async function prepareVoices(spec, { dir, cacheDir, log }) {
  const tempo = +(spec.voice_tempo ?? 1), pad = +(spec.voice_pad ?? 0.5);
  for (const sc of spec.scenes) {
    if (!sc.voice) continue;
    let file;
    if (typeof sc.voice === 'string') {
      file = isAbsolute(sc.voice) ? sc.voice : resolve(dir, sc.voice);
      if (!existsSync(file)) throw new Error(`voice file not found: ${sc.voice}`);
    } else {
      log(`🎙 ${String(sc.voice.text).slice(0, 40)}…`);
      ({ file } = await synthesize(sc.voice.text, {
        provider: sc.voice.provider || spec.voice_provider,
        voice: sc.voice.voice || spec.voice_name,
        rate: sc.voice.rate || spec.voice_rate,
        cacheDir,
      }));
      if (!sc.spoken) sc.spoken = sc.voice.text;
    }
    sc._voice = file;
    sc.duration = Math.max(+(sc.duration ?? 3.5), (await audioDuration(file)) / tempo + pad);
  }
  return { tempo };
}

const srtTime = (x) => {
  const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
};

const ff = (args) => new Promise((ok, bad) => {
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  p.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited with ${c}`))));
  p.on('error', bad);
});

/**
 * Render a reel spec to `out/<slug>.mp4`, plus a 4:5 cover PNG and an SRT of the spoken lines.
 * Returns { mp4, cover, srt, seconds, frames, voiceLines }.
 */
export async function renderReel(spec, { out, fps = 30, music = null, musicVolume = 0.12, dir = process.cwd(), cacheDir = join(ROOT, '.cache'), log = () => {} } = {}) {
  mkdirSync(out, { recursive: true });
  mkdirSync(join(cacheDir, 'tts'), { recursive: true });
  const slug = spec.slug || 'reel';
  const B = { ...REEL_BRAND, ...(spec.brand || {}) };
  const logo = dataUrl(join(ROOT, 'assets/brand/fd-logo.png'));

  const { tempo } = await prepareVoices(spec, { dir, cacheDir: join(cacheDir, 'tts'), log });

  // ---- frames ----
  const overlaySeconds = +(spec.overlay?.seconds ?? 3.5);
  const shots = [];              // { buf, frames }
  const srt = [], voices = [];
  let t = 0;

  const browser = await chromium.launch(browserOptions());
  try {
    const page_ = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page_.setContent(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css(B, logo)}</style></head><body></body></html>`);
    await page_.evaluate(() => document.fonts.ready);
    for (const sc of spec.scenes) {
      const start = t;
      const here = t < overlaySeconds - 0.01 ? spec.overlay : null;
      for (const { html, seconds } of sceneFrames(sc, here)) {
        await page_.evaluate((h) => { document.documentElement.querySelector('body').outerHTML = h; }, html);
        const buf = await page_.screenshot({ type: 'jpeg', quality: 94 });
        shots.push({ buf, frames: Math.max(1, Math.round(seconds * fps)) });
        t += seconds;
      }
      if (sc.spoken) srt.push([start, t, sc.spoken]);
      if (sc._voice) voices.push([start, sc._voice]);
      log(`🎬 ${sc.type || 'title'} — ${t.toFixed(1)}s`);
    }
  } finally { await browser.close(); }

  // ---- encode ----
  const mp4 = join(out, `${slug}.mp4`);
  const silent = (voices.length || music) ? join(out, `.${slug}-silent.mp4`) : mp4;
  await new Promise((ok, bad) => {
    const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps),
      '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited with ${c}`))));
    p.on('error', bad);
    (async () => {
      for (const { buf, frames } of shots) {
        for (let i = 0; i < frames; i++) {
          if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
        }
      }
      p.stdin.end();
    })();
  });

  if (voices.length || music) {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', silent];
    const parts = [], labels = [];
    voices.forEach(([at, file], i) => {
      args.push('-i', file);
      const ms = Math.round(at * 1000);
      const tf = Math.abs(tempo - 1) > 1e-3 ? `atempo=${tempo},` : '';
      parts.push(`[${i + 1}:a]aresample=44100,${tf}adelay=${ms}|${ms}[v${i + 1}]`);
      labels.push(`[v${i + 1}]`);
    });
    if (music) {
      const mi = voices.length + 1;
      args.push('-stream_loop', '-1', '-i', music);
      parts.push(`[${mi}:a]aresample=44100,volume=${musicVolume}[mus]`);
      labels.push('[mus]');
    }
    // loudnorm brings the mix to the ~-14 LUFS the social platforms expect
    parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
    args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
    if (music) args.push('-shortest');   // looping music would otherwise run forever
    args.push('-movflags', '+faststart', mp4);
    await ff(args);
    try { unlinkSync(silent); } catch {}
  }

  const cover = join(out, `${slug}-cover.png`);
  const coverAt = +(spec.cover_at ?? Math.min(2.5, t * 0.08));
  await ff(['-y', '-hide_banner', '-loglevel', 'error', '-ss', coverAt.toFixed(2), '-i', mp4,
    '-frames:v', '1', '-vf', 'crop=1080:1350:0:190', cover]);

  const srtFile = join(out, `${slug}.srt`);
  writeFileSync(srtFile, srt.map(([a, b, text], i) => `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${text}\n`).join('\n'), 'utf8');

  return { mp4, cover, srt: srtFile, seconds: +t.toFixed(2), frames: shots.length, voiceLines: voices.length };
}
