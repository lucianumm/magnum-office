// Writes the filled template blocks as DOCX (Word) and PDF, entirely on this computer.
// DOCX is a ZIP of XML parts; the ZIP is written here with Node's zlib so no new dependency is needed.
const zlib = require('node:zlib');

// ---- ZIP (deflate, no encryption, no ZIP64: documents are small) ----------------------------
function zip(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  // Fixed DOS date (1980-01-01) keeps the output reproducible; Word ignores it.
  const time = 0,
    date = 33;
  for (const [name, content] of files) {
    const raw = Buffer.from(content, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const fileName = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---- DOCX -----------------------------------------------------------------------------------
const xml = s =>
  String(s)
    // Control characters are not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' };

function docx(blocks, { title = '', author = '' } = {}) {
  const paragraphs = blocks
    .map(b => {
      const runs = b.runs
        .filter(r => r.text)
        .map(r => {
          const props = [r.bold && '<w:b/>', r.italic && '<w:i/>', r.underline && '<w:u w:val="single"/>', b.heading && '<w:sz w:val="28"/>']
            .filter(Boolean)
            .join('');
          return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
        })
        .join('');
      return `<w:p><w:pPr><w:jc w:val="${jc[b.align] || 'both'}"/></w:pPr>${runs}</w:p>`;
    })
    .join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ],
    [
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ],
    [
      'word/styles.xml',
      // Times New Roman 12, 1.5 line spacing, 6 pt after each paragraph.
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    ],
    [
      'word/document.xml',
      // A4 with 3 cm top/left and 2 cm right/bottom margins (ABNT).
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ],
    [
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ],
  ]);
}

// ---- PDF ------------------------------------------------------------------------------------
const cm = 72 / 2.54;
// pdf-lib's widthOfTextAtSize subtracts kerning ("TA", "AV"...), but drawText does not apply it,
// so uppercase words would overlap the next one. Measure glyph by glyph instead.
const textWidth = (font, text, size) => [...text].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, size), 0);

async function pdf(blocks, { title = '', author = '' } = {}) {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setProducer('Magnum Office');
  doc.setCreator('Magnum Office');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
  const fontOf = r => fonts[r.bold && r.italic ? 'boldItalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'regular'];
  const measure = textWidth;
  // The standard fonts only cover WinAnsi (Latin-1 and a few symbols); anything else becomes "?".
  const safe = (font, text) =>
    [...text]
      .map(ch => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return '?';
        }
      })
      .join('');
  const [width, height] = [595.28, 841.89];
  const left = 3 * cm,
    right = width - 2 * cm,
    top = height - 3 * cm,
    bottom = 2 * cm;
  let page = doc.addPage([width, height]);
  let y = top;
  for (const block of blocks) {
    const size = block.heading ? 14 : 12;
    const lineHeight = size * 1.5;
    // Words keep their run formatting; spaces separate them.
    const words = [];
    for (const run of block.runs) {
      const font = fontOf(run);
      for (const piece of safe(font, run.text).split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) words.push({ space: true });
        else words.push({ text: piece, font, underline: run.underline, width: measure(font, piece, size) });
      }
    }
    const lines = [];
    let line = [],
      lineWidth = 0;
    const spaceWidth = fonts.regular.widthOfTextAtSize(' ', size);
    for (const w of words) {
      if (w.space) {
        if (line.length) line.pendingSpace = true;
        continue;
      }
      const gap = line.length && line.pendingSpace ? spaceWidth : 0;
      if (line.length && lineWidth + gap + w.width > right - left) {
        lines.push(line);
        line = [];
        lineWidth = 0;
      }
      w.gap = line.length && line.pendingSpace ? spaceWidth : 0;
      line.pendingSpace = false;
      line.push(w);
      lineWidth += w.gap + w.width;
    }
    lines.push(line);
    lines.forEach((words, index) => {
      if (y - lineHeight < bottom) {
        page = doc.addPage([width, height]);
        y = top;
      }
      y -= lineHeight;
      const natural = words.reduce((sum, w) => sum + w.gap + w.width, 0);
      const free = right - left - natural;
      const gaps = words.filter((w, i) => i > 0 && w.gap).length;
      const last = index === lines.length - 1;
      const extra = block.align === 'justify' && !last && gaps ? free / gaps : 0;
      let x = left + (block.align === 'center' ? free / 2 : block.align === 'right' ? free : 0);
      words.forEach((w, i) => {
        if (i > 0) x += w.gap + (w.gap ? extra : 0);
        page.drawText(w.text, { x, y, size, font: w.font });
        if (w.underline) page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w.width, y: y - 1.5 }, thickness: 0.6 });
        x += w.width;
      });
    });
    y -= 6; // 6 pt after each paragraph, as in the DOCX.
  }
  // Viewers without Times (some PDFium builds) substitute a wider font and words run together.
  // Declaring the standard widths makes them scale the substitute to the right spacing.
  const winAnsi = new TextDecoder('windows-1252');
  const { PDFNumber, PDFName } = require('pdf-lib');
  for (const font of Object.values(fonts)) {
    await font.embed();
    const dict = doc.context.lookup(font.ref);
    const widths = [];
    for (let code = 32; code <= 255; code++) {
      let width = 0;
      try {
        width = Math.round(font.widthOfTextAtSize(winAnsi.decode(Uint8Array.of(code)), 1000));
      } catch {
        /* code without a glyph in WinAnsi */
      }
      widths.push(PDFNumber.of(width));
    }
    dict.set(PDFName.of('FirstChar'), PDFNumber.of(32));
    dict.set(PDFName.of('LastChar'), PDFNumber.of(255));
    dict.set(PDFName.of('Widths'), doc.context.obj(widths));
  }
  return Buffer.from(await doc.save());
}

module.exports = { zip, docx, pdf, textWidth };
