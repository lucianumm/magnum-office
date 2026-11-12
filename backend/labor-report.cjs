// Severance estimate as a PDF "memória de cálculo". The numbers are recalculated here from the
// inputs, never taken from the screen.
const { calculateSeverance, centsBRL } = require('../app/labor.mjs');
const { uuid, text } = require('./validation.cjs');

const br = date => date.split('-').reverse().join('/');
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
  'kind',
  'notice',
  'admission',
  'termination',
  'salary',
  'extras',
  'salaryDays',
  'vestedPeriods',
  'thirteenthAdvance',
  'doubledPeriods',
  'fgtsBalance',
];

function laborReport(input = {}) {
  const clean = Object.fromEntries(fields.map(key => [key, text(String(input[key] ?? ''), 40)]));
  const r = calculateSeverance({ ...clean, art477: input.art477 === true });
  const caseId = input.caseId ? uuid(input.caseId) : '';
  const blocks = [
    p('MEMÓRIA DE CÁLCULO — VERBAS RESCISÓRIAS', { heading: true, align: 'center', bold: true }),
    labelled('Modalidade', r.kindLabel),
    labelled('Contrato', `${br(r.admission)} a ${br(r.termination)} (${r.years} ano(s) completo(s))`),
    ...(r.projected !== r.termination ? [labelled('Projeção do aviso prévio', br(r.projected))] : []),
    labelled('Remuneração considerada', centsBRL(r.remuneration)),
    p(''),
    p('Verbas', { bold: true }),
    ...r.items.map(i =>
      p(`${i.label}${i.reference ? ` (${i.reference})` : ''}: ${i.debit ? '− ' : ''}${centsBRL(i.value)}`),
    ),
    labelled('Total das verbas', centsBRL(r.totals.net)),
    p(''),
    p('FGTS', { bold: true }),
    p(`Depósito do mês da rescisão (8%): ${centsBRL(r.fgts.deposit)}`),
    ...(r.fgts.finePercent
      ? [
          p(
            `Multa de ${r.fgts.finePercent}% sobre saldo de ${centsBRL(r.fgts.accountBalance)}${r.fgts.estimated ? ' (estimado)' : ''} mais o depósito: ${centsBRL(r.fgts.fine)}`,
          ),
        ]
      : []),
    p(''),
    labelled('TOTAL GERAL ESTIMADO', centsBRL(r.totals.total)),
    p(''),
    p('Fundamentos e critérios', { bold: true }),
    ...r.basis.map(b => p(`• ${b}`)),
    ...r.warnings.map(w => p(`• ${w}`)),
    p(''),
    p(`Gerado pelo Magnum Office em ${new Date().toLocaleDateString('pt-BR')}.`),
  ];
  return {
    blocks,
    caseId,
    title: `Cálculo de rescisão ${br(r.termination).replace(/\//g, '-')}`,
    calculation: {
      type: 'labor',
      total: (r.totals.total / 100).toFixed(2),
      net: (r.totals.net / 100).toFixed(2),
      date: r.termination,
    },
  };
}
module.exports = { laborReport };
