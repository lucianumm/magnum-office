// INSS (employee) and IRRF monthly tables, in cents. When a year has no table, the latest one is used
// and the calculation says so: the office must check the table in force before relying on it.
//
// INSS 2025: Portaria Interministerial MPS/MF nº 6/2025 (progressive brackets; ceiling R$ 8.157,41).
// IRRF from 05/2025: Lei 15.191/2025 (exemption up to R$ 2.428,80; simplified discount R$ 607,20).
// IRRF from 01/2026: same table plus the monthly reduction of Lei 15.270/2025 (no tax up to R$ 5.000,00,
// gradual reduction up to R$ 7.350,00).
export const inssTables = {
  2025: [
    [151800, 0.075],
    [279388, 0.09],
    [419083, 0.12],
    [815741, 0.14],
  ],
};

const brackets2025 = [
  [242880, 0, 0],
  [282665, 0.075, 18216],
  [375105, 0.15, 39416],
  [466468, 0.225, 67549],
  [Infinity, 0.275, 90873],
];
export const irrfTables = [
  { from: '2025-05', brackets: brackets2025, dependent: 18959, simplified: 60720 },
  {
    from: '2026-01',
    brackets: brackets2025,
    dependent: 18959,
    simplified: 60720,
    reduction: { fullUpTo: 500000, fullMax: 31289, partialUpTo: 735000, a: 97862, b: 0.133145 },
  },
];

// Employee contribution, progressive, up to the ceiling.
export function inss(base, year) {
  const years = Object.keys(inssTables).map(Number).sort();
  const used = years.filter(y => y <= year).at(-1) ?? years[0];
  const table = inssTables[used];
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of table) {
    if (base <= lower) break;
    tax += (Math.min(base, upper) - lower) * rate;
    lower = upper;
  }
  return { value: Math.round(tax), table: used, exact: used === year };
}

// Monthly withholding. Uses the larger of the legal deductions (INSS + dependants) or the simplified one.
export function irrf(gross, inssValue, { month, dependents = 0 }) {
  const tables = irrfTables.filter(t => t.from <= month);
  const table = tables.at(-1) || irrfTables[0];
  const legal = inssValue + dependents * table.dependent;
  const base = Math.max(0, gross - Math.max(legal, table.simplified));
  const [, rate, deduction] = table.brackets.find(([upper]) => base <= upper);
  let tax = Math.max(0, Math.round(base * rate - deduction));
  const r = table.reduction;
  if (r && tax) {
    const cut = gross <= r.fullUpTo ? r.fullMax : gross <= r.partialUpTo ? Math.round(r.a - r.b * gross) : 0;
    tax = Math.max(0, tax - Math.max(0, cut));
  }
  return { value: tax, base, table: table.from };
}
