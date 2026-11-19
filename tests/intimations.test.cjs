const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { DJEN } = require('../backend/djen.cjs');
const text = require('../app/intimation-text.mjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'djen-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  settings.save({ djenEnabled: true, lawyers: [{ name: 'Marina Exemplo', oab: '12345', uf: 'GO' }] });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, settings };
}
// answer(url) → { status, body, headers, bytes }
function fakeFetch(answer) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const { status = 200, body, headers = {}, bytes } = await answer(url, calls.length);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: name => headers[name.toLowerCase()] ?? null },
      json: async () => body,
      arrayBuffer: async () => bytes,
    };
  };
  return { fetch, calls };
}
const item = (id, extra = {}) => ({
  id,
  hash: 'abc' + id,
  data_disponibilizacao: '2026-11-05',
  siglaTribunal: 'TJGO',
  tipoComunicacao: 'Intimação',
  nomeOrgao: '21ª Vara Cível',
  texto: '<p>Intime-se a parte autora, no prazo de 15 (quinze) dias úteis, para réplica.</p>',
  numero_processo: '00000016320248090051',
  numeroprocessocommascara: '0000001-63.2024.8.09.0051',
  link: `https://comunicaapi.pje.jus.br/api/v1/comunicacao/abc${id}/certidao`,
  nomeClasse: 'Procedimento Comum Cível',
  ativo: true,
  destinatarios: [
    { nome: 'Ana Souza', polo: 'A' },
    { nome: 'Empresa X', polo: 'P' },
  ],
  destinatarioadvogados: [{ advogado: { nome: 'Marina Exemplo', numero_oab: '12345', uf_oab: 'GO' } }],
  ...extra,
});

test('text: deadlines, hearing dates, amounts and urgency are found without calling anything a calculation', () => {
  const t =
    'Fica a parte intimada para, no prazo de 15 (quinze) dias úteis, apresentar réplica. Designada audiência de instrução para o dia 20/11/2026 às 14h30, valor de R$ 1.500,00. Manifeste-se em 5 dias.';
  const deadlines = text.findDeadlines(t);
  assert.deepEqual(
    deadlines.map(d => [d.days, d.unit]),
    [
      [15, 'uteis'],
      [5, ''],
    ],
  );
  assert.deepEqual(text.findEvent(t), { date: '2026-11-20', time: '14:30', kind: 'Audiência' });
  assert.deepEqual(text.findEvent('Perícia médica designada para 3 de dezembro de 2026, às 9:00 horas'), {
    date: '2026-12-03',
    time: '09:00',
    kind: 'Perícia',
  });
  assert.equal(text.findEvent('Juntada de petição em 20/11/2026.'), null, 'a date alone is not a hearing');
  assert.equal(text.findDeadlines('no dia 15 de março, 3 vezes').length, 0);
  assert.deepEqual(
    text
      .segments(t)
      .filter(s => s.kind)
      .map(s => s.kind),
    ['deadline', 'date', 'money', 'deadline'],
  );
  assert.equal(
    text
      .segments(t)
      .map(s => s.text)
      .join(''),
    t,
    'marking never changes the text',
  );
  const long = Array.from({ length: 30 }, (_, i) => `Frase número ${i} do despacho.`).join(' ');
  assert.ok(text.paragraphs(long).length > 1 && text.paragraphs(long).every(p => p.length <= 700));
  assert.equal(text.kindOf('Citação').tone, 'red');
  assert.equal(text.kindOf('Pauta de Julgamento').key, 'agenda');
  // Published Thursday 12/11/2026, 15 working days from Monday 16/11 → Friday 04/12 (holidays are not considered).
  const u = text.urgency({ texto: t, date: '2026-11-12', tipo: 'Intimação', status: 'new' }, '2026-11-13');
  assert.deepEqual([u.level, u.approxEnd], ['normal', '2026-12-04']);
  assert.equal(
    text.urgency({ texto: t, date: '2026-11-12', tipo: 'Intimação', status: 'new' }, '2026-12-02').level,
    'high',
  );
  assert.equal(
    text.urgency({ texto: 'Cite-se.', date: '2026-11-12', tipo: 'Citação', status: 'new' }, '2026-11-13').level,
    'high',
  );
  assert.equal(
    text.urgency({ texto: t, date: '2026-11-12', tipo: 'Intimação', status: 'done' }, '2026-11-30').level,
    'normal',
  );
});

test('grouping by process: one group per number, newest activity first, no number last', () => {
  const groups = text.groupByProcess([
    { id: '1', processo: '111', date: '2026-11-01' },
    { id: '2', processo: '', date: '2026-11-09' },
    { id: '3', processo: '222', date: '2026-11-05' },
    { id: '4', processo: '111', date: '2026-11-07' },
  ]);
  assert.deepEqual(
    groups.map(g => [g.key, g.items.map(i => i.id).join('')]),
    [
      ['111', '41'],
      ['222', '3'],
      ['sem-numero', '2'],
    ],
  );
});

test('rate limit: a 429 makes the program wait a minute; one lawyer failing does not hide the others', async t => {
  const { store, settings } = await fixture(t);
  settings.save({
    lawyers: [
      { name: 'Marina Exemplo', oab: '12345', uf: 'GO' },
      { name: 'Paulo Sócio', oab: '999', uf: 'SP' },
    ],
  });
  let now = Date.parse('2026-11-07T12:00:00Z');
  const clock = () => now;
  // Paulo's request fails with a server error; Marina's works.
  const { fetch, calls } = fakeFetch(url =>
    new URL(url).searchParams.get('ufOab') === 'SP'
      ? { status: 500 }
      : { body: { count: 1, items: [item(1)] }, headers: { 'x-ratelimit-remaining': '3' } },
  );
  const djen = new DJEN({ store, settings, fetch, clock, pause: 0 });
  const result = await djen.check();
  assert.equal(result.added, 1, "Marina's publication was kept");
  const health = djen.health();
  assert.match(health.error, /Paulo Sócio/);
  assert.equal(health.lastResult.partial, true);
  assert.equal(health.remaining, 3);
  assert.equal(settings.get().lastDjenCheck, null, 'the last check does not move forward after a partial failure');
  assert.equal(calls.length, 2);
  // Everything failing with 429: the retry time is kept and the next try is refused without calling the API.
  const limited = fakeFetch(() => ({ status: 429 }));
  const blocked = new DJEN({ store, settings, fetch: limited.fetch, clock, pause: 0 });
  await assert.rejects(blocked.check(), /Muitas consultas/);
  const before = limited.calls.length;
  await assert.rejects(blocked.check(), /esperar/);
  assert.equal(limited.calls.length, before, 'no request while waiting');
  assert.ok(blocked.health().retryAt);
  now += 61000;
  await assert.rejects(blocked.check(), /Muitas consultas/);
  assert.ok(limited.calls.length > before, 'after a minute it tries again');
});

test('health: failing for three days is flagged, and success clears it', async t => {
  const { store, settings } = await fixture(t);
  let now = Date.parse('2026-11-07T12:00:00Z');
  const clock = () => now;
  let fail = true;
  const { fetch } = fakeFetch(() => (fail ? { status: 500 } : { body: { count: 0, items: [] } }));
  const djen = new DJEN({ store, settings, fetch, clock, pause: 0 });
  await assert.rejects(djen.check(), /não respondeu/);
  assert.equal(djen.health().failingDays, 0);
  now += 3 * 86400000 + 1000;
  await assert.rejects(djen.check(), /não respondeu/);
  assert.equal(djen.health().failingDays, 3);
  fail = false;
  await djen.check();
  assert.deepEqual([djen.health().failingDays, djen.health().error], [0, '']);
});

test('one-off search: filters go to the API, results stay apart until kept, and the lawyer can be registered', async t => {
  const { store, settings } = await fixture(t);
  const caseItem = store.save('cases', {
    title: 'Indenização',
    status: 'Em andamento',
    number: '00000016320248090051',
  });
  const { fetch, calls } = fakeFetch(url =>
    url.includes('/tribunal')
      ? { body: [{ sigla: 'TJGO' }, { sigla: 'TRT18' }, { instituicoes: [{ sigla: 'TJSP' }] }] }
      : {
          body: {
            count: 12000,
            items: [
              item(7, { destinatarioadvogados: [{ advogado: { nome: 'Colega', numero_oab: '777', uf_oab: 'SP' } }] }),
            ],
          },
        },
  );
  const djen = new DJEN({ store, settings, fetch, clock: () => Date.parse('2026-11-07T12:00:00Z'), pause: 0 });
  await assert.rejects(djen.search({}), /Informe a OAB/);
  await assert.rejects(djen.search({ oab: '777' }), /UF da OAB/);
  await assert.rejects(djen.search({ siglaTribunal: 'TJGO' }), /informe também o período/);
  await assert.rejects(djen.search({ numeroProcesso: '123' }), /20 dígitos/);
  await assert.rejects(djen.search({ nomeParte: 'x', de: '2026-11-10', ate: '2026-11-01' }), /depois da final/);
  const found = await djen.search({
    oab: '777',
    uf: 'sp',
    nomeParte: 'Empresa X',
    siglaTribunal: 'TJSP',
    de: '2026-10-01',
    ate: '2026-11-01',
    meio: 'D',
  });
  const params = Object.fromEntries(new URL(calls[0]).searchParams);
  assert.deepEqual(params, {
    numeroOab: '777',
    ufOab: 'SP',
    nomeParte: 'Empresa X',
    siglaTribunal: 'TJSP',
    dataDisponibilizacaoInicio: '2026-10-01',
    dataDisponibilizacaoFim: '2026-11-01',
    meio: 'D',
    itensPorPagina: '100',
    pagina: '1',
  });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].caseId, caseItem.id, 'linked to the registered process');
  assert.deepEqual(found.items[0].parties, [
    { nome: 'Ana Souza', polo: 'A' },
    { nome: 'Empresa X', polo: 'P' },
  ]);
  assert.equal(found.capped, true, 'the API stops at 10,000 results for this kind of search');
  assert.equal(found.truncated, true);
  assert.equal(djen.list().length, 0, 'the search did not touch the inbox');
  djen.keep('7');
  assert.equal(djen.list().length, 1);
  assert.equal(djen.list()[0].caseId, caseItem.id);
  djen.keep('7');
  assert.equal(djen.list().length, 1, 'keeping twice stores once');
  assert.throws(() => djen.keep('nao-existe'), /Refaça a busca/);
  assert.deepEqual(await djen.courts(), ['TJGO', 'TJSP', 'TRT18']);
});

test('certificate: downloads the PDF of a stored publication and refuses anything else', async t => {
  const { store, settings } = await fixture(t);
  const pdf = Buffer.from('%PDF-1.4\nconteúdo da certidão\n%%EOF');
  const { fetch, calls } = fakeFetch(url =>
    url.endsWith('/abc1/certidao') ? { bytes: pdf } : { body: { count: 1, items: [item(1)] } },
  );
  const djen = new DJEN({ store, settings, fetch, clock: () => Date.parse('2026-11-07T12:00:00Z'), pause: 0 });
  await djen.check();
  const { bytes, name } = await djen.certificate('1');
  assert.deepEqual(bytes, pdf);
  assert.equal(name, 'certidao-0000001-63.2024.8.09.0051-2026-11-05.pdf');
  assert.equal(calls.at(-1), 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/abc1/certidao');
  const html = fakeFetch(() => ({ bytes: Buffer.from('<html>erro</html>') }));
  await assert.rejects(new DJEN({ store, settings, fetch: html.fetch, pause: 0 }).certificate('1'), /não é um PDF/);
  await assert.rejects(djen.certificate('inexistente'), /não encontrada/);
});

test('paging: a page of groups at a time, grouped as chosen, with filters; texts come apart; status changes update the cache', async t => {
  const { store, settings } = await fixture(t);
  const caseItem = store.save('cases', {
    title: 'Indenização',
    status: 'Em andamento',
    number: '00000016320248090051',
  });
  const rows = [];
  for (let i = 0; i < 60; i++)
    rows.push(
      item(2000 + i, {
        numero_processo: '100000000000000000' + String(i % 40).padStart(2, '0'),
        numeroprocessocommascara: `P${i % 40}`,
        data_disponibilizacao: `2026-11-${String(1 + (i % 9)).padStart(2, '0')}`,
        siglaTribunal: i % 2 ? 'TJGO' : 'TRT18',
        tipoComunicacao: i % 5 === 0 ? 'Citação' : 'Intimação',
        texto: '<p>' + 'Texto muito longo da publicação. '.repeat(60) + '</p>',
      }),
    );
  rows.push(item(9, { numero_processo: '00000016320248090051' }));
  const { fetch } = fakeFetch(() => ({ body: { count: rows.length, items: rows.slice(0, 100) } }));
  const djen = new DJEN({ store, settings, fetch, clock: () => Date.parse('2026-11-10T12:00:00Z'), pause: 0 });
  await djen.check();
  assert.deepEqual(djen.summary().counts, { new: 61, done: 0, dismissed: 0 });
  assert.equal(djen.summary().newest.tipo, 'Intimação');
  const first = djen.pageOf({ status: 'new', group: 'process', limit: 15 });
  assert.equal(first.groups.length, 15);
  assert.equal(first.total, 41, '40 processes plus the registered one');
  assert.equal(first.totalItems, 61);
  assert.ok(
    first.groups.every(g => g.items.every(i => i.texto.length <= 600)),
    'only the beginning of each text',
  );
  assert.ok(JSON.stringify(first).length < 120000, 'a page stays small');
  const second = djen.pageOf({ status: 'new', group: 'process', limit: 15, offset: 15 });
  assert.ok(!second.groups.some(g => first.groups.some(f => f.key === g.key)), 'no group repeated across pages');
  assert.equal(djen.pageOf({ group: 'court' }).total, 2);
  assert.equal(djen.pageOf({ group: 'type' }).groups.length, 2);
  assert.ok(djen.pageOf({ group: 'day' }).total <= 9);
  assert.equal(djen.pageOf({ court: 'TRT18' }).totalItems, 30);
  assert.equal(djen.pageOf({ type: 'citation' }).totalItems, 12);
  assert.equal(djen.pageOf({ linked: 'yes' }).totalItems, 1);
  assert.equal(djen.pageOf({ linked: 'yes' }).groups[0].caseId, caseItem.id);
  assert.equal(djen.pageOf({ query: 'P7' }).total, 1);
  assert.equal(djen.pageOf({ lawyer: '12345/GO' }).totalItems, 61);
  assert.equal(djen.pageOf({}).facets.courts.TJGO, 31);
  assert.ok(djen.fullText('2000').length > 600, 'the whole text on request');
  assert.throws(() => djen.fullText('nao-existe'), /não encontrada/);
  // Handling a whole group at once, and the filters following the new status.
  const ids = first.groups[0].items.map(i => i.id);
  djen.setStatusMany(ids, 'done');
  assert.equal(djen.summary().counts.done, ids.length);
  assert.equal(djen.pageOf({ status: 'done' }).totalItems, ids.length);
  assert.equal(djen.pageOf({ status: 'new' }).totalItems, 61 - ids.length);
  assert.throws(() => djen.setStatusMany('x', 'done'), /inválidas/);
});
