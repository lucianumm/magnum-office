const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Library } = require('../backend/library.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { HearingReminders } = require('../backend/hearing-reminders.cjs');
const { WorkflowRunner } = require('../backend/workflow-runner.cjs');
const { AgentAPI } = require('../backend/agent-api.cjs');
const { planWorkflow, defaultWorkflows } = require('../app/workflows.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'remind-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault);
  await store.migrate();
  const settings = new Settings(root);
  settings.save({ officeName: 'Escritório Exemplo' });
  const library = new Library(store);
  const operations = new Operations();
  const messaging = new Messaging(store, settings, operations);
  const reminders = new HearingReminders({ store, settings, library, messaging });
  t.after(() => {
    messaging.stop();
    store.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, settings, library, messaging, operations, reminders };
}
const pad = n => String(n).padStart(2, '0');
const inDays = n => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test('hearing reminder is scheduled once, rescheduled when the date changes and cancelled when done', async t => {
  const f = await fixture(t);
  const client = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000' });
  const caseItem = f.store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id });
  const day = inDays(10);
  let task = f.store.save('tasks', { title: 'Audiência de conciliação', type: 'Audiência', due: `${day}T14:30`, caseId: caseItem.id, clientReminder: true, reminderLead: '2', reminderTime: '09:00' });
  let result = f.reminders.sync(task);
  assert.equal(result.status, 'pending');
  task = result.task;
  let [message] = f.messaging.list();
  assert.equal(f.messaging.list().length, 1);
  assert.equal(message.recipient, '5564999990000');
  assert.equal(message.clientId, client.id);
  assert.match(message.body, new RegExp(`Olá, Ana! .*audiência em ${day.split('-').reverse().join('/')}, às 14:30\\. .*Escritório Exemplo`));
  const expected = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)) - 2, 9, 0);
  assert.equal(message.scheduledFor, expected.toISOString());
  // Saving again without relevant changes does not create a new message.
  task = f.reminders.sync(f.store.save('tasks', { ...task, notes: 'Levar documentos' })).task;
  assert.equal(f.messaging.list().length, 1);
  // A new date cancels the old message and schedules a new one.
  task = f.reminders.sync(f.store.save('tasks', { ...task, due: `${inDays(12)}T10:00` })).task;
  const list = f.messaging.list();
  assert.equal(list.length, 2);
  assert.equal(list.find(m => m.id === message.id).status, 'cancelled');
  assert.equal(list.find(m => m.id === task.reminderMessageId).status, 'pending');
  // Concluding the hearing cancels the pending reminder.
  task = f.reminders.sync(f.store.save('tasks', { ...task, status: 'Concluída' })).task;
  assert.ok(f.messaging.list().every(m => m.status === 'cancelled'));
  assert.equal(task.reminderMessageId, '');
});

test('reminders are not sent for the past, without a client phone, or for other task types', async t => {
  const f = await fixture(t);
  const client = f.store.save('clients', { name: 'Ana', phone: '5564999990000' });
  const tomorrow = inDays(1);
  const past = f.reminders.sync(f.store.save('tasks', { title: 'Audiência', type: 'Audiência', due: `${tomorrow}T09:00`, clientId: client.id, clientReminder: true, reminderLead: '7' }));
  assert.equal(past.status, 'none');
  assert.match(past.reason, /já passou/);
  const noClient = f.reminders.sync(f.store.save('tasks', { title: 'Audiência', type: 'Audiência', due: `${inDays(9)}T09:00`, clientReminder: true }));
  assert.match(noClient.reason, /Vincule um cliente/);
  const deadline = f.store.save('tasks', { title: 'Prazo', type: 'Prazo', due: `${inDays(9)}T09:00`, clientId: client.id, clientReminder: true });
  assert.equal(deadline.clientReminder, false, 'only hearings and meetings');
  assert.equal(f.messaging.list().length, 0);
});

test('a chosen WhatsApp template is personalized with the hearing variables', async t => {
  const f = await fixture(t);
  const group = f.library.groups()[0];
  const model = f.library.save({ kind: 'whatsapp', groupId: group.id, title: 'Lembrete', body: '{1}: {6} em {4} às {5}.' });
  const client = f.store.save('clients', { name: 'Carlos Lima', phone: '5564999990001' });
  const day = inDays(8);
  f.reminders.sync(f.store.save('tasks', { title: 'Reunião de alinhamento', type: 'Reunião', due: `${day}T16:00`, clientId: client.id, clientReminder: true, reminderTemplateId: model.id }));
  assert.equal(f.messaging.list()[0].body, `Carlos Lima: Reunião de alinhamento em ${day.split('-').reverse().join('/')} às 16:00.`);
});

test('agents cannot switch reminders on, and their date changes wait for review', async t => {
  const f = await fixture(t);
  f.settings.internal({ agentWrite: true });
  const api = new AgentAPI({ store: f.store, settings: f.settings, operations: f.operations, library: f.library, messaging: f.messaging, reminders: f.reminders });
  const client = f.store.save('clients', { name: 'Ana', phone: '5564999990000' });
  const task = f.reminders.sync(f.store.save('tasks', { title: 'Audiência', type: 'Audiência', due: `${inDays(10)}T09:00`, clientId: client.id, clientReminder: true })).task;
  await assert.rejects(api.execute('save_record', { kind: 'tasks', data: { title: 'X', due: `${inDays(10)}T09:00`, clientReminder: true } }), /aviso ao cliente/);
  await api.execute('save_record', { kind: 'tasks', id: task.id, data: { due: `${inDays(11)}T09:00` } });
  const statuses = f.messaging.list().map(m => m.status).sort();
  assert.deepEqual(statuses, ['cancelled', 'needs_review']);
  await api.execute('delete_record', { kind: 'tasks', id: task.id });
  assert.ok(f.messaging.list().every(m => m.status === 'cancelled'));
});

test('workflows create the standard tasks of a case on business days, and settings validate them', async t => {
  const f = await fixture(t);
  assert.equal(f.settings.get().workflows.length, defaultWorkflows.length, 'defaults offered on first use');
  const flow = defaultWorkflows.find(w => w.id === 'trabalhista-reclamacao');
  // Start Thu 2026-11-19: documents on the start date; +5 = Tue 24/11; +10 = Sun 29/11 → Mon 30/11.
  const plan = planWorkflow(flow, '2026-11-19');
  assert.deepEqual(plan.map(p => p.due), ['2026-11-19T09:00', '2026-11-19T09:00', '2026-11-19T09:00', '2026-11-19T09:00', '2026-11-24T09:00', '2026-11-30T09:00']);
  // Start on the Consciência Negra holiday moves the same-day items to Mon 23/11.
  assert.equal(planWorkflow(flow, '2026-11-20')[0].due, '2026-11-23T09:00');
  const caseItem = f.store.save('cases', { title: 'Reclamação', status: 'Em andamento', area: 'Trabalhista' });
  const runner = new WorkflowRunner({ store: f.store, settings: f.settings });
  assert.equal(runner.apply({ caseId: caseItem.id, workflowId: flow.id, start: '2026-11-19' }).count, 6);
  const tasks = f.store.list('tasks');
  assert.ok(tasks.every(t => t.caseId === caseItem.id && t.status === 'Pendente' && t.notes === 'Fluxo: Reclamação trabalhista'));
  assert.throws(() => runner.apply({ caseId: caseItem.id, workflowId: 'nao-existe', start: '2026-11-19' }), /fluxo/);
  assert.throws(() => f.settings.save({ workflows: [{ id: 'x', name: 'X', area: '', items: [] }] }), /1 a 40/);
  assert.throws(() => f.settings.save({ workflows: [{ id: 'x', name: 'X', area: 'Inventada', items: [{ title: 'a', offset: 0, type: 'Tarefa', priority: 'Normal' }] }] }), /Área/);
  f.settings.save({ workflows: [] });
  assert.deepEqual(new Settings(f.root).get().workflows, [], 'an emptied list stays empty');
  const saved = f.settings.save({ courtCalendar: [{ date: '2026-10-24', type: 'holiday', description: 'Aniversário de Goiânia', courtId: 'tjgo' }] });
  assert.equal(saved.courtCalendar.length, 1);
  assert.throws(() => f.settings.save({ courtCalendar: [{ date: '2026-02-30', type: 'holiday' }] }), /Data/);
  assert.throws(() => f.settings.save({ courtCalendar: [{ date: '2026-10-24', type: 'x' }] }), /Tipo/);
});
