const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Library } = require('../backend/library.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Birthdays, occurrence, dayKey } = require('../backend/birthdays.cjs');
const { personalizeMessage } = require('../app/message-variables.mjs');
const { PortableBackup, unseal } = require('../backend/portable-backup.cjs');
async function fixture(t) {
  const base = path.resolve('work/birthday-tests');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault);
  await store.migrate();
  fs.writeFileSync(path.join(root, 'vault.bin'), 'fixture-only');
  const settings = new Settings(root);
  settings.internal({ termsAcceptedVersion: require('../app/terms.json').version });
  const library = new Library(store);
  const operations = new Operations();
  const messaging = new Messaging(store, settings, operations);
  const birthdays = new Birthdays({ store, settings, library, messaging });
  messaging.birthdays = birthdays;
  const model = library.list().find(m => m.purpose === 'birthday');
  t.after(() => {
    messaging.stop();
    store.close();
    if (!root.startsWith(base + path.sep)) throw Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store, settings, library, messaging, birthdays, model };
}
function client(f, more = {}) {
  return f.store.save('clients', {
    name: 'Ana Maria',
    phone: '64999991111',
    birthDate: '2000-12-20',
    birthdayEnabled: true,
    birthdayTemplateId: f.model.id,
    birthdayTime: '09:00',
    ...more,
  });
}
test('birthday model is seeded once and variables personalize names safely without recursive substitution', async t => {
  const f = await fixture(t);
  assert.equal(f.model.title, 'Mensagem aniversário');
  new Birthdays(f);
  assert.equal(f.library.list().filter(m => m.purpose === 'birthday').length, 1);
  assert.equal(
    personalizeMessage('{1}|{2}|{3}', { name: 'Ana Maria' }, { officeName: 'Escritório' }),
    'Ana Maria|Ana|Escritório',
  );
  assert.equal(personalizeMessage('{1}', { name: '<Ana & {3}>' }, {}, true), '&lt;Ana &amp; {3}&gt;');
  f.library.remove('template', f.model.id);
  new Birthdays(f);
  assert.equal(f.library.list().filter(m => m.purpose === 'birthday').length, 0);
  assert.throws(
    () =>
      f.library.save({
        kind: 'whatsapp',
        purpose: 'birthday',
        groupId: f.library.groups()[0].id,
        title: 'Incorreto',
        body: 'Olá {4}',
      }),
    /variáveis/,
  );
});
test('date validation is strict and activation requires an existing birthday model and explicit local permission', async t => {
  const f = await fixture(t);
  for (const birthDate of ['2001-02-29', '2025-04-31', '2999-01-01', '06/11/2000'])
    assert.throws(() => client(f, { birthDate }), /nascimento/);
  assert.throws(() => client(f, { birthDate: '' }), /nascimento/);
  assert.throws(() => client(f, { birthdayTime: '24:00' }), /Horário/);
  const general = f.library.save({ groupId: f.library.groups()[0].id, kind: 'whatsapp', title: 'Geral', body: 'Olá' });
  assert.throws(() => client(f, { birthdayTemplateId: general.id }), /finalidade/);
  const c = client(f, { birthdayEnabled: false });
  f.birthdays.tick(true);
  assert.equal(f.messaging.list().length, 0);
  assert.equal(f.store.get('clients', c.id).birthDate, '2000-12-20');
  const { AgentAPI } = require('../backend/agent-api.cjs');
  const api = new AgentAPI({ ...f, operations: new Operations() });
  f.settings.internal({ agentWrite: true });
  await assert.rejects(
    api.execute('save_record', { kind: 'clients', id: c.id, data: { birthdayEnabled: true } }),
    /cadastro local/,
  );
});
test('annual queue persists its deduplication across scheduler restart and never resends a sent or uncertain occurrence', async t => {
  const f = await fixture(t);
  const c = client(f);
  f.birthdays.tick(true);
  let rows = f.messaging.list();
  assert.equal(rows.length, 1);
  const first = rows[0];
  assert.ok(first.body.includes('Ana'));
  assert.equal(first.autoBirthday, true);
  new Birthdays(f).tick(true);
  assert.equal(f.messaging.list().length, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM birthday_dispatches').get().n, 1);
  f.store.db.prepare("UPDATE queue SET status='sent',attempts=1 WHERE id=?").run(first.id);
  f.birthdays.tick(true);
  rows = f.messaging.list();
  assert.equal(rows.length, 2);
  assert.equal(Math.max(...rows.map(r => r.birthdayYear)), first.birthdayYear + 1);
  f.store.db.prepare("UPDATE queue SET status='uncertain',attempts=1 WHERE id=?").run(first.id);
  f.birthdays.tick(true);
  assert.equal(f.messaging.list().length, 2);
  assert.equal(f.messaging.list().find(m => m.id === first.id).status, 'uncertain');
  f.store.save('clients', { ...c, birthdayEnabled: false });
  f.birthdays.tick(true);
  assert.ok(
    f.messaging
      .list()
      .filter(m => m.id !== first.id)
      .every(m => m.status === 'cancelled'),
  );
});
test('same-day catch-up is sent once with the latest model and never sent on a later date or after opt-out', async t => {
  const f = await fixture(t);
  const today = dayKey(new Date());
  const c = client(f, { birthDate: '2000' + today.slice(4), birthdayTime: '00:00' });
  f.birthdays.tick(true);
  let row = f.messaging.list()[0];
  assert.equal(row.birthdayDate, today);
  f.library.save({ ...f.model, body: 'Feliz aniversário, {1}! {3}' });
  f.settings.save({ officeName: 'Equipe jurídica' });
  let sent = 0,
    text = '';
  f.messaging.wa = { status: 'connected' };
  f.messaging.socket = {
    sendMessage: async (_to, payload) => {
      sent++;
      text = payload.text;
    },
    end: () => {},
  };
  f.store.db.prepare('UPDATE queue SET available_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', row.id);
  await f.messaging.process();
  assert.equal(sent, 1);
  assert.equal(text, 'Feliz aniversário, Ana Maria! Equipe jurídica');
  assert.equal(f.messaging.list().find(m => m.id === row.id).body, text);
  await f.messaging.process();
  assert.equal(sent, 1);
  const data = { ...row, birthdayDate: '2000-01-01' };
  assert.equal(f.birthdays.prepare(data), null);
  f.store.save('clients', { ...c, birthdayEnabled: false });
  assert.equal(f.birthdays.prepare(row), null);
  assert.equal(dayKey(occurrence({ ...c, birthDate: '2000-02-29' }, 2027)), '2027-02-28');
  assert.equal(dayKey(occurrence({ ...c, birthDate: '2000-02-29' }, 2028)), '2028-02-29');
});
test('a paused birthday is not sent and a missed day is cancelled instead of delivered late', async t => {
  const f = await fixture(t);
  const now = new Date();
  client(f, { birthDate: '2000' + dayKey(now).slice(4), birthdayTime: '00:00' });
  f.birthdays.tick(true);
  const row = f.messaging.list()[0];
  let sent = 0;
  f.messaging.wa = { status: 'connected' };
  f.messaging.socket = { sendMessage: async () => sent++, end: () => {} };
  f.store.db.prepare('UPDATE queue SET available_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', row.id);
  f.settings.save({ queuePaused: true });
  await f.messaging.process();
  assert.equal(sent, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  f.birthdays.clock = () => tomorrow.getTime();
  f.birthdays.tick(true);
  assert.equal(f.messaging.list().find(m => m.id === row.id).status, 'cancelled');
  f.settings.save({ queuePaused: false });
  await f.messaging.process();
  assert.equal(sent, 0);
});
test('portable copies preserve birthday dates, model type and deduplication history while requiring reactivation', async t => {
  const f = await fixture(t);
  client(f);
  f.birthdays.tick(true);
  const portable = new PortableBackup(f.store, f.settings);
  const bytes = await portable.create('senha de backup 12345');
  const plain = await unseal(bytes, 'senha de backup 12345');
  assert.equal(plain.birthdayHistory.length, 1);
  const snapshot = await portable.stageRestore(bytes, 'senha de backup 12345');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(f.root, 'backups', snapshot.id, 'database.sqlite'), { readOnly: true });
  try {
    const c = f.vault.unseal(db.prepare("SELECT payload FROM entities WHERE kind='clients'").get().payload);
    assert.equal(c.birthDate, '2000-12-20');
    assert.equal(c.birthdayEnabled, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM birthday_dispatches').get().n, 1);
    const q = f.vault.unseal(db.prepare('SELECT payload FROM queue').get().payload);
    assert.equal(q.autoBirthday, true);
    const templates = db
      .prepare('SELECT payload FROM templates')
      .all()
      .map(r => f.vault.unseal(r.payload));
    assert.ok(templates.some(t => t.purpose === 'birthday'));
  } finally {
    db.close();
  }
});
