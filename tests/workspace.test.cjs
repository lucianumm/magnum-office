const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Library } = require('../backend/library.cjs');
const { Imports } = require('../backend/imports.cjs');
const { extractEmails } = require('../backend/email-addresses.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { AgentAPI } = require('../backend/agent-api.cjs');
const { Backups, restoreBackup } = require('../backend/backups.cjs');
const base = path.resolve('work', 'workspace-tests');
fs.mkdirSync(base, { recursive: true });
async function setup(t) {
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const vault = new Vault(randomBytes(32)),
    store = new Store(root, vault);
  await store.migrate();
  const settings = new Settings(root),
    operations = new Operations(),
    library = new Library(store),
    imports = new Imports(store),
    messaging = new Messaging(store, settings, operations),
    api = new AgentAPI({ store, settings, operations, library, messaging });
  t.after(async () => {
    await api.stop();
    messaging.stop();
    try {
      store.close();
    } catch {
      /* already closed */
    }
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, settings, library, imports, messaging, api, operations, vault };
}
test('email extraction recognizes mixed text, brackets, punctuation, IDN and duplicates', () => {
  const p = extractEmails(
    'Ana <ANA@Example.com>; ana@example.COM\nmailto:b+news@example.org, / c@ação.com.br ; inválido@ ; .bad@example.org bad..x@example.org',
  );
  assert.deepEqual(p.emails, ['ANA@example.com', 'b+news@example.org', 'c@xn--ao-siap.com.br']);
  assert.equal(p.duplicates, 1);
  assert.equal(p.unrecognized, 3);
});
test('pasted campaign links existing contacts and blocks opt-out even without clientId', async t => {
  const { store, settings, messaging: m } = await setup(t);
  settings.save({ ownDomain: 'office.test', emailFrom: 'contact@office.test', emailDNSConfirmed: true });
  const c = store.save('clients', { phone: '5564999990000', name: 'Contato', email: 'yes@example.test' });
  m.campaign({ body: 'Teste', recipients: [{ email: 'yes@example.test' }, { email: 'new@example.test' }] });
  assert.equal(m.list().find(r => r.recipient === c.email).clientId, c.id);
  store.save('clients', {
    phone: '5564999990000',
    name: 'Bloqueado',
    email: 'no@example.test',
    emailPreference: 'Não receber',
  });
  assert.throws(() => m.campaign({ body: 'Teste', recipients: [{ email: 'no@example.test' }] }), /optou/);
  store.save('clients', {
    phone: '5564999990000',
    name: 'Novo bloqueio',
    email: 'new@example.test',
    emailPreference: 'Não receber',
  });
  m.configureEmail('re_test');
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'mock' }) });
  try {
    await m.process();
    await m.process();
  } finally {
    global.fetch = previousFetch;
  }
  assert.equal(m.list().find(r => r.recipient === 'new@example.test').status, 'cancelled');
});
test('template groups, sanitized rich models, imported text and encrypted backup survive recovery', async t => {
  const { root, store, library, settings, vault } = await setup(t);
  const group = library.saveGroup({ name: 'Constitutivos especiais' });
  const model = library.save({
    title: 'Modelo privado',
    groupId: group.id,
    body: 'Texto confidencial',
    html: '<p><b>Texto</b><script>evil()</script></p>',
  });
  assert.ok(model.html.includes('<b>Texto</b>'));
  assert.ok(!model.html.includes('script'));
  assert.throws(() => library.remove('group', group.id), /Mova/);
  const row = store.db.prepare('SELECT payload FROM templates WHERE id=?').get(model.id);
  assert.ok(!row.payload.includes(Buffer.from('Texto confidencial')));
  fs.writeFileSync(path.join(root, 'texto.txt'), 'Importado para edição');
  assert.equal((await library.readFile(path.join(root, 'texto.txt'))).body, 'Importado para edição');
  const backup = await new Backups(store, settings).create();
  library.remove('template', model.id);
  store.close();
  await restoreBackup(root, backup.id, vault);
  const reopened = new Store(root, vault);
  await reopened.migrate();
  assert.ok(new Library(reopened).list().some(m => m.title === 'Modelo privado'));
  reopened.close();
});
test('CSV contact preview handles quoted separators, duplicates and invalid rows without writing', async t => {
  const { root, store, imports } = await setup(t);
  const file = path.join(root, 'clientes.csv');
  fs.writeFileSync(
    file,
    'Nome;E-mail;WhatsApp;Observações\r\n"Ana; Maria";ana@example.test;64999990000;Texto\r\nRepetido;ANA@example.test;64999990001;\r\nInválido;sem-email;\r\n',
  );
  const f = await imports.read(file);
  const p = imports.preview({ id: f.id, kind: 'clients' });
  assert.equal(store.list('clients').length, 0);
  assert.equal(p.valid, 1);
  assert.equal(p.duplicates, 1);
  assert.equal(p.errors, 1);
  assert.throws(() => imports.commit({ id: f.id, rows: [4] }), /válidas/);
  assert.equal(imports.commit({ id: f.id, rows: [2] }).count, 1);
  assert.equal(store.list('clients')[0].name, 'Ana; Maria');
  assert.throws(() => imports.commit({ id: f.id, rows: [2] }), /Revise/);
});
test('XLSX agenda imports BR dates and real Excel dates, rejects invalid dates and duplicate times', async t => {
  const { root, store, imports } = await setup(t);
  const Excel = require('exceljs');
  const b = new Excel.Workbook(),
    s = b.addWorksheet('Agenda');
  s.addRows([
    ['Título', 'Data', 'Hora'],
    ['Audiência', '07/11/2026', '14:30'],
    ['Impossível', '31/02/2026', '09:00'],
    ['Audiência', '07/11/2026', '14:30'],
    ['Reunião', new Date('2026-11-08T00:00:00Z'), '10:00'],
  ]);
  s.getCell('B5').numFmt = 'dd/mm/yyyy';
  const file = path.join(root, 'agenda.xlsx');
  await b.xlsx.writeFile(file);
  const f = await imports.read(file);
  const p = imports.preview({ id: f.id, kind: 'tasks' });
  assert.equal(p.valid, 2);
  assert.equal(p.errors, 1);
  assert.equal(p.duplicates, 1);
  assert.equal(p.rows[0].value.due, '2026-11-07T14:30');
  assert.equal(p.rows[3].value.due, '2026-11-08T10:00');
  assert.equal(imports.commit({ id: f.id, rows: [2, 5] }).count, 2);
  assert.equal(store.list('tasks').length, 2);
});
test('agent REST and MCP enforce token, local origin, write permissions, rotation and review before sends', async t => {
  const { api, settings, operations, messaging } = await setup(t);
  await api.configure({ enabled: false, write: false, port: 47832 });
  await api.start();
  assert.equal(api.status().running, false);
  settings.internal({ agentEnabled: true });
  const net = require('node:net');
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  settings.internal({ agentPort: port });
  await api.start();
  const baseURL = 'http://127.0.0.1:' + port,
    token = api.token(),
    headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(baseURL + '/api/v1')).status, 401);
  assert.equal((await fetch(baseURL + '/api/v1', { headers: { ...headers, Origin: 'http://evil.test' } })).status, 401);
  assert.equal((await fetch(baseURL + '/api/v1', { headers })).status, 200);
  const call = (name, args) =>
    fetch(baseURL + '/api/v1/tools/' + name, { method: 'POST', headers, body: JSON.stringify(args) });
  assert.equal(
    (await call('save_record', { kind: 'clients', data: { name: 'Agente', phone: '5564999990000' } })).status,
    400,
  );
  settings.internal({ agentWrite: true });
  const saved = await (
    await call('save_record', { kind: 'clients', data: { name: 'Agente', phone: '5564999990000' } })
  ).json();
  assert.ok(saved.result.id);
  const task = await api.execute('save_record', { kind: 'tasks', data: { title: 'Visita', due: '2026-11-09T14:30' } });
  await api.execute('save_record', { kind: 'tasks', id: task.id, data: { notes: 'Alterado pelo agente' } });
  const draft = await api.execute('draft_message_schedule', {
    channel: 'whatsapp',
    recipient: '5564999999999',
    body: 'Revisar antes de enviar',
  });
  assert.equal(draft.status, 'needs_review');
  assert.equal(messaging.list()[0].status, 'needs_review');
  await api.execute('revise_message_schedule', {
    id: draft.id,
    channel: 'whatsapp',
    recipient: '5564999999999',
    body: 'Conteúdo revisado pelo agente',
    scheduledFor: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(messaging.list()[0].status, 'needs_review');
  assert.equal(messaging.list()[0].body, 'Conteúdo revisado pelo agente');
  operations.maintenance = true;
  await assert.rejects(api.execute('save_record', { kind: 'notes', data: { title: 'Bloqueado' } }), /manutenção/);
  operations.maintenance = false;
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseURL + '/mcp'), { requestInit: { headers } }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some(t => t.name === 'save_record'));
  const response = await client.callTool({
    name: 'save_record',
    arguments: { kind: 'notes', data: { title: 'Anotação MCP', content: 'Teste sem rede externa' } },
  });
  assert.ok(!response.isError);
  await client.close();
  await api.configure({ enabled: true, write: true, port, rotate: true });
  assert.notEqual(api.token(), token);
  assert.equal((await fetch(baseURL + '/api/v1', { headers })).status, 401);
  await api.configure({ enabled: false, write: false, port });
  assert.equal(api.status().running, false);
});

test('message templates have separate channels, subjects, editing and deletion with no count cap', async t => {
  const { library } = await setup(t);
  const group = library.groups()[0];
  const seeded = library.list().length;
  /* starting legal templates */ for (let i = 0; i < 110; i++)
    library.save({
      kind: i % 2 ? 'whatsapp' : 'email',
      groupId: group.id,
      title: 'Modelo ' + i,
      body: 'Conteúdo reutilizável',
      html: '<b>Formatado</b>',
      subject: 'Assunto salvo',
    });
  assert.equal(library.list().length, seeded + 110);
  const email = library.list().find(m => m.kind === 'email');
  const updated = library.save({ ...email, title: 'Editado', body: 'Novo texto' });
  assert.equal(updated.subject, 'Assunto salvo');
  assert.ok(
    library
      .list()
      .filter(m => m.kind === 'whatsapp')
      .every(m => m.html === ''),
  );
  library.remove('template', email.id);
  assert.equal(library.list().length, seeded + 109);
});
