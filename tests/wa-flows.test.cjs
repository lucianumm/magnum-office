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
const { Inbox } = require('../backend/wa-inbox.cjs');
const { Campaigns } = require('../backend/campaigns.cjs');
const { EventNotices } = require('../backend/event-notices.cjs');
const { DataJud } = require('../backend/datajud.cjs');
const { Flows } = require('../backend/wa-flows.cjs');
const { classify, extractCpf } = require('../app/wa-flow-rules.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
const NOW = new Date(2026, 10, 12, 10, 0).getTime();
const CPF_ANA = '529.982.247-25';
const CPF_BIA = '111.444.777-35';
async function fixture(t, { mode } = {}) {
  const root = fs.mkdtempSync(path.join(base, 'flow-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  settings.internal({ termsAcceptedVersion: require('../app/terms.json').version, waInboxEnabled: true });
  settings.save({ officeName: 'Escritório Exemplo', ...(mode ? { waFlowMode: mode } : {}) });
  const library = new Library(store);
  const messaging = new Messaging(store, settings, new Operations());
  messaging.skipSendRules = true;
  let now = NOW;
  const clock = () => now;
  const inbox = new Inbox({ store, settings, clock });
  const campaigns = new Campaigns({ store, settings, library, messaging, clock });
  const eventNotices = new EventNotices({ store, settings, library, messaging, clock });
  const datajud = new DataJud({ store, settings, fetch: async () => ({ ok: false, status: 500 }), clock });
  const flows = new Flows({ store, settings, messaging, inbox, campaigns, eventNotices, datajud, library, clock });
  t.after(() => {
    messaging.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let n = 0;
  // A message from a number, as the inbox stores it.
  const say = async (phone, text) => {
    const record = inbox.receive({
      key: { id: 'M' + ++n, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
      message: { conversation: text },
      messageTimestamp: Math.floor(now / 1000),
    });
    assert.ok(record, 'the inbox stored the message');
    return { handled: await flows.handle(record), record };
  };
  const sent = () => messaging.list().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    store,
    settings,
    library,
    messaging,
    inbox,
    datajud,
    flows,
    eventNotices,
    say,
    sent,
    setNow: v => (now = v),
    now: () => now,
  };
}
const movement = (f, caseId, name = 'Juntada de petição') =>
  f.datajud.write(caseId, {
    movements: [
      { id: 'm1', date: '2026-11-10T12:00:00.000Z', name, code: 1, complements: [], orgao: '', source: 'datajud' },
    ],
    meta: { sigilo: 0 },
    fetchedAt: new Date(NOW - 3600000).toISOString(),
    newCount: 0,
  });
function ana(f, over = {}) {
  const client = f.store.save('clients', {
    name: 'Ana Souza',
    phone: '5564999990000',
    document: CPF_ANA,
    status: 'Ativo',
    whatsappProgressConsent: true,
    ...over,
  });
  const caseItem = f.store.save('cases', {
    title: 'Indenização',
    number: '',
    status: 'Em andamento',
    clientId: client.id,
  });
  movement(f, caseItem.id);
  return { client, caseItem };
}

test('what the client writes is told apart: menu, CPF, choice and confirmation', () => {
  assert.equal(classify('1').intent, 'progress');
  assert.equal(classify(' Andamento do processo ').intent, 'progress');
  assert.equal(classify('2').intent, 'event');
  assert.equal(classify('Quero falar com a equipe').intent, 'human');
  assert.equal(classify('oi, bom dia').intent, 'other');
  assert.deepEqual(classify('529.982.247-25', { step: 'cpf' }), { intent: 'cpf', cpf: '52998224725' });
  assert.equal(classify('529.982.247-25').intent, 'other', 'a CPF is only read when one was asked for');
  assert.deepEqual(classify('2', { step: 'pick' }), { intent: 'pick', n: 2 });
  assert.equal(classify('Sim', { awaiting: true }).intent, 'confirm');
  assert.equal(classify('Sim', { awaiting: false }).intent, 'other');
  assert.equal(classify('CONFIRMO!', { awaiting: true }).intent, 'confirm');
  assert.equal(extractCpf('meu cpf é 529.982.247-25'), '52998224725');
  assert.equal(extractCpf('123'), '');
});

test('progress by CPF: asks for the CPF, answers with the last movement and waits for review by default', async t => {
  const f = await fixture(t);
  ana(f);
  await f.say('556499990000', '1'); // the number comes without the ninth digit
  assert.match(f.sent()[0].body, /informe o seu CPF/);
  assert.equal(f.sent()[0].status, 'pending', 'the question is neutral and goes out by itself');
  const { record } = await f.say('556499990000', '529.982.247-25');
  const answer = f.sent()[1];
  assert.match(
    answer.body,
    /Olá, Ana! Sobre o seu processo: o último andamento registrado, em 10\/11\/2026, foi “Juntada de petição”/,
  );
  assert.equal(answer.status, 'needs_review', 'default mode: case data waits for a click');
  assert.equal(f.inbox.list().find(m => m.id === record.id).text, '[CPF informado]', 'the CPF is not kept');
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM audit').all()).includes('52998224725'));
});

test('"answer by itself" sends the answer without waiting', async t => {
  const f = await fixture(t, { mode: 'auto' });
  ana(f);
  await f.say('556499990000', 'andamento');
  await f.say('556499990000', '52998224725');
  assert.equal(f.sent()[1].status, 'pending');
});

test("security: right number with another client's CPF, another client's number with this CPF, and no consent", async t => {
  const f = await fixture(t, { mode: 'auto' });
  ana(f);
  const bia = f.store.save('clients', {
    name: 'Bia Lima',
    phone: '5511988887777',
    document: CPF_BIA,
    status: 'Ativo',
    whatsappProgressConsent: true,
  });
  f.store.save('cases', { title: 'Divórcio', status: 'Em andamento', clientId: bia.id });
  // Ana's number, Bia's CPF: refused.
  await f.say('556499990000', '1');
  await f.say('556499990000', CPF_BIA);
  assert.match(f.sent().at(-1).body, /CPF não confere.*2 tentativa/);
  // Bia's number, Ana's CPF: refused too (the CPF must be the one of whoever writes).
  await f.say('5511988887777', '1');
  await f.say('5511988887777', CPF_ANA);
  assert.match(f.sent().at(-1).body, /CPF não confere/);
  assert.ok(!f.sent().some(m => /último andamento|Indenização|Divórcio/.test(m.body)), 'no case data left');
  // Right CPF without the opt-in: never asked.
  f.store.put('clients', bia.id, { ...strip(f.store.get('clients', bia.id)), whatsappProgressConsent: false });
  const before = f.sent().length;
  await f.say('5511988887777', '1');
  assert.match(f.sent()[before].body, /não está ativada no seu cadastro/);
  await f.say('5511988887777', CPF_BIA);
  assert.ok(!/último andamento/.test(f.sent().at(-1).body));
});

test('three wrong CPFs block the consultation for 24 hours', async t => {
  const f = await fixture(t, { mode: 'auto' });
  ana(f);
  await f.say('556499990000', '1');
  await f.say('556499990000', '11144477735');
  await f.say('556499990000', '11144477735');
  await f.say('556499990000', '11144477735');
  assert.match(f.sent().at(-1).body, /bloqueada por 24 horas/);
  // Even the right CPF is not accepted while blocked.
  await f.say('556499990000', '1');
  assert.match(f.sent().at(-1).body, /bloqueada por 24 horas/);
  f.setNow(NOW + 25 * 3600000);
  await f.say('556499990000', '1');
  assert.match(f.sent().at(-1).body, /informe o seu CPF/);
});

test('several cases: a numbered list; secret cases are never answered; five answers a day', async t => {
  const f = await fixture(t, { mode: 'auto' });
  const { client } = ana(f);
  const second = f.store.save('cases', { title: 'Trabalhista', status: 'Em andamento', clientId: client.id });
  movement(f, second.id, 'Audiência designada');
  f.store.save('cases', { title: 'Sigiloso', status: 'Em andamento', clientId: client.id, secret: true });
  await f.say('556499990000', '1');
  await f.say('556499990000', CPF_ANA);
  const list = f.sent().at(-1).body;
  assert.match(list, /\*1\* Indenização/);
  assert.match(list, /\*2\* Trabalhista/);
  assert.ok(!/Sigiloso/.test(list), 'secret cases are not even listed');
  await f.say('556499990000', '2');
  assert.match(f.sent().at(-1).body, /“Audiência designada”/);
  // Four more rounds reach the limit of five answers per day.
  for (let i = 0; i < 4; i++) {
    await f.say('556499990000', '1');
    await f.say('556499990000', CPF_ANA);
    await f.say('556499990000', '1');
  }
  await f.say('556499990000', '1');
  assert.match(f.sent().at(-1).body, /máximo de consultas de hoje/);
});

test('a client with only a secret case is told to talk to the office', async t => {
  const f = await fixture(t, { mode: 'auto' });
  const client = f.store.save('clients', {
    name: 'Ana Souza',
    phone: '5564999990000',
    document: CPF_ANA,
    status: 'Ativo',
    whatsappProgressConsent: true,
  });
  f.store.save('cases', { title: 'Sigiloso', status: 'Em andamento', clientId: client.id, secret: true });
  await f.say('556499990000', '1');
  await f.say('556499990000', CPF_ANA);
  assert.match(f.sent().at(-1).body, /exige atendimento da nossa equipe/);
});

test('strangers get one fixed line a day; the menu is not repeated within 30 minutes; the team is told', async t => {
  const f = await fixture(t, { mode: 'auto' });
  ana(f);
  const first = await f.say('5521977776666', 'oi');
  assert.equal(first.handled, true);
  assert.match(f.sent()[0].body, /^Aqui é o Escritório Exemplo\. Para atendimento, fale com a nossa equipe/);
  assert.equal((await f.say('5521977776666', 'alô?')).handled, false, 'only once a day');
  assert.equal(f.sent().length, 1);
  assert.equal(f.inbox.list().filter(m => m.status === 'new').length, 2, 'the office still sees both');
  await f.say('556499990000', 'oi');
  assert.match(f.sent().at(-1).body, /atendimento automático do Escritório Exemplo/);
  const count = f.sent().length;
  await f.say('556499990000', 'bom dia');
  assert.equal(f.sent().length, count, 'no second menu within 30 minutes');
  f.setNow(NOW + 31 * 60000);
  await f.say('556499990000', 'bom dia');
  assert.equal(f.sent().length, count + 1);
  await f.say('556499990000', '3');
  assert.match(f.sent().at(-1).body, /Avisamos a nossa equipe/);
  assert.equal(f.inbox.list().find(m => m.text === '3').status, 'new', 'a request for the team stays in the inbox');
});

test('confirming presence marks the event; the next hearing is told only to its client', async t => {
  const f = await fixture(t, { mode: 'auto' });
  const { client, caseItem } = ana(f);
  const task = f.store.save('tasks', {
    title: 'Audiência',
    type: 'Audiência',
    eventKind: 'de conciliação',
    due: '2026-11-25T14:00',
    caseId: caseItem.id,
    clientReminder: true,
    place: 'Fórum, sala 3',
  });
  f.eventNotices.apply(task.id, { confirmation: true, offsets: [] });
  assert.equal(f.store.get('tasks', task.id).confirmationStatus, 'awaiting');
  await f.say('556499990000', '2');
  assert.match(
    f.sent().at(-1).body,
    /Sua próxima audiência de conciliação.*quarta-feira, 25\/11\/2026, às 14:00\.\nLocal: Fórum, sala 3\./s,
  );
  await f.say('556499990000', 'CONFIRMO');
  assert.equal(f.store.get('tasks', task.id).confirmationStatus, 'confirmed');
  assert.match(f.sent().at(-1).body, /Presença confirmada: audiência de conciliação, 25\/11\/2026, às 14:00\./);
  // Another client never hears about it.
  f.store.save('clients', { name: 'Bia Lima', phone: '5511988887777', status: 'Ativo' });
  await f.say('5511988887777', '2');
  assert.match(f.sent().at(-1).body, /Não encontramos audiência/);
  void client;
});

test('turned off, nothing is answered; media and unreadable chats are ignored', async t => {
  const f = await fixture(t, { mode: 'off' });
  ana(f);
  assert.equal((await f.say('556499990000', '1')).handled, false);
  assert.equal(f.sent().length, 0);
  assert.equal(await f.flows.handle({ phone: '', text: '1' }), false);
  assert.equal(await f.flows.handle({ phone: '556499990000', text: '', media: true }), false);
});

function strip(task) {
  const { id, createdAt, updatedAt, ...rest } = task;
  void id;
  void createdAt;
  void updatedAt;
  return rest;
}
