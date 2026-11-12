// Digital signature of a PDF with an ICP-Brasil A1 certificate (.pfx/.p12), in the PAdES format
// (ETSI.CAdES.detached). The certificate and its password are read only for this signature and never
// stored or sent anywhere.
const forge = require('node-forge');
const { PDFDocument } = require('pdf-lib');

const MAX_PDF = 100 * 1024 * 1024;
const MAX_CERT = 64 * 1024;

// Holder name and validity of the certificate, to show before signing and to stamp the signature.
function certificateInfo(p12Bytes, password) {
  if (!p12Bytes?.length || p12Bytes.length > MAX_CERT) throw new Error('Escolha um certificado A1 (.pfx ou .p12).');
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(p12Bytes.toString('binary'))),
      String(password),
    );
  } catch {
    throw new Error('Senha do certificado incorreta ou arquivo inválido.');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keys = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  if (!bags.length || !keys.length) throw new Error('O certificado não contém a chave privada.');
  // The holder certificate is the one whose public key matches the private key.
  const key = keys[0].key;
  const holder = bags.map(b => b.cert).find(c => c.publicKey.n && key.n && c.publicKey.n.equals(key.n)) || bags[0].cert;
  const cn = holder.subject.getField('CN')?.value || '';
  return {
    name: cn.split(':')[0].trim() || cn,
    subject: cn,
    issuer: holder.issuer.getField('CN')?.value || '',
    validFrom: holder.validity.notBefore.toISOString(),
    validTo: holder.validity.notAfter.toISOString(),
  };
}

async function signPdf({
  pdfBytes,
  p12Bytes,
  password,
  reason = 'Assinatura digital',
  location = '',
  now = new Date(),
}) {
  if (!pdfBytes?.length || pdfBytes.length > MAX_PDF) throw new Error('Escolha um PDF de até 100 MB.');
  const info = certificateInfo(p12Bytes, password);
  if (now < new Date(info.validFrom) || now > new Date(info.validTo))
    throw new Error(
      `O certificado não está válido hoje (validade até ${new Date(info.validTo).toLocaleDateString('pt-BR')}).`,
    );
  const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
  const { P12Signer } = require('@signpdf/signer-p12');
  const signpdf = require('@signpdf/signpdf').default;
  const { SUBFILTER_ETSI_CADES_DETACHED } = require('@signpdf/utils');
  let doc;
  try {
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  } catch {
    throw new Error('O PDF está protegido ou corrompido.');
  }
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: String(reason).slice(0, 200),
    contactInfo: '',
    name: info.name.slice(0, 200),
    location: String(location).slice(0, 200),
    signingTime: now,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
  });
  const prepared = Buffer.from(await doc.save({ useObjectStreams: false }));
  const signer = new P12Signer(p12Bytes, { passphrase: String(password) });
  const signed = await signpdf.sign(prepared, signer, now);
  return { bytes: Buffer.from(signed), info };
}

module.exports = { signPdf, certificateInfo };
