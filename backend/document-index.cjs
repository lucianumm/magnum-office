// Search inside documents: the text of PDF, DOCX, TXT and CSV files is extracted once, kept encrypted
// next to the document, and searched in memory. Scanned PDFs (images only) have no text to find.
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const indexable = new Set(['.pdf', '.docx', '.txt', '.csv']);
const MAX_BYTES = 40 * 1024 * 1024;
const normalize = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function extractInWorker(bytes, ext, timeout = 60000) {
  return new Promise(resolve => {
    const worker = new Worker(path.join(__dirname, 'document-text-worker.cjs'), {
      workerData: { bytes, ext },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ error: 'Tempo esgotado ao ler o documento.' });
    }, timeout);
    worker.once('message', message => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', error => {
      clearTimeout(timer);
      resolve({ error: error.message });
    });
  });
}

class DocumentIndex {
  constructor({ store, documents }) {
    Object.assign(this, { store, documents });
    this.running = null;
  }
  write(id, status, text) {
    this.store.db
      .prepare(
        'INSERT INTO document_text(document_id,payload,status,extracted_at) VALUES(?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET payload=excluded.payload,status=excluded.status,extracted_at=excluded.extracted_at',
      )
      .run(id, this.store.vault.seal({ text }), status, new Date().toISOString());
  }
  async index(id) {
    const doc = this.store.get('documents', id);
    if (!indexable.has(doc.ext) || doc.size > MAX_BYTES) return this.write(id, 'skipped', '');
    const result = await extractInWorker(this.documents.read(id), doc.ext);
    if (result.error) return this.write(id, 'skipped', '');
    const text = result.text.replace(/[ \t]+/g, ' ').trim();
    this.write(id, text ? 'ok' : 'empty', text);
  }
  // Documents imported before this version, or whose indexing was interrupted.
  pending() {
    return this.store.db
      .prepare(
        "SELECT e.id FROM entities e LEFT JOIN document_text t ON t.document_id = e.id WHERE e.kind='documents' AND t.document_id IS NULL",
      )
      .all()
      .map(r => r.id);
  }
  // One pass at a time; returns how many were indexed.
  async indexPending() {
    if (this.running) return this.running;
    this.running = (async () => {
      let count = 0;
      for (const id of this.pending()) {
        try {
          await this.index(id);
          count++;
        } catch {
          /* removed meanwhile */
        }
      }
      return count;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  status() {
    const rows = this.store.db.prepare('SELECT status, COUNT(*) AS n FROM document_text GROUP BY status').all();
    return { ...Object.fromEntries(rows.map(r => [r.status, r.n])), pending: this.pending().length };
  }
  remove(id) {
    this.store.db.prepare('DELETE FROM document_text WHERE document_id=?').run(id);
  }
  // Every word of the query must appear; accents and case are ignored. Returns a snippet per match.
  search(query, limit = 50) {
    const words = normalize(query)
      .split(/\s+/)
      .filter(w => w.length >= 2);
    if (!words.length || normalize(query).trim().length < 3) return [];
    const docs = new Map(this.store.list('documents').map(d => [d.id, d]));
    const results = [];
    for (const row of this.store.db.prepare("SELECT document_id, payload FROM document_text WHERE status='ok'").all()) {
      const doc = docs.get(row.document_id);
      if (!doc) continue;
      const { text } = this.store.vault.unseal(row.payload);
      const plain = normalize(text);
      if (!words.every(w => plain.includes(w))) continue;
      // For ordinary (NFC) text, removing accents keeps the number of characters, so the position
      // found in the normalized text also cuts the original.
      const start = Math.max(0, plain.indexOf(words[0]) - 80);
      const snippet = text
        .slice(start, start + 260)
        .replace(/\s+/g, ' ')
        .trim();
      results.push({
        id: doc.id,
        name: doc.name,
        caseId: doc.caseId,
        clientId: doc.clientId,
        snippet: `${start > 0 ? '… ' : ''}${snippet} …`,
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}
module.exports = { DocumentIndex, extractInWorker, normalize };
