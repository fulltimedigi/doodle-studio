// Print-quality PDF: HTML -> A4 pages with real, selectable text.
//
// web/magnet.html builds the same kind of guide in the browser, where the only way out is
// html-to-image + jsPDF.addImage — every page ends up a flat JPEG, so the text cannot be
// selected, searched or indexed and Arabic letterforms soften at print size. When a server is
// available, Chromium prints the pages directly instead: vector text, embedded fonts, a much
// smaller file. Same design system either way — assets/print/guide.css.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, dataUrl } from './project.mjs';
import { browserOptions } from './reel.mjs';

const PRINT_CSS = join(ROOT, 'assets/print/guide.css');

/**
 * The A4 Arabic print stylesheet with every @font-face URL inlined, so the HTML renders
 * identically whatever (or whether) its base URL is.
 */
export function guideCss() {
  return readFileSync(PRINT_CSS, 'utf8').replace(/url\(\.\.\/fonts\/([^)]+)\)/g, (m, file) => {
    const f = join(ROOT, 'assets/fonts', file);
    return existsSync(f) ? `url(${dataUrl(f)})` : m;
  });
}

/** Wrap page bodies in a full document carrying the print stylesheet. */
export function guideHtml(pagesHtml, { title = 'دليل', head = '' } = {}) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">`
    + `<title>${title}</title><style>${guideCss()}</style>${head}</head>`
    + `<body>${Array.isArray(pagesHtml) ? pagesHtml.join('\n') : pagesHtml}</body></html>`;
}

/**
 * Render HTML to a print-ready A4 PDF. `html` is either a full document or an array of
 * `.page` blocks, which are wrapped in the print stylesheet for you.
 * Returns { out, bytes, pages }.
 */
export async function renderGuidePdf(html, { out, baseDir = null, title = 'دليل', log = () => {} } = {}) {
  mkdirSync(dirname(out), { recursive: true });
  const doc = (typeof html === 'string' && /<html[\s>]/i.test(html)) ? html : guideHtml(html, { title });
  const browser = await chromium.launch(browserOptions());
  try {
    const page = await browser.newPage();
    // A base URL lets a document reference its own local images; without one, everything the
    // document needs must already be inline.
    await page.setContent(doc, { waitUntil: 'load', ...(baseDir ? { baseURL: `file://${baseDir}/` } : {}) });
    await page.evaluate(() => document.fonts.ready);
    const pages = await page.evaluate(() => document.querySelectorAll('.page').length);
    // The document owns its own @page size and margins, so Chromium adds none.
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    log(`📄 ${pages} pages`);
    return { out, bytes: statSync(out).size, pages };
  } finally { await browser.close(); }
}
