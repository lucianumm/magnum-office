const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const { png } = require('../backend/ocr.cjs');
const { extractInWorker } = require('../backend/document-index.cjs');

// A "scanned" PDF: one page that is only an image of text, with no text layer.
async function scannedPdf() {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const page = source.addPage([595, 842]);
  page.drawText('PROCURACAO AD JUDICIA', { x: 60, y: 760, size: 24, font });
  page.drawText('Outorgante Maria da Silva residente em Goiania', { x: 60, y: 720, size: 16, font });
  const lib = await PDFiumLibrary.init();
  const doc = await lib.loadDocument(Buffer.from(await source.save()));
  const image = await doc.getPage(0).render({ scale: 2, render: 'bitmap', transparent: false });
  doc.destroy();
  lib.destroy();
  const scanned = await PDFDocument.create();
  const embedded = await scanned.embedPng(png(image.data, image.width, image.height));
  scanned.addPage([595, 842]).drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  return { pdf: Buffer.from(await scanned.save()), picture: png(image.data, image.width, image.height) };
}

test('scanned PDFs and photos are read by OCR on this computer', async () => {
  const { pdf, picture } = await scannedPdf();
  const fromPdf = await extractInWorker(pdf, '.pdf', 120000);
  assert.match(fromPdf.text, /PROCURACAO AD JUDICIA/);
  assert.match(fromPdf.text, /Maria da Silva/);
  const fromImage = await extractInWorker(picture, '.png', 120000);
  assert.match(fromImage.text, /Goiania/);
});
