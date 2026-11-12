const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const validation = require('./validation.cjs');
const version = require('../app/version.cjs');

class Store {
  constructor(root, vault, migrations = path.join(__dirname, '..', 'migrations')) {
    this.root = root;
    this.vault = vault;
    this.migrations = migrations;
    for (const dir of ['', 'documents', 'backups', 'logs', 'updates', 'temporary'])
      fs.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(root, 'database.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);',
    );
    // Decrypted payloads by record, reused while the row's updated_at is unchanged. Decrypting every
    // record on each change was the main cost with large offices (scripts/perf-measure.mjs).
    this.decrypted = new Map();
  }
  unsealRow(row) {
    const cached = this.decrypted.get(row.id);
    if (cached && cached.updatedAt === row.updated_at) return cached.payload;
    const payload = this.vault.unseal(row.payload);
    this.decrypted.set(row.id, { updatedAt: row.updated_at, payload });
    return payload;
  }
  async migrate() {
    const files = fs
      .readdirSync(this.migrations)
      .filter(f => /^\d+-.+\.sql$/.test(f))
      .sort();
    const applied = this.db.prepare('SELECT * FROM migrations ORDER BY name').all();
    if (applied.some(row => !files.includes(row.name)))
      throw new Error('Esta base exige uma versão mais recente. Use a recuperação para restaurar uma versão anterior.');
    const pending = [];
    for (const name of files) {
      const sql = fs.readFileSync(path.join(this.migrations, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = applied.find(row => row.name === name);
      if (old && old.checksum !== checksum)
        throw new Error('Uma migração já aplicada foi alterada. Inicialização interrompida.');
      if (!old) pending.push({ name, sql, checksum });
    }
    if (pending.length) {
      await backup(this.db, path.join(this.root, 'backups', `pre-migration-${Date.now()}.sqlite`));
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // Migrations only add: any table that disappears or ends with fewer rows undoes everything.
        const before = this.rowCounts();
        for (const item of pending) {
          this.db.exec(item.sql);
          this.db
            .prepare('INSERT INTO migrations VALUES (?,?,?)')
            .run(item.name, item.checksum, new Date().toISOString());
        }
        const after = this.rowCounts();
        for (const [table, count] of Object.entries(before))
          if (!(table in after) || after[table] < count)
            throw new Error(`A migração reduziria os dados da tabela ${table}. Inicialização interrompida.`);
        if (!this.integrity()) throw new Error('Falha de integridade após a migração.');
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    if (!this.integrity()) throw new Error('A base de dados precisa de recuperação.');
    this.hasLinks = undefined;
    this.backfillLinks();
  }
  rowCounts() {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name);
    return Object.fromEntries(
      tables.map(t => [t, this.db.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n]),
    );
  }
  // False only on a base kept at a schema older than migration 005 (tests and partial restores).
  linkColumns() {
    if (this.hasLinks === undefined)
      this.hasLinks = this.db
        .prepare('PRAGMA table_info(entities)')
        .all()
        .some(c => c.name === 'case_id');
    return this.hasLinks;
  }
  // Fills client_id/case_id for records saved before migration 005.
  backfillLinks() {
    if (!this.linkColumns()) return;
    if (this.db.prepare("SELECT 1 FROM maintenance WHERE name='entity-links'").get()) return;
    const update = this.db.prepare('UPDATE entities SET client_id=?, case_id=? WHERE id=?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of this.db.prepare('SELECT id, payload FROM entities').all()) {
        const links = this.links(this.vault.unseal(row.payload));
        update.run(links.client, links.case, row.id);
      }
      this.db.prepare("INSERT INTO maintenance VALUES ('entity-links', ?)").run(new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  // A case that depends on another one (appeal, execution) links to it like a task does.
  links(payload) {
    return { client: payload.clientId || null, case: payload.caseId || payload.parentCaseId || null };
  }
  linked(column, id) {
    if (!this.linkColumns())
      return this.db
        .prepare('SELECT payload FROM entities')
        .all()
        .some(row => this.links(this.vault.unseal(row.payload))[column] === id);
    return !!this.db
      .prepare(`SELECT 1 FROM entities WHERE ${column === 'client' ? 'client_id' : 'case_id'}=? LIMIT 1`)
      .get(id);
  }
  integrity() {
    return (
      this.db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' &&
      this.db.prepare('PRAGMA foreign_key_check').all().length === 0
    );
  }
  list(kind) {
    if (!validation.kinds.includes(kind)) throw new Error('Tipo de registro inválido.');
    return this.db
      .prepare('SELECT * FROM entities WHERE kind=? ORDER BY updated_at DESC')
      .all(kind)
      .map(row => ({
        ...structuredCloneSafe(this.unsealRow(row)),
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }
  get(kind, id) {
    validation.uuid(id);
    const row = this.db.prepare('SELECT * FROM entities WHERE kind=? AND id=?').get(kind, id);
    if (!row) throw new Error('Registro não encontrado.');
    return { ...this.vault.unseal(row.payload), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  save(kind, input) {
    if (kind === 'documents') throw new Error('Use a importação de documentos.');
    const payload = validation.entity(kind, input);
    if (kind === 'clients' && payload.birthdayEnabled) {
      const row = this.db.prepare('SELECT payload FROM templates WHERE id=?').get(payload.birthdayTemplateId);
      const model = row && this.vault.unseal(row.payload);
      if (!model || model.kind !== 'whatsapp' || model.purpose !== 'birthday')
        throw new Error('Escolha um modelo de WhatsApp com finalidade Mensagem aniversário.');
      if (require('../app/message-variables.mjs').personalizeMessage(model.body, payload).length > 30000)
        throw new Error('A mensagem de aniversário personalizada excede 30 mil caracteres.');
    }
    if (payload.clientId) this.get('clients', payload.clientId);
    if (payload.caseId) this.get('cases', payload.caseId);
    const id = input.id ? validation.uuid(input.id) : randomUUID();
    if (input.id) this.get(kind, id);
    if (payload.parentCaseId) {
      if (payload.parentCaseId === id) throw new Error('Um processo não pode ser relacionado a ele mesmo.');
      // Walk up the chain so A → B → A cannot be created.
      for (let parent = this.get('cases', payload.parentCaseId), depth = 0; parent.parentCaseId; depth++) {
        if (parent.parentCaseId === id || depth > 50) throw new Error('Essa relação entre processos criaria um ciclo.');
        parent = this.get('cases', parent.parentCaseId);
      }
    }
    return this.put(kind, id, payload);
  }
  put(kind, id, payload) {
    const now = new Date().toISOString();
    const links = this.links(payload);
    if (!this.linkColumns()) {
      this.db
        .prepare(
          'INSERT INTO entities (id,kind,payload,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
        )
        .run(id, kind, this.vault.seal(payload), now, now);
      this.audit('record.saved', { kind, id });
      return this.get(kind, id);
    }
    this.db
      .prepare(
        'INSERT INTO entities (id,kind,payload,created_at,updated_at,client_id,case_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,client_id=excluded.client_id,case_id=excluded.case_id',
      )
      .run(id, kind, this.vault.seal(payload), now, now, links.client, links.case);
    this.audit('record.saved', { kind, id });
    return this.get(kind, id);
  }
  hasTable(name) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  }
  // Excluding moves the record to the trash (migration 009), where it stays for 30 days. Bases kept
  // at an older schema (tests, partial restores) still delete for good.
  remove(kind, id) {
    this.get(kind, id);
    if (kind === 'clients' && this.linked('client', id))
      throw new Error('Este cliente está vinculado a outros registros. Remova os vínculos antes de excluir.');
    if (kind === 'cases' && this.linked('case', id))
      throw new Error('Este processo está vinculado a outros registros. Remova os vínculos antes de excluir.');
    const extra = {};
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (kind === 'cases' && this.hasTable('intimations')) {
        extra.intimations = this.db
          .prepare('SELECT id FROM intimations WHERE case_id=?')
          .all(id)
          .map(r => r.id);
        this.db.prepare('UPDATE intimations SET case_id=NULL WHERE case_id=?').run(id);
      }
      // The text index is rebuilt on restore; a document in the trash must not show up in the search.
      if (kind === 'documents' && this.hasTable('document_text'))
        this.db.prepare('DELETE FROM document_text WHERE document_id=?').run(id);
      if (this.hasTable('trash')) {
        const columns = this.linkColumns() ? ',client_id,case_id' : '';
        this.db
          .prepare(
            `INSERT INTO trash (id,kind,payload,created_at,updated_at${columns},deleted_at,extra) SELECT id,kind,payload,created_at,updated_at${columns},?,? FROM entities WHERE kind=? AND id=?`,
          )
          .run(new Date().toISOString(), JSON.stringify(extra), kind, id);
      } else this.dropFiles(kind, id);
      this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.decrypted.delete(id);
    this.audit('record.removed', { kind, id });
  }
  // What only a final deletion removes: the document file and the movements of a case.
  dropFiles(kind, id) {
    if (kind === 'cases' && this.hasTable('case_movements'))
      this.db.prepare('DELETE FROM case_movements WHERE case_id=?').run(id);
    if (kind === 'documents') fs.rmSync(path.join(this.root, 'documents', `${id}.enc`), { force: true });
  }
  trashList() {
    if (!this.hasTable('trash')) return [];
    return this.db
      .prepare('SELECT id,kind,payload,deleted_at,client_id,case_id FROM trash ORDER BY deleted_at DESC')
      .all()
      .map(row => {
        const p = this.vault.unseal(row.payload);
        return {
          id: row.id,
          kind: row.kind,
          title: p.name || p.title || p.description || 'Sem título',
          deletedAt: row.deleted_at,
          clientId: row.client_id || '',
          caseId: row.case_id || '',
        };
      });
  }
  restore(id) {
    validation.uuid(id);
    const row = this.db.prepare('SELECT * FROM trash WHERE id=?').get(id);
    if (!row) throw new Error('Item não encontrado na lixeira.');
    for (const [kind, linkId] of [
      ['clients', row.client_id],
      ['cases', row.case_id],
    ])
      if (linkId && !this.db.prepare('SELECT 1 FROM entities WHERE kind=? AND id=?').get(kind, linkId))
        throw new Error(
          `Restaure primeiro o ${kind === 'clients' ? 'cliente' : 'processo'} vinculado, que também está na lixeira ou foi excluído.`,
        );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const columns = this.linkColumns() ? ',client_id,case_id' : '';
      this.db
        .prepare(
          `INSERT INTO entities (id,kind,payload,created_at,updated_at${columns}) SELECT id,kind,payload,created_at,?${columns} FROM trash WHERE id=?`,
        )
        .run(new Date().toISOString(), id);
      const extra = JSON.parse(row.extra || '{}');
      if (row.kind === 'cases' && extra.intimations?.length && this.hasTable('intimations')) {
        const relink = this.db.prepare('UPDATE intimations SET case_id=? WHERE id=? AND case_id IS NULL');
        for (const intimation of extra.intimations) relink.run(id, intimation);
      }
      this.db.prepare('DELETE FROM trash WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.audit('record.restored', { kind: row.kind, id });
    return this.get(row.kind, id);
  }
  // Deletes for good: one item ({ id }), everything ({ all: true }) or what is older than N days.
  purgeTrash({ id, all = false, olderThanDays, now = Date.now() } = {}) {
    if (!this.hasTable('trash')) return 0;
    let rows;
    if (id) rows = this.db.prepare('SELECT id,kind FROM trash WHERE id=?').all(validation.uuid(id));
    else if (all) rows = this.db.prepare('SELECT id,kind FROM trash').all();
    else if (olderThanDays)
      rows = this.db
        .prepare('SELECT id,kind FROM trash WHERE deleted_at < ?')
        .all(new Date(now - olderThanDays * 86400000).toISOString());
    else return 0;
    for (const row of rows) {
      this.dropFiles(row.kind, row.id);
      this.db.prepare('DELETE FROM trash WHERE id=?').run(row.id);
    }
    if (rows.length) this.audit('trash.purged', { code: String(rows.length) });
    return rows.length;
  }
  secret(id, value) {
    if (value === undefined) {
      const row = this.db.prepare('SELECT payload FROM secrets WHERE id=?').get(id);
      return row ? this.vault.unseal(row.payload) : null;
    }
    if (value === null) this.db.prepare('DELETE FROM secrets WHERE id=?').run(id);
    else
      this.db
        .prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
        .run(id, this.vault.seal(value));
  }
  audit(event, metadata = {}) {
    const allowed = [
      'kind',
      'id',
      'version',
      'fromVersion',
      'channel',
      'sha256',
      'url',
      'actor',
      'reason',
      'code',
      'bytes',
      'status',
    ];
    const clean = Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.includes(key)));
    const at = new Date().toISOString();
    this.db
      .prepare('INSERT INTO audit(event,metadata,created_at) VALUES (?,?,?)')
      .run(event, JSON.stringify(clean), at);
    fs.appendFileSync(
      path.join(this.root, 'logs', 'audit.jsonl'),
      JSON.stringify({ at, version, event, ...clean }) + '\n',
      { mode: 0o600 },
    );
  }
  auditList() {
    return this.db
      .prepare('SELECT id,event,metadata,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100')
      .all()
      .map(row => ({ ...row, metadata: JSON.parse(row.metadata) }));
  }
  counts() {
    return Object.fromEntries(
      this.db
        .prepare('SELECT kind,COUNT(*) AS count FROM entities GROUP BY kind')
        .all()
        .map(row => [row.kind, row.count]),
    );
  }
  close() {
    this.db.close();
  }
}
// Callers get their own copy of nested values (lists, objects), so the cache cannot be changed by them.
function structuredCloneSafe(payload) {
  for (const value of Object.values(payload)) if (value && typeof value === 'object') return structuredClone(payload);
  return payload;
}
module.exports = { Store };
