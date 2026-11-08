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
const { DocumentGenerator } = require('../backend/document-generator.cjs');
const { docx, pdf, textWidth } = require('../backend/document-files.cjs');
const { reaisInWords, moneyWithWords, parseMoney } = require('../app/money.mjs');
const { htmlBlocks, fillBlocks, templateQuestions, blocksText, documentContext } = require('../app/document-template.mjs');
const { findConflicts, normalizeName } = require('../app/conflicts.mjs');
const courts = require('../app/courts.json').courts;

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'docs-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault);
  await store.migrate();
  const settings = new Settings(root);
  t.after(() => {
    try { store.close(); } catch { /* closed by the test */ }
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store, settings };
}

test('amounts in reais are written out in words', () => {
  const cases = [
    [1, 'um real'],
    [21, 'vinte e um reais'],
    [100, 'cem reais'],
    [101, 'cento e um reais'],
    [1500, 'mil e quinhentos reais'],
    [2100, 'dois mil e cem reais'],
    [1234.56, 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos'],
    [0.5, 'cinquenta centavos'],
    [0.01, 'um centavo'],
    [2000000, 'dois milhões de reais'],
    [1000100, 'um milhão e cem reais'],
    [15000.5, 'quinze mil reais e cinquenta centavos'],
  ];
  for (const [value, words] of cases) assert.equal(reaisInWords(value), words, String(value));
  assert.equal(moneyWithWords('1500.00'), 'R$ 1.500,00 (mil e quinhentos reais)');
  assert.equal(parseMoney('R$ 2.000,10'), '2000.10');
  assert.equal(parseMoney('abc'), null);
});

test('rich template HTML keeps paragraphs, alignment and bold, and fills variables and questions', () => {
  const html =
    '<h1>PROCURAÇÃO</h1><p><strong>OUTORGANTE:</strong> {cliente.nome}, &amp; {processo.numero}</p>' +
    '<p style="text-align: center">{escritorio.cidade}, {data.extenso}.</p><div><br></div><p>Valor: {?Valor:moeda} – {?Referente a}</p>';
  const blocks = htmlBlocks(html);
  assert.equal(blocks.length, 5);
  assert.deepEqual([blocks[0].align, blocks[0].heading, blocks[0].runs[0].bold], ['center', true, true]);
  assert.deepEqual(blocks[1].runs.map(r => [r.text, r.bold]), [['OUTORGANTE:', true], [' {cliente.nome}, & {processo.numero}', false]]);
  assert.equal(blocks[2].align, 'center');
  assert.equal(blocksText([blocks[3]]), '', 'empty line kept');
  assert.deepEqual(templateQuestions(blocks).map(q => [q.label, q.type]), [['Valor', 'money'], ['Referente a', 'text']]);
  const values = documentContext({
    client: { name: 'Ana Souza' },
    caseItem: { number: '0000001-63.2024.8.09.0051' },
    settings: { officeCity: 'Goiânia' },
    courts,
    now: new Date(2026, 10, 7),
  });
  const filled = fillBlocks(blocks, values, { 'Valor:moeda': '1.500,00' });
  assert.equal(blocksText([filled.blocks[1]]), 'OUTORGANTE: Ana Souza, & 0000001-63.2024.8.09.0051');
  assert.equal(blocksText([filled.blocks[2]]), 'Goiânia, 7 de novembro de 2026.');
  assert.equal(blocksText([filled.blocks[4]]), 'Valor: R$ 1.500,00 (mil e quinhentos reais) – __________');
  assert.deepEqual(filled.missing, ['Referente a']);
  assert.deepEqual(fillBlocks(blocks, values, { 'Valor:moeda': 'mil' }).invalid, ['Valor']);
  assert.equal(values['processo.tribunal'], courts.find(c => c.id === 'tjgo').name);
});

test('DOCX opens in a Word reader and PDF is a valid A4 document', async () => {
  const blocks = htmlBlocks('<h1>TÍTULO</h1><p>Primeiro <strong>parágrafo</strong> com acentuação: ação, “aspas” e § 1º.</p><p>' + 'Texto longo. '.repeat(400) + '</p><p>Símbolo fora do padrão: ✓</p>');
  const word = docx(blocks, { title: 'Teste', author: 'Escritório' });
  const text = (await require('mammoth').extractRawText({ buffer: word })).value;
  assert.match(text, /TÍTULO/);
  assert.match(text, /Primeiro parágrafo com acentuação: ação, “aspas” e § 1º\./);
  const { PDFDocument } = require('pdf-lib');
  const file = await PDFDocument.load(await pdf(blocks, { title: 'Teste' }));
  assert.ok(file.getPageCount() >= 2, 'long text continues on a new page');
  assert.deepEqual(file.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  assert.equal(file.getTitle(), 'Teste');
  // Words are drawn without kerning, so they must be measured without it ("CONTRATANTE:ANA" bug).
  const { StandardFonts } = require('pdf-lib');
  const bold = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRomanBold);
  assert.ok(textWidth(bold, 'CONTRATANTE:', 12) > bold.widthOfTextAtSize('CONTRATANTE:', 12));
  assert.equal(Math.round(textWidth(bold, 'CONTRATANTE:', 12) * 1000), 97332, 'Adobe Times-Bold metrics');
});

test('starting legal templates are added once, generate DOCX and PDF into the case, and missing data is listed', async t => {
  const { store, settings } = await fixture(t);
  settings.save({ officeName: 'Escritório Exemplo', officeCity: 'Goiânia', officeAddress: 'Rua 1, nº 10, Centro, Goiânia/GO', lawyers: [{ name: 'Marina Exemplo', oab: '12345', uf: 'GO' }, { name: 'João Lima', oab: '6789', uf: 'GO' }] });
  const library = new Library(store);
  const legal = library.list().filter(x => x.kind === 'document');
  assert.equal(legal.length, 5);
  const procuracao = legal.find(x => x.title.startsWith('Procuração'));
  library.remove('template', procuracao.id);
  assert.equal(new Library(store).list().filter(x => x.kind === 'document').length, 4, 'deleted templates do not come back');
  const contract = legal.find(x => x.title.startsWith('Contrato'));
  const client = store.save('clients', { name: 'Ana Souza', phone: '5564999990000', document: '52998224725', nationality: 'brasileira', maritalStatus: 'casada', profession: 'professora', rg: '123', city: 'Goiânia', state: 'GO', street: 'Rua 2', addressNumber: '5' });
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', clientId: client.id, number: '00000016320248090051' });
  const generator = new DocumentGenerator({ store, library, settings, documents: new Documents(store), courts });
  const preview = generator.preview({ templateId: contract.id, caseId: caseItem.id });
  assert.deepEqual(preview.questions.map(q => q.label), ['Objeto do contrato (serviço a ser prestado)', 'Valor dos honorários', 'Forma de pagamento']);
  assert.deepEqual(preview.missing, preview.questions.map(q => q.label));
  const text = blocksText(preview.blocks);
  assert.match(text, /CONTRATANTE: ANA SOUZA, brasileira, casada, professora/);
  assert.match(text, /MARINA EXEMPLO, advogado\(a\) inscrito\(a\) na OAB\/GO nº 12\.345 e JOÃO LIMA, advogado\(a\) inscrito\(a\) na OAB\/GO nº 6\.789/);
  const onlySecond = blocksText(generator.preview({ templateId: contract.id, caseId: caseItem.id, lawyers: [1] }).blocks);
  assert.doesNotMatch(onlySecond, /MARINA/);
  await assert.rejects(generator.generate({ templateId: contract.id, caseId: caseItem.id, formats: ['docx'], answers: { 'Valor dos honorários:moeda': 'dez' } }), /Valor inválido/);
  await assert.rejects(generator.generate({ templateId: contract.id, caseId: caseItem.id, formats: ['exe'] }), /DOCX/);
  const saved = await generator.generate({
    templateId: contract.id,
    caseId: caseItem.id,
    formats: ['docx', 'pdf'],
    answers: { 'Objeto do contrato (serviço a ser prestado)': 'ação de indenização', 'Valor dos honorários:moeda': '3.000', 'Forma de pagamento': 'à vista' },
  });
  assert.deepEqual(saved.map(d => [d.name, d.caseId, d.clientId]), [
    ['Contrato de honorários advocatícios - Ana Souza.docx', caseItem.id, client.id],
    ['Contrato de honorários advocatícios - Ana Souza.pdf', caseItem.id, client.id],
  ]);
  const word = await require('mammoth').extractRawText({ buffer: new Documents(store).read(saved[0].id) });
  assert.match(word.value, /honorários de R\$ 3\.000,00 \(três mil reais\), da seguinte forma: à vista\./);
  assert.throws(() => store.remove('cases', caseItem.id), /vinculado/);
  assert.throws(() => generator.preview({ templateId: '', caseId: caseItem.id }), /modelo/);
});

test('people are a record kind linked to cases, and conflicts of interest are detected', async t => {
  const { store } = await fixture(t);
  const client = store.save('clients', { name: 'Construtora Horizonte Ltda', phone: '5564999990000', personType: 'Jurídica', document: '11222333000181' });
  const caseItem = store.save('cases', { title: 'Cobrança', status: 'Em andamento', clientId: client.id, opposingParty: 'Banco Exemplo S/A' });
  const witness = store.save('people', { name: 'Paulo Testemunha', role: 'Testemunha', caseId: caseItem.id, oab: '' });
  assert.equal(store.list('people').length, 1);
  assert.throws(() => store.save('people', { name: 'X', document: '123' }), /CPF ou CNPJ/);
  assert.equal(store.save('people', { name: 'Y', role: 'Qualquer' }).role, 'Outro');
  assert.throws(() => store.remove('cases', caseItem.id), /vinculado/);
  const entities = { clients: store.list('clients'), cases: store.list('cases'), people: store.list('people') };
  assert.equal(normalizeName('Banco Exemplo S.A.'), normalizeName('banco exemplo s/a'));
  // Representing the bank would conflict with the existing case.
  const asClient = findConflicts({ name: 'Banco Exemplo S.A.', side: 'client' }, entities);
  assert.deepEqual(asClient.map(c => [c.severity, c.kind, c.id]), [['conflict', 'cases', caseItem.id]]);
  // Suing our own client is a conflict; found by CNPJ even with another name.
  const asOpposing = findConflicts({ name: 'Horizonte Construções', document: '11.222.333/0001-81', side: 'opposing' }, entities);
  assert.deepEqual(asOpposing.map(c => [c.severity, c.id]), [['conflict', client.id]]);
  assert.deepEqual(findConflicts({ name: 'Construtora Horizonte', side: 'client', excludeId: client.id }, entities), []);
  assert.equal(findConflicts({ name: 'Paulo Testemunha', side: 'client' }, entities)[0].severity, 'notice');
  assert.equal(findConflicts({ name: 'Paulo Testemunha', side: 'client' }, entities)[0].id, witness.id);
  assert.deepEqual(findConflicts({ name: 'Ana', side: 'client' }, entities), [], 'short names are ignored');
});

test('migration 006 keeps every record and the link columns', async t => {
  const legacy = fs.mkdtempSync(path.join(base, 'docs-migrations-'));
  t.after(() => fs.rmSync(legacy, { recursive: true, force: true }));
  for (const name of fs.readdirSync('migrations').filter(n => n < '006')) fs.copyFileSync(path.join('migrations', name), path.join(legacy, name));
  const root = fs.mkdtempSync(path.join(base, 'docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = new Vault(randomBytes(32));
  const old = new Store(root, vault, legacy);
  await old.migrate();
  const client = old.save('clients', { name: 'Cliente antigo', phone: '5564999990000' });
  const caseItem = old.save('cases', { title: 'Processo antigo', status: 'Em andamento', clientId: client.id });
  assert.throws(() => old.db.prepare("INSERT INTO entities (id,kind,payload,created_at,updated_at) VALUES ('x','people',x'00','a','a')").run(), /CHECK/);
  old.close();
  const store = new Store(root, vault);
  try {
    await store.migrate();
    assert.equal(store.get('cases', caseItem.id).clientId, client.id);
    assert.equal(store.db.prepare('SELECT client_id FROM entities WHERE id=?').get(caseItem.id).client_id, client.id);
    assert.throws(() => store.remove('clients', client.id), /vinculado/);
    assert.ok(store.save('people', { name: 'Nova pessoa', role: 'Perito', caseId: caseItem.id }).id);
    assert.ok(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_entities_case'").get());
  } finally {
    store.close();
  }
});
