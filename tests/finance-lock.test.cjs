const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { FinanceLock } = require('../backend/finance-lock.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'fin-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  let now = 1_800_000_000_000;
  const lock = new FinanceLock({ store, clock: () => now });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, lock, advance: ms => (now += ms), root };
}

test('without a password nothing is protected; with one the money is hidden until it is typed', async t => {
  const { lock, store } = await fixture(t);
  assert.deepEqual(lock.config(), { enabled: false, locked: false });
  assert.doesNotThrow(() => lock.assertOpen());
  assert.throws(() => lock.setPassword({ password: 'abc' }), /4 a 200/);
  lock.setPassword({ password: 'segredo' });
  assert.equal(lock.config().locked, false, 'open right after it is set');
  const saved = JSON.stringify(
    store.db
      .prepare("SELECT * FROM secrets WHERE id='finance-lock'")
      .all()
      .map(r => [...r.payload]),
  );
  assert.ok(!saved.includes('segredo'), 'only a hash is kept');
  lock.lock();
  assert.deepEqual(lock.config(), { enabled: true, locked: true });
  assert.throws(() => lock.assertOpen(), /protegido por senha/);
  assert.throws(() => lock.unlock('errada'), /incorreta/);
  assert.equal(lock.unlock('segredo').locked, false);
  assert.doesNotThrow(() => lock.assertOpen());
});

test('it closes again after 30 minutes, five wrong tries make it wait, and changing needs the current password', async t => {
  const { lock, advance } = await fixture(t);
  lock.setPassword({ password: 'segredo' });
  advance(29 * 60000);
  assert.equal(lock.locked(), false);
  advance(2 * 60000);
  assert.equal(lock.locked(), true);
  for (let i = 0; i < 5; i++) assert.throws(() => lock.unlock('x'), /incorreta/);
  assert.throws(() => lock.unlock('segredo'), /Muitas tentativas/);
  advance(31000);
  assert.equal(lock.unlock('segredo').locked, false);
  assert.throws(() => lock.setPassword({ current: 'errada', password: 'outra-senha' }), /atual não confere/);
  lock.setPassword({ current: 'segredo', password: 'outra-senha' });
  lock.lock();
  assert.throws(() => lock.unlock('segredo'), /incorreta/);
  assert.equal(lock.unlock('outra-senha').locked, false);
  assert.throws(() => lock.disable({ current: 'x' }), /atual não confere/);
  assert.deepEqual(lock.disable({ current: 'outra-senha' }), { enabled: false, locked: false });
});
