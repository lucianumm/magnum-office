const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateSeverance, centsBRL } = require('../app/labor.mjs');

const lines = r => Object.fromEntries(r.items.map(i => [i.key, [i.reference, i.value]]));

// Each case below was worked out by hand from the CLT rules written in app/labor.mjs.
test('dismissal without cause: notice of 39 days projects the 13th and vacation; FGTS fine on the balance', () => {
  const r = calculateSeverance({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '2022-03-10',
    termination: '2025-08-20',
    salary: '3.000,00',
    vestedPeriods: '1',
    fgtsBalance: '9.000,00',
  });
  assert.equal(r.years, 3);
  assert.equal(r.noticeDays, 39);
  assert.equal(r.projected, '2025-09-28');
  assert.deepEqual(lines(r), {
    saldo: ['20 dia(s)', 200000],
    aviso: ['39 dia(s)', 390000],
    '13-2025': ['9/12', 225000],
    'ferias-vencidas': ['1 período(s)', 300000],
    'terco-vencidas': ['', 100000],
    'ferias-proporcionais': ['7/12', 175000],
    'terco-proporcionais': ['', 58333],
  });
  assert.equal(r.totals.gross, 1448333);
  assert.deepEqual(r.fgts, {
    deposit: 65200,
    finePercent: 40,
    accountBalance: 900000,
    estimated: false,
    fine: 386080,
    total: 451280,
  });
  assert.equal(r.totals.total, 1899613);
  assert.equal(centsBRL(r.totals.total), 'R$ 18.996,13');
});

test('resignation without serving notice: 30 days are deducted and there is no FGTS fine', () => {
  const r = calculateSeverance({
    kind: 'pedido',
    notice: 'descontado',
    admission: '2024-01-15',
    termination: '2024-06-10',
    salary: '2400',
  });
  assert.deepEqual(lines(r), {
    saldo: ['10 dia(s)', 80000],
    'desconto-aviso': ['30 dia(s)', 240000],
    '13-2024': ['5/12', 100000],
    'ferias-proporcionais': ['5/12', 100000],
    'terco-proporcionais': ['', 33333],
  });
  assert.deepEqual(r.totals, { gross: 313333, deductions: 240000, net: 73333, total: 73333 + 14400 });
  assert.equal(r.fgts.fine, 0);
  assert.ok(r.warnings.some(w => /Não há multa do FGTS/.test(w)));
});

test('just cause keeps only the salary balance and vested vacation', () => {
  const r = calculateSeverance({
    kind: 'justa-causa',
    admission: '2021-05-01',
    termination: '2023-02-15',
    salary: '1.500,00',
    vestedPeriods: 1,
  });
  assert.deepEqual(lines(r), {
    saldo: ['15 dia(s)', 75000],
    'ferias-vencidas': ['1 período(s)', 150000],
    'terco-vencidas': ['', 50000],
  });
  assert.equal(r.totals.net, 275000);
  assert.equal(r.fgts.deposit, 6000);
});

test('agreement (art. 484-A): half the notice, 20% fine, 13th of the next year only from 15 days', () => {
  const r = calculateSeverance({
    kind: 'acordo',
    notice: 'indenizado',
    admission: '2019-12-01',
    termination: '2024-12-10',
    salary: '5.000,00',
  });
  assert.equal(r.noticeDays, 45);
  assert.equal(r.projected, '2025-01-01');
  const l = lines(r);
  assert.deepEqual(l.aviso, ['22 dia(s)', 366667]);
  assert.deepEqual(l['13-2024'], ['12/12', 500000]);
  assert.equal(l['13-2025'], undefined, 'one day in January is not a twelfth');
  assert.deepEqual(l['ferias-proporcionais'], ['1/12', 41667]);
  assert.equal(r.fgts.finePercent, 20);
  assert.equal(r.fgts.estimated, true);
  assert.ok(r.warnings.some(w => /Saldo do FGTS estimado/.test(w)));
});

test('worked notice pays only the proportional days beyond 30; projection can complete a vacation period', () => {
  const worked = calculateSeverance({
    kind: 'sem-justa-causa',
    notice: 'trabalhado',
    admission: '2015-01-05',
    termination: '2025-01-03',
    salary: '3000',
  });
  assert.equal(worked.noticeDays, 57);
  assert.deepEqual(lines(worked).aviso, ['27 dia(s)', 270000]);
  const crossing = calculateSeverance({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '2024-02-10',
    termination: '2025-01-20',
    salary: '3000',
  });
  assert.equal(crossing.projected, '2025-02-19');
  assert.deepEqual(lines(crossing)['ferias-projecao'], ['1 período(s)', 300000]);
  assert.deepEqual(lines(crossing)['ferias-proporcionais'], undefined, 'the new period has only 10 days');
});

test('invalid input is explained', () => {
  assert.throws(
    () => calculateSeverance({ admission: '2025-01-10', termination: '2024-01-10', salary: '1000' }),
    /antes da admissão/,
  );
  assert.throws(
    () => calculateSeverance({ admission: '2024-01-10', termination: '2025-01-10', salary: '' }),
    /salário/,
  );
  assert.throws(
    () => calculateSeverance({ admission: '2024-02-30', termination: '2025-01-10', salary: '1000' }),
    /datas/,
  );
  assert.throws(
    () =>
      calculateSeverance({ admission: '2024-01-10', termination: '2025-01-10', salary: '1000', fgtsBalance: 'abc' }),
    /FGTS/,
  );
});

test('the PDF report is recalculated from the inputs and becomes a valid PDF', async () => {
  const { laborReport } = require('../backend/labor-report.cjs');
  const { pdf } = require('../backend/document-files.cjs');
  const { blocks, caseId, title } = laborReport({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '2022-03-10',
    termination: '2025-08-20',
    salary: '3.000,00',
    vestedPeriods: '1',
    fgtsBalance: '9.000,00',
    total: 'ignorado',
  });
  const text = blocks.map(b => b.runs.map(r => r.text).join('')).join('\n');
  assert.equal(caseId, '');
  assert.equal(title, 'Cálculo de rescisão 20-08-2025');
  assert.match(text, /Aviso prévio indenizado \(39 dia\(s\)\): R\$ 3\.900,00/);
  assert.match(text, /TOTAL GERAL ESTIMADO: R\$ 18\.996,13/);
  assert.equal((await pdf(blocks, { title })).subarray(0, 5).toString(), '%PDF-');
  assert.throws(() => laborReport({ salary: 'x'.repeat(100) }), /Campo inválido/);
});

test('the 13th advance is deducted and forgotten vacation periods are pointed out', () => {
  const r = calculateSeverance({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '2022-03-10',
    termination: '2025-08-20',
    salary: '3.000,00',
    thirteenthAdvance: '1.000,00',
    fgtsBalance: '9.000,00',
  });
  const advance = r.items.find(i => i.key === 'adiantamento-13');
  assert.deepEqual([advance.value, advance.debit], [100000, true]);
  assert.equal(r.totals.deductions, 100000);
  assert.ok(r.warnings.some(w => /completou 3 período\(s\) aquisitivo/.test(w)));
  assert.throws(
    () =>
      calculateSeverance({
        admission: '2024-01-10',
        termination: '2025-01-10',
        salary: '1000',
        thirteenthAdvance: 'x',
      }),
    /adiantamento/,
  );
});

test('INSS and IRRF on salary balance and 13th; exemption up to R$ 5.000 from 2026', () => {
  const { inss, irrf } = require('../app/tax-tables.mjs');
  // 2025: 1.518,00 × 7,5% + 1.275,88 × 9% + 1.396,95 × 12% + 2.475,84 × 14% = 742,93
  assert.deepEqual(inss(666667, 2025), { value: 74293, table: 2025, exact: true });
  // Base 6.666,67 − 742,93 = 5.923,74 × 27,5% − 908,73 = 720,30
  assert.equal(irrf(666667, 74293, { month: '2025-08' }).value, 72030);
  // 2.000,00: the simplified discount (607,20) is larger than the INSS, so there is no tax.
  assert.equal(irrf(200000, inss(200000, 2025).value, { month: '2025-08' }).value, 0);
  // 2026: up to R$ 5.000 the reduction cancels the tax; above R$ 7.350 there is no reduction.
  assert.equal(irrf(450000, inss(450000, 2026).value, { month: '2026-03' }).value, 0);
  assert.equal(irrf(800000, 80000, { month: '2026-03' }).value, irrf(800000, 80000, { month: '2025-12' }).value);
  assert.equal(inss(200000, 2026).exact, false, '2026 table not registered: the latest one is used');
  const r = calculateSeverance({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '2022-03-10',
    termination: '2025-08-20',
    salary: '10.000,00',
    fgtsBalance: '0',
    taxes: true,
  });
  const v = Object.fromEntries(r.items.map(i => [i.key, i.value]));
  assert.equal(v['inss-saldo'], 74293);
  assert.equal(v['irrf-saldo'], 72030);
  assert.ok(v['inss-13'] > 0 && v['irrf-13'] > 0);
  assert.equal(v.aviso, 1300000, 'the notice is not taxed');
});

test('fixed-term contract ended early: art. 479 pays half the remaining days, art. 480 deducts up to it', () => {
  const base = { admission: '2025-01-09', termination: '2025-03-10', contractEnd: '2025-04-08', salary: '3000' };
  const employer = calculateSeverance({ ...base, kind: 'antecipada-empregador' });
  const v = Object.fromEntries(employer.items.map(i => [i.key, [i.reference, i.value]]));
  assert.deepEqual(v['art-479'], ['29 dia(s)', 145000]);
  assert.equal(employer.fgts.finePercent, 40);
  const employee = calculateSeverance({ ...base, kind: 'antecipada-empregado' });
  const deduction = employee.items.find(i => i.key === 'art-480');
  assert.deepEqual([deduction.value, deduction.debit], [145000, true]);
  assert.equal(employee.fgts.finePercent, 0);
  assert.throws(
    () => calculateSeverance({ ...base, contractEnd: '2025-03-01', kind: 'antecipada-empregador' }),
    /terminaria/,
  );
});
