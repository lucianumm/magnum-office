const { randomUUID } = require('node:crypto');
const { text, uuid } = require('./validation.cjs');
const { cleanHTML } = require('./email-content.cjs');
class Library {
  constructor(store) {
    this.store = store;
    if (!this.groups().length)
      for (const name of ['Modelos de pedidos', 'Constitutivos', 'Contratos', 'Outros']) this.saveGroup({ name });
    this.seedLegalTemplates();
  }
  seeded() {
    return (
      this.hasMaintenance() && !!this.store.db.prepare("SELECT 1 FROM maintenance WHERE name='legal-templates'").get()
    );
  }
  hasMaintenance() {
    return !!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance'").get();
  }
  // Adds the starting legal templates once. If the office deletes them they do not come back.
  seedLegalTemplates() {
    if (!this.hasMaintenance() || this.seeded()) return;
    const { htmlBlocks, blocksText } = require('../app/document-template.mjs');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of require('./legal-templates.cjs')) {
        const groupId = (this.groups().find(g => g.name === t.group) || this.saveGroup({ name: t.group })).id;
        this.save({ kind: 'document', groupId, title: t.title, html: t.html, body: blocksText(htmlBlocks(t.html)) });
      }
      this.store.db.prepare("INSERT INTO maintenance VALUES ('legal-templates', ?)").run(new Date().toISOString());
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  groups() {
    return this.store.db
      .prepare('SELECT * FROM template_groups')
      .all()
      .map(r => ({ ...this.store.vault.unseal(r.payload), id: r.id }));
  }
  list() {
    return this.store.db
      .prepare('SELECT * FROM templates')
      .all()
      .map(r => ({
        kind: 'document',
        purpose: 'general',
        ...this.store.vault.unseal(r.payload),
        id: r.id,
        groupId: r.group_id,
      }));
  }
  saveGroup(input) {
    const name = text(input.name, 100);
    if (!name) throw new Error('Informe o nome do grupo.');
    const id = input.id ? uuid(input.id) : randomUUID();
    if (input.id && !this.groups().some(g => g.id === id)) throw new Error('Grupo não encontrado.');
    this.store.db
      .prepare(
        'INSERT INTO template_groups(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(id, this.store.vault.seal({ name }));
    this.store.audit('template.group.saved', { id });
    return { id, name };
  }
  save(input) {
    const title = text(input.title, 200),
      body = text(input.body || '', 60000),
      html = cleanHTML(input.html || '');
    if (!title || !body) throw new Error('Informe título e conteúdo do modelo.');
    const groupId = uuid(input.groupId);
    if (!this.groups().some(g => g.id === groupId)) throw new Error('Grupo não encontrado.');
    const id = input.id ? uuid(input.id) : randomUUID();
    if (input.id && !this.list().some(t => t.id === id)) throw new Error('Modelo não encontrado.');
    const kind = input.kind || 'document';
    if (!['document', 'whatsapp', 'email'].includes(kind)) throw new Error('Tipo de modelo inválido.');
    if (kind !== 'document' && body.length > 30000) throw new Error('Mensagens devem ter até 30 mil caracteres.');
    const purpose = input.purpose || (input.id ? this.list().find(t => t.id === id)?.purpose : 'general') || 'general';
    if (!['general', 'birthday'].includes(purpose) || (purpose === 'birthday' && kind !== 'whatsapp'))
      throw new Error('Mensagem aniversário deve ser um modelo de WhatsApp.');
    if (purpose === 'birthday' && [...body.matchAll(/\{(\d+)\}/g)].some(m => !['1', '2', '3'].includes(m[1])))
      throw new Error('Use as variáveis {1}, {2} e {3} no aniversário.');
    const subject = text(input.subject || '', 300);
    const emailDesign = kind === 'email' ? require('./email-design.cjs').normalize(input.emailDesign || {}) : null;
    const payload = {
      title,
      body,
      emailDesign,
      purpose,
      html: kind === 'whatsapp' ? '' : html,
      kind,
      subject,
      updatedAt: new Date().toISOString(),
    };
    this.store.db
      .prepare(
        'INSERT INTO templates(id,group_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,payload=excluded.payload',
      )
      .run(id, groupId, this.store.vault.seal(payload));
    this.store.audit('template.saved', { id });
    return { ...payload, id, groupId };
  }
  remove(type, id) {
    uuid(id);
    if (type === 'group') {
      if (this.list().some(t => t.groupId === id)) throw new Error('Mova os modelos deste grupo antes de excluí-lo.');
      this.store.db.prepare('DELETE FROM template_groups WHERE id=?').run(id);
    } else if (type === 'template') this.store.db.prepare('DELETE FROM templates WHERE id=?').run(id);
    else throw new Error('Tipo inválido.');
    this.store.audit('template.removed', { id });
    return true;
  }
  async readFile(file) {
    const fs = require('node:fs/promises'),
      path = require('node:path');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 5 * 1024 ** 2) throw new Error('Importe arquivos de até 5 MB.');
    const ext = path.extname(file).toLowerCase();
    let html = '',
      body = '';
    if (ext === '.docx') {
      await require('./zip-limits.cjs').checkArchive(file);
      const mammoth = require('mammoth');
      html = cleanHTML((await mammoth.convertToHtml({ path: file }, { externalFileAccess: false })).value);
      body = require('sanitize-html')(html, { allowedTags: [], allowedAttributes: {} });
    } else if (['.txt', '.html', '.htm'].includes(ext)) {
      body = await fs.readFile(file, 'utf8');
      if (ext !== '.txt') {
        html = cleanHTML(body);
        body = require('sanitize-html')(html, { allowedTags: [], allowedAttributes: {} });
      }
    } else throw new Error('Use DOCX, TXT ou HTML.');
    return { title: path.basename(file, ext), body: text(body, 60000), html };
  }
}
module.exports = { Library };
