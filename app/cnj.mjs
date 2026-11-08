// Número único de processo (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO.
// The check digits follow ISO 7064 mod 97-10, the same family used by IBAN.

// Order used by the CNJ for the TR field of state courts (J=8) and electoral courts (J=6).
export const cnjStates = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SE',
  'SP',
  'TO',
];

const segments = {
  1: 'Supremo Tribunal Federal',
  2: 'Conselho Nacional de Justiça',
  3: 'Superior Tribunal de Justiça',
  4: 'Justiça Federal',
  5: 'Justiça do Trabalho',
  6: 'Justiça Eleitoral',
  7: 'Justiça Militar da União',
  8: 'Justiça Estadual',
  9: 'Justiça Militar Estadual',
};
const stateMilitary = { 13: 'MG', 21: 'RS', 26: 'SP' };

export const cnjDigits = value => String(value || '').replace(/\D/g, '');

export function cnjCheckDigits(sequence, year, segment, tribunal, origin) {
  const base = BigInt(`${sequence}${year}${segment}${tribunal}${origin}00`);
  return String(98n - (base % 97n)).padStart(2, '0');
}

export function formatCNJ(value) {
  const d = cnjDigits(value).slice(0, 20);
  const parts = [d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16, 20)];
  const marks = ['', '-', '.', '.', '.', '.'];
  return parts.reduce((out, part, i) => (part ? out + marks[i] + part : out), '');
}

function court(segment, tr) {
  const n = Number(tr);
  const uf = cnjStates[n - 1];
  switch (segment) {
    case 1:
      return { id: 'stf', uf: '' };
    case 2:
      return { id: 'cnj', uf: '' };
    case 3:
      return { id: 'stj', uf: '' };
    case 4:
      return n >= 1 && n <= 6 ? { id: 'trf' + n, uf: '' } : null;
    case 5:
      return n === 0 ? { id: 'tst', uf: '' } : n >= 1 && n <= 24 ? { id: 'trt' + n, uf: '' } : null;
    case 6:
      return n === 0 ? { id: 'tse', uf: '' } : uf ? { id: 'tre-' + uf.toLowerCase(), uf } : null;
    case 7:
      return { id: 'stm', uf: '' };
    case 8:
      return uf ? { id: uf === 'DF' ? 'tjdft' : 'tj' + uf.toLowerCase(), uf } : null;
    case 9:
      return stateMilitary[n] ? { id: 'tjm' + stateMilitary[n].toLowerCase(), uf: stateMilitary[n] } : null;
    default:
      return null;
  }
}

// Returns null when the value is not a 20-digit CNJ number (old or administrative numbering).
export function parseCNJ(value) {
  const d = cnjDigits(value);
  if (d.length !== 20) return null;
  const sequence = d.slice(0, 7),
    check = d.slice(7, 9),
    year = d.slice(9, 13),
    segment = Number(d[13]),
    tribunal = d.slice(14, 16),
    origin = d.slice(16, 20);
  const expected = cnjCheckDigits(sequence, year, segment, tribunal, origin);
  const found = segments[segment] ? court(segment, tribunal) : null;
  const valid = expected === check && !!segments[segment] && Number(year) >= 1900;
  return {
    formatted: formatCNJ(d),
    valid,
    expectedCheck: expected,
    sequence,
    year: Number(year),
    segment,
    segmentName: segments[segment] || '',
    tribunal,
    origin,
    originalJurisdiction: origin === '0000',
    courtId: found?.id || '',
    uf: found?.uf || '',
  };
}

// Plain-language reason a number cannot be accepted, or '' when it can.
export function cnjProblem(value) {
  const d = cnjDigits(value);
  if (!d) return '';
  if (d.length !== 20) return d.length > 20 ? 'O número CNJ tem 20 dígitos.' : '';
  const parsed = parseCNJ(d);
  if (!segments[parsed.segment]) return 'O segmento de justiça (J) do número não existe.';
  if (parsed.year < 1900) return 'O ano do número do processo é inválido.';
  if (!parsed.valid)
    return 'O dígito verificador do número do processo não confere. Confira se algum número foi digitado errado.';
  return '';
}
