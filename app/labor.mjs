// Simple severance calculation (verbas rescisórias) under the CLT. Amounts are whole cents, so
// the screen, the PDF and the tests always agree. It is an estimate for the office: no INSS, IRRF,
// overtime, interest or monetary correction.
import { parseMoney } from './money.mjs';

export const terminationKinds = {
  'sem-justa-causa': 'Dispensa sem justa causa',
  pedido: 'Pedido de demissão',
  'justa-causa': 'Dispensa por justa causa',
  acordo: 'Acordo entre as partes (art. 484-A da CLT)',
  'termino-prazo': 'Fim do contrato por prazo determinado ou de experiência',
};
export const noticeOptions = {
  'sem-justa-causa': { indenizado: 'Indenizado', trabalhado: 'Trabalhado' },
  pedido: {
    trabalhado: 'Cumprido pelo empregado',
    descontado: 'Não cumprido (desconto de 30 dias)',
    dispensado: 'Dispensado pelo empregador',
  },
  acordo: { indenizado: 'Indenizado (pela metade)', trabalhado: 'Trabalhado' },
  'justa-causa': {},
  'termino-prazo': {},
};

const DAY = 86400000;
const toDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
};
const iso = d => d.toISOString().slice(0, 10);
const br = d => iso(d).split('-').reverse().join('/');
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((b - a) / DAY) + 1; // both days included
// Same day N months later; the 31st falls back to the last day of shorter months.
function addMonths(d, n) {
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth() + n,
    day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}
const completeYears = (start, end) => {
  let years = 0;
  while (addMonths(start, 12 * (years + 1)) <= addDays(end, 1)) years++;
  return years;
};
const cents = value => {
  const parsed = parseMoney(value);
  return parsed ? Math.round(Number(parsed) * 100) : parsed === '' ? 0 : null;
};
const share = (amount, numerator, denominator) => Math.round((amount * numerator) / denominator);

// 13th salary: one twelfth per calendar month with 15 days or more worked, per calendar year, from
// the year of the termination (earlier years are taken as paid) to the year the notice projects to.
function thirteenthAvos(start, termination, end) {
  const out = [];
  for (
    let year = Math.max(start.getUTCFullYear(), termination.getUTCFullYear());
    year <= end.getUTCFullYear();
    year++
  ) {
    let avos = 0;
    for (let month = 0; month < 12; month++) {
      const from = new Date(Math.max(Date.UTC(year, month, 1), start));
      const to = new Date(Math.min(Date.UTC(year, month + 1, 0), end));
      if (to >= from && daysBetween(from, to) >= 15) avos++;
    }
    out.push({ year, avos });
  }
  return out;
}
// Proportional vacation: one twelfth per month of the current accrual period, counting a final
// fraction of 15 days or more (art. 146, sole paragraph, CLT).
function vacationAvos(periodStart, end) {
  let avos = 0;
  for (let m = 0; m < 12; m++) {
    const from = addMonths(periodStart, m);
    if (from > end) break;
    const to = addDays(addMonths(periodStart, m + 1), -1);
    if (to <= end || daysBetween(from, end) >= 15) avos++;
  }
  return avos;
}

export function calculateSeverance(input) {
  const admission = toDate(input.admission);
  const termination = toDate(input.termination);
  if (!admission || !termination) throw new Error('Informe as datas de admissão e de desligamento.');
  if (termination < admission) throw new Error('O desligamento não pode ser antes da admissão.');
  const kind = terminationKinds[input.kind] ? input.kind : 'sem-justa-causa';
  const salary = cents(input.salary);
  const extras = cents(input.extras);
  if (!salary) throw new Error('Informe o salário mensal.');
  if (extras === null) throw new Error('Valor inválido nas médias de variáveis.');
  const balance = String(input.fgtsBalance ?? '').trim() ? cents(input.fgtsBalance) : '';
  if (balance === null) throw new Error('Valor inválido no saldo do FGTS.');
  const vested = Math.max(0, Math.min(10, Number.parseInt(input.vestedPeriods, 10) || 0));
  const doubled = Math.max(0, Math.min(vested, Number.parseInt(input.doubledPeriods, 10) || 0));
  const remuneration = salary + extras;
  const daysWorked =
    input.salaryDays === undefined || input.salaryDays === ''
      ? termination.getUTCDate()
      : Number.parseInt(input.salaryDays, 10);
  if (!Number.isInteger(daysWorked) || daysWorked < 0 || daysWorked > 31)
    throw new Error('Dias trabalhados no mês: de 0 a 31.');
  const options = noticeOptions[kind];
  const notice = options[input.notice] ? input.notice : Object.keys(options)[0] || '';

  const items = [];
  const basis = [];
  const warnings = [];
  const add = (key, label, reference, value, debit = false) =>
    value && items.push({ key, label, reference, value, debit });

  // Notice: 30 days plus 3 per complete year of service, up to 90 (Lei 12.506/2011). Only the
  // employer owes the proportional part; the employee who resigns owes at most 30 days.
  const years = completeYears(admission, termination);
  const noticeDays = Math.min(90, 30 + 3 * years);
  let indemnifiedDays = 0;
  if (kind === 'sem-justa-causa') indemnifiedDays = notice === 'indenizado' ? noticeDays : noticeDays - 30;
  if (kind === 'acordo') indemnifiedDays = Math.floor((notice === 'indenizado' ? noticeDays : noticeDays - 30) / 2);
  // The indemnified notice counts as service time (art. 487, § 1º, CLT; OJ 82 da SDI-1 do TST).
  const projected = addDays(termination, indemnifiedDays);

  add('saldo', 'Saldo de salário', `${daysWorked} dia(s)`, share(remuneration, daysWorked, 30));
  if (indemnifiedDays > 0) {
    const label =
      notice === 'trabalhado'
        ? 'Aviso prévio proporcional indenizado (dias além dos 30 trabalhados)'
        : kind === 'acordo'
          ? 'Aviso prévio indenizado pela metade'
          : 'Aviso prévio indenizado';
    add('aviso', label, `${indemnifiedDays} dia(s)`, share(remuneration, indemnifiedDays, 30));
    basis.push(
      `Aviso prévio de ${noticeDays} dias: 30 dias mais 3 por ano completo de serviço (${years} ano(s)), limitado a 90 (Lei 12.506/2011).`,
    );
    basis.push(
      `Data projetada pelo aviso indenizado: ${br(projected)} (art. 487, § 1º, da CLT e OJ 82 da SDI-1 do TST), usada para o 13º e as férias.`,
    );
    if (kind === 'acordo')
      basis.push(
        'No acordo, o aviso prévio indenizado e a multa do FGTS são devidos pela metade (art. 484-A, I, da CLT).',
      );
  }
  if (kind === 'pedido' && notice === 'descontado') {
    add('desconto-aviso', 'Desconto do aviso prévio não cumprido', '30 dia(s)', share(salary, 30, 30), true);
    basis.push(
      'No pedido de demissão sem cumprir o aviso, o empregador pode descontar 30 dias de salário (art. 487, § 2º, da CLT).',
    );
  }

  if (kind !== 'justa-causa') {
    for (const { year, avos } of thirteenthAvos(admission, termination, projected))
      add(`13-${year}`, `13º salário proporcional de ${year}`, `${avos}/12`, share(remuneration, avos, 12));
    basis.push(
      '13º salário: 1/12 por mês do ano com 15 dias ou mais trabalhados (Lei 4.090/1962), supondo pagos os anos anteriores.',
    );
  }

  // Vacation already vested and not taken is always due, even with just cause.
  if (vested) {
    const simple = vested - doubled;
    if (simple) {
      add('ferias-vencidas', 'Férias vencidas', `${simple} período(s)`, remuneration * simple);
      add('terco-vencidas', '1/3 sobre férias vencidas', '', Math.round((remuneration * simple) / 3));
    }
    if (doubled) {
      add(
        'ferias-dobro',
        'Férias vencidas em dobro (art. 137 da CLT)',
        `${doubled} período(s)`,
        remuneration * doubled * 2,
      );
      add('terco-dobro', '1/3 sobre férias em dobro', '', Math.round((remuneration * doubled * 2) / 3));
    }
  }
  const yearsToProjection = completeYears(admission, projected);
  const vestedByNotice = yearsToProjection - years;
  if (kind !== 'justa-causa') {
    if (vestedByNotice > 0) {
      add(
        'ferias-projecao',
        'Férias completadas na projeção do aviso',
        `${vestedByNotice} período(s)`,
        remuneration * vestedByNotice,
      );
      add(
        'terco-projecao',
        '1/3 sobre férias completadas na projeção',
        '',
        Math.round((remuneration * vestedByNotice) / 3),
      );
    }
    const avos = vacationAvos(addMonths(admission, 12 * yearsToProjection), projected);
    add('ferias-proporcionais', 'Férias proporcionais', `${avos}/12`, share(remuneration, avos, 12));
    add('terco-proporcionais', '1/3 sobre férias proporcionais', '', Math.round(share(remuneration, avos, 12) / 3));
    basis.push(
      'Férias proporcionais com 1/3: 1/12 por mês do período aquisitivo em curso, contando a fração de 15 dias ou mais (arts. 146 e 147 da CLT; Súmulas 171 e 261 do TST).',
    );
  } else {
    basis.push(
      'Na justa causa são devidos apenas o saldo de salário e as férias vencidas com 1/3 (Súmula 171 do TST).',
    );
  }
  if (input.art477) {
    add('multa-477', 'Multa do art. 477, § 8º, da CLT (atraso no pagamento)', '1 salário', salary);
    basis.push(
      'Multa do art. 477, § 8º: um salário, quando as verbas não são pagas em 10 dias do término do contrato.',
    );
  }

  // FGTS: 8% on the salary balance, the indemnified notice and the 13th (Súmula 305 do TST); not
  // on indemnified vacation (OJ 195 da SDI-1). The fine is on the whole account balance.
  const fgtsBase = items
    .filter(i => i.key === 'saldo' || i.key === 'aviso' || i.key.startsWith('13-'))
    .reduce((n, i) => n + i.value, 0);
  const deposit = Math.round(fgtsBase * 0.08);
  const finePercent = kind === 'sem-justa-causa' ? 40 : kind === 'acordo' ? 20 : 0;
  const months = Math.max(0, Math.round((termination - admission) / DAY / (365.25 / 12)));
  const estimated = balance === '';
  // Without the statement: 8% a month on the remuneration, the 13th and the vacation third.
  const accountBalance = estimated ? Math.round(((remuneration * 0.08 * (13 + 1 / 3)) / 12) * months) : balance;
  const fine = finePercent ? Math.round(((accountBalance + deposit) * finePercent) / 100) : 0;
  basis.push(
    'FGTS de 8% sobre saldo de salário, aviso prévio indenizado e 13º (Súmula 305 do TST); não incide sobre férias indenizadas (OJ 195 da SDI-1).',
  );
  if (finePercent)
    basis.push(
      `Multa de ${finePercent}% sobre o saldo da conta do FGTS (art. 18, § 1º, da Lei 8.036/1990${kind === 'acordo' ? ', reduzida pelo art. 484-A' : ''}).`,
    );
  if (finePercent && estimated)
    warnings.push(
      'Saldo do FGTS estimado pelo tempo de contrato e pela remuneração atual. Para a multa exata, informe o saldo do extrato da Caixa (com os saques, se houver).',
    );
  if (kind === 'termino-prazo')
    warnings.push(
      'Na rescisão antecipada de contrato a prazo há indenização própria (arts. 479 e 480 da CLT), não incluída aqui.',
    );
  if (kind === 'pedido' || kind === 'justa-causa')
    warnings.push('Não há multa do FGTS nem saque do saldo nesta modalidade.');
  warnings.push(
    'Estimativa sem descontos de INSS e IRRF, sem horas extras, adicionais ou médias não informados, e sem correção ou juros. Confira o adiantamento do 13º, se houver.',
  );

  const gross = items.filter(i => !i.debit).reduce((n, i) => n + i.value, 0);
  const deductions = items.filter(i => i.debit).reduce((n, i) => n + i.value, 0);
  const net = gross - deductions;
  return {
    kind,
    kindLabel: terminationKinds[kind],
    notice,
    admission: iso(admission),
    termination: iso(termination),
    projected: iso(projected),
    years,
    noticeDays,
    remuneration,
    items,
    fgts: { deposit, finePercent, accountBalance, estimated, fine, total: deposit + fine },
    totals: { gross, deductions, net, total: net + deposit + fine },
    basis,
    warnings,
  };
}

// "R$ 1.234,56" from whole cents.
export const centsBRL = value =>
  (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/gu, ' ');
