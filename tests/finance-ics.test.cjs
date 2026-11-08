const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Finance } = require('../backend/finance.cjs');
const { entity } = require('../backend/validation.cjs');
const { buildInstallments, entryStatus, summarize, addMonths } = require('../app/finance.mjs');
const { agendaICS } = require('../app/ics.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t, migrations) {
  const root = fs.mkdtempSync(path.join(base, 'fin-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault, migrations);
  await store.migrate();
  t.after(() => {
    try { store.close(); } catch { /* closed by the test */ }
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store };
}
const fee = { direction: 'Receita', category: 'Honorário contratual', description: 'Honorários', amount: '1.000,00', dueDate: '2026-01-31' };

test('installments split the total in cents and keep the day of the month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  const list = buildInstallments({ total: '1000.00', count: 3, firstDue: '2026-01-31', description: 'Honorários' });
  assert.deepEqual(list.map(e => [e.amount, e.dueDate, e.description]), [
    ['333.33', '2026-01-31', 'Honorários (1/3)'],
    ['333.33', '2026-02-28', 'Honorários (2/3)'],
    ['333.34', '2026-03-31', 'Honorários (3/3)'],
  ]);
  assert.throws(() => buildInstallments({ total: '100', count: 1, firstDue: '2026-01-01' }), /2 a 120/);
  assert.throws(() => buildInstallments({ total: '', count: 3, firstDue: '2026-01-01' }), /valor total/);
});

test('entry validation, status and totals', () => {
  const v = entity('finance', fee);
  assert.equal(v.amount, '1000.00');
  assert.equal(v.reimbursable, false);
  assert.throws(() => entity('finance', { ...fee, amount: '' }), /valor do lançamento/);
  assert.equal(entity('finance', { ...fee, category: 'Honorário de êxito', amount: '' }).amount, '', 'success fee can wait');
  assert.throws(() => entity('finance', { ...fee, category: 'Honorário de êxito', amount: '', paidDate: '2026-02-01' }), /valor antes/);
  assert.throws(() => entity('finance', { ...fee, dueDate: '2026-02-30' }), /vencimento/);
  assert.throws(() => entity('finance', { ...fee, amount: 'mil' }), /valor do lançamento em reais/);
  assert.equal(entity('finance', { ...fee, direction: 'Despesa', category: 'Custas processuais', reimbursable: true }).reimbursable, true);
  assert.equal(entity('finance', { ...fee, reimbursable: true }).reimbursable, false, 'only expenses are reimbursable');
  assert.equal(entity('finance', { ...fee, direction: 'Despesa' }).category, 'Outra despesa');
  const today = '2026-03-10';
  const entries = [
    { ...fee, amount: '500.00', dueDate: '2026-03-05' }, // overdue
    { ...fee, amount: '300.00', dueDate: '2026-03-20' }, // open in March
    { ...fee, amount: '700.00', dueDate: '2026-04-20' }, // open in April
    { ...fee, amount: '200.00', dueDate: '2026-03-01', paidDate: '2026-03-02' }, // received in March
    { ...fee, category: 'Honorário de êxito', amount: '', dueDate: '2026-12-31' },
    { direction: 'Despesa', category: 'Custas processuais', amount: '150.50', dueDate: '2026-03-03', paidDate: '2026-03-03', reimbursable: true },
  ];
  assert.deepEqual(entries.map(e => entryStatus(e, today)), ['overdue', 'open', 'open', 'paid', 'pending-amount', 'paid']);
  assert.deepEqual(summarize(entries, today, { from: '2026-03-01', to: '2026-03-31' }), {
    toReceive: '300.00',
    overdue: '500.00',
    received: '200.00',
    expenses: '150.50',
    reimbursable: '150.50',
  });
});

test('installment plans are saved at once, linked to the case, and exported to a spreadsheet', async t => {
  const { store } = await fixture(t);
  const client = store.save('clients', { name: 'Ana', phone: '5564999990000' });
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id });
  const finance = new Finance({ store });
  const saved = finance.createInstallments({ ...fee, amount: '3.000,00', dueDate: '2026-11-10', installments: 3, clientId: client.id, caseId: caseItem.id });
  assert.equal(saved.length, 3);
  assert.equal(new Set(saved.map(e => e.seriesId)).size, 1);
  assert.deepEqual(saved.map(e => e.amount), ['1000.00', '1000.00', '1000.00']);
  assert.throws(() => store.remove('cases', caseItem.id), /vinculado/);
  assert.throws(() => finance.createInstallments({ ...fee, installments: 3, id: saved[0].id }), /novos/);
  store.save('finance', { ...saved[0], paidDate: '2026-11-10', method: 'Pix' });
  const Excel = require('exceljs');
  const book = new Excel.Workbook();
  await book.xlsx.load(await finance.workbook('2026-12-15'));
  const sheet = book.getWorksheet('Lançamentos');
  assert.equal(sheet.rowCount, 4);
  assert.deepEqual(sheet.getRow(1).values.slice(1, 4), ['Vencimento', 'Tipo', 'Categoria']);
  // Columns: 5 Cliente, 7 Valor, 8 Situação (see exportColumns).
  const first = sheet.getRow(2);
  assert.equal(first.getCell(5).value, 'Ana');
  assert.equal(first.getCell(7).value, 1000);
  assert.equal(first.getCell(8).value, 'Pago');
  assert.equal(sheet.getRow(3).getCell(8).value, 'Atrasado');
});

test('the record-kinds rebuild keeps every record and accepts finance entries', async t => {
  const legacy = fs.mkdtempSync(path.join(base, 'fin-migrations-'));
  t.after(() => fs.rmSync(legacy, { recursive: true, force: true }));
  for (const name of fs.readdirSync('migrations').filter(n => n < '006')) fs.copyFileSync(path.join('migrations', name), path.join(legacy, name));
  const { root, vault, store } = await fixture(t, legacy);
  const client = store.save('clients', { name: 'Cliente antigo', phone: '5564999990000' });
  assert.throws(() => store.save('finance', fee), /CHECK/);
  store.close();
  const upgraded = new Store(root, vault);
  try {
    await upgraded.migrate();
    assert.equal(upgraded.get('clients', client.id).name, 'Cliente antigo');
    assert.ok(upgraded.save('finance', { ...fee, clientId: client.id }).id);
  } finally {
    upgraded.close();
  }
});

test('a migration that would remove rows is undone', async t => {
  const { root, store } = await fixture(t);
  store.save('clients', { name: 'Não pode sumir', phone: '5564999990000' });
  const dir = fs.mkdtempSync(path.join(root, 'migrations-'));
  for (const name of fs.readdirSync('migrations')) fs.copyFileSync(path.join('migrations', name), path.join(dir, name));
  fs.writeFileSync(path.join(dir, '999-perde-dados.sql'), "CREATE TABLE x (id TEXT); DELETE FROM entities WHERE kind='clients';");
  store.migrations = dir;
  await assert.rejects(store.migrate(), /reduziria os dados da tabela entities/);
  assert.equal(store.list('clients').length, 1);
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='x'").get(), undefined, 'nothing of it stays');
});

test('agenda export: all-day deadlines, timed appointments, escaping, folding and privacy', () => {
  const tasks = [
    { id: 'a1', title: 'Contestação; processo, urgente', type: 'Prazo', due: '2026-03-23T23:59', priority: 'Urgente', caseId: 'c1', clientId: 'p1' },
    { id: 'a2', title: 'Audiência de instrução', type: 'Audiência', due: '2026-03-25T23:30', priority: 'Normal', caseId: 'c1' },
    { id: 'a3', title: 'Reunião com um título muito longo que certamente passa de setenta e cinco bytes na linha do resumo', type: 'Reunião', due: '2026-03-26T10:00' },
    { id: 'a4', title: 'Sem data', type: 'Tarefa', due: 'inválido' },
  ];
  const names = { clients: new Map([['p1', 'Ana Souza']]), cases: new Map([['c1', 'Indenização']]), now: new Date('2026-03-01T12:00:00Z') };
  const ics = agendaICS(tasks, names);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3, 'invalid dates are skipped');
  assert.match(ics, /UID:a1@magnum-office\r\nDTSTAMP:20260301T120000Z\r\nDTSTART;VALUE=DATE:20260323\r\nDTEND;VALUE=DATE:20260324/);
  assert.match(ics, /SUMMARY:Prazo: Contestação\\; processo\\, urgente/);
  assert.match(ics, /DTSTART:20260325T233000\r\nDTEND:20260326T003000/, 'one hour, crossing midnight');
  assert.doesNotMatch(ics, /Ana Souza|Indenização/, 'names only when asked');
  const unfold = text => text.replace(/\r\n /g, '');
  assert.match(unfold(agendaICS(tasks, { ...names, includeNames: true })), /DESCRIPTION:Indenização · Ana Souza\\nVencimento às 23:59\\nPrioridade Urgente/);
  assert.match(unfold(ics), /SUMMARY:Reunião: Reunião com um título muito longo que certamente passa de setenta e cinco bytes/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(ics, /\r\n /, 'long lines are folded');
});
