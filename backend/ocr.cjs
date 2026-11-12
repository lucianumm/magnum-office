// Text recognition (OCR) for scanned PDFs and images, entirely on this computer: Tesseract compiled to
// WebAssembly and the Portuguese model shipped with the program. Nothing is sent anywhere. Runs inside
// the document text worker, so a slow page never blocks the program.
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_OCR_PAGES = 40;
// A page with less text than this after the normal extraction is treated as an image.
const MIN_TEXT_PER_PAGE = 20;

// PNG from raw RGBA pixels (what PDFium renders), so Tesseract can read it.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Portuguese model shipped with the program (npm package @tesseract.js-data/por, integer "best").
// In the installed program it lives outside app.asar (asarUnpack), where the OCR worker can read it.
const modelDir = () =>
  path
    .join(path.dirname(require.resolve('@tesseract.js-data/por/package.json')), '4.0.0_best_int')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

async function withWorker(task) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('por', 1, {
    langPath: modelDir(),
    cachePath: modelDir(),
    gzip: true,
    cacheMethod: 'none',
  });
  try {
    return await task(worker);
  } finally {
    await worker.terminate();
  }
}

// Pages of a PDF without a text layer: rendered at 200 dpi and read by Tesseract.
async function ocrPdf(document) {
  const pages = [...document.pages()];
  const empty = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.getText().replace(/\s+/g, '').length < MIN_TEXT_PER_PAGE)
    .slice(0, MAX_OCR_PAGES);
  if (!empty.length) return '';
  return withWorker(async worker => {
    const parts = [];
    for (const { page, index } of empty) {
      // About 200 dpi, limited to 4000 pixels on the longer side.
      const { originalWidth: w, originalHeight: h } = page.getOriginalSize();
      const scale = Math.min(200 / 72, 4000 / Math.max(w, h));
      const image = await page.render({ scale, render: 'bitmap', transparent: false });
      const { data } = await worker.recognize(png(image.data, image.width, image.height));
      // Stamps, photos and blank pages give no words or low confidence: nothing is recorded for them.
      if (/\p{L}{2}/u.test(data.text) && data.confidence >= 40) parts.push(`[página ${index + 1}] ${data.text.trim()}`);
    }
    return parts.join('\n');
  });
}

async function ocrImage(buffer) {
  return withWorker(async worker => {
    const { data } = await worker.recognize(buffer);
    return /\p{L}{2}/u.test(data.text) && data.confidence >= 40 ? data.text.trim() : '';
  });
}

module.exports = { ocrPdf, ocrImage, png, crc32, MAX_OCR_PAGES };
