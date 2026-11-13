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
const { EventNotices } = require('../backend/event-notices.cjs');
const { renderMessage, messageContext, unknownVariables, whenParts } = require('../app/message-vars.mjs');
const { defaultBodies, purposeKeys } = require('../app/message-defaults.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'notice-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  settings.save({ officeName: 'Escritório Exemplo' });
  const library = new Library(store);
  const messaging = new Messaging(store, settings, new Operations());
  messaging.skipSendRules = true;
  const notices = new EventNotices({ store, settings, library, messaging });
  const reminders = new HearingReminders({ store, settings, library, messaging });
  t.after(() => {
    messaging.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, settings, library, messaging, notices, reminders };
}
const pad = n => String(n).padStart(2, '0');
const inDays = n => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const br = key => key.split('-').reverse().join('/');

test('named variables fill from the client, event and case; old numbers keep working; typos are found', () => {
  const task = {
    title: 'Audiência',
    type: 'Audiência',
    eventKind: 'de instrução e julgamento',
    due: '2026-11-12T14:30',
    modality: 'virtual',
    roomLink: 'https://sala.example/abc',
    place: '',
    clientNotes: 'Entre 10 minutos antes.',
  };
  const context = messageContext({
    client: { name: 'Ana Maria Souza' },
    settings: { officeName: 'Escritório Exemplo' },
    task,
    caseItem: { number: '0001234-56.2026.8.09.0001', title: 'Indenização', county: 'Goiânia' },
  });
  assert.equal(
    renderMessage('{primeiro_nome}, sua {evento}{processo_ref}: {dia_semana}, {data}, {hora}.', context),
    'Ana, sua audiência de instrução e julgamento no processo nº 0001234-56.2026.8.09.0001: quinta-feira, 12/11/2026, 14:30.',
  );
  assert.match(
    renderMessage('{detalhes}', context),
    /Modalidade: por videoconferência\.\nSala virtual: https:\/\/sala\.example\/abc\nOrientações: Entre 10/,
  );
  assert.equal(renderMessage('{2}|{3}|{4}|{5}', context), 'Ana|Escritório Exemplo|12/11/2026|14:30');
  assert.equal(
    renderMessage('sem processo{processo_ref}.', messageContext({ client: { name: 'Ana' } })),
    'sem processo.',
  );
  assert.equal(
    renderMessage('{ultimo_andamento}{valor}ok', messageContext({})),
    'ok',
    'missing data is empty, never undefined',
  );
  assert.deepEqual(unknownVariables('{cliente} {nome_cliente} {9}'), ['{nome_cliente}', '{9}']);
  assert.deepEqual(whenParts('2026-11-15T09:00'), { data: '15/11/2026', hora: '09:00', dia_semana: 'domingo' });
  for (const purpose of purposeKeys.filter(p => p !== 'birthday')) assert.ok(defaultBodies[purpose], purpose);
  for (const body of Object.values(defaultBodies)) assert.deepEqual(unknownVariables(body), []);
});

test('templates by purpose: variables are checked and the purposes are WhatsApp only', async t => {
  const f = await fixture(t);
  const groupId = f.library.groups()[0].id;
  const ok = f.library.save({
    kind: 'whatsapp',
    purpose: 'event-confirmation',
    groupId,
    title: 'Confirmação',
    body: 'Oi {primeiro_nome}, {evento} em {data}.',
  });
  assert.equal(ok.purpose, 'event-confirmation');
  assert.throws(
    () =>
      f.library.save({ kind: 'whatsapp', purpose: 'event-reminder', groupId, title: 'X', body: 'Oi {nome_cliente}' }),
    /Variável desconhecida: \{nome_cliente\}/,
  );
  assert.throws(
    () => f.library.save({ kind: 'email', purpose: 'billing', groupId, title: 'X', body: 'Oi' }),
    /só existe para modelos de WhatsApp/,
  );
  assert.throws(
    () => f.library.save({ kind: 'whatsapp', purpose: 'inexistente', groupId, title: 'X', body: 'Oi' }),
    /Finalidade/,
  );
});

test('event types and details are kept; the link must be a web address', async t => {
  const f = await fixture(t);
  const task = f.store.save('tasks', {
    title: 'Perícia médica',
    type: 'Perícia',
    due: `${inDays(5)}T10:00`,
    clientReminder: true,
    eventKind: 'médica',
    modality: 'presencial',
    place: 'Rua A, 10',
    noticeOffsets: '7d,1d,xx,1d',
  });
  assert.deepEqual(
    [task.type, task.eventKind, task.modality, task.clientReminder],
    ['Perícia', 'médica', 'presencial', true],
  );
  assert.equal(task.noticeOffsets, '7d,1d', 'unknown and repeated offsets are dropped');
  assert.throws(
    () =>
      f.store.save('tasks', {
        title: 'X',
        type: 'Audiência',
        due: `${inDays(5)}T10:00`,
        roomLink: 'javascript:alert(1)',
      }),
    /link da sala virtual/,
  );
});

test('confirmation window: preview, then confirmation now plus reminders, without duplicates on a second apply', async t => {
  const f = await fixture(t);
  const client = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000' });
  const day = inDays(10);
  const task = f.store.save('tasks', {
    title: 'Audiência',
    type: 'Audiência',
    eventKind: 'de conciliação',
    due: `${day}T14:30`,
    clientId: client.id,
    clientReminder: true,
    place: 'Fórum de Goiânia',
  });
  const preview = f.notices.preview(task.id);
  assert.equal(preview.eligible, true);
  assert.match(preview.confirmationBody, /Olá, Ana!.*audiência de conciliação: .*14:30\.\nLocal: Fórum de Goiânia\./s);
  assert.deepEqual(
    preview.reminders.filter(r => r.selected).map(r => r.key),
    ['7d', '1d', '2h'],
    'defaults',
  );
  const result = f.notices.apply(task.id, { confirmation: true, offsets: ['7d', '2h'] });
  assert.deepEqual(result.reminders, ['7d', '2h']);
  const list = f.messaging.list();
  assert.equal(list.length, 3);
  assert.equal(list.filter(m => !m.scheduledFor).length, 1, 'the confirmation goes out now');
  assert.ok(list.every(m => m.recipient === '5564999990000' && m.clientId === client.id && m.status === 'pending'));
  const saved = f.store.get('tasks', task.id);
  assert.equal(saved.confirmationStatus, 'awaiting');
  assert.equal(saved.noticeOffsets, '7d,2h');
  // Applying again replaces the open messages instead of adding more.
  f.notices.apply(task.id, { confirmation: true, offsets: ['1d'] });
  const again = f.messaging.list();
  assert.equal(again.filter(m => m.status === 'pending').length, 2);
  assert.equal(again.filter(m => m.status === 'cancelled').length, 3);
});

test('a reminder in the past is not queued, and the old single reminder gives way to the notices', async t => {
  const f = await fixture(t);
  const client = f.store.save('clients', { name: 'Ana', phone: '5564999990000' });
  const task = f.store.save('tasks', {
    title: 'Reunião',
    type: 'Reunião',
    due: `${inDays(2)}T10:00`,
    clientId: client.id,
    clientReminder: true,
    reminderLead: '1',
  });
  // Old behaviour: one reminder.
  const legacy = f.reminders.sync(task);
  assert.equal(legacy.status, 'pending');
  const result = f.notices.apply(task.id, { confirmation: false, offsets: ['7d', '1d'] });
  assert.deepEqual(result.reminders, ['1d'], '7 days before is already past');
  const withNotices = f.store.get('tasks', task.id);
  const synced = f.reminders.sync(withNotices);
  assert.equal(synced.status, 'none');
  const open = f.messaging.list().filter(m => m.status === 'pending');
  assert.equal(open.length, 1, 'the legacy reminder was cancelled; only the notice stays');
});

test('rescheduling moves the reminders and asks approval for a message to a client who was already told', async t => {
  const f = await fixture(t);
  const client = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000' });
  const task = f.store.save('tasks', {
    title: 'Audiência',
    type: 'Audiência',
    due: `${inDays(10)}T14:30`,
    clientId: client.id,
    clientReminder: true,
  });
  f.notices.apply(task.id, { confirmation: true, offsets: ['1d'] });
  const conf = f.messaging.list().find(m => !m.scheduledFor);
  // The confirmation goes out.
  f.store.db.prepare("UPDATE queue SET status='sent',sent_at=? WHERE id=?").run(new Date().toISOString(), conf.id);
  const before = f.store.get('tasks', task.id);
  const newDay = inDays(15);
  const moved = f.notices.afterSave(
    before,
    f.store.put('tasks', task.id, { ...stripMeta(before), due: `${newDay}T09:00` }),
  );
  assert.equal(moved.confirmationStatus, 'awaiting');
  const list = f.messaging.list();
  const reschedule = list.find(m => m.status === 'needs_review');
  assert.match(reschedule.body, new RegExp(`remarcada para .*${br(newDay)}, às 09:00`));
  const reminder = list.find(m => m.status === 'pending');
  assert.equal(
    reminder.scheduledFor,
    new Date(
      Number(newDay.slice(0, 4)),
      Number(newDay.slice(5, 7)) - 1,
      Number(newDay.slice(8)) - 1,
      9,
      0,
    ).toISOString(),
  );
  // Deleting the event stops the reminder and prepares the cancellation notice.
  f.notices.afterRemove(f.store.get('tasks', task.id));
  const final = f.messaging.list();
  assert.equal(final.filter(m => m.status === 'pending').length, 0);
  const cancel = final.filter(m => m.status === 'needs_review');
  assert.equal(cancel.length, 2);
  assert.ok(cancel.some(m => /foi cancelada/.test(m.body)));
});

test('an event without a client or phone explains why no notice can be sent', async t => {
  const f = await fixture(t);
  const noClient = f.store.save('tasks', { title: 'Audiência', type: 'Audiência', due: `${inDays(9)}T09:00` });
  assert.match(f.notices.preview(noClient.id).reason, /Vincule um cliente/);
  const other = f.store.save('tasks', { title: 'Prazo', type: 'Prazo', due: `${inDays(9)}T09:00` });
  assert.match(f.notices.preview(other.id).reason, /Só audiência/);
  assert.throws(() => f.notices.apply(noClient.id, { confirmation: true, offsets: [] }), /Vincule um cliente/);
  assert.equal(f.messaging.list().length, 0);
});

function stripMeta(task) {
  const { id, createdAt, updatedAt, ...rest } = task;
  void id;
  void createdAt;
  void updatedAt;
  return rest;
}
