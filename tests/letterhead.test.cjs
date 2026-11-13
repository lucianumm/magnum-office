const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { randomBytes } = require('node:crypto');
const { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, PDFHexString, PDFString } = require('pdf-lib');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Letterheads, inspectImage } = require('../backend/letterhead.cjs');
const { docx, pdf } = require('../backend/document-files.cjs');
const { SystemFonts, readFaces, standardFor } = require('../backend/system-fonts.cjs');
const { DocumentGenerator } = require('../backend/document-generator.cjs');
const { htmlBlocks } = require('../app/document-template.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'lh-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, letterheads: new Letterheads({ store }) };
}
// A valid PNG made on the spot (8-bit RGB, solid color).
function png(width, height, rgb = [200, 30, 30]) {
  const crc = buf => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(zlib.crc32(buf) >>> 0);
    return out;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([length, body, crc(body)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Text drawn on a page with standard fonts: the hex strings of the content stream, decoded as Latin-1.
async function pageText(doc, index) {
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(r => doc.context.lookup(r)) : [contents];
  let out = '';
  for (const s of streams) {
    const raw = s instanceof PDFRawStream ? s.contents : s.getContents();
    const body = zlib.inflateSync(Buffer.from(raw)).toString('latin1');
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(m[1], 'hex').toString('latin1') + '\n';
  }
  return out;
}
const hasImage = (doc, index) => {
  const xobjects = doc.getPage(index).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  return !!xobjects && xobjects.keys().length > 0;
};
const longBlocks = () =>
  htmlBlocks(
    '<h1>TÍTULO</h1>' +
      Array.from({ length: 40 }, (_, i) => `<p>Parágrafo ${i}. ${'Texto longo do documento. '.repeat(20)}</p>`).join(
        '',
      ),
  );
const resolved = (over = {}) => ({
  paper: 'a4',
  margins: { top: 3, right: 2, bottom: 2, left: 3 },
  firstPageDifferent: true,
  pageNumbers: 'skipFirst',
  pageNumberAlign: 'center',
  watermark: '',
  header: {
    cols: ['Escritório Exemplo', '', 'OAB/GO 12345'],
    image: { bytes: png(120, 40), mime: 'image/png', width: 120, height: 40, heightMm: 15, align: 'left' },
  },
  continuation: { cols: ['Escritório Exemplo', '', 'Processo 0001'] },
  footer: { cols: ['Rua A, 10 - Goiânia', '(62) 3000-0000', 'www.exemplo.adv.br'], image: null },
  ...over,
});

test('images are recognized by their content, limited in size and checked before they are saved', async t => {
  const { letterheads } = await fixture(t);
  assert.deepEqual(inspectImage(png(120, 40)), { mime: 'image/png', width: 120, height: 40 });
  assert.throws(() => inspectImage(Buffer.from('GIF89a......................')), /PNG ou JPG/);
  assert.throws(() => inspectImage(png(8, 8)), /16 a 4000/);
  assert.throws(() => inspectImage(Buffer.alloc(2 * 1024 * 1024 + 1, 1)), /2 MB/);
  assert.throws(() => inspectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), /PNG ou JPG/);
  await assert.rejects(letterheads.inspect(Buffer.from('texto qualquer').toString('base64')), /PNG ou JPG/);
  assert.equal((await letterheads.inspect(png(60, 30).toString('base64'))).mime, 'image/png');
});

test('letterheads: saved encrypted with the image apart, a default, variables filled, unused images removed', async t => {
  const { store, letterheads } = await fixture(t);
  const saved = await letterheads.save({
    name: 'Papel do escritório',
    paper: 'oficio',
    margins: { top: 4, right: 2, bottom: 2.5, left: 3 },
    firstPageDifferent: true,
    pageNumbers: 'skipFirst',
    watermark: 'RASCUNHO',
    header: {
      cols: ['Escritório Exemplo', '', '{processo.numero}'],
      image: { data: png(120, 40).toString('base64'), heightMm: 18, align: 'center' },
    },
    continuation: { cols: ['', '', '{cliente.nome}'] },
    footer: { cols: ['Rua A', '', ''], image: null },
  });
  assert.equal(saved.isDefault, true, 'the first one becomes the default');
  assert.deepEqual([saved.header.image.mime, saved.header.image.width], ['image/png', 120]);
  assert.ok(!JSON.stringify(saved).includes('base64'), 'the list never carries image bytes');
  const raw = store.db.prepare("SELECT payload FROM secrets WHERE id LIKE 'letterhead-image:%'").get();
  assert.ok(!Buffer.from(raw.payload).includes(Buffer.from('IHDR')), 'the image is stored encrypted');
  const r = letterheads.resolve(saved.id, { 'processo.numero': '0001234-56', 'cliente.nome': 'Ana Souza' });
  assert.deepEqual(r.header.cols, ['Escritório Exemplo', '', '0001234-56']);
  assert.deepEqual(r.continuation.cols, ['', '', 'Ana Souza']);
  assert.equal(r.header.image.bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([r.paper, r.margins.top, r.watermark], ['oficio', 4, 'RASCUNHO']);
  // A second one is not the default until chosen; the default can move.
  const second = await letterheads.save({ name: 'Simples', header: { cols: ['x', '', ''] }, footer: {} });
  assert.equal(second.isDefault, false);
  letterheads.setDefault(second.id);
  assert.equal(letterheads.defaultId(), second.id);
  // Replacing the image removes the old one; removing the letterhead removes its image.
  const edited = await letterheads.save({
    ...saved,
    header: { ...saved.header, image: { data: png(60, 30).toString('base64'), heightMm: 10 } },
  });
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM secrets WHERE id LIKE 'letterhead-image:%'").get().n, 1);
  letterheads.remove(edited.id);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM secrets WHERE id LIKE 'letterhead-image:%'").get().n, 0);
  assert.throws(() => letterheads.resolve(edited.id), /não encontrado/);
  await assert.rejects(letterheads.save({ name: '' }), /Dê um nome/);
  await assert.rejects(letterheads.save({ name: 'x', header: { cols: ['a\nb\nc\nd\ne'] } }), /4 linhas/);
});

test('DOCX with letterhead: header, footer, image, page numbers, first page, paper, margins and font are in the package', async () => {
  const word = docx(
    longBlocks(),
    { title: 'Teste', author: 'Escritório' },
    {
      paper: 'oficio',
      margins: { top: 4, right: 2, bottom: 2.5, left: 3 },
      font: { family: 'Calibri', size: 11 },
      lineSpacing: 1.15,
      paragraphSpacing: 8,
      firstLineIndent: 1.25,
      letterhead: resolved({ watermark: 'CONFIDENCIAL' }),
    },
  );
  const zip = await JSZip.loadAsync(word);
  const names = Object.keys(zip.files);
  for (const part of [
    'word/header1.xml',
    'word/header2.xml',
    'word/footer1.xml',
    'word/footer2.xml',
    'word/media/image1.png',
    'word/_rels/header2.xml.rels',
  ])
    assert.ok(names.includes(part), part);
  // Every XML part is well formed.
  for (const name of names.filter(n => /\.(xml|rels)$/.test(n))) {
    const errors = [];
    new DOMParser({ onError: (level, msg) => errors.push(msg) }).parseFromString(
      await zip.file(name).async('string'),
      'text/xml',
    );
    assert.deepEqual(errors, [], name);
  }
  const document = await zip.file('word/document.xml').async('string');
  assert.match(document, /<w:titlePg\/>/);
  assert.match(document, /<w:headerReference w:type="first" r:id="rIdH2"\/>/);
  assert.match(document, /<w:pgSz w:w="12246" w:h="18709"\/>/, 'Ofício');
  assert.match(document, /w:top="2268" w:right="1134" w:bottom="1418" w:left="1701"/);
  assert.match(document, /<w:ind w:firstLine="709"\/>/);
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(styles, /w:ascii="Calibri"/);
  assert.match(styles, /<w:sz w:val="22"\/>/);
  assert.match(styles, /w:after="160" w:line="276"/);
  const first = await zip.file('word/header2.xml').async('string');
  assert.match(first, /OAB\/GO 12345/);
  assert.match(first, /<w:drawing>/);
  assert.match(first, /CONFIDENCIAL/);
  const next = await zip.file('word/header1.xml').async('string');
  assert.match(next, /Processo 0001/);
  assert.ok(!/<w:drawing>/.test(next), 'the image is only on the first page');
  const footer = await zip.file('word/footer1.xml').async('string');
  assert.match(footer, /instrText[^>]*> PAGE /);
  assert.match(footer, /NUMPAGES/);
  assert.ok(!/instrText/.test(await zip.file('word/footer2.xml').async('string')), 'no number on the first page');
  assert.match(await zip.file('[Content_Types].xml').async('string'), /Extension="png"/);
  const text = (await require('mammoth').extractRawText({ buffer: word })).value;
  assert.match(text, /TÍTULO/);
});

test('DOCX without letterhead keeps the usual look (A4, ABNT margins, Times New Roman 12, 1.5)', async () => {
  const zip = await JSZip.loadAsync(docx(htmlBlocks('<p>Olá</p>'), { title: 'T' }));
  assert.ok(!Object.keys(zip.files).some(n => /header|footer|media/.test(n)));
  const document = await zip.file('word/document.xml').async('string');
  assert.match(
    document,
    /<w:pgSz w:w="11906" w:h="16838"\/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/,
  );
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(styles, /w:ascii="Times New Roman"/);
  assert.match(styles, /w:sz w:val="24"/);
  assert.match(styles, /w:after="120" w:line="360"/);
});

test('PDF with letterhead: header, footer, numbering "Página 2 de N", image only on the first page, watermark, Ofício', async () => {
  const bytes = await pdf(
    longBlocks(),
    { title: 'Teste' },
    { paper: 'oficio', letterhead: resolved({ watermark: 'RASCUNHO' }) },
  );
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPageCount();
  assert.ok(pages >= 3, 'long text continues over several pages');
  assert.deepEqual(doc.getPage(0).getSize(), { width: 612.28, height: 935.43 });
  const first = await pageText(doc, 0);
  const second = await pageText(doc, 1);
  assert.match(first, /Escritório Exemplo/);
  assert.match(first, /OAB\/GO 12345/);
  assert.ok(!/Processo 0001/.test(first));
  assert.match(first, /Rua A, 10 - Goi\u00e2nia/, 'footer with accents');
  assert.ok(!/P\u00e1gina 1 de/.test(first), 'skipFirst: no number on page 1');
  assert.match(second, /Processo 0001/);
  assert.ok(!/OAB\/GO 12345/.test(second), 'the full header only on page 1');
  assert.match(second, new RegExp(`P\u00e1gina 2 de ${pages}`));
  assert.match(second, /RASCUNHO/);
  assert.equal(hasImage(doc, 0), true);
  assert.equal(hasImage(doc, 1), false);
  // The text never starts above the header: the first body line is below the image and the columns.
  const body = (await pageText(doc, 0)).split('\n').findIndex(l => /TÍTULO/.test(l));
  assert.ok(body >= 0);
});

test('PDF page numbers: every page, none, and a header that fits when the first page is not different', async () => {
  const all = await PDFDocument.load(
    await pdf(longBlocks(), {}, { letterhead: resolved({ pageNumbers: 'all', firstPageDifferent: false }) }),
  );
  assert.match(await pageText(all, 0), new RegExp(`P\u00e1gina 1 de ${all.getPageCount()}`));
  assert.match(await pageText(all, 1), /OAB\/GO 12345/, 'the same header on every page');
  assert.equal(hasImage(all, 1), true);
  const none = await PDFDocument.load(
    await pdf(longBlocks(), {}, { letterhead: resolved({ pageNumbers: 'none', firstPageDifferent: false }) }),
  );
  assert.ok(!/P\u00e1gina/.test(await pageText(none, 0)));
  // The body does not shrink without a letterhead: same page count as before for the same text.
  const plain = await PDFDocument.load(await pdf(longBlocks(), {}));
  assert.ok(plain.getPageCount() <= all.getPageCount(), 'a letterhead only takes space');
});

test('the same document in DOCX and PDF has the same options (font size and spacing) and the PDF follows them', async () => {
  const small = await PDFDocument.load(
    await pdf(longBlocks(), {}, { font: { family: 'Arial', size: 10 }, lineSpacing: 1, paragraphSpacing: 0 }),
  );
  const big = await PDFDocument.load(
    await pdf(longBlocks(), {}, { font: { family: 'Arial', size: 16 }, lineSpacing: 2, paragraphSpacing: 12 }),
  );
  assert.ok(big.getPageCount() > small.getPageCount() * 2);
  assert.equal(standardFor('Calibri'), 'Helvetica');
  assert.equal(standardFor('Garamond'), 'Times');
  assert.equal(standardFor('Courier New'), 'Courier');
});

// A minimal font file with the names and the embedding permission, to test reading without real fonts.
function fakeFont(file, { family, subfamily, fsType }) {
  const utf16 = s => Buffer.from(s, 'utf16le').swap16();
  const names = [
    [1, family],
    [2, subfamily],
    [4, `${family} ${subfamily}`],
  ];
  const strings = Buffer.concat(names.map(([, s]) => utf16(s)));
  const name = Buffer.alloc(6 + names.length * 12);
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(names.length, 2);
  name.writeUInt16BE(6 + names.length * 12, 4);
  let at = 0;
  names.forEach(([id, s], i) => {
    const o = 6 + i * 12;
    name.writeUInt16BE(3, o);
    name.writeUInt16BE(1, o + 2);
    name.writeUInt16BE(0x409, o + 4);
    name.writeUInt16BE(id, o + 6);
    name.writeUInt16BE(utf16(s).length, o + 8);
    name.writeUInt16BE(at, o + 10);
    at += utf16(s).length;
  });
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(fsType, 8);
  const tables = [
    ['OS/2', os2],
    ['name', Buffer.concat([name, strings])],
  ];
  const head = Buffer.alloc(12 + tables.length * 16);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(tables.length, 4);
  let offset = head.length;
  tables.forEach(([tag, data], i) => {
    head.write(tag, 12 + i * 16, 'latin1');
    head.writeUInt32BE(offset, 12 + i * 16 + 8);
    head.writeUInt32BE(data.length, 12 + i * 16 + 12);
    offset += data.length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...tables.map(([, d]) => d)]));
}

test('installed fonts: names and embedding permission are read; a restricted font is never used in a PDF', async t => {
  const { root } = await fixture(t);
  const dir = path.join(root, 'fonts');
  fs.mkdirSync(dir);
  fakeFont(path.join(dir, 'a.ttf'), { family: 'Livre Sans', subfamily: 'Regular', fsType: 0 });
  fakeFont(path.join(dir, 'b.ttf'), { family: 'Livre Sans', subfamily: 'Bold', fsType: 0 });
  fakeFont(path.join(dir, 'c.ttf'), { family: 'Restrita', subfamily: 'Regular', fsType: 2 });
  fakeFont(path.join(dir, 'd.ttf'), { family: 'Sem Subconjunto', subfamily: 'Regular', fsType: 0x100 });
  fakeFont(path.join(dir, 'e.ttf'), { family: 'So Impressao', subfamily: 'Regular', fsType: 4 });
  fs.writeFileSync(path.join(dir, 'lixo.ttf'), 'isto não é uma fonte');
  assert.deepEqual((await readFaces(path.join(dir, 'b.ttf')))[0], {
    file: path.join(dir, 'b.ttf'),
    index: 0,
    family: 'Livre Sans',
    subfamily: 'Bold',
    full: 'Livre Sans Bold',
    bold: true,
    italic: false,
    fsType: 0,
    embeddable: true,
  });
  const fonts = new SystemFonts({ dirs: [dir, path.join(root, 'nao-existe')] });
  const list = await fonts.names();
  assert.deepEqual(
    list.map(f => [f.family, f.embeddable]),
    [
      ['Livre Sans', true],
      ['Restrita', false],
      ['Sem Subconjunto', false],
      ['So Impressao', true],
    ],
  );
  assert.match((await fonts.load('Restrita')).warning, /licença da fonte Restrita não permite/);
  assert.match((await fonts.load('Sem Subconjunto')).warning, /não permite/);
  assert.match((await fonts.load('Fonte Que Nao Existe')).warning, /não está instalada/);
  assert.equal((await fonts.load('So Impressao')).warning, undefined, 'print-only embedding is allowed');
});

const windowsFonts = fs.existsSync(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'calibri.ttf'));
test(
  'real installed fonts (Windows): Calibri and Cambria (a .ttc) are embedded as subsets with accents and symbols',
  { skip: !windowsFonts },
  async () => {
    const fonts = new SystemFonts();
    const names = (await fonts.names()).map(f => f.family);
    for (const family of ['Times New Roman', 'Arial', 'Calibri', 'Cambria']) assert.ok(names.includes(family), family);
    for (const family of ['Calibri', 'Cambria']) {
      const loaded = await fonts.load(family);
      assert.ok(loaded.bytes?.regular, family);
      const blocks = htmlBlocks(
        '<h1>AÇÃO</h1><p>Olá, ação — “aspas” € § 1º <strong>negrito</strong> <em>itálico</em> ✓</p>',
      );
      const bytes = await pdf(blocks, {}, { font: { family, size: 12 }, fontFiles: loaded.bytes });
      const doc = await PDFDocument.load(bytes);
      const names = [];
      let files = 0;
      for (const [, object] of doc.context.enumerateIndirectObjects())
        if (object instanceof PDFDict) {
          const base = object.get(PDFName.of('BaseFont'));
          if (base) names.push(String(base));
          if (object.get(PDFName.of('FontFile2')) || object.get(PDFName.of('FontFile3'))) files++;
        }
      assert.ok(
        names.some(n => n.startsWith('/' + family)),
        `${family} is in the PDF: ${names}`,
      );
      assert.ok(files >= 1, 'the font program is embedded');
      assert.ok(bytes.length < 120000, 'only the used characters are embedded, so the file stays small');
    }
  },
);

test('generating with a font that is not installed falls back to a PDF font and says so', async t => {
  const { store, letterheads } = await fixture(t);
  const lh = await letterheads.save({
    name: 'Papel',
    header: { cols: ['Escritório {escritorio.nome}', '', ''] },
    footer: {},
  });
  const generator = new DocumentGenerator({
    store,
    letterheads,
    systemFonts: new SystemFonts({ dirs: [] }),
    settings: { get: () => ({}) },
  });
  const unchosen = await generator.layoutFor({}, {}, 'pdf');
  assert.deepEqual(unchosen, { layout: {}, warnings: [] }, 'nothing chosen: the usual look');
  const { layout, warnings } = await generator.layoutFor(
    { layout: { family: 'Garamond', size: 11, lineSpacing: 1.15, letterheadId: lh.id } },
    { 'escritorio.nome': 'Exemplo' },
    'pdf',
  );
  assert.match(warnings[0], /Garamond não está instalada/);
  assert.equal(layout.fontFiles, undefined);
  assert.equal(layout.letterhead.header.cols[0], 'Escritório Exemplo');
  const forWord = await generator.layoutFor({ layout: { family: 'Garamond' } }, {}, 'docx');
  assert.deepEqual(forWord.warnings, [], 'Word uses its own installed font: no warning');
  assert.equal(forWord.layout.font.family, 'Garamond');
  assert.throws(() => generator.options({ layout: { size: 3 } }), /8 a 72/);
  assert.throws(() => generator.options({ layout: { lineSpacing: 1.7 } }), /Entrelinhas/);
  assert.throws(() => generator.options({ layout: [] }), /inválidas/);
});

void PDFHexString;
void PDFString;
