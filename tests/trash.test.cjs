const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Documents } = require('../backend/documents.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'trash-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}

test('removed records go to the trash and come back with their links', async t => {
  const { store } = await fixture(t);
  const client = store.save('clients', { name: 'Ana', phone: '5564999990000', status: 'Ativo' });
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id });
  const task = store.save('tasks', { title: 'Contestação', due: '2026-12-01T09:00', caseId: caseItem.id });
  assert.throws(() => store.remove('clients', client.id), /vinculado/, 'links still protect');
  store.remove('tasks', task.id);
  assert.equal(store.list('tasks').length, 0);
  assert.throws(() => store.get('tasks', task.id), /não encontrado/);
  const [item] = store.trashList();
  assert.deepEqual([item.id, item.kind, item.title], [task.id, 'tasks', 'Contestação']);
  store.restore(task.id);
  assert.equal(store.get('tasks', task.id).caseId, caseItem.id);
  assert.equal(store.trashList().length, 0);
  // A task whose case is in the trash comes back only after the case.
  store.remove('tasks', task.id);
  store.remove('cases', caseItem.id);
  assert.throws(() => store.restore(task.id), /Restaure primeiro/);
  store.restore(caseItem.id);
  store.restore(task.id);
  assert.equal(store.counts().tasks, 1);
});

test('the trash is emptied after 30 days and deleting from it removes the document file', async t => {
  const { root, store } = await fixture(t);
  const documents = new Documents(store);
  const doc = await documents.save('peticao.pdf', Buffer.from('%PDF-1.4 teste'));
  const file = path.join(root, 'documents', `${doc.id}.enc`);
  store.remove('documents', doc.id);
  assert.ok(fs.existsSync(file), 'kept while in the trash');
  const note = store.save('notes', { title: 'Antiga', content: 'x' });
  store.remove('notes', note.id);
  store.db.prepare('UPDATE trash SET deleted_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', note.id);
  assert.equal(store.purgeTrash({ olderThanDays: 30, now: Date.parse('2026-11-12T00:00:00Z') }), 1);
  assert.deepEqual(
    store.trashList().map(i => i.id),
    [doc.id],
  );
  store.purgeTrash({ id: doc.id });
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.trashList().length, 0);
});
