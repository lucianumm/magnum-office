const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { billTime } = require('../backend/time-billing.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });

test('hours are stored in the database and billed once, as a receivable of the case', async t => {
  const root = fs.mkdtempSync(path.join(base, 'time-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const client = store.save('clients', { name: 'Ana', phone: '5564999990000', status: 'Ativo' });
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id });
  store.save('time', {
    caseId: caseItem.id,
    date: '2026-11-10',
    minutes: '90',
    description: 'Inicial',
    rate: '300,00',
  });
  store.save('time', { caseId: caseItem.id, date: '2026-11-11', minutes: '30', description: 'Reunião', rate: '200' });
  store.save('time', { caseId: caseItem.id, date: '2026-11-11', minutes: '15', description: 'Sem valor' });
  assert.throws(
    () => store.save('time', { caseId: caseItem.id, date: '2026-11-11', minutes: '0', description: 'x' }),
    /Minutos/,
  );
  const entry = billTime(store, caseItem.id);
  // 1h30 × 300 + 0h30 × 200 = 450 + 100
  assert.deepEqual([entry.amount, entry.direction, entry.clientId], ['550.00', 'Receita', client.id]);
  assert.match(entry.description, /2h00/);
  assert.equal(store.list('time').filter(t => t.billed === entry.id).length, 2);
  assert.throws(() => billTime(store, caseItem.id), /Não há horas/, 'not billed twice');
  assert.throws(() => store.remove('cases', caseItem.id), /vinculado/, 'hours keep the case');
});

test('migration 010 keeps every record when the table is rebuilt for the new kind', async t => {
  const legacy = fs.mkdtempSync(path.join(base, 'time-migrations-'));
  const root = fs.mkdtempSync(path.join(base, 'time-legacy-'));
  t.after(() => {
    fs.rmSync(legacy, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of fs.readdirSync('migrations').filter(n => n < '010'))
    fs.copyFileSync(path.join('migrations', name), path.join(legacy, name));
  const vault = new Vault(randomBytes(32));
  const old = new Store(root, vault, legacy);
  await old.migrate();
  const client = old.save('clients', { name: 'Cliente antigo', phone: '5564999990000' });
  const caseItem = old.save('cases', { title: 'Processo antigo', status: 'Em andamento', clientId: client.id });
  assert.throws(
    () =>
      old.db
        .prepare("INSERT INTO entities (id,kind,payload,created_at,updated_at) VALUES ('x','time',x'00','a','a')")
        .run(),
    /CHECK/,
  );
  old.close();
  const store = new Store(root, vault);
  try {
    await store.migrate();
    assert.equal(store.get('cases', caseItem.id).clientId, client.id);
    assert.equal(store.counts().clients, 1);
    store.save('time', { caseId: caseItem.id, date: '2026-11-10', minutes: '60', description: 'Depois da migração' });
    assert.equal(store.list('time').length, 1);
  } finally {
    store.close();
  }
});
