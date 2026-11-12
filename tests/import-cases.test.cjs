const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Imports } = require('../backend/imports.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });

test('cases exported by another system are imported, linked to clients by name and not duplicated', async t => {
  const root = fs.mkdtempSync(path.join(base, 'import-cases-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ana = store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  const file = path.join(root, 'processos.csv');
  fs.writeFileSync(
    file,
    [
      'Número do Processo;Cliente;Parte Contrária;Comarca;Vara;Área;Situação;Fase;Classe;Valor da Causa;Data de Distribuição;Obs',
      '0000001-63.2024.8.09.0051;Ana Souza;Banco X S.A.;Goiânia;3ª Vara Cível;Cível;Ativo;Conhecimento;Procedimento Comum;15.000,00;10/03/2024;urgente',
      '0010001-69.2024.5.18.0101;Pedro Novo;Empresa Y;Rio Verde;1ª Vara do Trabalho;Trabalhista;Arquivado definitivamente;;Ação Trabalhista;;;',
      '0000001-00.2024.8.09.0051;Ana Souza;Z;;;;;;;;;',
    ].join('\n'),
  );
  const imports = new Imports(store);
  const read = await imports.read(file);
  const preview = imports.preview({ id: read.id, kind: 'cases' });
  assert.equal(preview.valid, 2);
  assert.match(preview.rows[2].error, /dígito|CNJ|número/i, 'wrong check digits are shown, not imported');
  const [first, second] = preview.rows;
  assert.equal(first.value.clientId, ana.id);
  assert.deepEqual(
    [first.value.number, first.value.status, first.value.phase, first.value.claimValue, first.value.filedAt],
    ['0000001-63.2024.8.09.0051', 'Em andamento', 'Conhecimento', '15000.00', '2024-03-10'],
  );
  assert.equal(first.value.title, 'Procedimento Comum');
  assert.equal(second.value.status, 'Arquivado');
  assert.equal(second.value.clientId, '');
  assert.match(second.value.notes, /Cliente na planilha: Pedro Novo/);
  assert.deepEqual(imports.commit({ id: read.id, rows: [first.row, second.row] }), { count: 2 });
  const again = await imports.read(file);
  assert.equal(imports.preview({ id: again.id, kind: 'cases' }).duplicates, 2, 'same numbers are duplicates');
});
