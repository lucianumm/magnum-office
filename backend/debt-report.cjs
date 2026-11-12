// Turns a debt update into a PDF "memória de cálculo" to attach to a petition. The numbers are
// recalculated here from the cached indices, never taken from the screen.
const { calculateDebt, seriesNeeded, indexSeries } = require('../app/debt.mjs');
const { formatBRL } = require('../app/money.mjs');
const { uuid } = require('./validation.cjs');

const br = date => date.split('-').reverse().join('/');
const pct = (n, places = 4) =>
  `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: places })}%`;
const p = (text, opts = {}) => ({
  align: opts.align || 'left',
  heading: !!opts.heading,
  runs: [{ text, bold: !!opts.bold }],
});
const labelled = (label, value) => ({
  align: 'left',
  heading: false,
  runs: [{ text: `${label}: `, bold: true }, { text: value }],
});

function report(input, indices) {
  const params = { ...input, series: indices.values(seriesNeeded(input)) };
  const r = calculateDebt(params);
  const caseId = input.caseId ? uuid(input.caseId) : '';
  const interestLabel = {
    none: 'Sem juros',
    simple: 'Juros simples',
    legal: 'Taxa Legal',
    cc: 'Código Civil (taxa informada até 29/08/2024 e Taxa Legal depois)',
    selic: 'Selic',
  }[r.interest];
  const blocks = [
    p('MEMÓRIA DE CÁLCULO — ATUALIZAÇÃO DE DÉBITO', { heading: true, align: 'center', bold: true }),
    labelled('Valor original', formatBRL(r.principal)),
    labelled('Período', `${br(r.start)} a ${br(r.end)}`),
    labelled(
      'Correção monetária',
      r.correction === 'none' ? 'Sem índice de correção' : indexSeries[r.correction].label,
    ),
    labelled('Juros', interestLabel),
    p(''),
    labelled('Fator de correção', r.factor.toLocaleString('pt-BR', { maximumFractionDigits: 8 })),
    labelled('Valor corrigido', formatBRL(r.corrected)),
    labelled('Juros acumulados', `${pct(r.interestRate)} = ${formatBRL(r.interestAmount)}`),
    labelled('Débito atualizado', formatBRL(r.subtotal)),
    ...(r.fine ? [labelled('Multa', formatBRL(r.fine))] : []),
    ...(r.fees ? [labelled('Honorários', formatBRL(r.fees))] : []),
    labelled('TOTAL', formatBRL(r.total)),
    p(''),
    p('Mês a mês', { bold: true }),
    ...r.rows.map(row =>
      p(
        [
          row.month.split('-').reverse().join('/'),
          row.index !== null
            ? `índice ${pct(row.index, 2)}, fator acumulado ${row.factor.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}`
            : '',
          row.interestRate !== null
            ? `juros ${pct(row.interestRate, 6)}${row.interestDays ? ` (${row.interestDays} dia(s))` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join(' — '),
      ),
    ),
    p(''),
    p('Fundamentos e critérios', { bold: true }),
    ...r.basis.map(b => p(`• ${b}`)),
    ...r.warnings.map(w => p(`• ${w}`)),
    p(''),
    p(
      `Índices: Banco Central do Brasil, Sistema Gerenciador de Séries Temporais (SGS). Gerado pelo Magnum Office em ${new Date().toLocaleDateString('pt-BR')}.`,
    ),
  ];
  return { blocks, caseId, title: `Memória de cálculo ${br(r.end).replace(/\//g, '-')}` };
}
module.exports = { report };
