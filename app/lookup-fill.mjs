// What a lookup (DataJud or CNPJ) fills in a form: only empty fields, never what was typed. The form
// applies it to its current values when the answer arrives, so typing during the lookup is kept.
const caseLabels = {
  procedure: 'Classe',
  court: 'Vara / órgão julgador',
  county: 'Comarca',
  filedAt: 'Distribuição',
  instance: 'Instância',
  area: 'Área',
};
const addressKeys = ['zip', 'street', 'addressNumber', 'complement', 'district', 'city', 'state'];
const empty = value => !String(value ?? '').trim();
const brDate = value => value.split('-').reverse().join('/');

// result: answer of window.advocacia.lookupCase. savedArea: the area stored before editing, if any.
export function caseFill(current, result, { savedArea = '' } = {}) {
  const changes = {};
  const lines = [];
  for (const [key, value] of Object.entries(result.fields || {})) {
    // "Cível" is the form's default area, not a choice, while the case was never saved with it.
    const free = empty(current[key]) || (key === 'area' && current.area === 'Cível' && !savedArea);
    if (free && value && current[key] !== value) {
      changes[key] = value;
      lines.push(`${caseLabels[key] || key}: ${key === 'filedAt' ? brDate(value) : value}`);
    }
  }
  return { changes, lines };
}

// slot: 'opposing' (case form) or 'client' (client form). result: answer of window.advocacia.lookupCNPJ.
export function companyFill(current, result, slot) {
  const changes = {};
  const lines = [];
  const put = (key, value, label) => {
    if (value && empty(current[key])) {
      changes[key] = value;
      lines.push(`${label}: ${value}`);
    }
  };
  if (slot === 'opposing') put('opposingParty', result.name, 'Parte contrária');
  else {
    put('name', result.name, 'Razão social');
    if (current.personType !== 'Jurídica') changes.personType = 'Jurídica';
    put('legalRepresentative', result.legalRepresentative, 'Representante legal');
    // The address goes in only as a whole, so parts of two addresses are never mixed.
    const a = result.address || {};
    if (addressKeys.every(k => empty(current[k])) && a.street) {
      for (const k of addressKeys) if (a[k]) changes[k] = a[k];
      lines.push(
        `Endereço: ${[a.street, a.addressNumber, a.complement, a.district, a.city && `${a.city}/${a.state}`, a.zip]
          .filter(Boolean)
          .join(', ')}`,
      );
    }
  }
  return { changes, lines };
}
