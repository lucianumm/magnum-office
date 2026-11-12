const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { text, uuid } = require('./validation.cjs');
const allowed = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.odt',
  '.txt',
  '.rtf',
  '.xlsx',
  '.xls',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);
class Documents {
  constructor(store) {
    this.store = store;
  }
  async import(file, links = {}) {
    const stat = await fsp.stat(file);
    const ext = path.extname(file).toLowerCase();
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || !allowed.has(ext))
      throw new Error('Escolha um documento, planilha ou imagem de até 100 MB. Executáveis não são permitidos.');
    return this.save(path.basename(file), await fsp.readFile(file), links);
  }
  // Encrypts content produced or read by the application and lists it with the case/client.
  async save(name, data, links = {}) {
    const ext = path.extname(name).toLowerCase();
    if (!allowed.has(ext) || data.length > 100 * 1024 * 1024)
      throw new Error('Formato ou tamanho de documento não permitido.');
    const id = randomUUID();
    if (links.caseId) this.store.get('cases', uuid(links.caseId));
    if (links.clientId) this.store.get('clients', uuid(links.clientId));
    await fsp.writeFile(path.join(this.store.root, 'documents', id + '.enc'), this.store.vault.seal(data), {
      mode: 0o600,
    });
    try {
      return this.store.put('documents', id, {
        name: text(name, 255),
        size: data.length,
        ext,
        sha256: createHash('sha256').update(data).digest('hex'),
        caseId: links.caseId || '',
        clientId: links.clientId || '',
        notes: '',
      });
    } catch (error) {
      await fsp.rm(path.join(this.store.root, 'documents', id + '.enc'), { force: true });
      throw error;
    }
  }
  read(id) {
    this.store.get('documents', id);
    return this.store.vault.unseal(fs.readFileSync(path.join(this.store.root, 'documents', id + '.enc')), true);
  }
  async temporary(id) {
    const document = this.store.get('documents', id);
    if (!allowed.has(document.ext)) throw new Error('Formato não permitido.');
    const dir = await fsp.mkdtemp(path.join(this.store.root, 'temporary', 'document-'));
    const file = path.join(dir, 'visualizar' + document.ext);
    await fsp.writeFile(file, this.read(id), { mode: 0o600 });
    return file;
  }
  clean() {
    for (const name of fs.readdirSync(path.join(this.store.root, 'temporary')))
      if (/^document-[\w-]+$/.test(name)) {
        try {
          fs.rmSync(path.join(this.store.root, 'temporary', name), { recursive: true, force: true });
        } catch (error) {
          if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        }
      }
  }
}
module.exports = { Documents };
