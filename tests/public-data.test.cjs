const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Indices } = require('../backend/indices.cjs');
const { DataJud, DEFAULT_KEY } = require('../backend/datajud.cjs');
const { DJEN } = require('../backend/djen.cjs');
const { report } = require('../backend/debt-report.cjs');
const { pdf } = require('../backend/document-files.cjs');
const { calculateDebt, seriesNeeded } = require('../app/debt.mjs');

// Real values from the BCB SGS (series 433 and 29543), read on 2026-11-07.
const IPCA = { '2003-01': 2.25, '2003-02': 1.57, '2003-03': 1.23, '2003-04': 0.97, '2003-05': 0.61, '2003-06': -0.15, '2003-07': 0.2, '2003-08': 0.34, '2003-09': 0.78, '2003-10': 0.29, '2003-11': 0.34, '2003-12': 0.52, '2024-07': 0.38, '2024-08': -0.02, '2024-09': 0.44 };
const TAXA_LEGAL = { '2024-08': 0.605306, '2024-09': 0.676227, '2024-10': 0.704241, '2025-03': 0 };
const SELIC = { '2022-01': 0.73, '2022-02': 0.76 };

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'public-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  const settings = new Settings(root);
  t.after(() => {
    store.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, settings };
}
// Simulated network: records each request and answers from a function.
function fakeFetch(answer) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const { status = 200, body } = await answer(url, options, calls.length);
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetch, calls };
}

test('debt update reproduces the Banco Central examples (IPCA 2003 and Taxa Legal)', () => {
  // Calculadora do Cidadão: IPCA 01/2003 to 12/2003 → 1,0929994; 01/2003 alone → 1,0225.
  const year = calculateDebt({ principal: '1000', start: '2003-01-01', end: '2003-12-31', correction: 'IPCA', series: { IPCA } });
  // The BCB shows the factor truncated to 7 decimal places (1,09299945… → 1,0929994).
  assert.equal(Math.trunc(year.factor * 1e7) / 1e7, 1.0929994);
  assert.equal(year.corrected, 1093);
  assert.equal(calculateDebt({ principal: '1000', start: '2003-01-15', end: '2003-01-20', correction: 'IPCA', series: { IPCA } }).factor, 1.0225);
  // Metodologia da Taxa Legal: 30/08/2024 to 31/08/2024 → 0,00019526; R$ 1.000,00 → R$ 1.000,20.
  const legal = calculateDebt({ principal: '1.000,00', start: '2024-08-30', end: '2024-08-31', interest: 'legal', series: { TAXA_LEGAL } });
  assert.equal(legal.interestRate, 0.019526);
  assert.equal(legal.total, 1000.2);
  // Whole month: day 1 to day 1 of the next month gives the monthly rate.
  assert.equal(calculateDebt({ principal: '1000', start: '2024-09-01', end: '2024-10-01', interest: 'legal', series: { TAXA_LEGAL } }).interestRate, 0.676227);
});

test('Código Civil transition, Selic, fine, fees and warnings', () => {
  // 30/07 → 30/08/2024 at the rate typed (1% a month): 2/31 + 29/31 = 1%; then 1 day of Taxa Legal.
  const cc = calculateDebt({ principal: '1000', start: '2024-07-30', end: '2024-08-31', interest: 'cc', rate: '1', series: { TAXA_LEGAL } });
  assert.equal(cc.interestRate, 1.019526);
  assert.ok(cc.basis.some(b => b.includes('divergência')));
  const legalOnly = calculateDebt({ principal: '1000', start: '2024-07-30', end: '2024-08-31', interest: 'legal', series: { TAXA_LEGAL } });
  assert.equal(legalOnly.interestRate, 0.019526);
  assert.ok(legalOnly.warnings.some(w => w.includes('30/08/2024')));
  // Selic replaces any other index (EC 113/2021).
  const composite = calculateDebt({ principal: '1000', start: '2022-01-10', end: '2022-02-10', correction: 'IPCA', interest: 'selic', series: { SELIC } });
  assert.equal(composite.correction, 'none');
  assert.equal(composite.interestAmount, 14.96); // (1.0073 × 1.0076 − 1) × 1000
  assert.equal(calculateDebt({ principal: '1000', start: '2022-01-10', end: '2022-02-10', interest: 'selic', selicMode: 'simples', series: { SELIC } }).interestAmount, 14.9);
  // Fine and fees of 10% each on the updated debt (CPC, art. 523, § 1º).
  const r = calculateDebt({ principal: '1000', start: '2024-09-01', end: '2024-10-01', interest: 'legal', fine: '10', fees: '10', series: { TAXA_LEGAL } });
  assert.equal(r.subtotal, 1006.76);
  assert.deepEqual([r.fine, r.fees, r.total], [100.68, 100.68, 1208.12]);
  // Months not yet published are reported, not invented.
  const late = calculateDebt({ principal: '1000', start: '2024-08-01', end: '2024-11-15', correction: 'IPCA', series: { IPCA } });
  assert.ok(late.warnings.some(w => w.includes('10/2024') && w.includes('11/2024')));
  assert.throws(() => calculateDebt({ principal: '1000', start: '1999-01-01', end: '1999-02-01', correction: 'IPCA', series: { IPCA } }), /Atualize os índices/);
  assert.throws(() => calculateDebt({ principal: '', start: '2024-01-01', end: '2024-02-01' }), /valor/);
  assert.throws(() => calculateDebt({ principal: '10', start: '2024-02-01', end: '2024-01-01' }), /posterior/);
  assert.deepEqual(seriesNeeded({ correction: 'IPCA', interest: 'cc' }), ['IPCA', 'TAXA_LEGAL']);
  assert.deepEqual(seriesNeeded({ correction: 'IPCA', interest: 'selic' }), ['SELIC']);
});

test('indices are downloaded in 10-year windows from the SGS and cached for offline use', async t => {
  const { root, store } = await fixture(t);
  const { fetch, calls } = fakeFetch(url => {
    // The Taxa Legal series only exists from 2024: older windows answer 404, as the real API does.
    if (url.includes('sgs.29543') && !url.includes('dataInicial=01/01/2025')) return { status: 404 };
    const year = Number(/dataInicial=01\/01\/(\d{4})/.exec(url)[1]);
    return { body: [{ data: `01/01/${year}`, valor: '0.50' }, { data: `01/02/${year}`, valor: '-0.10' }] };
  });
  const indices = new Indices({ root, fetch, store, clock: () => Date.parse('2026-11-07T12:00:00Z') });
  assert.equal(indices.status().updatedAt, null);
  await indices.update(['IPCA', 'TAXA_LEGAL']);
  const ipcaCalls = calls.filter(c => c.url.includes('sgs.433'));
  assert.deepEqual(ipcaCalls.map(c => /dataInicial=([^&]+)&dataFinal=([^&]+)/.exec(c.url).slice(1).join('-')), ['01/01/1995-31/12/2004', '01/01/2005-31/12/2014', '01/01/2015-31/12/2024', '01/01/2025-31/12/2026']);
  assert.ok(calls.every(c => c.url.startsWith('https://api.bcb.gov.br/dados/serie/bcdata.sgs.') && c.url.includes('formato=json')));
  const values = new Indices({ root, fetch: null }).values(['IPCA', 'TAXA_LEGAL']);
  assert.equal(values.IPCA['2015-02'], -0.1);
  assert.deepEqual(Object.keys(values.TAXA_LEGAL), ['2025-01', '2025-02']);
  assert.equal(new Indices({ root }).status().series.IPCA.last, '2025-02');
  const failing = new Indices({ root, fetch: fakeFetch(() => ({ status: 500 })).fetch });
  await assert.rejects(failing.update(['INPC']), /Banco Central não respondeu/);
  assert.equal(new Indices({ root }).status().series.IPCA.count, 8, 'a failed update keeps the cache');
});

test('debt report is recalculated from the cache and becomes a PDF', async t => {
  const { root } = await fixture(t);
  fs.writeFileSync(path.join(root, 'indices.json'), JSON.stringify({ updatedAt: '2026-11-07', series: { IPCA, TAXA_LEGAL } }));
  const { blocks, title } = report({ principal: '1000', start: '2024-08-30', end: '2024-08-31', interest: 'legal' }, new Indices({ root }));
  const text = blocks.map(b => b.runs.map(r => r.text).join('')).join('\n');
  assert.match(text, /TOTAL: R\$ 1\.000,20/);
  assert.match(text, /Taxa Legal/);
  assert.equal(title, 'Memória de cálculo 31-08-2024');
  const { PDFDocument } = require('pdf-lib');
  assert.ok((await PDFDocument.load(await pdf(blocks, { title }))).getPageCount() >= 1);
});

test('DataJud: request format, merged movements, news count and errors', async t => {
  const { store, settings } = await fixture(t);
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', number: '00000016320248090051' });
  const movement = (codigo, dataHora, nome) => ({ codigo, dataHora, nome, orgaoJulgador: { nome: '21ª Vara Cível' } });
  let movements = [movement(26, '2024-03-01T10:00:00.000Z', 'Distribuído por sorteio'), movement(85, '2024-03-05T11:00:00.000Z', 'Petição')];
  const { fetch, calls } = fakeFetch(() => ({
    body: { hits: { hits: [{ _source: { tribunal: 'TJGO', grau: 'G1', numeroProcesso: '00000016320248090051', nivelSigilo: 0, dataAjuizamento: '20240301100000', classe: { nome: 'Procedimento Comum Cível' }, orgaoJulgador: { nome: '21ª Vara Cível' }, movimentos: movements } }] } },
  }));
  const datajud = new DataJud({ store, settings, fetch });
  await assert.rejects(datajud.refresh(caseItem.id), /Ative a consulta/);
  settings.save({ datajudEnabled: true });
  const first = await datajud.refresh(caseItem.id);
  assert.equal(calls[0].url, 'https://api-publica.datajud.cnj.jus.br/api_publica_tjgo/_search');
  assert.equal(calls[0].options.headers.Authorization, `APIKey ${DEFAULT_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { size: 10, query: { match: { numeroProcesso: '00000016320248090051' } } });
  assert.equal(first.added, 2);
  assert.equal(first.newCount, 0, 'first import is history');
  assert.deepEqual(first.meta, { classe: 'Procedimento Comum Cível', orgao: '21ª Vara Cível', graus: ['G1'], sigilo: 0, filedAt: '2024-03-01', updatedAt: '', tribunal: 'TJGO' });
  assert.equal(first.movements[0].name, 'Petição', 'newest first');
  movements = [...movements, movement(193, '2024-04-10T09:00:00.000Z', 'Decisão')];
  assert.equal((await datajud.refresh(caseItem.id)).added, 1);
  assert.deepEqual(datajud.newCounts(), { [caseItem.id]: 1 });
  datajud.markSeen(caseItem.id);
  assert.deepEqual(datajud.newCounts(), {});
  const manual = datajud.addManual(caseItem.id, { date: '2024-05-01', name: 'Protocolo de memoriais' });
  assert.equal(manual.movements.filter(m => m.source === 'manual').length, 1);
  assert.equal(datajud.removeManual(caseItem.id, manual.movements.find(m => m.source === 'manual').id).movements.length, 3);
  settings.save({ datajudKey: 'NOVA_CHAVE==' });
  const rejected = new DataJud({ store, settings, fetch: fakeFetch(() => ({ status: 403 })).fetch });
  await assert.rejects(rejected.refresh(caseItem.id), /recusou a chave/);
  assert.throws(() => settings.save({ datajudKey: 'APIKey abc def' }), /Chave do DataJud/);
  const noNumber = store.save('cases', { title: 'Sem número', status: 'Em andamento' });
  await assert.rejects(datajud.refresh(noNumber.id), /número CNJ válido/);
  store.remove('cases', caseItem.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM case_movements').get().n, 0);
});

test('DJEN: queries each lawyer by OAB, pages, links cases and never stores a publication twice', async t => {
  const { store, settings } = await fixture(t);
  const caseItem = store.save('cases', { title: 'Indenização', status: 'Em andamento', number: '00000016320248090051' });
  const item = (id, extra = {}) => ({
    id,
    data_disponibilizacao: '2026-11-05',
    siglaTribunal: 'TJGO',
    tipoComunicacao: 'Intimação',
    nomeOrgao: '21ª Vara Cível',
    texto: '<p>Intime-se a parte autora para <b>réplica</b>.</p>',
    numero_processo: '00000016320248090051',
    numeroprocessocommascara: '0000001-63.2024.8.09.0051',
    link: 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/abc/certidao',
    nomeClasse: 'Procedimento Comum Cível',
    ativo: true,
    destinatarioadvogados: [{ advogado: { nome: 'Marina Exemplo', numero_oab: '12345', uf_oab: 'GO' } }],
    ...extra,
  });
  const page1 = Array.from({ length: 100 }, (_, i) => item(1000 + i, { numero_processo: '11111111111111111111' }));
  const { fetch, calls } = fakeFetch(url => {
    const page = Number(new URL(url).searchParams.get('pagina'));
    return { body: { status: 'success', count: 103, items: page === 1 ? page1 : [item(1), item(2, { ativo: false }), item(3, { link: 'https://evil.example/x' })] } };
  });
  const clock = () => Date.parse('2026-11-07T12:00:00Z');
  const djen = new DJEN({ store, settings, fetch, clock });
  await assert.rejects(djen.check(), /Ative a consulta/);
  settings.save({ djenEnabled: true });
  await assert.rejects(djen.check(), /Cadastre os advogados/);
  settings.save({ lawyers: [{ name: 'Marina Exemplo', oab: '12.345', uf: 'GO' }] });
  const result = await djen.check();
  assert.deepEqual(result, { found: 103, added: 103, from: '2026-10-31', to: '2026-11-07' });
  const params = new URL(calls[0].url).searchParams;
  assert.equal(calls[0].url.split('?')[0], 'https://comunicaapi.pje.jus.br/api/v1/comunicacao');
  assert.deepEqual(Object.fromEntries(params), { numeroOab: '12345', ufOab: 'GO', dataDisponibilizacaoInicio: '2026-10-31', dataDisponibilizacaoFim: '2026-11-07', itensPorPagina: '100', pagina: '1' });
  assert.equal(calls.length, 2, 'stops when a page is not full');
  const list = djen.list();
  const one = list.find(i => i.id === '1');
  assert.equal(one.caseId, caseItem.id);
  assert.equal(one.texto, 'Intime-se a parte autora para réplica.');
  assert.equal(one.status, 'new');
  assert.equal(list.find(i => i.id === '2').status, 'dismissed', 'cancelled publications');
  assert.equal(list.find(i => i.id === '3').link, '', 'only links on .jus.br');
  assert.throws(() => djen.link('3'), /não traz link/);
  // The next check starts one day before the last one and does not duplicate anything.
  const again = await new DJEN({ store, settings, fetch, clock: () => Date.parse('2026-11-08T12:00:00Z') }).check();
  assert.equal(again.added, 0);
  assert.equal(again.from, '2026-11-06');
  djen.setStatus('1', 'done');
  assert.equal(djen.list().find(i => i.id === '1').status, 'done');
  assert.throws(() => djen.setStatus('1', 'x'), /inválida/);
  const limited = new DJEN({ store, settings, fetch: fakeFetch(() => ({ status: 429 })).fetch, clock });
  await assert.rejects(limited.check(), /Muitas consultas/);
});
