// Every expected date below was checked by hand against the calendar, day by day.
// Reference: Easter 2025-04-20, 2026-04-05, 2027-03-28.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDeadline, easter, businessDaysBefore, suggestRule, createCalendar } = require('../app/deadlines.mjs');

const end = input => calculateDeadline(input).end;

test('Easter and the holidays that depend on it', () => {
  assert.equal(easter(2025), '2025-04-20');
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  const cal = createCalendar();
  assert.equal(cal.info('2026-02-16').type, 'holiday', 'Carnaval segunda');
  assert.equal(cal.info('2026-02-17').type, 'holiday', 'Carnaval terça');
  assert.equal(cal.info('2026-02-18').type, 'reduced', 'Quarta-feira de Cinzas');
  assert.equal(cal.info('2026-04-03').type, 'holiday', 'Sexta-feira da Paixão');
  assert.equal(cal.info('2026-06-04').type, 'holiday', 'Corpus Christi');
  assert.equal(cal.info('2026-11-20').type, 'holiday', 'Consciência Negra (Lei 14.759/2023)');
  assert.equal(cal.info('2026-12-21').type, 'recess');
  assert.equal(cal.info('2027-01-20').type, 'recess');
  assert.equal(cal.info('2027-01-21').type, 'business');
  assert.equal(createCalendar({ recess: false }).info('2026-12-21').type, 'business');
});

test('CPC: business days, first day after publication, Good Friday', () => {
  // Monday 02/03/2026 → counting starts Tue 03/03; 15 business days end Mon 23/03.
  assert.equal(end({ start: '2026-03-02', days: 15 }), '2026-03-23');
  // Friday 27/03/2026 → starts Mon 30/03; skips Good Friday 03/04 → Mon 20/04.
  assert.equal(end({ start: '2026-03-27', days: 15 }), '2026-04-20');
  // Doubled: 30 business days from Mon 02/03/2026 → Tue 14/04.
  assert.equal(end({ start: '2026-03-02', days: 15, double: true }), '2026-04-14');
  const r = calculateDeadline({ start: '2026-03-02', days: 15 });
  assert.equal(r.firstDay, '2026-03-03');
  assert.equal(r.steps.filter(s => s.kind === 'counted').length, 15);
  assert.ok(r.basis.some(b => b.includes('art. 219')));
});

test('CPC: recess from 20/12 to 20/01, Carnaval and a deadline ending on Ash Wednesday', () => {
  // Wed 16/12/2026: 17 (1), 18 (2), recess, Jan 21 (3) ... Feb 5 (14);
  // Carnaval 08 and 09/02/2027 skipped; Ash Wednesday 10/02 is day 15 but has reduced hours,
  // so the deadline moves to Thu 11/02 (CPC, art. 224, § 1º).
  const r = calculateDeadline({ start: '2026-12-16', days: 15 });
  assert.equal(r.end, '2027-02-11');
  assert.equal(r.steps.find(s => s.n === 3).date, '2027-01-21');
  assert.equal(r.steps.find(s => s.n === 15).date, '2027-02-10');
  assert.equal(r.steps.at(-1).kind, 'extended');
});

test('Publication counted from the DJe availability date', () => {
  // Made available Thu 05/03/2026 → published Fri 06/03 → counting starts Mon 09/03 → 15 days end Fri 27/03.
  const r = calculateDeadline({ start: '2026-03-05', days: 15, mode: 'disponibilizacao' });
  assert.equal(r.publication, '2026-03-06');
  assert.equal(r.firstDay, '2026-03-09');
  assert.equal(r.end, '2026-03-27');
  assert.ok(r.basis.some(b => b.includes('11.419')));
});

test('CLT: business days and the Consciência Negra holiday', () => {
  // Thu 19/11/2026; Fri 20/11 is a national holiday → starts Mon 23/11 → 8 business days end Wed 02/12.
  assert.equal(end({ start: '2026-11-19', days: 8, rule: 'clt' }), '2026-12-02');
});

test('CPP: calendar days, Súmula 310 and extension when the deadline ends without court hours', () => {
  // Friday 06/03/2026 → starts Mon 09/03 → 5 days end Fri 13/03.
  assert.equal(end({ start: '2026-03-06', days: 5, rule: 'cpp' }), '2026-03-13');
  // Mon 13/04/2026 → 14..18; Sat 18/04 → extended to Mon 20/04.
  assert.equal(end({ start: '2026-04-13', days: 5, rule: 'cpp' }), '2026-04-20');
  // Thu 16/04/2026 → 17..21; Tue 21/04 is Tiradentes → extended to Wed 22/04.
  assert.equal(end({ start: '2026-04-16', days: 5, rule: 'cpp' }), '2026-04-22');
  // Weekends in the middle count in criminal deadlines.
  assert.equal(end({ start: '2026-03-02', days: 10, rule: 'cpp' }), '2026-03-12');
});

test('Federal calendar (Lei 5.010/1966) closes the Holy Week from Wednesday', () => {
  // Mon 30/03/2026, 5 business days. Default: 31, 01, 02, 06, 07. Federal: 31, 06, 07, 08, 09.
  assert.equal(end({ start: '2026-03-30', days: 5 }), '2026-04-07');
  assert.equal(end({ start: '2026-03-30', days: 5, profile: 'federal' }), '2026-04-09');
  assert.equal(createCalendar({ profile: 'federal', recess: false }).info('2027-01-05').type, 'holiday');
});

test('Office calendar adds local holidays and reduced hours, and can reopen a day, per court', () => {
  const custom = [
    { date: '2026-06-04', type: 'workday', description: 'Expediente normal em Corpus Christi', courtId: 'tjgo' },
    { date: '2026-03-23', type: 'reduced', description: 'Indisponibilidade do sistema', courtId: '' },
  ];
  // Tue 02/06/2026, 3 days: 03 (1), Corpus Christi skipped, 05 (2), 08 (3).
  assert.equal(end({ start: '2026-06-02', days: 3 }), '2026-06-08');
  // The TJGO entry reopens 04/06 only for TJGO.
  assert.equal(end({ start: '2026-06-02', days: 3, custom, courtId: 'tjgo' }), '2026-06-05');
  assert.equal(end({ start: '2026-06-02', days: 3, custom, courtId: 'tjsp' }), '2026-06-08');
  // A deadline ending on a day with system unavailability moves to the next day (art. 224, § 1º).
  assert.equal(end({ start: '2026-03-02', days: 15, custom }), '2026-03-24');
  const r = calculateDeadline({ start: '2026-03-02', days: 15 });
  assert.ok(
    r.warnings.some(w => w.includes('Nenhum feriado')),
    'warns when no local holiday is registered',
  );
  assert.equal(calculateDeadline({ start: '2026-03-02', days: 15, custom }).warnings.length, 1);
});

test('Validation, internal deadline and suggestions from the case', () => {
  assert.throws(() => calculateDeadline({ start: '2026-02-30', days: 5 }), /data/);
  assert.throws(() => calculateDeadline({ start: '2026-03-02', days: 0 }), /prazo/);
  assert.throws(() => calculateDeadline({ start: '2026-03-02', days: 5, rule: 'x' }), /contagem/);
  assert.equal(businessDaysBefore('2026-03-23', 2, {}), '2026-03-19');
  assert.equal(businessDaysBefore('2026-04-06', 1, {}), '2026-04-02', 'skips Good Friday and the weekend');
  assert.deepEqual(suggestRule({ area: 'Trabalhista' }), { rule: 'clt', profile: 'padrao', courtId: '' });
  assert.deepEqual(suggestRule({ area: 'Criminal' }), { rule: 'cpp', profile: 'padrao', courtId: '' });
  assert.deepEqual(suggestRule({ area: 'Cível', instance: 'Juizado especial' }).rule, 'jec');
  assert.deepEqual(suggestRule({ area: 'Cível' }, { segment: 4, courtId: 'trf1' }), {
    rule: 'cpc',
    profile: 'federal',
    courtId: 'trf1',
  });
});
