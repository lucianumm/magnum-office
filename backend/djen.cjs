// Communications (intimações) published in the Diário de Justiça Eletrônico Nacional for the office's
// lawyers. Sends only each lawyer's OAB number and state to the CNJ.
// Format confirmed against the live API: GET https://comunicaapi.pje.jus.br/api/v1/comunicacao with
// numeroOab, ufOab, dataDisponibilizacaoInicio/Fim (AAAA-MM-DD), itensPorPagina, pagina; the answer is
// { status, message, count, items: [{ id, data_disponibilizacao, siglaTribunal, tipoComunicacao,
// nomeOrgao, texto, numero_processo, numeroprocessocommascara, link, nomeClasse, destinatarioadvogados... }] }.
const { cnjDigits } = require('../app/cnj.mjs');

const PAGE = 100;
const MAX_PAGES = 10;
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
  constructor({ store, settings, fetch, clock = Date.now }) {
    Object.assign(this, { store, settings, fetch, clock });
  }
  async page(lawyer, from, to, page) {
    const params = new URLSearchParams({
      numeroOab: lawyer.oab.replace(/\D/g, ''),
      ufOab: lawyer.uf,
      dataDisponibilizacaoInicio: from,
      dataDisponibilizacaoFim: to,
      itensPorPagina: String(PAGE),
      pagina: String(page),
    });
    let response;
    try {
      response = await this.fetch(`https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params}`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('Sem conexão com o Diário de Justiça Eletrônico Nacional. Verifique a internet.');
    }
    if (response.status === 429) throw Object.assign(new Error('Muitas consultas ao DJEN. Tente de novo em alguns minutos.'), { code: 'RATE' });
    if (!response.ok) throw new Error(`O DJEN não respondeu (código ${response.status}). Tente mais tarde.`);
    const json = await response.json();
    if (!Array.isArray(json?.items)) throw new Error('Resposta inesperada do DJEN.');
    return json.items;
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
      processo: cnjDigits(item.numero_processo),
      processoMascara: String(item.numeroprocessocommascara || ''),
      link: /^https:\/\/[^/]+\.jus\.br\//.test(String(item.link || '')) ? String(item.link) : '',
      cancelled: item.ativo === false || !!item.data_cancelamento,
      lawyers: (item.destinatarioadvogados || []).map(a => ({ nome: String(a.advogado?.nome || ''), oab: String(a.advogado?.numero_oab || ''), uf: String(a.advogado?.uf_oab || '') })),
    };
  }
  async check() {
    const cfg = this.settings.get();
    if (!cfg.djenEnabled) throw new Error('Ative a consulta ao DJEN em Configurações → Consultas públicas.');
    const lawyers = (cfg.lawyers || []).filter(l => l.oab && l.uf);
    if (!lawyers.length) throw new Error('Cadastre os advogados do escritório com OAB e UF em Configurações → Escritório.');
    const to = day(this.clock());
    // From the last check (one day of overlap) or the last 7 days; never more than 30 days at once.
    const last = cfg.lastDjenCheck ? Date.parse(cfg.lastDjenCheck) - 86400000 : this.clock() - 7 * 86400000;
    const from = day(Math.max(last, this.clock() - 30 * 86400000));
    const cases = new Map(this.store.list('cases').map(c => [cnjDigits(c.number), c.id]).filter(([digits]) => digits.length === 20));
    const insert = this.store.db.prepare('INSERT OR IGNORE INTO intimations(id,payload,status,case_id,published,created_at) VALUES(?,?,?,?,?,?)');
    let found = 0,
      added = 0;
    for (const lawyer of lawyers) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const items = await this.page(lawyer, from, to, page);
        found += items.length;
        for (const item of items) {
          const value = this.normalize(item);
          if (!value.djenId || !value.date) continue;
          added += insert.run(value.djenId, this.store.vault.seal(value), value.cancelled ? 'dismissed' : 'new', cases.get(value.processo) || null, value.date, new Date(this.clock()).toISOString()).changes;
        }
        if (items.length < PAGE) break;
      }
    }
    this.settings.internal({ lastDjenCheck: new Date(this.clock()).toISOString(), djenError: '' });
    if (added) this.store.audit('djen.checked', { code: String(added) });
    return { found, added, from, to };
  }
  // Intimations already stored, newest first; the case link is refreshed for numbers typed later.
  list(limit = 500) {
    const cases = new Map(this.store.list('cases').map(c => [cnjDigits(c.number), c.id]).filter(([digits]) => digits.length === 20));
    return this.store.db
      .prepare('SELECT * FROM intimations ORDER BY published DESC, created_at DESC LIMIT ?')
      .all(limit)
      .map(row => {
        const value = this.store.vault.unseal(row.payload);
        return { ...value, id: row.id, status: row.status, caseId: row.case_id || cases.get(value.processo) || '' };
      });
  }
  setStatus(id, status) {
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || !['new', 'done', 'dismissed'].includes(status)) throw new Error('Intimação inválida.');
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
