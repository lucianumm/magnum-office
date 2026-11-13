const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { ownDomain, sender } = require('../backend/email-policy.cjs');
const base = path.resolve('work', 'schedule-tests');
fs.mkdirSync(base, { recursive: true });
async function setup(t) {
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const vault = new Vault(crypto.randomBytes(32));
  const store = new Store(root, vault);
  await store.migrate();
  const settings = new Settings(root),
    operations = new Operations();
  const messaging = new Messaging(store, settings, operations);
  messaging.skipSendRules = true;
  const sends = [];
  messaging.wa = { status: 'connected', qr: null };
  messaging.socket = {
    sendMessage: async (jid, body) => {
      sends.push({ jid, body });
    },
    end: () => {},
  };
  t.after(() => {
    messaging.stop();
    store.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store, settings, operations, messaging, sends };
}
const input = () => ({
  channel: 'whatsapp',
  recipient: '5564999990000',
  body: 'Lembrete autorizado de teste',
  scheduledFor: new Date(Date.now() + 60000).toISOString(),
});
test('scheduled WhatsApp waits for its time and is sent only once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await setup(t);
  const id = f.messaging.enqueue(input());
  await f.messaging.process();
  assert.equal(f.sends.length, 0);
  t.mock.timers.tick(61000);
  await f.messaging.process();
  await f.messaging.process();
  assert.equal(f.sends.length, 1);
  assert.equal(f.messaging.list()[0].id, id);
  assert.equal(f.messaging.list()[0].status, 'sent');
  assert.ok(f.messaging.list()[0].sentAt);
});
test('pause holds due messages and resuming processes them without duplication', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await setup(t);
  f.messaging.enqueue(input());
  f.settings.save({ queuePaused: true });
  t.mock.timers.tick(61000);
  await f.messaging.process();
  assert.equal(f.sends.length, 0);
  f.settings.save({ queuePaused: false });
  await f.messaging.process();
  assert.equal(f.sends.length, 1);
});
test('missed schedules require review and cannot be retried at an old time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await setup(t);
  const id = f.messaging.enqueue(input());
  t.mock.timers.tick(62 * 60000);
  await f.messaging.process();
  assert.equal(f.sends.length, 0);
  assert.equal(f.messaging.list()[0].status, 'needs_review');
  assert.throws(() => f.messaging.change(id, 'retry'), /novo horário/);
  f.messaging.edit(id, { ...input(), body: 'Novo horário confirmado' });
  assert.equal(f.messaging.list()[0].status, 'pending');
  t.mock.timers.tick(61000);
  await f.messaging.process();
  assert.equal(f.sends.length, 1);
});
test('editing a scheduled dispatch requires a future valid date and checks links', async t => {
  const f = await setup(t);
  const id = f.messaging.enqueue(input());
  assert.throws(
    () => f.messaging.edit(id, { ...input(), scheduledFor: new Date(Date.now() - 1000).toISOString() }),
    /futuro/,
  );
  assert.throws(() => f.messaging.enqueue({ ...input(), clientId: crypto.randomUUID() }), /encontrado/);
  f.messaging.change(id, 'cancel');
  await f.messaging.process();
  assert.equal(f.sends.length, 0);
  assert.equal(f.messaging.list()[0].status, 'cancelled');
});
test('queue scans past a disconnected channel instead of starving a ready one', async t => {
  const f = await setup(t);
  f.messaging.wa.status = 'disconnected';
  for (let i = 0; i < 30; i++)
    f.messaging.enqueue({ channel: 'whatsapp', recipient: '5564999990000', body: 'WhatsApp offline' });
  f.settings.save({ ownDomain: 'myoffice.test', emailFrom: 'contact@myoffice.test', emailDNSConfirmed: true });
  f.messaging.configureEmail('re_testkey');
  f.messaging.enqueue({ channel: 'email', recipient: 'client@gmail.com', subject: 'Assunto', body: 'Teste' });
  const original = global.fetch;
  let called = 0;
  global.fetch = async (_url, opts) => {
    called++;
    assert.equal(JSON.parse(opts.body).from, 'contact@myoffice.test');
    return new Response('{}', { status: 200 });
  };
  t.after(() => {
    global.fetch = original;
  });
  await f.messaging.process();
  assert.equal(called, 1);
  assert.equal(f.messaging.list().filter(m => m.status === 'sent').length, 1);
});
test('e-mail requires own domain, matching sender and DNS confirmation; recipients remain unrestricted', async t => {
  const f = await setup(t);
  for (const domain of [
    'gmail.com',
    'mail.gmail.com',
    'outlook.com',
    'resend.dev',
    'https://office.com',
    'office.com/evil',
  ])
    assert.throws(() => ownDomain(domain));
  assert.equal(ownDomain('MYOFFICE.COM.BR'), 'myoffice.com.br');
  assert.throws(() => sender('owner@another.test', 'myoffice.test'));
  f.settings.save({ ownDomain: 'myoffice.test', emailFrom: 'contact@myoffice.test' });
  const email = { channel: 'email', recipient: 'client@gmail.com', subject: 'Teste', body: 'Teste autorizado' };
  assert.throws(() => f.messaging.enqueue(email), /Confirme/);
  f.settings.save({ emailDNSConfirmed: true });
  assert.ok(f.messaging.enqueue(email));
  assert.throws(() => f.settings.save({ emailFrom: 'owner@gmail.com' }));
  assert.throws(() => f.settings.save({ ownDomain: 'gmail.com' }));
});
test('personalization persists, and arbitrary renderer-provided logos are ignored', async t => {
  const f = await setup(t);
  f.settings.save({
    appName: 'Meu sistema jurídico',
    theme: 'purple',
    appearance: 'dark',
    density: 'compact',
    favoriteCourts: ['tjgo', 'trt18'],
  });
  const reopened = new Settings(f.root);
  assert.equal(reopened.get().appName, 'Meu sistema jurídico');
  assert.equal(reopened.get().theme, 'purple');
  assert.equal(reopened.get().appearance, 'dark');
  assert.deepEqual(reopened.get().favoriteCourts, ['tjgo', 'trt18']);
  assert.throws(() => f.settings.save({ theme: 'javascript:alert(1)' }));
  f.settings.save({ brandLogo: 'https://external.test/track.png' });
  assert.equal(f.settings.get().brandLogo, '');
});
test('version 0.1 data and encrypted pending messages survive the scheduling migration', async t => {
  const root = fs.mkdtempSync(path.join(base, 'legacy-'));
  const migrations = path.join(root, 'legacy-migrations');
  fs.mkdirSync(migrations);
  fs.copyFileSync('migrations/001-initial.sql', path.join(migrations, '001-initial.sql'));
  const vault = new Vault(crypto.randomBytes(32));
  let store = new Store(root, vault, migrations);
  await store.migrate();
  const client = store.save('clients', { phone: '5564999990000', name: 'Cliente preservado' });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  store.db
    .prepare('INSERT INTO queue(id,channel,payload,status,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(
      id,
      'whatsapp',
      vault.seal({ recipient: '5564999990000', subject: '', body: 'Conteúdo preservado' }),
      'pending',
      now,
      now,
      now,
    );
  store.close();
  store = new Store(root, vault);
  await store.migrate();
  assert.equal(store.get('clients', client.id).name, 'Cliente preservado');
  const messaging = new Messaging(store, new Settings(root), new Operations());
  messaging.skipSendRules = true;
  assert.equal(messaging.list()[0].body, 'Conteúdo preservado');
  assert.equal(messaging.list()[0].scheduledFor, null);
  messaging.stop();
  store.close();
  t.after(() => {
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
test('official directory includes each Brazilian court branch and safe HTTPS destinations', () => {
  const data = require('../app/courts.json');
  assert.equal(data.courts.filter(c => c.category === 'Estadual').length, 27);
  assert.equal(data.courts.filter(c => c.category === 'Trabalhista').length, 24);
  assert.equal(data.courts.filter(c => c.category === 'Federal').length, 6);
  assert.equal(data.courts.filter(c => c.category === 'Eleitoral').length, 27);
  assert.equal(new Set(data.courts.map(c => c.id)).size, data.courts.length);
  for (const c of data.courts)
    for (const url of [c.url, ...c.systems.map(s => s.url)]) {
      const u = new URL(url);
      assert.equal(u.protocol, 'https:');
      assert.ok(u.hostname.endsWith('.jus.br'));
    }
});
