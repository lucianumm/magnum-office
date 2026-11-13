// Messages received on WhatsApp. The program only listens to one-to-one chats and never downloads
// media: a photo or audio is recorded as "media received". Everything is encrypted and removed after
// 30 days. The inbox is OFF unless the office turns it on, and while it is off nothing is stored.
const { randomUUID } = require('node:crypto');
const { numberFromJid, phoneKey, isIndividualJid } = require('../app/phone-match.mjs');

const KEEP_DAYS = 30;
const MAX_TEXT = 4000;

// Plain text of a received message, or '' (stickers, reactions, polls...), and whether it carries media.
function readMessage(message = {}) {
  const m = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message;
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    '';
  const media = Boolean(
    m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage || m.contactMessage,
  );
  return { text: String(text).trim().slice(0, MAX_TEXT), media };
}

class Inbox {
  constructor({ store, settings, clock = Date.now }) {
    Object.assign(this, { store, settings, clock });
    this.onMessage = null; // answer flows (see wa-flows.cjs) hook in here
  }
  enabled() {
    return this.settings.get().waInboxEnabled === true;
  }
  // The client whose number matches, if any.
  clientByPhone(phone) {
    const key = phoneKey(phone);
    if (!key) return null;
    return this.store.list('clients').find(c => phoneKey(c.phone) === key) || null;
  }
  // upsert: one entry of Baileys' messages.upsert. Returns the stored record or null when ignored.
  receive(upsert) {
    if (!this.enabled()) return null;
    const key = upsert?.key || {};
    if (key.fromMe || !isIndividualJid(key.remoteJid)) return null;
    const { text, media } = readMessage(upsert.message);
    if (!text && !media) return null;
    const phone = numberFromJid(key.remoteJid, key.remoteJidAlt);
    const client = phone ? this.clientByPhone(phone) : null;
    const id = String(key.id || randomUUID());
    const at = new Date(Number(upsert.messageTimestamp) * 1000 || this.clock()).toISOString();
    const record = { id, at, phone, clientId: client?.id || '', text, media, replyJid: String(key.remoteJid) };
    const added = this.store.db
      .prepare('INSERT OR IGNORE INTO inbox(id,payload,status,client_id,created_at) VALUES(?,?,?,?,?)')
      .run(id, this.store.vault.seal(record), 'new', client?.id || null, new Date(this.clock()).toISOString()).changes;
    if (!added) return null; // a message already stored (WhatsApp redelivers)
    this.store.audit('whatsapp.received', { code: client ? 'CLIENT' : 'UNKNOWN' });
    return record;
  }
  list(limit = 200) {
    return this.store.db
      .prepare('SELECT * FROM inbox ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(row => ({ ...this.store.vault.unseal(row.payload), status: row.status, clientId: row.client_id || '' }));
  }
  // Replaces the text of a stored message (used so a CPF typed by the client does not stay in the inbox).
  redact(id, text) {
    const row = this.store.db.prepare('SELECT payload FROM inbox WHERE id=?').get(String(id));
    if (!row) return false;
    this.store.db
      .prepare('UPDATE inbox SET payload=? WHERE id=?')
      .run(this.store.vault.seal({ ...this.store.vault.unseal(row.payload), text }), String(id));
    return true;
  }
  setStatus(id, status) {
    if (!['new', 'handled', 'ignored'].includes(status)) throw new Error('Situação inválida.');
    const changes = this.store.db.prepare('UPDATE inbox SET status=? WHERE id=?').run(status, String(id)).changes;
    if (!changes) throw new Error('Mensagem não encontrada.');
    return true;
  }
  newCount() {
    return this.store.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE status='new'").get().n;
  }
  purge() {
    const cutoff = new Date(this.clock() - KEEP_DAYS * 86400000).toISOString();
    return Number(this.store.db.prepare('DELETE FROM inbox WHERE created_at < ?').run(cutoff).changes);
  }
}

module.exports = { Inbox, readMessage, KEEP_DAYS };
