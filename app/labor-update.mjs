// Update of a labour debt in the phases set by the STF (ADC 58) and adjusted by the TST after Lei
// 14.905/2024: IPCA-E before the claim is filed; Selic from filing until 29/08/2024; IPCA plus the
// Taxa Legal from 30/08/2024. Each phase starts from the total of the previous one.
import { calculateDebt, seriesNeeded } from './debt.mjs';

const LAW_14905 = '2024-08-30';
const dayBefore = date => new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

export function laborPhases({ start, filing, end }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || ''))
    throw new Error('Informe o vencimento e a data final.');
  if (end < start) throw new Error('A data final deve ser posterior ao vencimento.');
  const filed = /^\d{4}-\d{2}-\d{2}$/.test(filing || '') ? filing : '';
  if (filed && filed < start) throw new Error('O ajuizamento não pode ser antes do vencimento.');
  const phases = [];
  const preEnd = filed && filed <= end ? filed : end;
  if (start < preEnd || !filed)
    phases.push({ label: 'Fase pré-judicial: IPCA-E', start, end: preEnd, correction: 'IPCA-E', interest: 'none' });
  if (filed && filed < end) {
    if (filed < LAW_14905)
      phases.push({
        label: 'Do ajuizamento até 29/08/2024: Selic',
        start: filed,
        end: end < LAW_14905 ? end : dayBefore(LAW_14905),
        correction: 'none',
        interest: 'selic',
      });
    if (end >= LAW_14905)
      phases.push({
        label: 'Desde 30/08/2024: IPCA e Taxa Legal',
        start: filed > LAW_14905 ? filed : LAW_14905,
        end,
        correction: 'IPCA',
        interest: 'legal',
      });
  }
  return phases.filter(p => p.start <= p.end);
}

export const laborSeriesNeeded = input => [
  ...new Set(laborPhases(input).flatMap(p => seriesNeeded({ correction: p.correction, interest: p.interest }))),
];

export function updateLaborDebt({ principal, start, filing, end, series = {}, selicMode = 'composta' }) {
  let amount = principal;
  const steps = [];
  const warnings = new Set();
  for (const phase of laborPhases({ start, filing, end })) {
    if (phase.start === phase.end) continue;
    const r = calculateDebt({
      principal: amount,
      start: phase.start,
      end: phase.end,
      correction: phase.correction,
      interest: phase.interest,
      interestFrom: '',
      selicMode,
      fine: '0',
      fees: '0',
      rate: '0',
      series,
    });
    steps.push({ ...phase, from: Number(amount), total: Number(r.total), factor: r.factor });
    for (const w of r.warnings) warnings.add(w);
    amount = String(r.total);
  }
  return {
    principal: Number(principal),
    total: Number(amount),
    steps,
    warnings: [
      ...warnings,
      'Na fase pré-judicial, os juros do art. 39 da Lei 8.177/1991 (TRD) não foram somados; a TR tem ficado próxima de zero.',
    ],
  };
}
