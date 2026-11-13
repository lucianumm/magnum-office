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

// ---- Layout -----------------------------------------------------------------------------------
// Page, font and letterhead options shared by the DOCX and the PDF so both come out alike. Everything is optional:
// without options the result is the same as before (A4, ABNT margins, Times New Roman 12, 1.5 spacing).
const cm = 72 / 2.54;
const papers = { a4: { w: 210, h: 297, pt: [595.28, 841.89] }, oficio: { w: 216, h: 330, pt: [612.28, 935.43] } };
const stdFamily = { Times: 'Times New Roman', Helvetica: 'Arial', Courier: 'Courier New' };

function normalizeLayout(input = {}) {
  const margins = { top: 3, right: 2, bottom: 2, left: 3, ...(input.margins || {}) };
  const num = (v, min, max, fallback) =>
    Number.isFinite(Number(v)) && v !== '' ? Math.min(max, Math.max(min, Number(v))) : fallback;
  const paper = papers[input.paper] || papers.a4;
  return {
    paperW: paper.pt[0],
    paperH: paper.pt[1],
    paperMm: paper,
    margins: Object.fromEntries(
      Object.entries(margins).map(([k, v]) => [k, num(v, 0.5, 8, { top: 3, right: 2, bottom: 2, left: 3 }[k])]),
    ),
    family: String(input.font?.family || 'Times New Roman'),
    size: num(input.font?.size, 8, 72, 12),
    lineSpacing: num(input.lineSpacing, 1, 3, 1.5),
    paragraphSpacing: num(input.paragraphSpacing, 0, 36, 6),
    firstLineIndent: num(input.firstLineIndent, 0, 5, 0),
    letterhead: input.letterhead || null,
    fontFiles: input.fontFiles || null,
  };
}
// Lines of a header/footer column ("a\nb" is two lines), at most four.
const colLines = text =>
  String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4);
const hasText = cols => (cols || []).some(c => colLines(c).length);
const bandLines = cols => Math.max(0, ...(cols || []).map(c => colLines(c).length));
const BAND_SIZE = 9;
const BAND_LEADING = 11;

// What a page shows: the header, the footer and whether it carries the page number.
function pageBands(lh, index) {
  if (!lh) return { header: null, footer: null, number: false };
  const first = index === 0;
  const header = first || !lh.firstPageDifferent ? lh.header : { cols: lh.continuation?.cols || [], image: null };
  const number = lh.pageNumbers === 'all' || (lh.pageNumbers === 'skipFirst' && !first);
  return { header, footer: lh.footer, number };
}
const bandHeight = (band, withNumber, imageHeightPt) =>
  (band?.image ? imageHeightPt(band.image) + 4 : 0) +
  bandLines(band?.cols) * BAND_LEADING +
  (withNumber ? BAND_LEADING : 0);

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
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';
const EMU_PER_MM = 36000;

const field = code =>
  `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
const smallRun = text => `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const lineRuns = lines => lines.map((l, i) => (i ? '<w:r><w:br/></w:r>' : '') + smallRun(l)).join('');

function drawingXml(rel, image, id) {
  const hEmu = Math.round(image.heightMm * EMU_PER_MM);
  const wEmu = Math.round((image.width / image.height) * hEmu);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${wEmu}" cy="${hEmu}"/><wp:docPr id="${id}" name="Imagem ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="imagem${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const watermarkXml = (text, family) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${Math.min(460, 40 + text.length * 26)}pt;height:80pt;rotation:315;z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="silver" stroked="f"><v:fill opacity=".4"/><v:textpath style="font-family:&quot;${xml(family)}&quot;;font-size:1pt" string="${xml(text)}"/></v:shape></w:pict></w:r></w:p>`;

// One header or footer part. media(image) → relationship id of that image inside this part.
function bandXml(tag, band, { number, watermark, family, media, textWidthTwips }) {
  const body = [];
  if (watermark) body.push(watermarkXml(watermark, family));
  if (band?.image) {
    const rel = media(band.image);
    body.push(
      `<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="${jc[band.image.align] || 'left'}"/></w:pPr>${drawingXml(rel, band.image, 1)}</w:p>`,
    );
  }
  if (hasText(band?.cols)) {
    const cell = (text, align) =>
      `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(textWidthTwips / 3)}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${align}"/></w:pPr>${lineRuns(colLines(text))}</w:p></w:tc>`;
    body.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${textWidthTwips}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${[0, 1, 2].map(() => `<w:gridCol w:w="${Math.floor(textWidthTwips / 3)}"/>`).join('')}</w:tblGrid><w:tr>${cell(band.cols[0], 'left')}${cell(band.cols[1], 'center')}${cell(band.cols[2], 'right')}</w:tr></w:tbl>`,
    );
  }
  if (number)
    body.push(
      `<w:p><w:pPr><w:spacing w:before="60" w:after="0"/><w:jc w:val="${jc[number.align] || 'center'}"/></w:pPr>${smallRun('Página ')}${field('PAGE')}${smallRun(' de ')}${field('NUMPAGES')}</w:p>`,
    );
  // A part must end with a paragraph.
  body.push('<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}>${body.join('')}</w:${tag}>`;
}

function docx(blocks, { title = '', author = '' } = {}, options = {}) {
  const L = normalizeLayout(options);
  const lh = L.letterhead;
  const size = L.size;
  const indent = Math.round(L.firstLineIndent * 567);
  const paragraphs = blocks
    .map(b => {
      const runs = b.runs
        .filter(r => r.text)
        .map(r => {
          const props = [
            r.bold && '<w:b/>',
            r.italic && '<w:i/>',
            r.underline && '<w:u w:val="single"/>',
            b.heading && `<w:sz w:val="${Math.round((size + 2) * 2)}"/>`,
          ]
            .filter(Boolean)
            .join('');
          return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
        })
        .join('');
      const align = jc[b.align] || 'both';
      const ind = indent && !b.heading && ['both', 'left'].includes(align) ? `<w:ind w:firstLine="${indent}"/>` : '';
      return `<w:p><w:pPr>${ind}<w:jc w:val="${align}"/></w:pPr>${runs}</w:p>`;
    })
    .join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const twips = v => Math.round(v * 567);
  const textWidthTwips = Math.round((L.paperW / 72) * 1440) - twips(L.margins.left) - twips(L.margins.right);
  const files = [];
  const parts = [];
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  const media = new Map();
  let sect = '';
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ];
  if (lh) {
    const titlePg = lh.firstPageDifferent || lh.pageNumbers === 'skipFirst';
    const watermark = lh.watermark || '';
    const number = align => (align ? { align } : null);
    const build = (name, tag, band, withNumber) => {
      const partRels = [];
      const mediaFor = image => {
        if (!media.has(image.bytes)) {
          const file = `media/image${media.size + 1}.${image.mime === 'image/png' ? 'png' : 'jpeg'}`;
          media.set(image.bytes, file);
          files.push([`word/${file}`, image.bytes]);
        }
        const rel = `rIdImg${partRels.length + 1}`;
        partRels.push(
          `<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media.get(image.bytes)}"/>`,
        );
        return rel;
      };
      const content = bandXml(tag, band, {
        number: withNumber ? number(lh.pageNumberAlign) : null,
        watermark: tag === 'hdr' ? watermark : '',
        family: L.family,
        media: mediaFor,
        textWidthTwips,
      });
      files.push([`word/${name}.xml`, content]);
      if (partRels.length)
        files.push([
          `word/_rels/${name}.xml.rels`,
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${partRels.join('')}</Relationships>`,
        ]);
      types.push(
        `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tag === 'hdr' ? 'header' : 'footer'}+xml"/>`,
      );
    };
    const headerDefault = lh.firstPageDifferent ? { cols: lh.continuation?.cols || [], image: null } : lh.header;
    build('header1', 'hdr', headerDefault, false);
    build('footer1', 'ftr', lh.footer, lh.pageNumbers !== 'none');
    rels.push(
      '<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    );
    rels.push(
      '<Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    );
    parts.push(
      '<w:headerReference w:type="default" r:id="rIdH1"/>',
      '<w:footerReference w:type="default" r:id="rIdF1"/>',
    );
    if (titlePg) {
      build('header2', 'hdr', lh.header, false);
      build('footer2', 'ftr', lh.footer, lh.pageNumbers === 'all');
      rels.push(
        '<Relationship Id="rIdH2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>',
      );
      rels.push(
        '<Relationship Id="rIdF2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>',
      );
      parts.push(
        '<w:headerReference w:type="first" r:id="rIdH2"/>',
        '<w:footerReference w:type="first" r:id="rIdF2"/>',
      );
    }
    if (media.size) {
      if ([...media.values()].some(f => f.endsWith('.png')))
        types.push('<Default Extension="png" ContentType="image/png"/>');
      if ([...media.values()].some(f => f.endsWith('.jpeg')))
        types.push('<Default Extension="jpeg" ContentType="image/jpeg"/>');
    }
    sect = parts.join('') + (titlePg ? '<w:titlePg/>' : '');
  }
  // Header and footer references come first inside sectPr, then page size and margins.
  const sectPr = `<w:sectPr>${sect.replace('<w:titlePg/>', '')}<w:pgSz w:w="${Math.round((L.paperW / 72) * 1440)}" w:h="${Math.round((L.paperH / 72) * 1440)}"/><w:pgMar w:top="${twips(L.margins.top)}" w:right="${twips(L.margins.right)}" w:bottom="${twips(L.margins.bottom)}" w:left="${twips(L.margins.left)}" w:header="708" w:footer="567" w:gutter="0"/>${sect.includes('<w:titlePg/>') ? '<w:titlePg/>' : ''}</w:sectPr>`;
  const fontName = xml(L.family);
  return zip([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ],
    [
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    ],
    [
      'word/styles.xml',
      // Font, size, line spacing and the space after each paragraph (defaults: Times New Roman 12, 1.5, 6 pt).
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:cs="${fontName}" w:eastAsia="${fontName}"/><w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(L.paragraphSpacing * 20)}" w:line="${Math.round(L.lineSpacing * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    ],
    [
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${paragraphs}${sectPr}</w:body></w:document>`,
    ],
    [
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ],
    ...files,
  ]);
}

// ---- PDF ------------------------------------------------------------------------------------
// pdf-lib's widthOfTextAtSize subtracts kerning ("TA", "AV"...), but drawText does not apply it,
// so uppercase words would overlap the next one. Measure glyph by glyph instead.
const textWidth = (font, text, size) => [...text].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, size), 0);

// The fonts of a PDF: the chosen installed font (subset, embedded) or the standard one closest to it.
async function pdfFonts(doc, L) {
  const { StandardFonts } = require('pdf-lib');
  if (L.fontFiles?.regular) {
    doc.registerFontkit(require('@pdf-lib/fontkit'));
    const embed = bytes => doc.embedFont(bytes, { subset: true });
    const regular = await embed(L.fontFiles.regular);
    return {
      embedded: true,
      regular,
      bold: L.fontFiles.bold ? await embed(L.fontFiles.bold) : regular,
      italic: L.fontFiles.italic ? await embed(L.fontFiles.italic) : regular,
      boldItalic: L.fontFiles.boldItalic
        ? await embed(L.fontFiles.boldItalic)
        : L.fontFiles.bold
          ? await embed(L.fontFiles.bold)
          : regular,
    };
  }
  const family = /courier|consolas|mono/i.test(L.family)
    ? 'Courier'
    : /arial|calibri|verdana|tahoma|helvetica|segoe|trebuchet|sans/i.test(L.family)
      ? 'Helvetica'
      : 'Times';
  const names = {
    Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  }[family];
  return {
    embedded: false,
    standard: stdFamily[family],
    regular: await doc.embedFont(StandardFonts[names[0]]),
    bold: await doc.embedFont(StandardFonts[names[1]]),
    italic: await doc.embedFont(StandardFonts[names[2]]),
    boldItalic: await doc.embedFont(StandardFonts[names[3]]),
  };
}

async function pdf(blocks, { title = '', author = '' } = {}, options = {}) {
  const { PDFDocument, rgb, degrees } = require('pdf-lib');
  const L = normalizeLayout(options);
  const lh = L.letterhead;
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setProducer('Magnum Office');
  doc.setCreator('Magnum Office');
  const fonts = await pdfFonts(doc, L);
  const fontOf = r => fonts[r.bold && r.italic ? 'boldItalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'regular'];
  const measure = textWidth;
  // The standard fonts only cover WinAnsi (Latin-1 and a few symbols); anything else becomes "?".
  const safe = (font, text) =>
    fonts.embedded
      ? text
      : [...text]
          .map(ch => {
            try {
              font.encodeText(ch);
              return ch;
            } catch {
              return '?';
            }
          })
          .join('');
  const [width, height] = [L.paperW, L.paperH];
  const left = L.margins.left * cm,
    right = width - L.margins.right * cm,
    size = L.size;
  // Images of the letterhead are embedded once.
  const images = new Map();
  const embedImage = async image => {
    if (!images.has(image.bytes))
      images.set(
        image.bytes,
        image.mime === 'image/png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes),
      );
    return images.get(image.bytes);
  };
  const imageHeightPt = image => (image.heightMm / 25.4) * 72;
  // Room taken by the header (per page kind) and the footer, so the text never runs under them.
  const HEADER_AT = 1.25 * cm,
    FOOTER_AT = 1.0 * cm;
  const topFor = index => {
    if (!lh) return height - L.margins.top * cm;
    const { header } = pageBands(lh, index);
    const room =
      header && (header.image || hasText(header.cols)) ? HEADER_AT + bandHeight(header, false, imageHeightPt) + 10 : 0;
    return height - Math.max(L.margins.top * cm, room);
  };
  const bottomLimit = (() => {
    if (!lh) return L.margins.bottom * cm;
    const withNumber = lh.pageNumbers !== 'none';
    const room =
      lh.footer?.image || hasText(lh.footer?.cols) || withNumber
        ? FOOTER_AT + bandHeight(lh.footer, withNumber, imageHeightPt) + 10
        : 0;
    return Math.max(L.margins.bottom * cm, room);
  })();
  const watermark = lh?.watermark || '';
  const newPage = () => {
    const page = doc.addPage([width, height]);
    if (watermark) {
      const fontSize = Math.min(110, (width * 0.9) / Math.max(4, watermark.length) / 0.6);
      const w = textWidth(fonts.bold, watermark, fontSize);
      const angle = 45;
      const rad = (angle * Math.PI) / 180;
      page.drawText(watermark, {
        x: width / 2 - (w / 2) * Math.cos(rad) + (fontSize / 3) * Math.sin(rad),
        y: height / 2 - (w / 2) * Math.sin(rad) - (fontSize / 3) * Math.cos(rad),
        size: fontSize,
        font: fonts.bold,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.45,
        rotate: degrees(angle),
      });
    }
    return page;
  };
  let page = newPage();
  let pageIndex = 0;
  let y = topFor(0);
  for (const block of blocks) {
    const fontSize = block.heading ? size + 2 : size;
    const lineHeight = fontSize * L.lineSpacing;
    const indent =
      !block.heading && L.firstLineIndent && ['justify', 'left', undefined].includes(block.align)
        ? L.firstLineIndent * cm
        : 0;
    // Words keep their run formatting; spaces separate them.
    const words = [];
    for (const run of block.runs) {
      const font = fontOf(run);
      for (const piece of safe(font, run.text).split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) words.push({ space: true });
        else words.push({ text: piece, font, underline: run.underline, width: measure(font, piece, fontSize) });
      }
    }
    const lines = [];
    let line = [],
      lineWidth = 0;
    const spaceWidth = fonts.regular.widthOfTextAtSize(' ', fontSize);
    const room = () => right - left - (lines.length === 0 ? indent : 0);
    for (const w of words) {
      if (w.space) {
        if (line.length) line.pendingSpace = true;
        continue;
      }
      const gap = line.length && line.pendingSpace ? spaceWidth : 0;
      if (line.length && lineWidth + gap + w.width > room()) {
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
      if (y - lineHeight < bottomLimit) {
        page = newPage();
        pageIndex++;
        y = topFor(pageIndex);
      }
      y -= lineHeight;
      const offset = index === 0 ? indent : 0;
      const natural = words.reduce((sum, w) => sum + w.gap + w.width, 0);
      const free = right - left - offset - natural;
      const gaps = words.filter((w, i) => i > 0 && w.gap).length;
      const last = index === lines.length - 1;
      const extra = block.align === 'justify' && !last && gaps ? free / gaps : 0;
      let x = left + offset + (block.align === 'center' ? free / 2 : block.align === 'right' ? free : 0);
      words.forEach((w, i) => {
        if (i > 0) x += w.gap + (w.gap ? extra : 0);
        page.drawText(w.text, { x, y, size: fontSize, font: w.font });
        if (w.underline)
          page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + w.width, y: y - 1.5 }, thickness: 0.6 });
        x += w.width;
      });
    });
    y -= L.paragraphSpacing; // the same space after each paragraph as in the DOCX.
  }
  // Headers, footers and page numbers, now that the number of pages is known.
  if (lh) {
    const pages = doc.getPages();
    const base = fonts.regular;
    const drawColumns = (pg, cols, top) => {
      cols.forEach((text, col) => {
        colLines(text).forEach((lineText, i) => {
          const t = safe(base, lineText);
          const w = textWidth(base, t, BAND_SIZE);
          const x = col === 0 ? left : col === 1 ? (left + right) / 2 - w / 2 : right - w;
          pg.drawText(t, {
            x,
            y: top - BAND_SIZE - i * BAND_LEADING,
            size: BAND_SIZE,
            font: base,
            color: rgb(0.2, 0.2, 0.2),
          });
        });
      });
    };
    for (const [i, pg] of pages.entries()) {
      const { header, footer, number } = pageBands(lh, i);
      if (header) {
        let top = height - HEADER_AT;
        if (header.image) {
          const img = await embedImage(header.image);
          const h = imageHeightPt(header.image);
          const w = (header.image.width / header.image.height) * h;
          const x =
            header.image.align === 'center'
              ? (left + right) / 2 - w / 2
              : header.image.align === 'right'
                ? right - w
                : left;
          pg.drawImage(img, { x, y: top - h, width: w, height: h });
          top -= h + 4;
        }
        drawColumns(pg, header.cols || [], top);
      }
      if (footer || number) {
        let top = FOOTER_AT + bandHeight(footer, number, imageHeightPt);
        if (footer?.image) {
          const img = await embedImage(footer.image);
          const h = imageHeightPt(footer.image);
          const w = (footer.image.width / footer.image.height) * h;
          const x =
            footer.image.align === 'center'
              ? (left + right) / 2 - w / 2
              : footer.image.align === 'right'
                ? right - w
                : left;
          pg.drawImage(img, { x, y: top - h, width: w, height: h });
          top -= h + 4;
        }
        if (footer) drawColumns(pg, footer.cols || [], top);
        if (number) {
          const label = `Página ${i + 1} de ${pages.length}`;
          const w = textWidth(base, safe(base, label), BAND_SIZE);
          const align = lh.pageNumberAlign || 'center';
          const x = align === 'left' ? left : align === 'right' ? right - w : (left + right) / 2 - w / 2;
          pg.drawText(safe(base, label), { x, y: FOOTER_AT, size: BAND_SIZE, font: base, color: rgb(0.2, 0.2, 0.2) });
        }
      }
    }
  }
  // Viewers without Times (some PDFium builds) substitute a wider font and words run together.
  // Declaring the standard widths makes them scale the substitute to the right spacing.
  if (!fonts.embedded) {
    const winAnsi = new TextDecoder('windows-1252');
    const { PDFNumber, PDFName } = require('pdf-lib');
    for (const font of [fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic]) {
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
  }
  return Buffer.from(await doc.save());
}

module.exports = { zip, docx, pdf, textWidth, normalizeLayout, pageBands, papers };
