// Labour liquidation as a PDF "memória de cálculo": overtime with reflexes, other amounts and the
// update by the ADC 58 phases. Recalculated here from the inputs and the cached indices.
const { calculateOvertime } = require('../app/overtime.mjs');
const { updateLaborDebt, laborSeriesNeeded } = require('../app/labor-update.mjs');
const { parseMoney } = require('../app/money.mjs');
const { uuid, text } = require('./validation.cjs');

const br = date => date.split('-').reverse().join('/');
const brl = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/gu, ' ');
const p = (value, opts = {}) => ({
  align: opts.align || 'left',
  heading: !!opts.heading,
  runs: [{ text: value, bold: !!opts.bold }],
});
const labelled = (label, value) => ({
  align: 'left',
  heading: false,
  runs: [{ text: `${label}: `, bold: true }, { text: value }],
});
const fields = [
  'salary',
  'divisor',
  'hours',
  'percent',
  'months',
  'noticeDays',
  'finePercent',
  'others',
  'start',
  'filing',
  'end',
];

function liquidationReport(input = {}, indices) {
  const f = Object.fromEntries(fields.map(key => [key, text(String(input[key] ?? ''), 40)]));
  const overtime = f.salary && f.hours ? calculateOvertime({ ...f, dsrInBase: input.dsrInBase !== false }) : null;
  const others = parseMoney(f.others);
  if (others === null) throw new Error('Valor inválido em outras verbas.');
  const principal = (overtime ? overtime.total / 100 : 0) + (others ? Number(others) : 0);
  if (!principal) throw new Error('Informe as horas extras ou outras verbas.');
  const updated = f.start
    ? updateLaborDebt({ ...f, principal: principal.toFixed(2), series: indices.values(laborSeriesNeeded(f)) })
    : null;
  const blocks = [
    p('MEMÓRIA DE CÁLCULO — LIQUIDAÇÃO TRABALHISTA', { heading: true, align: 'center', bold: true }),
    ...(overtime
      ? [
          p('Horas extras e reflexos', { bold: true }),
          ...overtime.items.map(i => p(`${i.label}${i.reference ? ` (${i.reference})` : ''}: ${brl(i.value / 100)}`)),
          labelled('Subtotal', brl(overtime.total / 100)),
          p(''),
        ]
      : []),
    ...(others ? [labelled('Outras verbas', brl(others)), p('')] : []),
    labelled('Principal', brl(principal)),
    ...(updated
      ? [
          p(''),
          p('Atualização (ADC 58 do STF e Lei 14.905/2024)', { bold: true }),
          ...updated.steps.map(s =>
            p(`${s.label}, de ${br(s.start)} a ${br(s.end)}: ${brl(s.from)} → ${brl(s.total)}`),
          ),
          labelled('TOTAL ATUALIZADO', brl(updated.total)),
        ]
      : []),
    p(''),
    p('Fundamentos e avisos', { bold: true }),
    ...(overtime?.basis || []).map(b => p(`• ${b}`)),
    ...[...(overtime?.warnings || []), ...(updated?.warnings || [])].map(w => p(`• ${w}`)),
    p(''),
    p(
      `Índices: Banco Central do Brasil (SGS). Gerado pelo Magnum Office em ${new Date().toLocaleDateString('pt-BR')}.`,
    ),
  ];
  const end = f.end || new Date().toISOString().slice(0, 10);
  return {
    blocks,
    caseId: input.caseId ? uuid(input.caseId) : '',
    title: `Liquidação trabalhista ${br(end).replace(/\//g, '-')}`,
    calculation: { type: 'liquidation', total: Number(updated ? updated.total : principal).toFixed(2), date: end },
  };
}

module.exports = { liquidationReport };
