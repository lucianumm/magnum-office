// Debt update: monetary correction by a price index, interest, fine and attorney's fees, with the
// month-by-month reasoning. Indices come from the Banco Central (SGS) and are passed in as
// { 'YYYY-MM': percent }. Conventions follow the BCB "Calculadora do Cidadão":
// - price indices: product of (1 + index/100) from the start month to the end month, both included;
// - Taxa Legal (Lei 14.905/2024, Res. CMN 5.171/2024): simple interest, monthly rates added up,
//   partial months pro rata by calendar days (rate / days of the month × days), never negative.
import { isDateKey, addDays } from './deadlines.mjs';
import { parseMoney } from './money.mjs';

// Codes confirmed against the BCB SGS (values of 2024 checked against the official releases).
export const indexSeries = {
  IPCA: { code: 433, label: 'IPCA (IBGE)' },
  INPC: { code: 188, label: 'INPC (IBGE)' },
  'IGP-M': { code: 189, label: 'IGP-M (FGV)' },
  'IPCA-E': { code: 10764, label: 'IPCA-E (IBGE)' },
  SELIC: { code: 4390, label: 'Selic acumulada no mês' },
  TAXA_LEGAL: { code: 29543, label: 'Taxa Legal (Res. CMN 5.171/2024)' },
};
export const LEGAL_RATE_START = '2024-08-30'; // Lei 14.905/2024 in force

export const debtPresets = {
  civil: {
    label: 'Código Civil após a Lei 14.905/2024 (IPCA + Taxa Legal)',
    correction: 'IPCA',
    interest: 'cc',
  },
  fazenda: { label: 'Fazenda Pública — EC 113/2021 (Selic)', correction: 'none', interest: 'selic' },
  custom: { label: 'Personalizado', correction: 'IPCA', interest: 'simple' },
};

const monthOf = date => date.slice(0, 7);
const daysInMonth = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const monthsBetween = (from, to) => {
  const list = [];
  for (let m = from; m <= to; m = nextMonth(m)) list.push(m);
  return list;
};
// Calendar days of [from, to) that fall inside each month.
function daysByMonth(from, to) {
  const out = [];
  let d = from;
  while (d < to) {
    const month = monthOf(d);
    const monthEnd = nextMonth(month) + '-01';
    const until = monthEnd < to ? monthEnd : to;
    const days = Math.round((Date.parse(until) - Date.parse(d)) / 86400000);
    out.push({ month, days });
    d = until;
  }
  return out;
}
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const toCents = n => Math.round(n * 100) / 100;

export function calculateDebt(input) {
  const principal = Number(parseMoney(input.principal));
  if (!principal) throw new Error('Informe o valor a atualizar.');
  const { start, end } = input;
  if (!isDateKey(start) || !isDateKey(end)) throw new Error('Informe as datas inicial e final.');
  if (end < start) throw new Error('A data final deve ser posterior à inicial.');
  const correction = input.correction || 'none';
  const interest = input.interest || 'none';
  if (correction !== 'none' && !indexSeries[correction]) throw new Error('Índice de correção inválido.');
  if (!['none', 'simple', 'legal', 'cc', 'selic'].includes(interest)) throw new Error('Tipo de juros inválido.');
  const series = input.series || {};
  const warnings = [];
  const basis = [];
  const rows = new Map();
  const row = month => {
    if (!rows.has(month)) rows.set(month, { month, index: null, factor: null, interestRate: null, interestDays: null });
    return rows.get(month);
  };
  // Selic already contains inflation and interest (EC 113/2021, art. 3º): no other index on top.
  const effectiveCorrection = interest === 'selic' ? 'none' : correction;
  if (interest === 'selic' && correction !== 'none')
    warnings.push('Com a Selic, nenhum outro índice de correção é somado (EC 113/2021, art. 3º).');

  // 1. Monetary correction.
  let factor = 1;
  if (effectiveCorrection !== 'none') {
    const values = series[effectiveCorrection] || {};
    const months = monthsBetween(monthOf(start), monthOf(end));
    const missing = [];
    for (const m of months) {
      if (values[m] === undefined) {
        missing.push(m);
        continue;
      }
      factor *= 1 + values[m] / 100;
      Object.assign(row(m), { index: values[m], factor: round(factor, 8) });
    }
    if (missing.length === months.length)
      throw new Error(
        `Não há índices do ${indexSeries[effectiveCorrection].label} para o período. Atualize os índices.`,
      );
    if (missing.length)
      warnings.push(
        `${indexSeries[effectiveCorrection].label} ainda não divulgado ou ausente em: ${missing.map(m => m.split('-').reverse().join('/')).join(', ')}. Esses meses ficaram sem correção.`,
      );
    basis.push(
      `Correção pelo ${indexSeries[effectiveCorrection].label}: produto dos índices mensais de ${monthOf(start).split('-').reverse().join('/')} a ${monthOf(end).split('-').reverse().join('/')}, inclusive (metodologia da Calculadora do Cidadão do Banco Central).`,
    );
  }
  const corrected = toCents(principal * factor);

  // 2. Interest, on the corrected amount.
  const interestFrom = input.interestFrom && isDateKey(input.interestFrom) ? input.interestFrom : start;
  let rate = 0; // accumulated, in percent (simple) or as factor - 1 (selic composta)
  let interestAmount = 0;
  const simpleRate = Number(String(input.rate ?? '1').replace(',', '.'));
  const addLegal = (from, to) => {
    const values = series.TAXA_LEGAL || {};
    const missing = [];
    for (const { month, days } of daysByMonth(from, to)) {
      if (values[month] === undefined) {
        missing.push(month);
        continue;
      }
      const monthly = Math.max(0, values[month]);
      const part = round((monthly / daysInMonth(month)) * days, 6);
      rate += part;
      Object.assign(row(month), { interestRate: part, interestDays: days });
    }
    if (missing.length)
      warnings.push(
        `Taxa Legal ainda não divulgada em: ${missing.map(m => m.split('-').reverse().join('/')).join(', ')}. Esses dias ficaram sem juros.`,
      );
  };
  const addSimple = (from, to, monthly) => {
    for (const { month, days } of daysByMonth(from, to)) {
      const part = round((monthly / daysInMonth(month)) * days, 6);
      rate += part;
      Object.assign(row(month), { interestRate: part, interestDays: days });
    }
  };
  if (interest === 'simple') {
    if (!Number.isFinite(simpleRate) || simpleRate < 0 || simpleRate > 20)
      throw new Error('Informe a taxa de juros ao mês, por exemplo 1.');
    addSimple(interestFrom, end, simpleRate);
    basis.push(
      `Juros simples de ${String(simpleRate).replace('.', ',')}% ao mês desde ${interestFrom.split('-').reverse().join('/')}, proporcionais aos dias corridos.`,
    );
  } else if (interest === 'legal' || interest === 'cc') {
    if (interest === 'cc' && interestFrom < LEGAL_RATE_START) {
      // Before Lei 14.905/2024 the rate under the former art. 406 was disputed (1% a month or Selic),
      // so the office states the rate fixed in its decision or contract.
      if (!Number.isFinite(simpleRate) || simpleRate < 0 || simpleRate > 20)
        throw new Error('Informe a taxa de juros ao mês do período anterior, por exemplo 1.');
      addSimple(interestFrom, end < LEGAL_RATE_START ? end : LEGAL_RATE_START, simpleRate);
      basis.push(
        `Até 29/08/2024, juros simples de ${String(simpleRate).replace('.', ',')}% ao mês, informados no cálculo. Na redação anterior do art. 406 do Código Civil havia divergência (1% ao mês pelo art. 161, § 1º, do CTN, ou Selic); use o critério da decisão ou do contrato.`,
      );
    } else if (interestFrom < LEGAL_RATE_START)
      warnings.push('A Taxa Legal vale a partir de 30/08/2024. Os juros do período anterior não foram calculados.');
    const from = interestFrom > LEGAL_RATE_START ? interestFrom : LEGAL_RATE_START;
    if (from < end) addLegal(from, end);
    basis.push(
      'Juros pela Taxa Legal desde 30/08/2024: Selic menos IPCA-15, nunca negativa, em juros simples e pro rata por dias corridos (CC, art. 406, com a redação da Lei 14.905/2024; Res. CMN 5.171/2024).',
    );
  } else if (interest === 'selic') {
    const values = series.SELIC || {};
    const months = monthsBetween(monthOf(interestFrom), monthOf(end));
    const compound = input.selicMode !== 'simples';
    let selicFactor = 1;
    const missing = [];
    for (const m of months) {
      if (values[m] === undefined) {
        missing.push(m);
        continue;
      }
      if (compound) selicFactor *= 1 + values[m] / 100;
      else rate += values[m];
      Object.assign(row(m), { interestRate: values[m] });
    }
    if (compound) rate = (selicFactor - 1) * 100;
    if (missing.length)
      warnings.push(`Selic ainda não divulgada em: ${missing.map(m => m.split('-').reverse().join('/')).join(', ')}.`);
    basis.push(
      `Selic acumulada mensalmente ${compound ? 'de forma composta (como a Calculadora do Cidadão)' : 'por soma simples das taxas mensais'}, de ${monthOf(interestFrom).split('-').reverse().join('/')} a ${monthOf(end).split('-').reverse().join('/')}, inclusive (EC 113/2021, art. 3º). Confira o critério adotado pelo juízo.`,
    );
  }
  interestAmount = toCents(corrected * (rate / 100));

  // 3. Fine and fees on the updated debt (e.g. CPC, art. 523, § 1º: 10% + 10%).
  const subtotal = toCents(corrected + interestAmount);
  const finePercent = Number(String(input.fine || 0).replace(',', '.')) || 0;
  const feePercent = Number(String(input.fees || 0).replace(',', '.')) || 0;
  if (finePercent < 0 || finePercent > 100 || feePercent < 0 || feePercent > 100)
    throw new Error('Use percentuais entre 0 e 100.');
  const fine = toCents((subtotal * finePercent) / 100);
  const fees = toCents((subtotal * feePercent) / 100);
  if (finePercent || feePercent)
    basis.push(
      `Multa de ${String(finePercent).replace('.', ',')}% e honorários de ${String(feePercent).replace('.', ',')}% calculados sobre o débito atualizado (valor corrigido + juros).`,
    );
  warnings.push(
    'Confira os critérios fixados na decisão ou no contrato. O cálculo não substitui a conferência do advogado ou do contador.',
  );
  return {
    principal: toCents(principal),
    start,
    end,
    correction: effectiveCorrection,
    factor: round(factor, 8),
    corrected,
    interest,
    interestRate: round(rate, 6),
    interestAmount,
    subtotal,
    fine,
    fees,
    total: toCents(subtotal + fine + fees),
    rows: [...rows.values()].sort((a, b) => a.month.localeCompare(b.month)),
    basis,
    warnings,
  };
}

// Which series a calculation needs, and from when.
export function seriesNeeded({ correction, interest }) {
  const list = new Set();
  if (interest === 'selic') list.add('SELIC');
  else if (correction && correction !== 'none') list.add(correction);
  if (interest === 'legal' || interest === 'cc') list.add('TAXA_LEGAL');
  return [...list];
}
export { addDays };
