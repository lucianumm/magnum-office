const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { AppLock } = require('../backend/app-lock.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });

test('optional password: lock, wrong attempts, waiting, idle and turning off', async t => {
  const root = fs.mkdtempSync(path.join(base, 'lock-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const settings = new Settings(root);
  let now = 1_000_000;
  const lock = new AppLock({ store, settings, clock: () => now });
  assert.equal(lock.locked, false, 'no password, never locked');
  assert.equal(lock.lock(), false);
  assert.throws(() => lock.setPassword({ password: '123' }), /6 a 200/);
  lock.setPassword({ password: 'segredo1' });
  assert.ok(!JSON.stringify(store.secret('app-lock')).includes('segredo1'), 'only the hash is stored');
  assert.equal(lock.lock(), true);
  for (let i = 0; i < 5; i++) assert.throws(() => lock.unlock('errada'), /incorreta/);
  assert.throws(() => lock.unlock('segredo1'), /Aguarde 30 segundos/);
  now += 30001;
  assert.equal(lock.unlock('segredo1'), true);
  lock.configure({ idleMinutes: 5, onHide: true });
  assert.equal(lock.idle(200), false);
  assert.equal(lock.idle(300), true);
  assert.equal(new AppLock({ store, settings }).locked, true, 'starts locked when there is a password');
  assert.throws(() => lock.setPassword({ current: 'x', password: 'outrasenha' }), /atual não confere/);
  lock.setPassword({ current: 'segredo1', password: 'outrasenha' });
  assert.throws(() => lock.disable({ current: 'segredo1' }), /atual não confere/);
  lock.disable({ current: 'outrasenha' });
  assert.equal(lock.config().enabled, false);
  assert.throws(() => lock.configure({ idleMinutes: 7 }), /inválido/);
});
