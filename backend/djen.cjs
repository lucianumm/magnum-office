// Communications (intimações) published in the Diário de Justiça Eletrônico Nacional for the office's
// lawyers. Sends only each lawyer's OAB number and state to the CNJ.
// Format confirmed against the live API: GET https://comunicaapi.pje.jus.br/api/v1/comunicacao with
// numeroOab, ufOab, dataDisponibilizacaoInicio/Fim (AAAA-MM-DD), itensPorPagina, pagina; the answer is
// { status, message, count, items: [{ id, data_disponibilizacao, siglaTribunal, tipoComunicacao,
// nomeOrgao, texto, numero_processo, numeroprocessocommascara, link, nomeClasse, destinatarioadvogados... }] }.
const { cnjDigits } = require('../app/cnj.mjs');

const PAGE = 100;
const MAX_PAGES = 10;
const SEARCH_PAGES = 5; // a one-off search reads at most 500 publications
const BASE = 'https://comunicaapi.pje.jus.br/api/v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Local calendar day (at 22h in Brasília it is already tomorrow in UTC).
const day = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plain = s =>
  String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

class DJEN {
  // pause: milliseconds between pages (the API limits requests; 0 in tests).
  constructor({ store, settings, fetch, clock = Date.now, pause = 400 }) {
    Object.assign(this, { store, settings, fetch, clock, pause });
    this.lastSearch = new Map();
    this.remaining = null;
  }
  // One page of the API with the given filters: { items, count, remaining }.
  async request(filters, page, perPage = PAGE) {
    const retryAt = Date.parse(this.settings.get().djenRetryAt || '');
    if (retryAt > this.clock())
      throw Object.assign(
        new Error(
          `O DJEN pediu para esperar. Tente de novo depois das ${new Date(retryAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
        ),
        { code: 'RATE' },
      );
    const params = new URLSearchParams({ ...filters, itensPorPagina: String(perPage), pagina: String(page) });
    let response;
    try {
      response = await this.fetch(`${BASE}/comunicacao?${params}`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Sem conexão com o Diário de Justiça Eletrônico Nacional. Verifique a internet.');
    }
    const header = name => (typeof response.headers?.get === 'function' ? response.headers.get(name) : null);
    const left = Number(header('x-ratelimit-remaining'));
    this.remaining = Number.isFinite(left) && header('x-ratelimit-remaining') !== null ? left : this.remaining;
    if (response.status === 429) {
      // The API asks to wait one minute.
      this.settings.internal({ djenRetryAt: new Date(this.clock() + 60000).toISOString() });
      throw Object.assign(new Error('Muitas consultas ao DJEN. Tente de novo em alguns minutos.'), { code: 'RATE' });
    }
    if (!response.ok) throw new Error(`O DJEN não respondeu (código ${response.status}). Tente mais tarde.`);
    const json = await response.json();
    if (!Array.isArray(json?.items)) throw new Error('Resposta inesperada do DJEN.');
    return { items: json.items, count: Number(json.count) || json.items.length, remaining: this.remaining };
  }
  async page(lawyer, from, to, page) {
    const { items } = await this.request(
      {
        numeroOab: lawyer.oab.replace(/\D/g, ''),
        ufOab: lawyer.uf,
        dataDisponibilizacaoInicio: from,
        dataDisponibilizacaoFim: to,
      },
      page,
    );
    return items;
  }
  normalize(item) {
    return {
      djenId: String(item.id),
      date: String(item.data_disponibilizacao || '').slice(0, 10),
      tribunal: String(item.siglaTribunal || ''),
      tipo: String(item.tipoComunicacao || ''),
      orgao: String(item.nomeOrgao || ''),
      classe: String(item.nomeClasse || ''),
      documento: String(item.tipoDocumento || ''),
      texto: plain(item.texto).slice(0, 30000),
      hash: String(item.hash || ''),
      processo: cnjDigits(item.numero_processo),
      processoMascara: String(item.numeroprocessocommascara || ''),
      link: /^https:\/\/[^/]+\.jus\.br\//.test(String(item.link || '')) ? String(item.link) : '',
      cancelled: item.ativo === false || !!item.data_cancelamento,
      lawyers: (item.destinatarioadvogados || []).map(a => ({
        nome: String(a.advogado?.nome || ''),
        oab: String(a.advogado?.numero_oab || ''),
        uf: String(a.advogado?.uf_oab || ''),
      })),
      // Who the publication is addressed to, with the side of the case (A active, P passive, T third party).
      parties: (item.destinatarios || [])
        .map(d => ({ nome: String(d.nome || '').slice(0, 200), polo: String(d.polo || '').slice(0, 2) }))
        .filter(d => d.nome)
        .slice(0, 20),
    };
  }
  async check() {
    const cfg = this.settings.get();
    if (!cfg.djenEnabled) throw new Error('Ative a consulta ao DJEN em Configurações → Consultas públicas.');
    const lawyers = (cfg.lawyers || []).filter(l => l.oab && l.uf);
    if (!lawyers.length)
      throw new Error('Cadastre os advogados do escritório com OAB e UF em Configurações → Escritório.');
    const to = day(this.clock());
    // From the last check (one day of overlap) or the last 7 days; never more than 30 days at once.
    const last = cfg.lastDjenCheck ? Date.parse(cfg.lastDjenCheck) - 86400000 : this.clock() - 7 * 86400000;
    const from = day(Math.max(last, this.clock() - 30 * 86400000));
    const cases = this.caseNumbers();
    const insert = this.store.db.prepare(
      'INSERT OR IGNORE INTO intimations(id,payload,status,case_id,published,created_at) VALUES(?,?,?,?,?,?)',
    );
    let found = 0,
      added = 0;
    const failures = [];
    for (const lawyer of lawyers) {
      // One lawyer failing (or the limit being reached) must not hide the publications of the others.
      try {
        for (let page = 1; page <= MAX_PAGES; page++) {
          if (page > 1 && this.pause) await sleep(this.pause);
          const items = await this.page(lawyer, from, to, page);
          found += items.length;
          for (const item of items) {
            const value = this.normalize(item);
            if (!value.djenId || !value.date) continue;
            added += insert.run(
              value.djenId,
              this.store.vault.seal(value),
              value.cancelled ? 'dismissed' : 'new',
              cases.get(value.processo) || null,
              value.date,
              new Date(this.clock()).toISOString(),
            ).changes;
          }
          if (items.length < PAGE) break;
        }
      } catch (error) {
        failures.push({ lawyer: lawyer.name || lawyer.oab, error });
        if (error.code === 'RATE') break;
      }
    }
    if (failures.length === lawyers.length || (failures.length && failures[0].error.code === 'RATE' && !found)) {
      const error = failures[0].error;
      this.fail(error.message);
      throw error;
    }
    const now = new Date(this.clock()).toISOString();
    if (failures.length) {
      // Partial failure: what was found is kept and the problem is shown, without moving "last check" forward.
      this.settings.internal({
        djenError: `Não foi possível consultar: ${failures.map(f => f.lawyer).join(', ')}. ${failures[0].error.message}`,
        lastDjenResult: { at: now, found, added, partial: true },
      });
    } else {
      this.settings.internal({
        lastDjenCheck: now,
        djenError: '',
        djenFirstFailure: '',
        lastDjenResult: { at: now, found, added, partial: false },
      });
    }
    if (added) this.store.audit('djen.checked', { code: String(added) });
    return { found, added, from, to };
  }
  // Remembers when failures began: three days in a row is worth a loud warning (a publication could be missed).
  fail(message) {
    const cfg = this.settings.get();
    this.settings.internal({
      djenError: message,
      djenFirstFailure: cfg.djenFirstFailure || new Date(this.clock()).toISOString(),
    });
  }
  caseNumbers() {
    return new Map(
      this.store
        .list('cases')
        .map(c => [cnjDigits(c.number), c.id])
        .filter(([digits]) => digits.length === 20),
    );
  }
  // What the screen shows about the health of the consultation.
  health() {
    const cfg = this.settings.get();
    const firstFailure = cfg.djenFirstFailure ? Date.parse(cfg.djenFirstFailure) : 0;
    return {
      enabled: cfg.djenEnabled === true,
      lastCheck: cfg.lastDjenCheck || '',
      lastResult: cfg.lastDjenResult || null,
      error: cfg.djenError || '',
      failingDays: firstFailure ? Math.floor((this.clock() - firstFailure) / 86400000) : 0,
      remaining: this.remaining,
      retryAt: Date.parse(cfg.djenRetryAt || '') > this.clock() ? cfg.djenRetryAt : '',
    };
  }
  // A one-off search (any lawyer, party, process or court). Nothing enters the inbox until "keep" is used.
  // input: { oab, uf, nomeAdvogado, nomeParte, numeroProcesso, siglaTribunal, de, ate, meio }
  async search(input = {}) {
    const f = {};
    const oab = String(input.oab || '').replace(/\D/g, '');
    if (oab) {
      if (!/^[A-Za-z]{2}$/.test(String(input.uf || ''))) throw new Error('Informe a UF da OAB.');
      f.numeroOab = oab;
      f.ufOab = String(input.uf).toUpperCase();
    }
    for (const [key, max] of [
      ['nomeAdvogado', 160],
      ['nomeParte', 160],
      ['siglaTribunal', 12],
    ]) {
      const value = String(input[key] || '').trim();
      if (value) f[key] = value.slice(0, max);
    }
    const number = String(input.numeroProcesso || '').replace(/\D/g, '');
    if (number) {
      if (number.length !== 20) throw new Error('O número do processo deve ter 20 dígitos (padrão CNJ).');
      f.numeroProcesso = number;
    }
    if (!Object.keys(f).length)
      throw new Error('Informe a OAB, o nome do advogado ou da parte, o número do processo ou o tribunal.');
    const onlyCourt = !f.numeroOab && !f.nomeAdvogado && !f.nomeParte && !f.numeroProcesso;
    if (onlyCourt && !input.de) throw new Error('Para buscar só por tribunal, informe também o período.');
    const valid = k => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));
    if (input.de) {
      if (!valid(input.de)) throw new Error('Data inicial inválida.');
      f.dataDisponibilizacaoInicio = input.de;
    }
    if (input.ate) {
      if (!valid(input.ate)) throw new Error('Data final inválida.');
      f.dataDisponibilizacaoFim = input.ate;
    }
    if (input.de && input.ate && input.de > input.ate) throw new Error('A data inicial vem depois da final.');
    if (['D', 'E'].includes(input.meio)) f.meio = input.meio;
    const items = [];
    let count = 0;
    for (let page = 1; page <= SEARCH_PAGES; page++) {
      if (page > 1 && this.pause) await sleep(this.pause);
      const r = await this.request(f, page);
      count = r.count;
      items.push(...r.items);
      if (r.items.length < PAGE) break;
    }
    const cases = this.caseNumbers();
    const stored = new Set(
      this.store.db
        .prepare('SELECT id FROM intimations')
        .all()
        .map(r => r.id),
    );
    this.lastSearch = new Map();
    const result = items
      .map(item => this.normalize(item))
      .filter(v => v.djenId && v.date)
      .map(v => {
        this.lastSearch.set(v.djenId, v);
        return {
          ...v,
          id: v.djenId,
          status: 'search',
          caseId: cases.get(v.processo) || '',
          kept: stored.has(v.djenId),
        };
      });
    return {
      items: result,
      count,
      truncated: count > items.length,
      capped: count >= 10000 && !f.numeroProcesso,
      remaining: this.remaining,
    };
  }
  // Moves one result of the last search into the intimations list.
  keep(id) {
    const value = this.lastSearch.get(String(id));
    if (!value) throw new Error('Refaça a busca para guardar esta publicação.');
    const cases = this.caseNumbers();
    this.store.db
      .prepare('INSERT OR IGNORE INTO intimations(id,payload,status,case_id,published,created_at) VALUES(?,?,?,?,?,?)')
      .run(
        value.djenId,
        this.store.vault.seal(value),
        value.cancelled ? 'dismissed' : 'new',
        cases.get(value.processo) || null,
        value.date,
        new Date(this.clock()).toISOString(),
      );
    this.store.audit('djen.kept', { id: value.djenId });
    return true;
  }
  // The certidão (PDF) of a stored publication, from the API's own certificate address.
  async certificate(id) {
    const row = this.store.db.prepare('SELECT payload FROM intimations WHERE id=?').get(String(id));
    if (!row) throw new Error('Intimação não encontrada.');
    const value = this.store.vault.unseal(row.payload);
    const fromLink = (/\/comunicacao\/([^/]+)\/certidao/.exec(value.link || '') || [])[1];
    const hash = String(value.hash || fromLink || '');
    if (!/^[\w-]{3,100}$/.test(hash)) throw new Error('Esta publicação não traz certidão.');
    let response;
    try {
      response = await this.fetch(`${BASE}/comunicacao/${hash}/certidao`, { headers: { Accept: 'application/pdf' } });
    } catch {
      throw new Error('Sem conexão com o DJEN. Verifique a internet.');
    }
    if (response.status === 429) {
      this.settings.internal({ djenRetryAt: new Date(this.clock() + 60000).toISOString() });
      throw new Error('Muitas consultas ao DJEN. Tente de novo em alguns minutos.');
    }
    if (!response.ok) throw new Error(`O DJEN não entregou a certidão (código ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 8 || bytes.subarray(0, 4).toString() !== '%PDF')
      throw new Error('A certidão recebida não é um PDF.');
    const label = String(value.processoMascara || value.processo || hash).replace(/[^\d.-]/g, '');
    return { bytes, name: `certidao-${label}-${value.date}.pdf` };
  }
  // Courts that publish in the DJEN (for the search field). A failure gives an empty list.
  async courts() {
    if (this.courtList) return this.courtList;
    try {
      const response = await this.fetch(`${BASE}/comunicacao/tribunal`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return [];
      const json = await response.json();
      const rows = Array.isArray(json) ? json : json?.items || json?.data || [];
      const flat = rows.flatMap(r => (Array.isArray(r?.instituicoes) ? r.instituicoes : [r]));
      this.courtList = [...new Set(flat.map(r => String(r?.sigla || r?.siglaTribunal || '')).filter(Boolean))].sort();
      return this.courtList;
    } catch {
      return [];
    }
  }
  // Intimations already stored, newest first; the case link is refreshed for numbers typed later.
  list(limit = 500) {
    const cases = new Map(
      this.store
        .list('cases')
        .map(c => [cnjDigits(c.number), c.id])
        .filter(([digits]) => digits.length === 20),
    );
    return this.store.db
      .prepare('SELECT * FROM intimations ORDER BY published DESC, created_at DESC LIMIT ?')
      .all(limit)
      .map(row => {
        const value = this.store.vault.unseal(row.payload);
        return { ...value, id: row.id, status: row.status, caseId: row.case_id || cases.get(value.processo) || '' };
      });
  }
  setStatus(id, status) {
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || !['new', 'done', 'dismissed'].includes(status))
      throw new Error('Intimação inválida.');
    const changes = this.store.db.prepare('UPDATE intimations SET status=? WHERE id=?').run(status, id).changes;
    if (!changes) throw new Error('Intimação não encontrada.');
    return true;
  }
  link(id) {
    const row = this.store.db.prepare('SELECT payload FROM intimations WHERE id=?').get(String(id));
    if (!row) throw new Error('Intimação não encontrada.');
    const { link } = this.store.vault.unseal(row.payload);
    if (!link) throw new Error('Esta publicação não traz link para o documento.');
    return link;
  }
}
module.exports = { DJEN };
