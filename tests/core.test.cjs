const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Backups, restoreBackup, verifyBackup, backupPath } = require('../backend/backups.cjs');
const { Documents } = require('../backend/documents.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { diagnostics } = require('../backend/diagnostics.cjs');
const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault);
  await store.migrate();
  const settings = new Settings(root);
  const operations = new Operations();
  const backups = new Backups(store, settings);
  t.after(() => {
    try {
      store.close();
    } catch {
      /* May already be closed by restoration. */
    }
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store, settings, operations, backups };
}
test('AES-GCM encrypts and authenticates records and rejects another key', () => {
  const vault = new Vault(randomBytes(32));
  const sealed = vault.seal({ name: 'Confidencial' });
  assert.equal(sealed.includes(Buffer.from('Confidencial')), false);
  assert.deepEqual(vault.unseal(sealed), { name: 'Confidencial' });
  const changed = Buffer.from(sealed);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => vault.unseal(changed));
  assert.throws(() => new Vault(randomBytes(32)).unseal(sealed));
});
test('migrations are tracked, idempotent and leave a backup', async t => {
  const { store, root } = await fixture(t);
  const first = store.db.prepare('SELECT * FROM migrations').all();
  await store.migrate();
  assert.equal(first.length, fs.readdirSync(store.migrations).filter(n => n.endsWith('.sql')).length);
  assert.deepEqual(store.db.prepare('SELECT * FROM migrations').all(), first);
  assert.equal(store.integrity(), true);
  assert.ok(fs.readdirSync(path.join(root, 'backups')).some(n => n.startsWith('pre-migration-')));
});
test('failed migrations roll back changes and do not advance migration history', async t => {
  const { store, root } = await fixture(t);
  const dir = path.join(root, 'migration-test');
  fs.mkdirSync(dir);
  const initialCount = store.db.prepare('SELECT COUNT(*) AS n FROM migrations').get().n;
  for (const name of fs.readdirSync(store.migrations))
    fs.copyFileSync(path.join(store.migrations, name), path.join(dir, name));
  fs.writeFileSync(path.join(dir, '999-broken.sql'), 'CREATE TABLE should_not_exist (id TEXT); INVALID SQL;');
  store.migrations = dir;
  await assert.rejects(store.migrate());
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='should_not_exist'").get(), undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM migrations').get().n, initialCount);
});
test('client and process references survive restart and are encrypted in SQLite', async t => {
  const { store, root, vault } = await fixture(t);
  const client = store.save('clients', {
    phone: '5564999990000',
    name: 'Pessoa confidencial',
    email: 'segredo@example.test',
  });
  const c = store.save('cases', {
    title: 'Processo sigiloso',
    clientId: client.id,
    status: 'Em andamento',
    area: 'Cível',
  });
  assert.throws(() => store.remove('clients', client.id), /vinculado/);
  assert.throws(() => store.save('cases', { ...c, clientId: '00000000-0000-0000-0000-000000000000' }), /encontrado/);
  assert.equal(
    store.db
      .prepare('SELECT payload FROM entities WHERE id=?')
      .get(client.id)
      .payload.includes(Buffer.from('Pessoa confidencial')),
    false,
  );
  store.close();
  const reopened = new Store(root, vault);
  await reopened.migrate();
  assert.equal(reopened.get('cases', c.id).clientId, client.id);
  reopened.close();
});
test('task validation rejects invalid dates and preserves status', async t => {
  const { store } = await fixture(t);
  assert.throws(() => store.save('tasks', { title: 'Prazo', due: '2026-02-31T09:00' }), /Data/);
  assert.throws(() => store.save('tasks', { title: 'Prazo', due: '2026-01-01T25:00' }));
  const task = store.save('tasks', { title: 'Prazo', due: '2026-11-10T09:00', type: 'Prazo', priority: 'Urgente' });
  assert.equal(store.save('tasks', { ...task, status: 'Concluída' }).status, 'Concluída');
});
test('documents are encrypted, restored and arbitrary executables rejected', async t => {
  const { store, root } = await fixture(t);
  const docs = new Documents(store);
  const file = path.join(root, 'sample.txt');
  const original = Buffer.from('Texto jurídico privado');
  fs.writeFileSync(file, original);
  const doc = await docs.import(file);
  assert.deepEqual(docs.read(doc.id), original);
  assert.equal(fs.readFileSync(path.join(root, 'documents', doc.id + '.enc')).includes(original), false);
  fs.writeFileSync(path.join(root, 'bad.exe'), 'x');
  await assert.rejects(docs.import(path.join(root, 'bad.exe')), /Executáveis/);
});
test('authenticated backup restores all data and preserves the previous state', async t => {
  const { store, root, vault, backups } = await fixture(t);
  const client = store.save('clients', { phone: '5564999990000', name: 'Antes' });
  const copy = await backups.create();
  await verifyBackup(root, copy.id, vault);
  store.save('clients', { phone: '5564999990000', ...client, name: 'Depois' });
  store.close();
  await restoreBackup(root, copy.id, vault);
  const restored = new Store(root, vault);
  await restored.migrate();
  assert.equal(restored.get('clients', client.id).name, 'Antes');
  restored.close();
  assert.ok(fs.readdirSync(path.join(root, 'backups')).some(n => n.startsWith('before-restore-')));
});
test('backup tampering and path traversal are rejected before touching current data', async t => {
  const { store, root, vault, backups } = await fixture(t);
  const copy = await backups.create();
  await fsp.appendFile(path.join(backupPath(root, copy.id), 'database.sqlite'), 'tampered');
  await assert.rejects(verifyBackup(root, copy.id, vault), /corrompido/);
  assert.equal(store.integrity(), true);
  assert.throws(() => backupPath(root, '../database.sqlite'), /inválido/);
});
test('maintenance cannot interrupt an active critical operation', async () => {
  const operations = new Operations();
  let release;
  const active = operations.run(
    'Envio',
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  await assert.rejects(
    operations.exclusive(async () => {}),
    /andamento/,
  );
  release();
  await active;
  await operations.exclusive(async () => {
    await assert.rejects(
      operations.run('Gravação', async () => {}),
      /manutenção/,
    );
  });
  assert.deepEqual(operations.status(), { maintenance: false, active: [] });
});
test('queue survives restart, and a message left sending is marked uncertain', async t => {
  const { store, settings, operations } = await fixture(t);
  let service = new Messaging(store, settings, operations);
  const id = service.enqueue({ channel: 'whatsapp', recipient: '5562999990000', body: 'Mensagem confidencial' });
  store.db.prepare("UPDATE queue SET status='sending' WHERE id=?").run(id);
  service.stop();
  service = new Messaging(store, settings, operations);
  t.after(() => service.stop());
  assert.equal(service.list()[0].status, 'uncertain');
  await service.process();
  assert.equal(service.list()[0].attempts, 0);
  service.change(id, 'cancel');
  assert.equal(service.list()[0].status, 'cancelled');
});
test('diagnostics omit all client data, messages, secrets and filesystem paths', async t => {
  const { store, root, settings, operations, backups } = await fixture(t);
  store.save('clients', { phone: '5564999990000', name: 'PRIVATE_CLIENT_NAME', document: '52998224725' });
  settings.save({ ownDomain: 'office.test', emailFrom: 'contact@office.test', emailDNSConfirmed: true });
  store.secret('resend-key', 're_PRIVATE_API_KEY');
  const service = new Messaging(store, settings, operations);
  t.after(() => service.stop());
  service.enqueue({
    channel: 'email',
    recipient: 'PRIVATE_RECIPIENT@example.test',
    subject: 'PRIVATE_SUBJECT',
    body: 'PRIVATE_MESSAGE',
  });
  const value = JSON.stringify(await diagnostics(store, settings, service, backups));
  for (const forbidden of ['PRIVATE', '52998224725', '529.982.247-25', root.replaceAll('\\', '\\\\')])
    assert.equal(value.includes(forbidden), false);
  assert.equal(JSON.parse(value).database.integrity, 'ok');
});
test('repository and settings validation prevent arbitrary update origins', async t => {
  const { settings } = await fixture(t);
  assert.equal(settings.get().repository, 'lucianumm/magnum-office');
  assert.throws(() => settings.save({ repository: 'office/advocacia' }), /fixo/);
  assert.equal(settings.save({ repository: 'lucianumm/magnum-office' }).repository, 'lucianumm/magnum-office');
  assert.throws(() => settings.save({ repository: 'https://example.com/malware' }));
  assert.throws(() => settings.save({ channel: 'anything' }));
  assert.throws(() => settings.save({ businessStart: 22, businessEnd: 8 }));
});
