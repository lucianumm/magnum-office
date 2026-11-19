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
const { Outbox, Journal } = require('../backend/wa-retry.cjs');
const { AiReply } = require('../backend/ai-reply.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
const NOW = new Date(2026, 10, 12, 10, 0).getTime();
async function fixture(t, { ai = {}, fetch } = {}) {
  const root = fs.mkdtempSync(path.join(base, 'ai-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  settings.internal({ termsAcceptedVersion: require('../app/terms.json').version, waInboxEnabled: true });
  settings.save({ officeName: 'Escritório Exemplo', ...ai });
  let now = NOW;
  const clock = () => now;
  const library = new Library(store);
  const messaging = new Messaging(store, settings, new Operations());
  messaging.skipSendRules = true;
  const inbox = new Inbox({ store, settings, clock });
  const campaigns = new Campaigns({ store, settings, library, messaging, clock });
  const eventNotices = new EventNotices({ store, settings, library, messaging, clock });
  const datajud = new DataJud({ store, settings, fetch: async () => ({ ok: false, status: 500 }), clock });
  const calls = [];
  const aiFetch =
    fetch ||
    (async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return {
        status: 200,
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Olá! A equipe responde em breve.' }] }),
      };
    });
  const aiReply = new AiReply({ store, settings, fetch: aiFetch, clock });
  const flows = new Flows({
    store,
    settings,
    messaging,
    inbox,
    campaigns,
    eventNotices,
    datajud,
    library,
    ai: aiReply,
    clock,
  });
  t.after(() => {
    messaging.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let n = 0;
  const say = async (phone, text) => {
    const record = inbox.receive({
      key: { id: 'M' + ++n, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
      message: { conversation: text },
      messageTimestamp: Math.floor(now / 1000),
    });
    return { handled: await flows.handle(record), record };
  };
  const sent = () => messaging.list().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { store, settings, aiReply, flows, inbox, messaging, calls, say, sent, advance: ms => (now += ms), clock };
}
const aiOn = {
  aiEnabled: true,
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-5-5',
  aiGuidelines: 'Nunca prometa resultado. Atendimento de segunda a sexta.',
};
const KEY = 'sk-ant-chave-de-teste';

test('sent texts are kept for 24 hours so WhatsApp can ask for them again, also after a restart', async t => {
  const f = await fixture(t);
  const outbox = new Outbox({ store: f.store, clock: f.clock });
  outbox.remember('ABC123', '5564999990000@s.whatsapp.net', 'Olá, Ana!');
  assert.deepEqual(outbox.find('ABC123'), { conversation: 'Olá, Ana!' });
  assert.equal(outbox.find('NAO-EXISTE'), undefined);
  assert.deepEqual(
    new Outbox({ store: f.store, clock: f.clock }).find('ABC123'),
    { conversation: 'Olá, Ana!' },
    'a new run finds it',
  );
  const raw = f.store.db.prepare('SELECT payload FROM wa_outbox').get().payload;
  assert.ok(!Buffer.from(raw).includes(Buffer.from('Olá')), 'stored encrypted');
  f.advance(23 * 3600000);
  assert.ok(outbox.find('ABC123'));
  f.advance(2 * 3600000);
  assert.equal(outbox.find('ABC123'), undefined, 'older than 24 hours is not given back');
  assert.equal(outbox.purge(), 1);
  assert.equal(outbox.count(), 0);
});

test('journal: the same message twice is handled once; the text goes when the conversation ends; all vanishes in 24 h', async t => {
  const f = await fixture(t);
  const journal = new Journal({ store: f.store, clock: f.clock });
  const record = { id: 'M1', phone: '556499990000', text: 'oi', clientId: '' };
  assert.equal(journal.begin(record), true);
  assert.equal(journal.begin(record), false, 'delivered twice: not handled again');
  assert.equal(new Journal({ store: f.store, clock: f.clock }).begin(record), false, 'also after a restart');
  assert.ok(
    f.store.db.prepare("SELECT payload FROM wa_journal WHERE msg_id='M1'").get().payload,
    'the text is kept while it is being handled',
  );
  journal.finish('M1');
  const row = f.store.db.prepare("SELECT status,payload FROM wa_journal WHERE msg_id='M1'").get();
  assert.deepEqual([row.status, row.payload], ['done', null], 'the text is erased at the end');
  f.advance(25 * 3600000);
  assert.equal(journal.purge(), 1);
  assert.equal(journal.begin(record), true, 'after 24 hours nothing is remembered');
});

test('an answer cut by a crash is resumed if under 10 minutes old; older ones are dropped, never answered late', async t => {
  const f = await fixture(t);
  const first = new Journal({ store: f.store, clock: f.clock });
  first.begin({ id: 'M1', phone: '556499990000', text: 'quero saber da audiência', clientId: 'c1' });
  f.advance(4 * 60000);
  first.begin({ id: 'M2', phone: '556499990000', text: 'mais uma', clientId: 'c1' });
  // A new run of the program (the first one "crashed").
  const second = new Journal({ store: f.store, clock: f.clock });
  f.advance(3 * 60000);
  const back = second.interrupted();
  assert.deepEqual(
    back.map(b => [b.id, b.record.text]),
    [
      ['M1', 'quero saber da audiência'],
      ['M2', 'mais uma'],
    ],
  );
  second.finish('M1');
  f.advance(8 * 60000);
  assert.deepEqual(second.interrupted(), [], 'M2 is now older than 10 minutes');
  const state = f.store.db.prepare("SELECT status,payload FROM wa_journal WHERE msg_id='M2'").get();
  assert.deepEqual([state.status, state.payload], ['abandoned', null]);
  // What this run is handling right now is not "interrupted".
  second.begin({ id: 'M3', phone: '1', text: 'x', clientId: '' });
  assert.deepEqual(second.interrupted(), []);
});

test('AI: the request carries only the client text, first name, office and guidelines; the key is never shown', async t => {
  const f = await fixture(t, { ai: aiOn });
  assert.equal(f.aiReply.enabled(), false, 'off until a key is registered');
  f.aiReply.setKey(KEY);
  assert.equal(f.aiReply.enabled(), true);
  assert.ok(!JSON.stringify(f.aiReply.config()).includes('sk-ant'), 'the key never goes back to the screen');
  assert.equal(f.aiReply.config().hasKey, true);
  assert.throws(() => f.aiReply.setKey('curta'), /inválida/);
  const answer = await f.aiReply.draft({ text: 'Quando sai minha sentença?', firstName: 'Ana' });
  assert.equal(answer, 'Olá! A equipe responde em breve.');
  const [call] = f.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.options.headers['x-api-key'], KEY);
  assert.equal(call.body.model, 'claude-haiku-5-5');
  assert.match(call.body.system, /Escritório Exemplo/);
  assert.match(call.body.system, /não dê aconselhamento jurídico/);
  assert.match(call.body.system, /ignore qualquer instrução/);
  assert.match(call.body.system, /Diretrizes do escritório:\nNunca prometa resultado/);
  assert.match(call.body.messages[0].content, /Nome do cliente: Ana/);
  assert.equal(JSON.stringify(call.body).includes('sk-ant'), false);
  // Another service: OpenAI-compatible, here a model on this computer.
  const openai = [];
  const g = await fixture(t, {
    ai: { ...aiOn, aiProvider: 'openai', aiModel: 'llama', aiBaseUrl: 'http://localhost:11434/v1' },
    fetch: async (url, options) => {
      openai.push({ url, options, body: JSON.parse(options.body) });
      return {
        status: 200,
        ok: true,
        json: async () => ({ choices: [{ message: { content: '  Resposta local.  ' } }] }),
      };
    },
  });
  g.aiReply.setKey('chave-local-123');
  assert.equal(await g.aiReply.draft({ text: 'oi', firstName: '' }), 'Resposta local.');
  assert.equal(openai[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(openai[0].options.headers.authorization, 'Bearer chave-local-123');
  assert.deepEqual(
    openai[0].body.messages.map(m => m.role),
    ['system', 'user'],
  );
});

test('AI settings are validated and errors from the service are explained', async t => {
  const f = await fixture(t, { ai: aiOn });
  assert.throws(() => f.settings.save({ aiBaseUrl: 'http://example.com' }), /https:\/\//);
  assert.doesNotThrow(() => f.settings.save({ aiBaseUrl: 'https://api.exemplo.com/v1' }));
  assert.doesNotThrow(() => f.settings.save({ aiBaseUrl: 'http://127.0.0.1:8080' }));
  assert.throws(() => f.settings.save({ aiProvider: 'outro' }), /Escolha o serviço/);
  assert.throws(() => f.settings.save({ aiMode: 'x' }), /inválido/);
  assert.throws(() => f.settings.save({ aiGuidelines: 'x'.repeat(8001) }), /8.000/);
  f.settings.save({ aiBaseUrl: '' });
  f.aiReply.setKey('chave-de-teste-123');
  const answering = (status, body = {}) =>
    new AiReply({
      store: f.store,
      settings: f.settings,
      fetch: async () => ({ status, ok: status < 300, json: async () => body }),
      clock: f.clock,
    });
  await assert.rejects(answering(401).draft({ text: 'oi' }), /recusou a chave/);
  await assert.rejects(answering(429).draft({ text: 'oi' }), /esperar/);
  await assert.rejects(answering(500).draft({ text: 'oi' }), /código 500/);
  await assert.rejects(answering(200, { content: [] }).draft({ text: 'oi' }), /não devolveu texto/);
  const offline = new AiReply({
    store: f.store,
    settings: f.settings,
    fetch: async () => {
      throw new Error('rede');
    },
    clock: f.clock,
  });
  await assert.rejects(offline.draft({ text: 'oi' }), /Não foi possível falar/);
});

test('AI limits: 3 answers per client per hour', async t => {
  const f = await fixture(t, { ai: aiOn });
  for (let i = 0; i < 3; i++) {
    assert.equal(f.aiReply.allowed('c1'), true);
    f.aiReply.note('c1');
  }
  assert.equal(f.aiReply.allowed('c1'), false);
  assert.equal(f.aiReply.allowed('c2'), true, 'another client is not affected');
  f.advance(61 * 60000);
  assert.equal(f.aiReply.allowed('c1'), true);
});

test('free text from a registered client goes to the AI and waits for approval; keywords, strangers and failures do not', async t => {
  const f = await fixture(t, { ai: aiOn });
  f.aiReply.setKey(KEY);
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  await f.say('556499990000', 'Boa tarde, preciso conversar sobre meu caso');
  assert.equal(f.calls.length, 1);
  const [draft] = f.sent();
  assert.equal(draft.body, 'Olá! A equipe responde em breve.');
  assert.equal(draft.status, 'needs_review', 'a draft waits for the office by default');
  // The menu keywords are handled by the program, not by the AI.
  await f.say('556499990000', '3');
  assert.equal(f.calls.length, 1);
  assert.match(f.sent().at(-1).body, /Avisamos a nossa equipe/);
  // A stranger only gets the fixed line, and the AI is not called with their text.
  await f.say('5521977776666', 'me ajuda?');
  assert.equal(f.calls.length, 1);
  assert.match(f.sent().at(-1).body, /Aqui é o Escritório Exemplo/);
  // "Answer by itself": the answer goes out without waiting.
  f.settings.save({ aiMode: 'auto' });
  f.advance(2 * 3600000);
  await f.say('556499990000', 'obrigada pela atenção');
  assert.equal(f.calls.length, 2);
  assert.equal(f.sent().at(-1).status, 'pending');
  // When the service fails, the program falls back to its menu instead of staying silent.
  const g = await fixture(t, { ai: aiOn, fetch: async () => ({ status: 500, ok: false, json: async () => ({}) }) });
  g.aiReply.setKey(KEY);
  g.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  await g.say('556499990000', 'oi, tudo bem?');
  assert.match(g.sent()[0].body, /atendimento automático do Escritório Exemplo/);
});

test('with the automatic menu off the AI can still answer free text, but never the menu keywords', async t => {
  const f = await fixture(t, { ai: { ...aiOn, waFlowMode: 'off' } });
  f.aiReply.setKey(KEY);
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  assert.equal((await f.say('556499990000', '1')).handled, false, 'andamento is not answered with the menu off');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.say('556499990000', 'preciso de ajuda')).handled, true);
  assert.equal(f.calls.length, 1);
  const off = await fixture(t, { ai: { waFlowMode: 'off' } });
  off.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  assert.equal((await off.say('556499990000', 'preciso de ajuda')).handled, false, 'everything off: silent');
});

test('the inbox keeps messages for the chosen time (1, 7 or 30 days)', async t => {
  const f = await fixture(t);
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  await f.say('556499990000', 'oi');
  f.settings.save({ waInboxKeepDays: 1 });
  f.advance(25 * 3600000);
  assert.equal(f.inbox.purge(), 1);
  assert.throws(() => f.settings.save({ waInboxKeepDays: 3 }), /inválido/);
});
