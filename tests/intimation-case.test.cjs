const { test } = require('node:test');
const assert = require('node:assert/strict');
const { caseFromIntimation, matchClient, guessArea, joinNames } = require('../app/intimation-case.mjs');

const item = {
  processo: '00112223320245180001',
  processoMascara: '0011222-33.2024.5.18.0001',
  tribunal: 'TRT18',
  orgao: '1ª Vara do Trabalho de Goiânia',
  classe: 'Reclamação Trabalhista',
  date: '2026-11-10',
  parties: [
    { nome: 'ANA SOUZA LIMA', polo: 'A' },
    { nome: 'EMPRESA X LTDA', polo: 'P' },
    { nome: 'INSS', polo: 'T' },
  ],
  lawyers: [
    { nome: 'Marina Exemplo', oab: '12345', uf: 'GO' },
    { nome: 'Carlos Contrário', oab: '98.765', uf: 'sp' },
  ],
};

test("case from a publication: number, title, court, area, procedure, parties and the other side's lawyer", () => {
  const c = caseFromIntimation(item, { side: 'A', officeLawyers: [{ oab: '12.345', uf: 'GO' }] });
  assert.deepEqual(
    [c.number, c.title, c.court, c.area, c.instance, c.procedure, c.status],
    [
      '0011222-33.2024.5.18.0001',
      'ANA SOUZA LIMA x EMPRESA X LTDA',
      '1ª Vara do Trabalho de Goiânia',
      'Trabalhista',
      '1º grau',
      'Reclamação Trabalhista',
      'Em andamento',
    ],
  );
  assert.deepEqual([c.clientRole, c.opposingParty], ['Polo ativo', 'EMPRESA X LTDA']);
  assert.deepEqual(
    [c.opposingLawyer, c.opposingLawyerOab],
    ['Carlos Contrário', '98765/SP'],
    "the office's own lawyer is not the opposing one",
  );
  assert.match(
    c.notes,
    /Polo ativo: ANA SOUZA LIMA\nPolo passivo: EMPRESA X LTDA\nTerceiros: INSS\nCadastrado a partir da publicação de 10\/11\/2026 \(TRT18\)\./,
  );
  const passive = caseFromIntimation(item, { side: 'P' });
  assert.deepEqual([passive.clientRole, passive.opposingParty], ['Polo passivo', 'ANA SOUZA LIMA']);
  const unknown = caseFromIntimation(item, {});
  assert.deepEqual([unknown.clientRole, unknown.opposingParty], ['', '']);
  assert.equal(unknown.title, 'ANA SOUZA LIMA x EMPRESA X LTDA', 'the title does not need to know the side');
  assert.equal(caseFromIntimation({ ...item, parties: [] }).title, 'Reclamação Trabalhista');
});

test('a registered client is matched by name and linked; areas are guessed from the class and the court', () => {
  const clients = [
    { id: 'c1', name: 'Ana Souza Lima' },
    { id: 'c2', name: 'Bia' },
  ];
  assert.deepEqual(
    matchClient(item.parties, clients).map(m => [m.client.id, m.party.polo]),
    [['c1', 'A']],
  );
  assert.equal(caseFromIntimation(item, { side: 'A', clients }).clientId, 'c1');
  assert.equal(caseFromIntimation(item, { side: 'P', clients }).clientId, '', 'the client is on the other side');
  assert.equal(guessArea({ classe: 'Execução Fiscal', tribunal: 'TJGO' }), 'Tributário');
  assert.equal(guessArea({ classe: 'Divórcio Litigioso', tribunal: 'TJGO' }), 'Família');
  assert.equal(guessArea({ classe: 'Procedimento Comum Cível', tribunal: 'TJGO' }), 'Cível');
  assert.equal(joinNames(['A', 'B', 'C', 'D']), 'A e outros (3)');
});
