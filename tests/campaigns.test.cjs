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
const { Campaigns } = require('../backend/campaigns.cjs');
const rules = require('../app/campaign-rules.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
// 2026-11-12 10:00, a Thursday.
const NOW = new Date(2026, 10, 12, 10, 0).getTime();
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'camp-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  settings.internal({ termsAcceptedVersion: require('../app/terms.json').version });
  settings.save({ officeName: 'Escritório Exemplo' });
  const library = new Library(store);
  const messaging = new Messaging(store, settings, new Operations());
  messaging.skipSendRules = true;
  let now = NOW;
  const campaigns = new Campaigns({ store, settings, library, messaging, clock: () => now });
  messaging.campaigns = campaigns;
  t.after(() => {
    messaging.stop();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, settings, library, messaging, campaigns, setNow: v => (now = v) };
}
const d = (y, m, day, h = 0, min = 0) => new Date(y, m - 1, day, h, min);
const keys = list => list.map(rules.dayKey).join(' ');
const base2 = (over = {}) => ({
  name: 'Campanha',
  body: 'Olá, {primeiro_nome}! Aqui é do {escritorio}.',
  trigger: { type: 'dates', dates: ['2026-11-20'], time: '09:00' },
  segment: { mode: 'all' },
  ...over,
});

test('dates: yearly on 29/02, monthly on the 31st, moving holidays and weekdays', () => {
  const from = d(2026, 1, 1),
    to = d(2029, 12, 31);
  assert.equal(
    keys(rules.occurrences({ type: 'yearly', month: 2, day: 29 }, from, to)),
    '2026-02-28 2027-02-28 2028-02-29 2029-02-28',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'recurring', start: '2026-01-31', every: 'monthly', count: 5 }, from, to)),
    '2026-01-31 2026-02-28 2026-03-31 2026-04-30 2026-05-31',
    'the 31st comes back after a short month',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'calendar', key: 'easter' }, from, d(2028, 12, 31))),
    '2026-04-05 2027-03-28 2028-04-16',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'calendar', key: 'mothers' }, from, d(2027, 12, 31))),
    '2026-05-10 2027-05-09',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'recurring', start: '2026-11-14', every: 'weekdays', count: 4 }, from, to)),
    '2026-11-16 2026-11-17 2026-11-18 2026-11-19',
    'a Saturday start begins on Monday',
  );
  assert.equal(
    keys(
      rules.occurrences({ type: 'recurring', start: '2026-11-02', every: 'quarterly', until: '2027-06-30' }, from, to),
    ),
    '2026-11-02 2027-02-02 2027-05-02',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'recurring', start: '2026-11-02', every: 'biweekly', count: 3 }, from, to)),
    '2026-11-02 2026-11-16 2026-11-30',
  );
  assert.equal(
    keys(rules.occurrences({ type: 'dates', dates: ['2026-12-24', '2026-11-20', '2025-01-01'] }, d(2026, 11, 1), to)),
    '2026-11-20 2026-12-24',
  );
});

test('client dates: birthday every year, and the anniversary of the register only from the next year', () => {
  const from = d(2026, 11, 1),
    to = d(2027, 12, 31);
  assert.equal(
    keys(rules.clientOccurrences({ type: 'client-birthday' }, { birthDate: '2000-12-20' }, from, to)),
    '2026-12-20 2027-12-20',
  );
  assert.equal(keys(rules.clientOccurrences({ type: 'client-birthday' }, {}, from, to)), '');
  const since = { createdAt: '2026-11-10T12:00:00.000Z' };
  assert.equal(
    keys(rules.clientOccurrences({ type: 'client-since' }, since, from, d(2028, 12, 31))),
    '2027-11-10 2028-11-10',
  );
});

test('audience: by area, tag, phase, case or hand-picked list; inactive clients never', () => {
  const ana = { id: 'a', status: 'Ativo' },
    bia = { id: 'b', status: 'Ativo' },
    cid = { id: 'c', status: 'Inativo' };
  const cases = [
    { id: 'k1', clientId: 'a', area: 'Trabalhista', phase: 'Conhecimento', tags: 'urgente, idoso' },
    { id: 'k2', clientId: 'b', area: 'Família', phase: 'Execução', tags: '' },
    { id: 'k3', clientId: 'c', area: 'Trabalhista', phase: '', tags: '' },
  ];
  const who = segment =>
    [ana, bia, cid]
      .filter(c => rules.inSegment(c, cases, segment))
      .map(c => c.id)
      .join('');
  assert.equal(who({ mode: 'all' }), 'ab');
  assert.equal(who({ mode: 'area', values: ['Trabalhista'] }), 'a', 'the inactive client is left out');
  assert.equal(who({ mode: 'tag', values: ['IDOSO'] }), 'a');
  assert.equal(who({ mode: 'phase', values: ['Execução'] }), 'b');
  assert.equal(who({ mode: 'cases', values: ['k2'] }), 'b');
  assert.equal(who({ mode: 'clients', values: ['a', 'b', 'c'] }), 'ab');
  assert.ok(['SAIR', ' sair. ', 'Parar!', 'Não', 'stop'].map(rules.isStopReply).join() === 'true,true,true,false,true');
});

test('a campaign validates what it needs and refuses typos in variables', async t => {
  const f = await fixture(t);
  assert.throws(() => f.campaigns.save(base2({ name: '' })), /nome/);
  assert.throws(() => f.campaigns.save(base2({ body: 'Oi {nome_cliente}' })), /Variável desconhecida/);
  assert.throws(
    () => f.campaigns.save(base2({ trigger: { type: 'recurring', every: 'weekly', start: '2026-11-20' } })),
    /até quando/,
  );
  assert.throws(() => f.campaigns.save(base2({ trigger: { type: 'dates', dates: ['2026-13-40'] } })), /datas válidas/);
  assert.throws(
    () => f.campaigns.save(base2({ trigger: { type: 'finance-overdue', afterDays: 3, max: 5 } })),
    /no máximo 2/,
  );
  assert.throws(() => f.campaigns.save(base2({ segment: { mode: 'area', values: [] } })), /Escolha quem/);
  assert.equal(f.campaigns.save(base2()).status, 'draft', 'starts as a draft');
});

test('activating queues one message per client and date, never twice, and respects opt-out', async t => {
  const f = await fixture(t);
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  f.store.save('clients', { name: 'Bia Lima', phone: '5511988887777', status: 'Ativo' });
  const out = f.store.save('clients', {
    name: 'Caio Dias',
    phone: '5521977776666',
    status: 'Ativo',
    campaignOptOut: true,
  });
  f.store.save('clients', { name: 'Davi Inativo', phone: '5531966665555', status: 'Inativo' });
  const campaign = f.campaigns.save(base2());
  const preview = f.campaigns.preview(base2());
  assert.deepEqual([preview.total, preview.reachable, preview.optedOut], [3, 2, 1]);
  assert.match(preview.sample, /^Olá, \w+! Aqui é do Escritório Exemplo\.$/);
  assert.equal(f.messaging.list().length, 0, 'a draft and a preview queue nothing');
  f.campaigns.setStatus(campaign.id, 'active');
  const queued = f.messaging.list();
  assert.equal(queued.length, 2);
  assert.ok(queued.every(m => m.campaignId === campaign.id && m.scheduledFor === d(2026, 11, 20, 9).toISOString()));
  assert.ok(!queued.some(m => m.clientId === out.id));
  f.campaigns.tick(true);
  f.campaigns.tick(true);
  assert.equal(f.messaging.list().length, 2, 'planning again does not duplicate');
  // Editing the text updates what is waiting instead of queueing more.
  f.campaigns.save(base2({ id: campaign.id, body: 'Novo texto para {primeiro_nome}' }));
  const edited = f.messaging.list();
  assert.equal(edited.length, 2);
  assert.deepEqual(edited.map(m => m.body).sort(), ['Novo texto para Ana', 'Novo texto para Bia']);
  // The calendar lists them by date.
  assert.equal(f.campaigns.calendar().length, 2);
});

test('pausing cancels what is waiting; a client who answers SAIR stops getting campaigns', async t => {
  const f = await fixture(t);
  const ana = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  f.store.save('clients', { name: 'Bia Lima', phone: '5511988887777', status: 'Ativo' });
  const campaign = f.campaigns.save(base2());
  f.campaigns.setStatus(campaign.id, 'active');
  assert.equal(f.messaging.list().filter(m => m.status === 'pending').length, 2);
  assert.equal(f.campaigns.handleReply({ clientId: ana.id, text: ' Sair ' }), true);
  assert.equal(f.store.get('clients', ana.id).campaignOptOut, true);
  const after = f.messaging.list();
  const mine = after.filter(m => m.campaignId);
  assert.equal(mine.filter(m => m.clientId === ana.id)[0].status, 'cancelled');
  assert.equal(mine.filter(m => m.status === 'pending').length, 1);
  assert.ok(
    after.some(m => !m.campaignId && /não receberá mais/.test(m.body)),
    'the client gets a short confirmation',
  );
  assert.equal(f.campaigns.handleReply({ clientId: ana.id, text: 'Olá' }), false);
  f.campaigns.tick(true);
  assert.equal(f.messaging.list().filter(m => m.campaignId && m.status === 'pending').length, 1, 'not planned again');
  f.campaigns.setStatus(campaign.id, 'paused');
  assert.equal(f.messaging.list().filter(m => m.campaignId && m.status === 'pending').length, 0);
  // A message that was waiting is checked again at send time.
  assert.equal(f.campaigns.prepare({ campaignId: campaign.id, clientId: ana.id }), null);
  assert.deepEqual(f.campaigns.prepare({ x: 1 }), { x: 1 }, 'ordinary messages are untouched');
});

test('relative to an event and system events: a reminder before a hearing, welcome and gentle billing', async t => {
  const f = await fixture(t);
  const ana = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  const caseItem = f.store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: ana.id });
  f.store.save('tasks', { title: 'Audiência', type: 'Audiência', due: '2026-11-25T14:00', caseId: caseItem.id });
  f.store.save('tasks', { title: 'Perícia', type: 'Perícia', due: '2026-11-26T14:00', caseId: caseItem.id });
  const before = f.campaigns.save(
    base2({
      body: 'Sua {evento} é dia {data}, às {hora}.',
      trigger: { type: 'before-event', eventType: 'Audiência', days: 3, time: '10:30' },
    }),
  );
  f.campaigns.setStatus(before.id, 'active');
  let [m] = f.messaging.list();
  assert.equal(f.messaging.list().length, 1, 'only the hearing, not the expert exam');
  assert.equal(m.body, 'Sua audiência é dia 25/11/2026, às 14:00.');
  assert.equal(m.scheduledFor, d(2026, 11, 22, 10, 30).toISOString());
  // The hearing moves: the waiting message follows it and is not duplicated.
  const task = f.store.list('tasks').find(x => x.type === 'Audiência');
  const { id, createdAt, updatedAt, ...rest } = task;
  void createdAt;
  void updatedAt;
  f.store.put('tasks', id, { ...rest, due: '2026-11-27T09:00' });
  f.campaigns.tick(true);
  const moved = f.messaging.list();
  assert.equal(moved.filter(x => x.status === 'pending').length, 1);
  assert.equal(moved.find(x => x.status === 'pending').body, 'Sua audiência é dia 27/11/2026, às 09:00.');
  // Gentle billing: at most two reminders, a week apart, only while unpaid.
  f.store.save('finance', {
    description: 'Honorários',
    direction: 'Receita',
    category: 'Honorários',
    amount: '1000',
    dueDate: '2026-11-05',
    clientId: ana.id,
  });
  const bill = f.campaigns.save(
    base2({
      name: 'Cobrança',
      body: 'Valor {valor}, vencido em {vencimento}.',
      trigger: { type: 'finance-overdue', afterDays: 3, max: 2, time: '09:00' },
    }),
  );
  f.campaigns.setStatus(bill.id, 'active');
  const bills = f.messaging.list().filter(x => x.campaignId === bill.id);
  assert.equal(bills.length, 1, 'the first notice (08/11) is in the past; the second (15/11) is ahead');
  assert.match(bills[0].body, /^Valor R\$\s1\.000,00, vencido em 05\/11\/2026\.$/);
  assert.equal(bills[0].scheduledFor, d(2026, 11, 15, 9).toISOString());
  // Welcome for a case registered today.
  const welcome = f.campaigns.save(
    base2({
      name: 'Boas-vindas',
      body: 'Bem-vinda, {primeiro_nome}{processo_ref}!',
      trigger: { type: 'case-created', delayDays: 0, time: '23:00' },
    }),
  );
  f.campaigns.setStatus(welcome.id, 'active');
  assert.ok(f.messaging.list().some(x => x.campaignId === welcome.id && x.body === 'Bem-vinda, Ana!'));
  void m;
});

test('a sample goes to the typed number only and is marked as a sample', async t => {
  const f = await fixture(t);
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  f.campaigns.sendSample(base2(), '(62) 99999-1234');
  const [m] = f.messaging.list();
  assert.equal(m.recipient, '5562999991234');
  assert.match(m.body, /^\[AMOSTRA\]\nOlá, Ana!/);
  assert.equal(m.campaignId, undefined);
  assert.throws(() => f.campaigns.sendSample(base2(), 'abc'), /WhatsApp/);
});

test('client birthday: clients with the automatic birthday on in their record are not repeated', async t => {
  const f = await fixture(t);
  const model = f.library.save({
    kind: 'whatsapp',
    purpose: 'birthday',
    groupId: f.library.groups()[0].id,
    title: 'Aniversário',
    body: 'Feliz aniversário, {1}!',
  });
  f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo', birthDate: '1990-11-20' });
  f.store.save('clients', {
    name: 'Bia Lima',
    phone: '5511988887777',
    status: 'Ativo',
    birthDate: '1985-11-21',
    birthdayEnabled: true,
    birthdayTemplateId: model.id,
  });
  const campaign = f.campaigns.save(base2({ trigger: { type: 'client-birthday', time: '09:00' } }));
  f.campaigns.setStatus(campaign.id, 'active');
  const queued = f.messaging.list().filter(m => m.campaignId === campaign.id);
  assert.deepEqual(
    queued.map(m => m.body),
    ['Olá, Ana! Aqui é do Escritório Exemplo.'],
  );
});
