// Case movements from the CNJ public API (DataJud). It sends only the case number to the CNJ and
// receives public metadata and movements; secret cases are not returned by the API.
// Format confirmed against the live API: POST https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search
// with "Authorization: APIKey <public key>" and {"query":{"match":{"numeroProcesso":"<20 digits>"}}}.
const { createHash } = require('node:crypto');
const { uuid, text } = require('./validation.cjs');
const { parseCNJ, cnjDigits } = require('../app/cnj.mjs');

// Public key published by the CNJ (datajud-wiki.cnj.jus.br/api-publica/acesso), read on 2026-11-07.
// The CNJ may replace it; the office can paste the new one in the settings.
const DEFAULT_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const unsupported = new Set(['stf', 'cnj']);

const movementId = m => createHash('sha256').update(`${m.code}|${m.date}|${m.name}`).digest('hex').slice(0, 16);
function parseFiled(value) {
  const s = String(value || '');
  if (/^\d{14}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

class DataJud {
  constructor({ store, settings, fetch, clock = Date.now }) {
    Object.assign(this, { store, settings, fetch, clock });
  }
  alias(caseItem) {
    const parsed = parseCNJ(caseItem.number);
    if (!parsed?.valid || !parsed.courtId || unsupported.has(parsed.courtId)) return '';
    return 'api_publica_' + parsed.courtId;
  }
  read(caseId) {
    const row = this.store.db.prepare('SELECT payload FROM case_movements WHERE case_id=?').get(caseId);
    return row ? this.store.vault.unseal(row.payload) : { movements: [], meta: null, fetchedAt: null, newCount: 0 };
  }
  write(caseId, data) {
    this.store.db
      .prepare('INSERT INTO case_movements(case_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(case_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at')
      .run(caseId, this.store.vault.seal(data), new Date(this.clock()).toISOString());
  }
  movements(caseId) {
    this.store.get('cases', uuid(caseId));
    return this.read(caseId);
  }
  newCounts() {
    const out = {};
    for (const row of this.store.db.prepare('SELECT case_id, payload FROM case_movements').all()) {
      const n = this.store.vault.unseal(row.payload).newCount || 0;
      if (n) out[row.case_id] = n;
    }
    return out;
  }
  markSeen(caseId) {
    const data = this.read(uuid(caseId));
    if (data.newCount) this.write(caseId, { ...data, newCount: 0 });
    return true;
  }
  addManual(caseId, input) {
    this.store.get('cases', uuid(caseId));
    const date = text(input?.date || '', 10);
    const name = text(input?.name || '', 2000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) throw new Error('Informe a data e a descrição do andamento.');
    const data = this.read(caseId);
    const movement = { date: `${date}T12:00:00.000Z`, name, code: 0, complements: [], orgao: '', source: 'manual' };
    movement.id = movementId({ ...movement, date: movement.date + Math.random() });
    this.write(caseId, { ...data, movements: [...data.movements, movement].sort((a, b) => b.date.localeCompare(a.date)) });
    this.store.audit('movement.added', { id: caseId });
    return this.read(caseId);
  }
  removeManual(caseId, id) {
    const data = this.read(uuid(caseId));
    this.write(caseId, { ...data, movements: data.movements.filter(m => !(m.id === id && m.source === 'manual')) });
    return this.read(caseId);
  }
  async query(alias, digits) {
    const key = this.settings.get().datajudKey || DEFAULT_KEY;
    let response;
    try {
      response = await this.fetch(`https://api-publica.datajud.cnj.jus.br/${alias}/_search`, {
        method: 'POST',
        headers: { Authorization: `APIKey ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: digits } } }),
      });
    } catch {
      throw new Error('Sem conexão com o DataJud. Verifique a internet e tente de novo.');
    }
    if (response.status === 401 || response.status === 403)
      throw Object.assign(new Error('O DataJud recusou a chave de acesso. Confira a chave pública atual em Configurações → Consultas públicas.'), { code: 'KEY' });
    if (response.status === 429) throw Object.assign(new Error('Muitas consultas ao DataJud. Tente de novo em alguns minutos.'), { code: 'RATE' });
    if (!response.ok) throw new Error(`O DataJud não respondeu (código ${response.status}). Tente mais tarde.`);
    const json = await response.json();
    return (json?.hits?.hits || []).map(h => h._source).filter(Boolean);
  }
  async refresh(caseId) {
    if (!this.settings.get().datajudEnabled) throw new Error('Ative a consulta ao DataJud em Configurações → Consultas públicas.');
    const caseItem = this.store.get('cases', uuid(caseId));
    const alias = this.alias(caseItem);
    if (!alias) throw new Error('Informe um número CNJ válido de um tribunal atendido pelo DataJud.');
    const sources = await this.query(alias, cnjDigits(caseItem.number));
    const data = this.read(caseId);
    const known = new Set(data.movements.map(m => m.id));
    const incoming = [];
    for (const s of sources)
      for (const m of s.movimentos || []) {
        const movement = {
          date: String(m.dataHora || ''),
          name: text(String(m.nome || ''), 2000),
          code: Number(m.codigo) || 0,
          complements: (m.complementosTabelados || []).map(c => String(c.nome || c.descricao || c.valor || '')).filter(Boolean).slice(0, 10),
          orgao: String(m.orgaoJulgador?.nome || s.orgaoJulgador?.nome || ''),
          grau: String(s.grau || ''),
          source: 'datajud',
        };
        if (!movement.date || !movement.name) continue;
        movement.id = movementId(movement);
        if (!known.has(movement.id)) {
          known.add(movement.id);
          incoming.push(movement);
        }
      }
    const first = sources[0];
    const meta = first
      ? {
          classe: String(first.classe?.nome || ''),
          orgao: String(first.orgaoJulgador?.nome || ''),
          graus: [...new Set(sources.map(s => s.grau).filter(Boolean))],
          sigilo: Math.max(0, ...sources.map(s => Number(s.nivelSigilo) || 0)),
          filedAt: parseFiled(first.dataAjuizamento),
          updatedAt: String(sources.map(s => s.dataHoraUltimaAtualizacao || '').sort().at(-1) || ''),
          tribunal: String(first.tribunal || ''),
        }
      : data.meta;
    // The first import is history, not news.
    const newCount = data.fetchedAt ? (data.newCount || 0) + incoming.length : 0;
    this.write(caseId, {
      movements: [...data.movements, ...incoming].sort((a, b) => b.date.localeCompare(a.date)),
      meta,
      fetchedAt: new Date(this.clock()).toISOString(),
      newCount,
    });
    this.store.audit('datajud.checked', { id: caseId });
    return { added: incoming.length, found: sources.length > 0, ...this.read(caseId) };
  }
  // Daily check of active cases; stops on a rejected key or rate limit.
  async checkAll({ pause = 1500 } = {}) {
    const cases = this.store.list('cases').filter(c => ['Em andamento', 'Aguardando'].includes(c.status) && this.alias(c));
    let checked = 0,
      added = 0;
    for (const c of cases) {
      try {
        const result = await this.refresh(c.id);
        checked++;
        added += result.added;
      } catch (error) {
        if (['KEY', 'RATE'].includes(error.code)) {
          this.settings.internal({ datajudError: error.message });
          break;
        }
      }
      if (pause) await new Promise(r => setTimeout(r, pause));
    }
    this.settings.internal({ lastDatajudCheck: new Date(this.clock()).toISOString(), ...(checked ? { datajudError: '' } : {}) });
    return { checked, added };
  }
}
module.exports = { DataJud, DEFAULT_KEY };
