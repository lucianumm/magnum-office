const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Backups } = require('../backend/backups.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { WeeklyBackups } = require('../backend/weekly-backups.cjs');
const terms = require('../app/terms.json');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });

test('weekly protected copy goes to a synced folder, once a week, keeping the four latest', async t => {
  const root = fs.mkdtempSync(path.join(base, 'folder-backup-'));
  const folder = fs.mkdtempSync(path.join(base, 'onedrive-'));
  const store = new Store(path.join(root, 'dados'), new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(store.root);
  settings.internal({ termsAcceptedVersion: terms.version });
  const operations = new Operations();
  const messaging = new Messaging(store, settings, operations);
  messaging.stop();
  const weekly = new WeeklyBackups({ store, settings, backups: new Backups(store, settings), operations, messaging });
  weekly.stop();
  t.after(() => {
    weekly.stop();
    messaging.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  });
  store.save('clients', { name: 'Ana', phone: '5564999990000', status: 'Ativo' });
  assert.throws(
    () => weekly.configure({ enabled: true, dailyNotice: false, mode: 'folder', folder, acknowledged: true }),
    /senha/,
  );
  assert.throws(
    () =>
      weekly.configure({
        enabled: true,
        dailyNotice: false,
        mode: 'folder',
        folder: store.root,
        password: 'senha-forte-123',
        acknowledged: true,
      }),
    /fora dos dados/,
  );
  weekly.configure({
    enabled: true,
    dailyNotice: false,
    mode: 'folder',
    folder,
    password: 'senha-forte-123',
    acknowledged: true,
  });
  for (let i = 0; i < 6; i++)
    fs.writeFileSync(path.join(folder, `Magnum-Office-backup-2020-01-0${i + 1}.magnumbackup`), 'old');
  const now = Date.parse('2026-11-12T12:00:00Z');
  await weekly.tick(now);
  let files = fs.readdirSync(folder).sort();
  assert.equal(files.length, 4, 'four most recent kept');
  assert.equal(files.at(-1), 'Magnum-Office-backup-2026-11-12.magnumbackup');
  assert.ok(fs.statSync(path.join(folder, files.at(-1))).size > 100);
  assert.ok(!fs.readFileSync(path.join(folder, files.at(-1))).includes('Ana'), 'the copy is encrypted');
  await weekly.tick(now + 3600000);
  assert.equal(fs.readdirSync(folder).length, 4, 'nothing new within the week');
  assert.equal(weekly.get().lastFolder, new Date(now).toISOString());
});
