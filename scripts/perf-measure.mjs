// Measures how the local store behaves with a large office: 10 000 clients, 4 000 cases and 30 000
// tasks. Prints the time to list each kind (what the screen receives on every change) and to save.
// Usage: node scripts/perf-measure.mjs [clients] [tasks]
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');

const clients = Number(process.argv[2]) || 10000;
const tasks = Number(process.argv[3]) || 30000;
const cases = Math.round(clients * 0.4);
const base = path.resolve('work', 'perf');
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'run-'));
const store = new Store(root, new Vault(randomBytes(32)));
await store.migrate();
const time = (label, task) => {
  const start = process.hrtime.bigint();
  const value = task();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  process.stdout.write(`${label.padEnd(44)} ${ms.toFixed(1).padStart(9)} ms\n`);
  return { value, ms };
};
try {
  time(`criar ${clients} clientes, ${cases} processos, ${tasks} prazos`, () => {
    store.db.exec('BEGIN');
    const ids = [];
    for (let i = 0; i < clients; i++)
      ids.push(
        store.save('clients', { name: `Cliente ${i}`, phone: `55649999${String(i).padStart(5, '0')}`, status: 'Ativo' })
          .id,
      );
    const caseIds = [];
    for (let i = 0; i < cases; i++)
      caseIds.push(
        store.save('cases', { title: `Processo ${i}`, status: 'Em andamento', clientId: ids[i % ids.length] }).id,
      );
    for (let i = 0; i < tasks; i++)
      store.save('tasks', {
        title: `Prazo ${i}`,
        due: `2026-12-${String((i % 28) + 1).padStart(2, '0')}T09:00`,
        type: 'Prazo',
        priority: 'Normal',
        status: 'Pendente',
        caseId: caseIds[i % caseIds.length],
      });
    store.db.exec('COMMIT');
  });
  const results = {};
  for (const kind of ['clients', 'cases', 'tasks'])
    results[kind] = time(`listar ${kind} (1ª vez)`, () => store.list(kind)).ms;
  for (const kind of ['clients', 'cases', 'tasks']) time(`listar ${kind} (de novo)`, () => store.list(kind));
  const all = time('estado completo (8 tipos)', () =>
    Object.fromEntries(
      ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes'].map(k => [k, store.list(k)]),
    ),
  );
  time('serializar o estado para a tela', () => JSON.stringify(all.value).length);
  const one = store.list('clients')[0];
  time('salvar 1 cliente', () => store.save('clients', { ...one, id: one.id, name: one.name + ' (editado)' }));
  time('estado completo depois de salvar', () =>
    ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes'].map(k => store.list(k)),
  );
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
