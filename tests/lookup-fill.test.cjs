const { test } = require('node:test');
const assert = require('node:assert/strict');
const { caseFill, companyFill } = require('../app/lookup-fill.mjs');

const found = {
  found: true,
  fields: {
    procedure: 'Ação Trabalhista',
    court: '1ª Vara',
    county: 'Rio Verde',
    area: 'Trabalhista',
    filedAt: '2024-01-15',
  },
};

test('case lookup fills empty fields only, using the values at the time of the answer', () => {
  const atRequest = { number: 'x', court: '', area: 'Cível', procedure: '' };
  // While waiting, the person typed the court.
  const atAnswer = { ...atRequest, court: 'Digitado' };
  const { changes, lines } = caseFill(atAnswer, found);
  assert.equal(changes.court, undefined, 'typed value kept');
  assert.equal(changes.area, 'Trabalhista', 'default area of a new case is replaced');
  assert.ok(lines.includes('Distribuição: 15/01/2024'));
  assert.equal(
    caseFill({ area: 'Cível' }, found, { savedArea: 'Cível' }).changes.area,
    undefined,
    'a saved choice stays',
  );
});

test('company lookup never mixes two addresses and keeps typed names', () => {
  const result = {
    name: 'EMPRESA LTDA',
    legalRepresentative: 'Maria',
    address: { street: 'Av. Goiás', addressNumber: '100', city: 'Goiânia', state: 'GO', zip: '74000-000' },
  };
  const partial = companyFill({ name: 'Nome digitado', city: 'Anápolis', personType: 'Física' }, result, 'client');
  assert.deepEqual(partial.changes, { personType: 'Jurídica', legalRepresentative: 'Maria' });
  const full = companyFill({ personType: 'Jurídica' }, result, 'client');
  assert.equal(full.changes.street, 'Av. Goiás');
  assert.match(full.lines.at(-1), /Endereço: Av\. Goiás, 100, Goiânia\/GO, 74000-000/);
  assert.deepEqual(companyFill({ opposingParty: '' }, result, 'opposing').changes, { opposingParty: 'EMPRESA LTDA' });
});
