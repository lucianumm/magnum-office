// Money in reais: parsing of what people type, display, and the amount written out in words
// ("R$ 1.500,00 (mil e quinhentos reais)"), as contracts and receipts require.

// Accepts "R$ 1.234,56", "1234,56", "1234.56" or "15.000". Returns "1234.56", '' for empty, or null when invalid.
export function parseMoney(value) {
  let v = String(value ?? '').replace(/R\$|\s/g, '');
  if (!v) return '';
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+(\.\d{1,2})?$/.test(v)) v = v.replace(/\./g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(v)) return null;
  return Number(v).toFixed(2);
}

export const formatBRL = value =>
  value === '' || value === null || value === undefined
    ? ''
    : Number(value)
        .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        .replace(/\s/gu, ' '); /* Intl puts a no-break space after R$ */

const units = [
  '',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const hundreds = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function below1000(n) {
  if (n === 100) return 'cem';
  const parts = [];
  if (n >= 100) parts.push(hundreds[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 20) parts.push(tens[Math.floor(rest / 10)] + (rest % 10 ? ' e ' + units[rest % 10] : ''));
  else if (rest) parts.push(units[rest]);
  return parts.join(' e ');
}

// Integer in words, masculine (reais, centavos). Supports up to 999 bilhões.
export function numberInWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new Error('Número fora do limite para escrita por extenso.');
  if (n === 0) return 'zero';
  const scales = [
    [1e9, 'bilhão', 'bilhões'],
    [1e6, 'milhão', 'milhões'],
    [1e3, 'mil', 'mil'],
    [1, '', ''],
  ];
  const groups = [];
  let rest = n;
  for (const [size, one, many] of scales) {
    const value = Math.floor(rest / size);
    rest %= size;
    if (!value) continue;
    if (size === 1e3) groups.push({ value, text: value === 1 ? 'mil' : `${below1000(value)} mil` });
    else if (size === 1) groups.push({ value, text: below1000(value) });
    else groups.push({ value, text: `${below1000(value)} ${value === 1 ? one : many}` });
  }
  // "mil e quinhentos", "dois mil e cem", but "mil duzentos e trinta".
  return groups
    .map((g, i) => {
      if (i === 0) return g.text;
      const last = i === groups.length - 1;
      return (last && (g.value < 100 || g.value % 100 === 0) ? ' e ' : ' ') + g.text;
    })
    .join('');
}

export function reaisInWords(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) return '';
  const whole = Math.floor(cents / 100),
    fraction = cents % 100;
  const parts = [];
  if (whole) {
    const words = numberInWords(whole);
    // "um milhão de reais", but "um milhão e cem reais".
    const de = whole >= 1e6 && whole % 1e6 === 0 ? ' de' : '';
    parts.push(`${words}${de} ${whole === 1 ? 'real' : 'reais'}`);
  }
  if (fraction) parts.push(`${numberInWords(fraction)} ${fraction === 1 ? 'centavo' : 'centavos'}`);
  return parts.length ? parts.join(' e ') : 'zero real';
}

// "R$ 1.500,00 (mil e quinhentos reais)"
export const moneyWithWords = value =>
  value === '' || value == null ? '' : `${formatBRL(value)} (${reaisInWords(value)})`;
