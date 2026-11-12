const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateOvertime } = require('../app/overtime.mjs');
const { laborPhases, updateLaborDebt, laborSeriesNeeded } = require('../app/labor-update.mjs');

// 2.200,00 ÷ 220 = 10,00 por hora; com 50% = 15,00; 20 h/mês = 300,00; DSR 1/6 = 50,00.
test('overtime with reflexes, worked out by hand', () => {
  const r = calculateOvertime({
    salary: '2.200,00',
    divisor: 220,
    hours: '20',
    percent: '50',
    months: 12,
    noticeDays: 30,
    finePercent: 40,
  });
  const v = Object.fromEntries(r.items.map(i => [i.key, i.value]));
  assert.equal(r.monthly, 30000);
  assert.deepEqual(v, {
    he: 360000, // 300 × 12
    dsr: 60000, // 50 × 12
    13: 35000, // (300 + 50) × 12/12
    ferias: 46667, // 350 × 4/3
    aviso: 35000, // 350 × 30/30
    fgts: 39200, // 8% × (3600 + 600 + 350 + 350)
    multa: 15680, // 40% × 392
  });
  assert.equal(r.total, 591547);
  const before2023 = calculateOvertime({
    salary: '2.200,00',
    hours: '20',
    months: 12,
    dsrInBase: false,
    finePercent: 0,
  });
  assert.equal(before2023.items.find(i => i.key === '13').value, 30000);
  assert.throws(() => calculateOvertime({ salary: '2200', hours: '0', months: 1 }), /horas extras/);
  assert.throws(() => calculateOvertime({ salary: '2200', hours: '10', months: 1, divisor: 210 }), /Divisor/);
});

test('labour update phases follow ADC 58 and Lei 14.905/2024', () => {
  assert.deepEqual(
    laborPhases({ start: '2023-01-10', filing: '2023-06-01', end: '2025-03-31' }).map(p => [
      p.start,
      p.end,
      p.correction,
      p.interest,
    ]),
    [
      ['2023-01-10', '2023-06-01', 'IPCA-E', 'none'],
      ['2023-06-01', '2024-08-29', 'none', 'selic'],
      ['2024-08-30', '2025-03-31', 'IPCA', 'legal'],
    ],
  );
  assert.deepEqual(
    laborPhases({ start: '2025-01-10', filing: '', end: '2025-03-31' }).map(p => p.correction),
    ['IPCA-E'],
  );
  assert.deepEqual(laborSeriesNeeded({ start: '2023-01-10', filing: '2023-06-01', end: '2025-03-31' }).sort(), [
    'IPCA',
    'IPCA-E',
    'SELIC',
    'TAXA_LEGAL',
  ]);
  assert.throws(() => laborPhases({ start: '2025-01-10', filing: '2024-01-01', end: '2025-03-31' }), /ajuizamento/);
  // With every index at zero the amount does not change across the three phases.
  const zeros = {};
  for (const key of ['IPCA', 'IPCA-E', 'SELIC', 'TAXA_LEGAL']) {
    zeros[key] = {};
    for (let y = 2023; y <= 2025; y++)
      for (let m = 1; m <= 12; m++) zeros[key][`${y}-${String(m).padStart(2, '0')}`] = 0;
  }
  const r = updateLaborDebt({
    principal: '1000.00',
    start: '2023-01-10',
    filing: '2023-06-01',
    end: '2025-03-31',
    series: zeros,
  });
  assert.equal(r.steps.length, 3);
  assert.equal(r.total, 1000);
});
