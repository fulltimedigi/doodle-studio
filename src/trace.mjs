// Turn any raster image (png/jpg/webp) into line-art SVG for the drawing engine, for free.
// mode "outline":    edge detection -> traced outlines (a sketch of the photo)
// mode "silhouette": threshold -> filled shapes (good for logos / flat icons)
import Jimp from 'jimp';
import potrace from 'potrace';

function traceBuffer(buf, opts) {
  return new Promise((resolve, reject) => {
    potrace.trace(buf, opts, (err, svg) => (err ? reject(err) : resolve(svg)));
  });
}

export async function imageToSvg(file, { mode = 'outline', threshold = 128, color = '#222', maxSize = 900 } = {}) {
  let img = await Jimp.read(file);
  if (img.bitmap.width > maxSize || img.bitmap.height > maxSize) img.scaleToFit(maxSize, maxSize);
  const bg = new Jimp(img.bitmap.width, img.bitmap.height, 0xffffffff); // flatten transparency on white
  img = bg.composite(img, 0, 0);
  img.grayscale();
  let toTrace = img;
  if (mode === 'outline') {
    const w = img.bitmap.width, h = img.bitmap.height;
    const src = img.bitmap.data;
    const out = new Jimp(w, h, 0xffffffff);
    const g = (x, y) => src[(y * w + x) * 4];
    let maxMag = 1; const mags = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const gx = -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) + g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
      const gy = -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) + g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
      const m = Math.hypot(gx, gy); mags[y * w + x] = m; if (m > maxMag) maxMag = m;
    }
    const cut = (threshold / 255) * maxMag * 0.35;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const v = mags[y * w + x] > cut ? 0 : 255;
      out.bitmap.data[i] = out.bitmap.data[i + 1] = out.bitmap.data[i + 2] = v; out.bitmap.data[i + 3] = 255;
    }
    toTrace = out;
  }
  const png = await toTrace.getBufferAsync(Jimp.MIME_PNG);
  return traceBuffer(png, { threshold: mode === 'outline' ? 128 : threshold, color, turdSize: mode === 'outline' ? 6 : 2, optTolerance: 0.4, alphaMax: 1 });
}
