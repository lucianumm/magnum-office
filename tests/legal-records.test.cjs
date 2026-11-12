const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { entity, money } = require('../backend/validation.cjs');
const { parseCNJ, formatCNJ, cnjProblem } = require('../app/cnj.mjs');
const { brDocument } = require('../app/br-documents.mjs');
const { qualification, clientAddress } = require('../app/qualification.mjs');
const courts = require('../app/courts.json').courts;

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t, migrations) {
  const root = fs.mkdtempSync(path.join(base, 'legal-'));
  const vault = new Vault(randomBytes(32));
  const store = new Store(root, vault, migrations);
  await store.migrate();
  t.after(() => {
    try {
      store.close();
    } catch {
      /* closed by the test */
    }
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, store };
}
const client = { name: 'Ana Souza', phone: '5564999990000' };

test('CNJ numbers: check digits, segment, court and link to the courts directory', () => {
  // Check digits cross-checked against the piecewise algorithm of the Resolução CNJ 65/2008 annex.
  const cases = [
    ['00000016320248090051', 'tjgo', 'GO', 'Justiça Estadual'],
    ['12345672420195150042', 'trt15', '', 'Justiça do Trabalho'],
    ['08012349520234013400', 'trf1', '', 'Justiça Federal'],
    ['99999992520268260100', 'tjsp', 'SP', 'Justiça Estadual'],
  ];
  for (const [digits, courtId, uf, segmentName] of cases) {
    const parsed = parseCNJ(digits);
    assert.equal(parsed.valid, true, digits);
    assert.equal(parsed.courtId, courtId);
    assert.equal(parsed.uf, uf);
    assert.equal(parsed.segmentName, segmentName);
    assert.ok(
      courts.some(c => c.id === parsed.courtId),
      `${courtId} exists in courts.json`,
    );
  }
  assert.equal(formatCNJ('00000016320248090051'), '0000001-63.2024.8.09.0051');
  assert.equal(formatCNJ('0000001632'), '0000001-63.2');
  assert.equal(parseCNJ('0000001-64.2024.8.09.0051').valid, false);
  assert.match(cnjProblem('0000001-64.2024.8.09.0051'), /dígito verificador/);
  assert.match(cnjProblem('0000000-00.2026.0.00.0000'), /segmento/);
  assert.equal(cnjProblem('001/1.05.0012345-6'), '', 'old numbering is not judged');
  assert.equal(parseCNJ('123'), null);
  // Every state and federal branch the number can point to exists in the directory.
  for (let tr = 1; tr <= 27; tr++)
    for (const j of [6, 8]) {
      const id = parseCNJ(`0000001000000${j}${String(tr).padStart(2, '0')}0000`).courtId;
      assert.ok(
        courts.some(c => c.id === id),
        id,
      );
    }
  for (let tr = 1; tr <= 24; tr++)
    assert.ok(courts.some(c => c.id === parseCNJ(`00000010000005${String(tr).padStart(2, '0')}0000`).courtId));
});

test('CPF and CNPJ, including the alphanumeric CNPJ, are validated and formatted', () => {
  assert.deepEqual(brDocument('52998224725'), { type: 'CPF', valid: true, formatted: '529.982.247-25' });
  assert.equal(brDocument('529.982.247-24').valid, false);
  assert.equal(brDocument('111.111.111-11').valid, false);
  assert.equal(brDocument('11222333000181').formatted, '11.222.333/0001-81');
  assert.equal(brDocument('12.abc.345/01de-35').valid, true, 'Receita Federal example');
  assert.equal(brDocument('12.ABC.345/01DE-36').valid, false);
  assert.equal(entity('clients', { ...client, document: '52998224725' }).document, '529.982.247-25');
  assert.throws(() => entity('clients', { ...client, document: '12345678900' }), /CPF não é válido/);
  assert.equal(
    entity('clients', { ...client, document: '12345678900' }, { allowLegacyContact: true }).document,
    '12345678900',
  );
});

test('cases keep parties, court and claim data, and reject invalid numbers', () => {
  const value = entity('cases', {
    title: 'Ação de cobrança',
    status: 'Em andamento',
    area: 'Consumidor',
    number: '00000016320248090051',
    clientRole: 'Polo ativo',
    opposingParty: 'Banco Exemplo S.A.',
    opposingDocument: '11222333000181',
    opposingLawyerOab: '12345/go',
    county: 'Goiânia',
    court: '3ª Vara Cível',
    instance: '1º grau',
    phase: 'Conhecimento',
    claimValue: 'R$ 15.000,50',
    filedAt: '2024-03-01',
    secret: true,
    tags: 'urgente, banco, urgente',
  });
  assert.equal(value.number, '0000001-63.2024.8.09.0051');
  assert.equal(value.area, 'Consumidor');
  assert.equal(value.opposingDocument, '11.222.333/0001-81');
  assert.equal(value.opposingLawyerOab, '12345/GO');
  assert.equal(value.claimValue, '15000.50');
  assert.equal(value.secret, true);
  assert.equal(value.tags, 'urgente, banco');
  const minimal = { title: 'Processo', status: 'Em andamento' };
  assert.equal(entity('cases', minimal).secret, false);
  assert.throws(() => entity('cases', { ...minimal, number: '0000001-64.2024.8.09.0051' }), /dígito/);
  assert.equal(
    entity('cases', { ...minimal, number: '0000001-64.2024.8.09.0051' }, { allowLegacyContact: true }).number,
    '0000001-64.2024.8.09.0051',
  );
  assert.equal(entity('cases', { ...minimal, number: 'PA 123/2020' }).number, 'PA 123/2020');
  assert.throws(() => entity('cases', { ...minimal, phase: 'Qualquer' }), /Opção/);
  assert.throws(() => entity('cases', { ...minimal, filedAt: '2024-02-30' }), /distribuição/);
  assert.throws(() => entity('cases', { ...minimal, opposingLawyerOab: '12345' }), /OAB/);
  assert.equal(money('1.234,5'), '1234.50');
  assert.equal(money('1234.56'), '1234.56');
  assert.equal(money('15.000'), '15000.00');
  assert.throws(() => money('abc'), /valor da causa/);
});

test('qualification paragraph for people and companies lists what is missing', () => {
  const person = {
    name: 'Ana Souza',
    nationality: 'brasileira',
    maritalStatus: 'casada',
    profession: 'professora',
    rg: '1234567',
    rgIssuer: 'SSP/GO',
    document: '529.982.247-25',
    street: 'Rua 10',
    addressNumber: '100',
    complement: 'Apto 2',
    district: 'Centro',
    city: 'Goiânia',
    state: 'GO',
    zip: '74000000',
    email: 'ana@example.test',
  };
  assert.equal(
    qualification(person).text,
    'ANA SOUZA, brasileira, casada, professora, portador(a) da cédula de identidade RG nº 1234567 SSP/GO, inscrito(a) no CPF sob o nº 529.982.247-25, residente e domiciliado(a) em Rua 10, nº 100, Apto 2, Centro, Goiânia/GO, CEP 74000-000, e-mail ana@example.test.',
  );
  assert.deepEqual(qualification(person).missing, []);
  assert.deepEqual(qualification({ name: 'Ana' }).missing, [
    'nacionalidade',
    'estado civil',
    'profissão',
    'RG',
    'CPF',
    'endereço',
  ]);
  assert.equal(clientAddress({ address: 'Av. Antiga, 1' }), 'Av. Antiga, 1', 'legacy free-text address');
  const company = qualification({
    personType: 'Jurídica',
    name: 'Exemplo Ltda',
    document: '11.222.333/0001-81',
    city: 'Anápolis',
    state: 'GO',
    legalRepresentative: 'João Lima',
    representativeDocument: '529.982.247-25',
  });
  assert.equal(
    company.text,
    'EXEMPLO LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 11.222.333/0001-81, com sede em Anápolis/GO, neste ato representada por João Lima, inscrito(a) no CPF sob o nº 529.982.247-25.',
  );
  assert.deepEqual(company.missing, []);
});

test('link columns block removals without decrypting, including related cases, and refuse cycles', async t => {
  const { store } = await fixture(t);
  const c = store.save('clients', client);
  const main = store.save('cases', { title: 'Conhecimento', status: 'Em andamento', clientId: c.id });
  const appeal = store.save('cases', { title: 'Apelação', status: 'Em andamento', parentCaseId: main.id });
  const row = store.db.prepare('SELECT client_id, case_id FROM entities WHERE id=?');
  assert.deepEqual({ ...row.get(main.id) }, { client_id: c.id, case_id: null });
  assert.deepEqual({ ...row.get(appeal.id) }, { client_id: null, case_id: main.id });
  assert.throws(() => store.remove('cases', main.id), /vinculado/);
  assert.throws(() => store.save('cases', { ...main, parentCaseId: main.id }), /ele mesmo/);
  assert.throws(() => store.save('cases', { ...main, parentCaseId: appeal.id }), /ciclo/);
  assert.throws(
    () => store.save('cases', { ...appeal, parentCaseId: '00000000-0000-0000-0000-000000000000' }),
    /encontrado/,
  );
  store.remove('cases', appeal.id);
  assert.throws(() => store.remove('clients', c.id), /vinculado/);
  store.save('cases', { ...main, clientId: '' });
  store.remove('clients', c.id);
});

test('records saved before migration 005 get their links filled once', async t => {
  const legacy = fs.mkdtempSync(path.join(base, 'legal-migrations-'));
  t.after(() => fs.rmSync(legacy, { recursive: true, force: true }));
  for (const name of fs.readdirSync('migrations').filter(n => n < '005'))
    fs.copyFileSync(path.join('migrations', name), path.join(legacy, name));
  const { root, vault, store } = await fixture(t, legacy);
  const c = store.save('clients', client);
  const task = store.save('tasks', { title: 'Prazo', due: '2026-11-10T09:00', clientId: c.id });
  store.close();
  const upgraded = new Store(root, vault);
  try {
    await upgraded.migrate();
    assert.equal(upgraded.db.prepare('SELECT client_id FROM entities WHERE id=?').get(task.id).client_id, c.id);
    assert.throws(() => upgraded.remove('clients', c.id), /vinculado/);
    assert.ok(upgraded.db.prepare("SELECT 1 FROM maintenance WHERE name='entity-links'").get());
  } finally {
    upgraded.close();
  }
});

test('office lawyers are validated with OAB number and state', async t => {
  const { root } = await fixture(t);
  const settings = new Settings(root);
  const saved = settings.save({
    lawyers: [{ name: 'Dra. Maria', oab: '12.345', uf: 'go', email: 'maria@example.test' }],
  });
  assert.deepEqual(saved.lawyers, [{ name: 'Dra. Maria', oab: '12345', uf: 'GO', email: 'maria@example.test' }]);
  assert.throws(() => settings.save({ lawyers: [{ name: 'X', oab: 'abc', uf: 'GO' }] }), /OAB/);
  assert.throws(() => settings.save({ lawyers: [{ name: 'X', oab: '1', uf: 'XX' }] }), /UF/);
  assert.throws(
    () => settings.save({ lawyers: Array.from({ length: 31 }, () => ({ name: 'X', oab: '1', uf: 'GO' })) }),
    /30/,
  );
  assert.deepEqual(new Settings(root).get().lawyers, saved.lawyers);
});
