const { test } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const { PDFDocument } = require('pdf-lib');
const { signPdf, certificateInfo } = require('../backend/pdf-sign.cjs');

// A self-signed A1-like certificate, made only for the test.
function makeP12(password, { notAfter = new Date(Date.now() + 365 * 86400000) } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: 'commonName', value: 'MARIA DE TESTE:12345678909' }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

test('a PDF is signed in PAdES with an A1 certificate; wrong password and expired certificate are refused', async () => {
  const p12 = makeP12('senha-teste');
  const info = certificateInfo(p12, 'senha-teste');
  assert.equal(info.name, 'MARIA DE TESTE');
  assert.equal(info.issuer, 'AC Teste');
  assert.throws(() => certificateInfo(p12, 'errada'), /Senha do certificado incorreta/);

  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText('Petição de teste', { x: 50, y: 780 });
  const pdfBytes = Buffer.from(await doc.save());
  const { bytes } = await signPdf({
    pdfBytes,
    p12Bytes: p12,
    password: 'senha-teste',
    reason: 'Protocolo',
    location: 'Goiânia',
  });
  const text = bytes.toString('latin1');
  assert.match(text, /\/SubFilter\s*\/ETSI\.CAdES\.detached/);
  assert.match(text, /\/ByteRange\s*\[\s*0\s+\d+\s+\d+\s+\d+\s*\]/);
  // The signature is a non-empty CMS blob inside /Contents.
  const contents = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(text)[1].replace(/0+$/, '');
  assert.ok(contents.length > 1000);
  // The digest signed in the CMS is the SHA-256 of the bytes covered by /ByteRange.
  const [a, b, c, d] = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text).slice(1).map(Number);
  const covered = Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + d)]);
  const digest = require('node:crypto').createHash('sha256').update(covered).digest('binary');
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.hexToBytes(contents)));
  const signedDigest = p7.rawCapture.authenticatedAttributes.find(
    attr => forge.asn1.derToOid(attr.value[0].value) === forge.pki.oids.messageDigest,
  ).value[1].value[0].value;
  assert.equal(signedDigest, digest, 'the signature covers the document');
  // The signed file still opens as a PDF.
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);

  const expired = makeP12('x', { notAfter: new Date(Date.now() - 3600000) });
  await assert.rejects(signPdf({ pdfBytes, p12Bytes: expired, password: 'x' }), /não está válido hoje/);
});
