const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Library } = require('../backend/library.cjs');
const { Documents } = require('../backend/documents.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Intakes } = require('../backend/intakes.cjs');
const { DocumentIndex } = require('../backend/document-index.cjs');
const { DocumentGenerator } = require('../backend/document-generator.cjs');
const { Indices } = require('../backend/indices.cjs');
const { DataJud } = require('../backend/datajud.cjs');
const { DJEN } = require('../backend/djen.cjs');
const { AgentAPI } = require('../backend/agent-api.cjs');
const { docx, pdf } = require('../backend/document-files.cjs');
const { htmlBlocks } = require('../app/document-template.mjs');
const { clientReport, explainMovement } = require('../app/client-report.mjs');
const { officeReport, monthKeys } = require('../app/reports.mjs');
const courts = require('../app/courts.json').courts;

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'intake-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  const operations = new Operations();
  const messaging = new Messaging(store, settings, operations);
  t.after(() => {
    messaging.stop();
    store.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, settings, operations, messaging, documents: new Documents(store) };
}

test('an intake becomes a client and a pre-litigation case in one step, or nothing at all', async t => {
  const { store } = await fixture(t);
  assert.throws(() => store.save('intakes', { name: 'Ana', date: '' }), /data do atendimento/);
  assert.throws(() => store.save('intakes', { name: 'Ana', date: '2026-11-07', followUp: '2026-02-30' }), /retorno/);
  const intake = store.save('intakes', {
    name: 'Ana Souza',
    phone: '64999990000',
    email: 'ana@example.test',
    subject: 'Cobrança indevida do banco\nDetalhes',
    area: 'Consumidor',
    source: 'Indicação',
    date: '2026-11-07',
  });
  assert.equal(intake.status, 'Novo');
  const intakes = new Intakes({ store });
  const result = intakes.convert(intake.id);
  assert.equal(result.client.phone, '5564999990000');
  assert.match(result.client.notes, /Primeiro atendimento: Cobrança indevida/);
  assert.deepEqual(
    [result.case.title, result.case.area, result.case.phase, result.case.clientId],
    ['Cobrança indevida do banco', 'Consumidor', 'Pré-processual', result.client.id],
  );
  const updated = store.get('intakes', intake.id);
  assert.deepEqual(
    [updated.status, updated.convertedClientId, updated.convertedCaseId],
    ['Contratado', result.client.id, result.case.id],
  );
  assert.throws(() => intakes.convert(intake.id), /já virou cliente/);
  // Without a valid WhatsApp number the client cannot be created, and nothing is half-done.
  const noPhone = store.save('intakes', { name: 'Bruno', phone: '12', date: '2026-11-07' });
  assert.throws(() => intakes.convert(noPhone.id), /WhatsApp/);
  assert.equal(store.list('clients').length, 1);
  assert.equal(store.get('intakes', noPhone.id).status, 'Novo');
});

test('documents are indexed in a worker and found by words, ignoring accents', async t => {
  const { store, documents } = await fixture(t);
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento' });
  const txt = await documents.save(
    'anotacoes.txt',
    Buffer.from('Reunião sobre a cláusula penal do contrato de locação.'),
    { caseId: caseItem.id },
  );
  const word = await documents.save(
    'peticao.docx',
    docx(htmlBlocks('<p>Requer a <strong>tutela de urgência</strong> para suspensão da cobrança.</p>')),
  );
  const text = await documents.save(
    'decisao.pdf',
    await pdf(htmlBlocks('<p>Defiro a tutela de urgência requerida pela autora.</p>')),
  );
  const { PDFDocument, rgb } = require('pdf-lib');
  const image = await PDFDocument.create();
  image.addPage().drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0, 0, 0) });
  const scanned = await documents.save('digitalizado.pdf', Buffer.from(await image.save()));
  await documents.save('foto.png', Buffer.from('not really a png'));
  const index = new DocumentIndex({ store, documents });
  assert.equal(index.pending().length, 5);
  assert.equal(await index.indexPending(), 5);
  assert.deepEqual(index.status(), { ok: 3, empty: 1, skipped: 1, pending: 0 });
  const found = index.search('TUTELA urgencia');
  assert.deepEqual(found.map(f => f.name).sort(), ['decisao.pdf', 'peticao.docx']);
  assert.match(found.find(f => f.name === 'peticao.docx').snippet, /tutela de urgência/);
  const one = index.search('clausula locacao');
  assert.deepEqual(
    one.map(f => [f.id, f.caseId]),
    [[txt.id, caseItem.id]],
  );
  assert.deepEqual(index.search('ab'), [], 'short queries are ignored');
  assert.equal(index.search('inexistente').length, 0);
  store.remove('documents', text.id);
  assert.deepEqual(index.search('defiro'), []);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM document_text WHERE document_id=?').get(text.id).n, 0);
  void word;
  void scanned;
});

test('client report is plain language and leaves internal deadlines out', () => {
  assert.equal(explainMovement('Conclusão para despacho'), 'o processo foi enviado ao juiz para decidir');
  assert.equal(explainMovement('Trânsito em julgado'), 'a decisão ficou definitiva e não cabe mais recurso');
  assert.equal(explainMovement('Algo raro'), '');
  const text = clientReport({
    caseItem: {
      title: 'Indenização',
      number: '0000001-63.2024.8.09.0051',
      status: 'Em andamento',
      phase: 'Conhecimento',
    },
    client: { name: 'Ana Souza' },
    movements: [
      { date: '2026-10-01T10:00:00.000Z', name: 'Juntada de Petição' },
      { date: '2026-10-20T10:00:00.000Z', name: 'Conclusão' },
    ],
    tasks: [
      { title: 'Audiência de conciliação', type: 'Audiência', due: '2026-12-01T14:00', status: 'Pendente' },
      { title: 'Prazo para réplica', type: 'Prazo', due: '2026-11-20T23:59', status: 'Pendente' },
      { title: 'Audiência antiga', type: 'Audiência', due: '2026-01-01T14:00', status: 'Pendente' },
    ],
    settings: { officeName: 'Escritório Exemplo' },
    now: new Date(2026, 10, 7),
  });
  assert.match(text, /^Olá, Ana! Segue um resumo do seu processo “Indenização” \(nº 0000001-63\.2024\.8\.09\.0051\)\./);
  assert.match(text, /Situação: Em andamento, fase de conhecimento\./);
  assert.ok(
    text.indexOf('20/10/2026: Conclusão (o processo foi enviado ao juiz para decidir)') <
      text.indexOf('01/10/2026: Juntada de Petição'),
    'newest first',
  );
  assert.match(text, /01\/12\/2026 às 14:00: Audiência de conciliação/);
  assert.doesNotMatch(text, /réplica|antiga/);
  assert.match(text, /Escritório Exemplo$/);
});

test('office report counts cases, deadlines, intakes and money for the period', () => {
  assert.deepEqual(monthKeys('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  const entities = {
    clients: [{ createdAt: '2026-11-02T10:00:00Z' }, { createdAt: '2026-09-02T10:00:00Z' }],
    cases: [
      { status: 'Em andamento', area: 'Cível', phase: 'Conhecimento', createdAt: '2026-11-03T10:00:00Z' },
      { status: 'Aguardando', area: 'Cível', phase: '', createdAt: '2026-08-03T10:00:00Z' },
      { status: 'Arquivado', area: 'Trabalhista', createdAt: '2025-01-01T10:00:00Z' },
    ],
    tasks: [
      { type: 'Prazo', due: '2026-11-02T23:59', status: 'Concluída' },
      { type: 'Prazo', due: '2026-11-04T23:59', status: 'Pendente' },
      { type: 'Prazo', due: '2026-11-20T23:59', status: 'Pendente' },
      { type: 'Audiência', due: '2026-11-10T14:00', status: 'Pendente' },
    ],
    finance: [
      { direction: 'Receita', amount: '1500.00', dueDate: '2026-11-01', paidDate: '2026-11-03' },
      { direction: 'Receita', amount: '700.00', dueDate: '2026-10-10', paidDate: '' },
      { direction: 'Despesa', amount: '120.50', dueDate: '2026-11-05', paidDate: '2026-11-05' },
    ],
    intakes: [
      { date: '2026-11-01', status: 'Contratado', source: 'Indicação' },
      { date: '2026-11-02', status: 'Não contratado', source: 'Site' },
      { date: '2026-11-03', status: 'Novo', source: 'Indicação' },
    ],
  };
  const r = officeReport({ entities, today: '2026-11-07', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.cases.active, 2);
  assert.deepEqual(r.cases.byArea, [['Cível', 2]]);
  assert.deepEqual(r.cases.byPhase, [
    ['Conhecimento', 1],
    ['Não informado', 1],
  ]);
  assert.deepEqual([r.newClients, r.newCases], [1, 1]);
  assert.deepEqual(r.deadlines, { inPeriod: 3, concluded: 1, missed: 1, overdueNow: 1, next7: 1 });
  assert.deepEqual([r.intakes.total, r.intakes.converted, r.intakes.conversion], [3, 1, 50]);
  assert.deepEqual(r.intakes.bySource, [
    ['Indicação', 2],
    ['Site', 1],
  ]);
  assert.deepEqual(r.money, { received: '1500.00', expenses: '120.50', overdue: '700.00' });
  assert.equal(r.months.length, 12);
  assert.deepEqual(r.months.at(-1), {
    month: '2026-11',
    newClients: 1,
    newCases: 1,
    received: '1500.00',
    expenses: '120.50',
  });
});

test('new MCP tools are read-only and answer with the office data', async t => {
  const f = await fixture(t);
  f.settings.save({ lawyers: [{ name: 'Marina Exemplo', oab: '12345', uf: 'GO' }], officeCity: 'Goiânia/GO' });
  fs.writeFileSync(
    path.join(f.root, 'indices.json'),
    JSON.stringify({ updatedAt: '2026-11-07', series: { TAXA_LEGAL: { '2024-08': 0.605306 } } }),
  );
  const library = new Library(f.store);
  const generator = new DocumentGenerator({
    store: f.store,
    library,
    settings: f.settings,
    documents: f.documents,
    courts,
  });
  const api = new AgentAPI({
    store: f.store,
    settings: f.settings,
    operations: f.operations,
    library,
    messaging: f.messaging,
    datajud: new DataJud({ store: f.store, settings: f.settings, fetch: null }),
    djen: new DJEN({ store: f.store, settings: f.settings, fetch: null }),
    indices: new Indices({ root: f.root }),
    generator,
    courts,
  });
  assert.ok(!f.settings.get().agentWrite, 'write permission stays off');
  const client = f.store.save('clients', { name: 'Ana Souza', phone: '5564999990000' });
  const caseItem = f.store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id });
  f.store.save('tasks', { title: 'Contestação', type: 'Prazo', due: '2026-11-20T23:59', caseId: caseItem.id });
  f.store.save('finance', {
    direction: 'Receita',
    category: 'Honorário contratual',
    description: 'Honorários',
    amount: '1000',
    dueDate: '2026-11-10',
    caseId: caseItem.id,
  });
  const summary = await api.execute('get_case_summary', { caseId: caseItem.id });
  assert.equal(summary.client.name, 'Ana Souza');
  assert.deepEqual(
    summary.pendingTasks.map(x => x.title),
    ['Contestação'],
  );
  assert.equal(summary.finance.entries, 1);
  assert.equal((await api.execute('list_deadlines', { from: '2026-11-01', to: '2026-11-30' })).total, 1);
  assert.equal((await api.execute('calculate_deadline', { start: '2026-03-02', days: 15 })).end, '2026-03-23');
  assert.equal(
    (
      await api.execute('calculate_debt', {
        principal: '1000',
        start: '2024-08-30',
        end: '2024-08-31',
        correction: 'none',
        interest: 'legal',
      })
    ).total,
    1000.2,
  );
  const procuracao = library.list().find(x => x.title.startsWith('Procuração'));
  const preview = await api.execute('preview_document', { templateId: procuracao.id, caseId: caseItem.id });
  assert.equal(preview.draft, true);
  assert.match(preview.text, /OUTORGANTE: ANA SOUZA/);
  assert.equal(f.store.list('documents').length, 0, 'preview does not save files');
  assert.deepEqual((await api.execute('list_movements', { caseId: caseItem.id })).movements, []);
  assert.equal((await api.execute('list_intimations', {})).total, 0);
  assert.equal((await api.execute('list_records', { kind: 'intakes' })).total, 0);
  const severance = await api.execute('calculate_severance', {
    admission: '2022-03-10',
    termination: '2025-08-20',
    salary: '3.000,00',
    vestedPeriods: 1,
    fgtsBalance: '9.000,00',
  });
  assert.equal(severance.totals.total, 1899613, 'same hand-checked case as tests/labor.test.cjs');
  const typed = await api.execute('preview_document', {
    templateId: procuracao.id,
    values: { 'cliente.nome': 'Bruno Avulso' },
  });
  assert.match(typed.text, /Bruno Avulso/);
  const catalog = api.tools().map(x => x.name);
  for (const name of [
    'get_case_summary',
    'list_deadlines',
    'calculate_deadline',
    'calculate_debt',
    'preview_document',
    'list_movements',
    'list_intimations',
    'calculate_severance',
    'lookup_case',
    'lookup_cnpj',
  ])
    assert.ok(catalog.includes(name), name);
});
