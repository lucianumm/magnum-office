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
    for (const dir of ['', 'documents', 'backups', 'logs', 'updates', 'temporary']) fs.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(root, 'database.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);');
  }
  async migrate() {
    const files = fs.readdirSync(this.migrations).filter(f => /^\d+-.+\.sql$/.test(f)).sort();
    const applied = this.db.prepare('SELECT * FROM migrations ORDER BY name').all();
    if (applied.some(row => !files.includes(row.name))) throw new Error('Esta base exige uma versão mais recente. Use a recuperação para restaurar uma versão anterior.');
    const pending = [];
    for (const name of files) {
      const sql = fs.readFileSync(path.join(this.migrations, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = applied.find(row => row.name === name);
      if (old && old.checksum !== checksum) throw new Error('Uma migração já aplicada foi alterada. Inicialização interrompida.');
      if (!old) pending.push({ name, sql, checksum });
    }
    if (pending.length) {
      await backup(this.db, path.join(this.root, 'backups', `pre-migration-${Date.now()}.sqlite`));
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of pending) {
          this.db.exec(item.sql);
          this.db.prepare('INSERT INTO migrations VALUES (?,?,?)').run(item.name, item.checksum, new Date().toISOString());
        }
        if (!this.integrity()) throw new Error('Falha de integridade após a migração.');
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (!this.integrity()) throw new Error('A base de dados precisa de recuperação.');
  }
  integrity() { return this.db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && this.db.prepare('PRAGMA foreign_key_check').all().length === 0; }
  list(kind) {
    if (!validation.kinds.includes(kind)) throw new Error('Tipo de registro inválido.');
    return this.db.prepare('SELECT * FROM entities WHERE kind=? ORDER BY updated_at DESC').all(kind).map(row => ({ ...this.vault.unseal(row.payload), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }));
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
    if (payload.clientId) this.get('clients', payload.clientId);
    if (payload.caseId) this.get('cases', payload.caseId);
    const id = input.id ? validation.uuid(input.id) : randomUUID();
    if (input.id) this.get(kind, id);
    return this.put(kind, id, payload);
  }
  put(kind, id, payload) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO entities (id,kind,payload,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(id, kind, this.vault.seal(payload), now, now);
    this.audit('record.saved', { kind, id });
    return this.get(kind, id);
  }
  remove(kind, id) {
    this.get(kind, id);
    if (kind === 'clients' && [...this.list('cases'), ...this.list('tasks'), ...this.list('documents')].some(row => row.clientId === id)) throw new Error('Este cliente está vinculado a outros registros. Remova os vínculos antes de excluir.');
    if (kind === 'cases' && [...this.list('tasks'), ...this.list('notes'), ...this.list('documents')].some(row => row.caseId === id)) throw new Error('Este processo está vinculado a outros registros. Remova os vínculos antes de excluir.');
    this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id);
    if (kind === 'documents') fs.rmSync(path.join(this.root, 'documents', `${id}.enc`), { force: true });
    this.audit('record.removed', { kind, id });
  }
  secret(id, value) {
    if (value === undefined) {
      const row = this.db.prepare('SELECT payload FROM secrets WHERE id=?').get(id);
      return row ? this.vault.unseal(row.payload) : null;
    }
    if (value === null) this.db.prepare('DELETE FROM secrets WHERE id=?').run(id);
    else this.db.prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id, this.vault.seal(value));
  }
  audit(event, metadata = {}) {
    const allowed = ['kind', 'id', 'version', 'fromVersion', 'channel', 'sha256', 'url', 'actor', 'reason', 'code', 'bytes', 'status'];
    const clean = Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.includes(key)));
    const at = new Date().toISOString();
    this.db.prepare('INSERT INTO audit(event,metadata,created_at) VALUES (?,?,?)').run(event, JSON.stringify(clean), at);
    fs.appendFileSync(path.join(this.root, 'logs', 'audit.jsonl'), JSON.stringify({ at, version, event, ...clean }) + '\n', { mode: 0o600 });
  }
  auditList() { return this.db.prepare('SELECT id,event,metadata,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100').all().map(row => ({ ...row, metadata: JSON.parse(row.metadata) })); }
  counts() { return Object.fromEntries(this.db.prepare('SELECT kind,COUNT(*) AS count FROM entities GROUP BY kind').all().map(row => [row.kind, row.count])); }
  close() { this.db.close(); }
}
module.exports = { Store };
