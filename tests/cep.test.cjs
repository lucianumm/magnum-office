const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CEPLookup } = require('../backend/cep.cjs');

const fake = answer => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const { status = 200, body } = await answer(url);
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetch, calls };
};

test('CEP lookup maps BrasilAPI, falls back to ViaCEP and explains failures', async () => {
  const brasil = fake(() => ({
    body: { street: 'Avenida Goiás', neighborhood: 'Setor Central', city: 'Goiânia', state: 'GO' },
  }));
  assert.deepEqual(await new CEPLookup({ fetch: brasil.fetch }).lookup('74.000-000'), {
    found: true,
    zip: '74000-000',
    street: 'Avenida Goiás',
    district: 'Setor Central',
    city: 'Goiânia',
    state: 'GO',
  });
  assert.deepEqual(brasil.calls, ['https://brasilapi.com.br/api/cep/v2/74000000']);
  const via = fake(url =>
    url.includes('brasilapi')
      ? { status: 500 }
      : { body: { logradouro: 'Rua 1', bairro: 'Centro', localidade: 'Anápolis', uf: 'go' } },
  );
  assert.equal((await new CEPLookup({ fetch: via.fetch }).lookup('75000000')).city, 'Anápolis');
  assert.deepEqual(
    await new CEPLookup({
      fetch: fake(url => (url.includes('brasilapi') ? { status: 404 } : { body: { erro: true } })).fetch,
    }).lookup('00000000'),
    {
      found: false,
      zip: '00000-000',
    },
  );
  await assert.rejects(
    new CEPLookup({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    }).lookup('74000000'),
    /Sem conexão/,
  );
  await assert.rejects(new CEPLookup({ fetch: brasil.fetch }).lookup('7400'), /8 dígitos/);
});
