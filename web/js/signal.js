// FTD Content Signal System — نظام إشارات المحتوى
//
// Every piece of content carries the same three lines, in the same order, in the same place,
// with the same three colours:
//
//   لمن؟          who   — the audience, so a viewer sorts themselves in before reading anything
//   لماذا يهمه؟   why   — the problem, so the subject lands even with the sound off
//   ماذا ينتظره؟  what  — the next step, so the piece ends somewhere
//
// The point is not the strip. The point is that it never moves: after a few posts the three dots
// are recognised before the logo is. So the meaning of each colour and the order of the rows are
// fixed here, once, and no unit gets to re-decide them — a unit only supplies the three texts.
//
// The colours come from the brand, not from this file: the audience takes the brand's primary and
// the next step takes its accent, which is what makes the strip look like that brand and not like
// a traffic light. Only the middle one is the system's own, because "a problem" has no slot in a
// two-colour identity; it is a muted terracotta rather than a red, so it reads as a problem
// without raising its voice.
(() => {
  const PROBLEM = '#c2603f';

  /** The three signals, in render order. `ask` is what the row answers, never printed. */
  const SIGNALS = [
    { key: 'who', ask: 'لمن؟', hint: 'الفئة المستهدفة', of: (b) => b.colors?.primary || '#0b3b33' },
    { key: 'why', ask: 'لماذا يهمه؟', hint: 'المشكلة', of: () => PROBLEM },
    { key: 'what', ask: 'ماذا ينتظره؟', hint: 'الخطوة التالية', of: (b) => b.colors?.accent || '#00b478' },
  ];

  const colours = (brand = {}) => Object.fromEntries(SIGNALS.map((s) => [s.key, s.of(brand)]));

  // One stylesheet for every surface. The canvases are all 1080 wide — slide, cover and ad alike —
  // so one set of sizes is correct across them, and a landing page (which is not a canvas at all)
  // gets the same strip at the same proportions by turning `--sg-u` down. Sizes are written as
  // multiples of that unit for exactly that reason: the strip is one design at every scale, which
  // is the whole claim the system makes.
  const CSS = `
.ftd-signal{--sg-u:1px;--sg-ink:#12241f;--sg-panel:rgba(255,255,255,.93);display:flex;flex-direction:column;
  gap:calc(16*var(--sg-u));direction:rtl;font-family:"Cairo",sans-serif;background:var(--sg-panel);
  border-radius:calc(30*var(--sg-u));padding:calc(26*var(--sg-u)) calc(32*var(--sg-u));margin-top:calc(28*var(--sg-u))}
.ftd-signal .s{display:flex;align-items:center;gap:calc(20*var(--sg-u));font-size:calc(36*var(--sg-u));line-height:1.3;
  font-weight:700;color:var(--sg-ink);white-space:nowrap;overflow:hidden}
.ftd-signal .s i{width:calc(24*var(--sg-u));height:calc(24*var(--sg-u));border-radius:50%;flex:none}
.ftd-signal .s span{overflow:hidden;text-overflow:ellipsis}
.ftd-signal.on-dark{--sg-ink:#fff;--sg-panel:rgba(8,20,16,.52)}
/* A brand's own dark colour disappears against a dark canvas, and a signal nobody can see is not a
   signal. Every dot keeps its exact hue and gains a ring, so the three stay tellable apart on a
   photo, on black, and on white alike. */
.ftd-signal.on-dark .s i{box-shadow:0 0 0 calc(3*var(--sg-u)) rgba(255,255,255,.85)}
/* A story and a reel cover are viewed full-screen with the platform's own caption and buttons over
   the bottom of the frame. The strip keeps its place in the layout and steps above that furniture. */
.tall .ftd-signal,.s916 .ftd-signal,.cover .ftd-signal{margin-bottom:calc(300*var(--sg-u))}
.sq .ftd-signal{gap:calc(12*var(--sg-u));padding:calc(22*var(--sg-u)) calc(28*var(--sg-u));margin-top:calc(18*var(--sg-u))}
.sq .ftd-signal .s{font-size:calc(32*var(--sg-u))}`;

  let injected = false;
  function style() {
    if (injected) return;
    const el = document.createElement('style');
    el.id = 'ftd-signal-css';
    el.textContent = CSS;
    document.head.appendChild(el);
    injected = true;
  }

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * The strip, as the last child of a canvas's `.in` column. Returns '' when the piece has no
   * signal — a missing line is left missing rather than filled with something plausible.
   */
  function bar(sig, { brand = {}, dark = false, scale = 1, css = false } = {}) {
    if (!css) style();
    const rows = SIGNALS.filter((s) => String(sig?.[s.key] || '').trim());
    if (rows.length < SIGNALS.length) return '';
    const c = colours(brand);
    const unit = scale === 1 ? '' : ` style="--sg-u:${scale}px"`;
    return `${css ? `<style>${CSS}</style>` : ''}<div class="ftd-signal${dark ? ' on-dark' : ''}"${unit}>${rows.map((s) =>
      `<div class="s"><i style="background:${c[s.key]}"></i><span>${esc(sig[s.key])}</span></div>`).join('')}</div>`;
  }

  // Claims the brand has told us never to make. The third signal is where they surface, because
  // "the next step" is the one line that is tempted to promise a product that is not out yet.
  const READY_NOW = /(اطلب|اشتر|سجّل الآن|جرّب(ه|ها)?\b|متاح الآن|احجز|نزّل التطبيق|اشترك الآن)/;

  /**
   * What is wrong with these three lines, in Arabic, for the person editing them. Length first —
   * the strip is read in a glance, so a line that wraps has already failed — then the brand's own
   * banned words, then a promise the product cannot keep yet.
   */
  function check(sig, brand = {}) {
    const out = [];
    const banned = String(brand.banned || '').split('،').map((s) => s.trim()).filter((s) => s.length > 3);
    for (const s of SIGNALS) {
      const v = String(sig?.[s.key] || '').trim();
      if (!v) { out.push(`«${s.ask}» فاضية`); continue; }
      if (v.length > 34) out.push(`«${s.ask}» طويلة (${v.length} حرف) — الحد ٣٤ عشان تتقرا بلمحة`);
      const hit = banned.find((w) => v.includes(w));
      if (hit) out.push(`«${s.ask}» فيها كلمة ممنوعة في دليل هويتك: ${hit}`);
    }
    const what = String(sig?.what || '');
    if (READY_NOW.test(what)) out.push('«ماذا ينتظره؟» بتوعد بمنتج جاهز — خلّيها خطوة ناعمة (تابع، احفظ، شارك) لحد ما المنتج ينزل');
    return out;
  }

  /** Appended to a unit's system prompt so the model returns the three lines with the piece. */
  const PROMPT = `

SIGNAL STRIP (required — add a "signal" object at the TOP LEVEL of your JSON):
Every piece of content this brand publishes carries the same three lines, so a viewer can sort
themselves in within one second and follow the piece with the sound off.
  "signal": { "who": "...", "why": "...", "what": "..." }
- who  — WHO this piece is for, named as they would name themselves. Not "الجميع", not a persona
         label. Examples: "تجار العطور الإلكترونية", "أصحاب متاجر سلة وزد".
- why  — the ONE problem this piece is about, from their side, as a plain statement of what goes
         wrong. Examples: "الزائر يحتار بين المنتجات", "الكتالوج ناقص بيانات".
- what — what they get out of the piece, or the soft next step. Never a purchase, a sign-up or a
         product that is not released yet.
Hard limits: each line is a fragment, not a sentence — no more than 34 characters, no full stop,
no emoji, no hashtag. All three in the brand's dialect. If the topic does not fit one of them,
still answer all three from the topic itself; never leave one empty.`;

  /** Read the signal off a generated piece, wherever a unit happens to keep it. */
  const from = (data) => (data && typeof data.signal === 'object' ? data.signal : null) || null;

  const blank = () => ({ who: '', why: '', what: '' });

  /**
   * The three boxes, wherever a unit wants to put them, plus whatever is wrong with them right
   * now. `onInput` runs after every keystroke so the canvas next to it re-renders as you type.
   */
  function editor(el, sig, onInput, brand = {}) {
    if (!el) return;
    // Typing in a box re-renders the canvas, and the canvas re-draws its editor. Rebuilding the
    // markup here would take the caret out of the box the person is still typing in, so an editor
    // already showing this same object only refreshes what it says about it.
    if (el.__sig === sig) return el.__refresh();
    el.__sig = sig;
    const c = colours(brand);
    el.innerHTML = `<div class="sig-edit">${SIGNALS.map((s) => `
      <label class="sig-row"><i style="background:${c[s.key]}"></i>
        <span class="sig-ask">${s.ask}<small>${s.hint}</small></span>
        <input data-sig="${s.key}" maxlength="34" value="${esc(sig?.[s.key] || '')}" placeholder="${esc(s.hint)}">
      </label>`).join('')}<div class="sig-warn" hidden></div></div>`;
    const warn = el.querySelector('.sig-warn');
    const refresh = () => {
      const problems = check(sig, brand);
      warn.hidden = !problems.length;
      warn.innerHTML = problems.map((w) => `<div>⚠️ ${esc(w)}</div>`).join('');
    };
    el.__refresh = refresh;
    el.querySelectorAll('input[data-sig]').forEach((inp) => inp.addEventListener('input', () => {
      sig[inp.dataset.sig] = inp.value;
      refresh();
      onInput && onInput(sig);
    }));
    refresh();
  }

  window.Signal = { SIGNALS, colours, CSS, style, bar, check, editor, PROMPT, from, blank };
})();
