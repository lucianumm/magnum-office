// Builds the "qualificação" paragraph used at the start of powers of attorney, contracts and petitions.
// Gender is unknown, so the inflected words use the "(a)" form the lawyer can adjust in the document.

const join = parts => parts.filter(Boolean).join(', ');

export function formatZip(value) {
  const d = String(value || '').replace(/\D/g, '');
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : String(value || '').trim();
}

export function clientAddress(c) {
  const structured = [c.street, c.addressNumber, c.district, c.city, c.zip].some(v => String(v || '').trim());
  if (!structured) return String(c.address || '').trim();
  const place = c.city && c.state ? `${c.city}/${c.state}` : c.city || c.state;
  return join([
    c.street,
    c.addressNumber && `nº ${c.addressNumber}`,
    c.complement,
    c.district,
    place,
    c.zip && `CEP ${formatZip(c.zip)}`,
  ]);
}

export function qualification(c) {
  const legal = c.personType === 'Jurídica';
  const address = clientAddress(c);
  const missing = [];
  const need = (value, label) => {
    if (!String(value || '').trim()) missing.push(label);
    return value;
  };
  const name = String(c.name || '')
    .trim()
    .toLocaleUpperCase('pt-BR');
  let parts;
  if (legal) {
    parts = [
      name,
      'pessoa jurídica de direito privado',
      need(c.document, 'CNPJ') && `inscrita no CNPJ sob o nº ${c.document}`,
      need(address, 'endereço') && `com sede em ${address}`,
      c.email && `e-mail ${c.email}`,
      need(c.legalRepresentative, 'representante legal') &&
        `neste ato representada por ${c.legalRepresentative}${c.representativeDocument ? `, inscrito(a) no CPF sob o nº ${c.representativeDocument}` : ''}`,
    ];
  } else {
    const rg = c.rg && `portador(a) da cédula de identidade RG nº ${c.rg}${c.rgIssuer ? ` ${c.rgIssuer}` : ''}`;
    parts = [
      name,
      need(c.nationality, 'nacionalidade'),
      need(c.maritalStatus, 'estado civil'),
      need(c.profession, 'profissão'),
      need(c.rg, 'RG') && rg,
      need(c.document, 'CPF') && `inscrito(a) no CPF sob o nº ${c.document}`,
      need(address, 'endereço') && `residente e domiciliado(a) em ${address}`,
      c.email && `e-mail ${c.email}`,
    ];
  }
  return { text: join(parts) + '.', missing };
}
