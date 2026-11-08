// Extracts plain text from one document in a separate thread, so a large or malformed file never
// blocks the program. Receives { bytes, ext } and answers { text } or { error }.
const { parentPort, workerData } = require('node:worker_threads');

const MAX_PAGES = 500;
const MAX_CHARS = 2_000_000;

async function extract({ bytes, ext }) {
  const buffer = Buffer.from(bytes);
  if (ext === '.txt' || ext === '.csv') {
    let text = buffer.toString('utf8');
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
    return text;
  }
  if (ext === '.docx') {
    // The archive is checked against zip bombs like every other DOCX the program opens.
    const os = require('node:os');
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnum-docx-'));
    const file = path.join(dir, 'documento.docx');
    try {
      fs.writeFileSync(file, buffer, { mode: 0o600 });
      await require('./zip-limits.cjs').checkArchive(file);
      return (await require('mammoth').extractRawText({ buffer })).value;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (ext === '.pdf') {
    const { PDFiumLibrary } = require('@hyzyla/pdfium');
    const library = await PDFiumLibrary.init();
    try {
      const document = await library.loadDocument(buffer);
      try {
        const parts = [];
        let pages = 0;
        for (const page of document.pages()) {
          if (++pages > MAX_PAGES) break;
          parts.push(page.getText());
          if (parts.reduce((n, p) => n + p.length, 0) > MAX_CHARS) break;
        }
        return parts.join('\n');
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  }
  return '';
}

// NUL characters from some PDFs are removed before the text is stored.
const clean = text => String(text || '').split(String.fromCharCode(0)).join('');
extract(workerData)
  .then(text => parentPort.postMessage({ text: clean(text).slice(0, MAX_CHARS) }))
  .catch(error => parentPort.postMessage({ error: /password|encrypted/i.test(error.message) ? 'PDF protegido por senha.' : error.message }));
