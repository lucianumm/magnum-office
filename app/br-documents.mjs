// CPF and CNPJ check digits. CNPJ accepts the alphanumeric format adopted by the Receita Federal
// in July 2026 (letters in the first 12 positions, value = character code - 48).

const clean = value =>
  String(value || '')
    .toUpperCase()
    .replace(/[\s./-]/g, '');

function cpfValid(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(d[size])) return false;
  }
  return true;
}

function cnpjValid(d) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const value = c => c.charCodeAt(0) - 48;
  for (const size of [12, 13]) {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, w, i) => total + value(d[i]) * w, 0);
    const rest = sum % 11;
    if ((rest < 2 ? 0 : 11 - rest) !== Number(d[size])) return false;
  }
  return true;
}

// { type: 'CPF' | 'CNPJ' | '', valid, formatted }
export function brDocument(value) {
  const d = clean(value);
  if (!d) return { type: '', valid: true, formatted: '' };
  if (/^\d{11}$/.test(d))
    return { type: 'CPF', valid: cpfValid(d), formatted: d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') };
  if (d.length === 14)
    return {
      type: 'CNPJ',
      valid: cnpjValid(d),
      formatted: d.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    };
  return { type: '', valid: false, formatted: String(value).trim() };
}

export const documentKey = value => clean(value).replace(/[^0-9A-Z]/g, '');
