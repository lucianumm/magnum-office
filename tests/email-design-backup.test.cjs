const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Backups, verifyBackup, backupPath, restoreBackup } = require('../backend/backups.cjs');
const { Documents } = require('../backend/documents.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Library } = require('../backend/library.cjs');
const { render, normalize } = require('../backend/email-design.cjs');
const { PortableBackup, unseal } = require('../backend/portable-backup.cjs');
const { WeeklyBackups, WEEK } = require('../backend/weekly-backups.cjs');
const terms = require('../app/terms.json');
const base = path.resolve('work', 'design-backup-tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'run-')),
    vault = new Vault(randomBytes(32)),
    store = new Store(root, vault);
  await store.migrate();
  fs.writeFileSync(path.join(root, 'vault.bin'), 'fixture-os-vault');
  const settings = new Settings(root);
  settings.internal({ termsAcceptedVersion: terms.version });
  settings.save({
    queuePaused: true,
    ownDomain: 'office.test',
    emailFrom: 'contact@office.test',
    emailDNSConfirmed: true,
  });
  const operations = new Operations(),
    backups = new Backups(store, settings),
    messaging = new Messaging(store, settings, operations);
  messaging.stop();
  const weekly = new WeeklyBackups({ store, settings, backups, operations, messaging });
  weekly.stop();
  t.after(() => {
    weekly.stop();
    messaging.stop();
    try {
      store.close();
    } catch {
      /* restored fixture */
    }
    if (!root.startsWith(base + path.sep)) throw Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store, settings, operations, backups, messaging, weekly };
}
test('email design escapes headers, sanitizes body, rejects unsafe controls and uses the same frame for preview/send', () => {
  const design = {
    brand: 'Escritório <Privado>',
    tagline: 'Descrição',
    headerColor: '#112233',
    borderColor: '#ddeeff',
    radius: 20,
    footer: 'Assinatura\nContato',
    buttonLabel: 'Abrir atendimento',
    buttonURL: 'https://example.test/atendimento',
  };
  const input = { html: '<p><b>Mensagem</b><script>alert(1)</script></p>', design };
  const preview = render(input, {}, true),
    sent = render(input, {});
  assert.equal(preview.html, sent.html);
  assert.ok(sent.html.includes('Escritório &lt;Privado&gt;'));
  assert.ok(sent.html.includes('border-radius:20px'));
  assert.ok(sent.html.includes('#112233'));
  assert.ok(!sent.html.includes('<script'));
  assert.throws(() => normalize({ buttonURL: 'javascript:alert(1)' }), /Use/);
  assert.throws(() => normalize({ headerColor: 'red;url(evil)' }), /Cor/);
  assert.throws(() => normalize({ imageData: 'data:image/svg+xml;base64,PHN2Zz4=' }), /imagem/);
});
test('inline email images are embedded as CID attachments and do not require remote image requests', () => {
  const logo = 'data:image/png;base64,' + fs.readFileSync('frontend/public/app-icon.png').toString('base64');
  const r = render(
    { body: 'Texto', design: { imageData: 'data:image/jpeg;base64,YQ==' } },
    { brandLogo: logo, officeName: 'Escritório' },
    false,
  );
  assert.equal(r.attachments.length, 2);
  assert.ok(r.html.includes('cid:office-logo'));
  assert.ok(r.html.includes('cid:email-banner'));
  assert.ok(!r.html.includes('data:image'));
  assert.equal(r.attachments[0].content_id, 'office-logo');
  const p = render({ body: 'Texto' }, { brandLogo: logo }, true);
  assert.ok(p.html.includes('data:image/png'));
  assert.equal(p.attachments.length, 0);
});
test('portable backup restores linked records, models and documents under a different vault, excluding integration credentials', async t => {
  const source = await fixture(t),
    dest = await fixture(t);
  const client = source.store.save('clients', {
    phone: '5564999990000',
    name: 'Nome sigiloso para backup',
    email: 'cliente@example.test',
  });
  const item = source.store.save('cases', {
    title: 'Processo do cliente',
    clientId: client.id,
    status: 'Em andamento',
  });
  const person = source.store.save('people', { name: 'Testemunha do caso', role: 'Testemunha', caseId: item.id });
  const file = path.join(source.root, 'documento.txt');
  fs.writeFileSync(file, 'Documento confidencial do cliente');
  const doc = await new Documents(source.store).import(file, { clientId: client.id, caseId: item.id });
  const library = new Library(source.store);
  library.save({
    kind: 'email',
    groupId: library.groups()[0].id,
    title: 'Modelo visual',
    body: 'Olá',
    html: '<b>Olá</b>',
    emailDesign: { brand: 'Marca salva', headerColor: '#223344' },
  });
  source.store.secret('resend-key', 're_fixture_never_export');
  source.store.secret('wa:fixture', { credentials: 'do-not-export' });
  source.messaging.enqueue({
    channel: 'whatsapp',
    recipient: '5564999991111',
    body: 'Agendada',
    clientId: client.id,
    scheduledFor: new Date(Date.now() + 3600000).toISOString(),
  });
  const password = 'Senha de teste forte 123!';
  const portable = new PortableBackup(source.store, source.settings);
  const bytes = await portable.create(password);
  assert.equal(bytes.includes(Buffer.from('Nome sigiloso')), false);
  await assert.rejects(unseal(bytes, 'Outra senha diferente!'), /Senha/);
  const plain = await unseal(bytes, password);
  assert.equal(JSON.stringify(plain).includes('re_fixture_never_export'), false);
  assert.equal(JSON.stringify(plain).includes('do-not-export'), false);
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(unseal(tampered, password), /alterado/);
  dest.store.save('notes', { title: 'Antes de restaurar', content: 'Preservado até confirmação' });
  const snap = await new PortableBackup(dest.store, dest.settings).stageRestore(bytes, password);
  assert.equal(dest.store.list('notes').length, 1);
  await verifyBackup(dest.root, snap.id, dest.vault);
  const db = new DatabaseSync(path.join(backupPath(dest.root, snap.id), 'database.sqlite'), { readOnly: true });
  assert.equal(
    dest.vault.unseal(db.prepare("SELECT payload FROM entities WHERE kind='clients'").get().payload).name,
    'Nome sigiloso para backup',
  );
  assert.equal(db.prepare('SELECT status FROM queue').get().status, 'needs_review');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM secrets WHERE id='resend-key'").get().n, 0);
  db.close();
  dest.store.close();
  await restoreBackup(dest.root, snap.id, dest.vault);
  const reopened = new Store(dest.root, dest.vault);
  await reopened.migrate();
  assert.equal(reopened.get('cases', item.id).clientId, client.id);
  assert.equal(new Documents(reopened).read(doc.id).toString(), 'Documento confidencial do cliente');
  assert.equal(new Library(reopened).list().find(m => m.kind === 'email').emailDesign.headerColor, '#223344');
  assert.equal(
    new Library(reopened).list().filter(m => m.kind === 'document').length,
    5,
    'starting templates are restored, not added twice',
  );
  assert.equal(reopened.get('people', person.id).caseId, item.id);
  reopened.close();
});
test('weekly backups catch up only when open/accepted, preserve local copy and expose truthful daily status', async t => {
  const f = await fixture(t),
    now = Date.now();
  f.settings.internal({ termsAcceptedVersion: '' });
  await f.weekly.tick(now);
  assert.equal(f.backups.list().length, 0);
  f.settings.internal({ termsAcceptedVersion: terms.version });
  await f.weekly.tick(now + 60001);
  assert.equal(f.backups.list().filter(b => b.reason === 'weekly').length, 1);
  assert.equal(f.weekly.get().dailyNotice, true);
  f.weekly.noticeSeen();
  assert.equal(f.weekly.get().dailyNotice, false);
  await f.weekly.tick(now + 120002);
  assert.equal(f.backups.list().length, 1);
  f.settings.internal({ lastAutoBackupAt: new Date(now - WEEK - 1000).toISOString() });
  f.operations.maintenance = true;
  await f.weekly.tick(now + 180003);
  assert.equal(f.backups.list().length, 1);
  f.operations.maintenance = false;
  await f.weekly.tick(now + 240004);
  assert.equal(f.backups.list().length, 2);
});
test('weekly email is opt-in, goes to one responsible recipient, stays encrypted and never automatically retries an uncertain send', async t => {
  const f = await fixture(t);
  f.messaging.configureEmail('re_fixture');
  assert.throws(
    () =>
      f.weekly.configure({
        enabled: true,
        dailyNotice: true,
        mode: 'email',
        recipient: 'a@test.example,b@test.example',
        password: 'Senha de backup 123!',
        acknowledged: true,
      }),
    /único/,
  );
  f.weekly.configure({
    enabled: true,
    dailyNotice: true,
    mode: 'email',
    recipient: 'responsavel@example.test',
    password: 'Senha de backup 123!',
    acknowledged: true,
  });
  f.settings.save({ queuePaused: false });
  const previous = global.fetch;
  let count = 0,
    payload;
  global.fetch = async (_url, options) => {
    count++;
    payload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };
  t.after(() => (global.fetch = previous));
  const now = Date.now();
  await f.weekly.tick(now);
  assert.equal(count, 1);
  assert.deepEqual(payload.to, ['responsavel@example.test']);
  assert.ok(payload.attachments[0].filename.endsWith('.magnumbackup'));
  const archive = Buffer.from(payload.attachments[0].content, 'base64');
  assert.equal((await unseal(archive, 'Senha de backup 123!')).format, 1);
  assert.equal(f.backups.list().filter(b => b.reason === 'weekly').length, 1);
  await f.weekly.tick(now + 120000);
  assert.equal(count, 1);
  f.settings.internal({ lastBackupEmailAt: null, backupEmailState: 'idle' });
  global.fetch = async () => {
    count++;
    throw Error('network');
  };
  await f.weekly.tick(now + 240000);
  assert.equal(f.weekly.get().emailState, 'uncertain');
  await f.weekly.tick(now + 360000);
  assert.equal(count, 2);
  assert.equal(f.backups.list().length, 1);
});
