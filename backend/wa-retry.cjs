// What the program keeps so WhatsApp can recover from two things, both for 24 hours only:
//  - Outbox: the text of every message sent. When the client's phone shows "Aguardando mensagem" WhatsApp asks the
//    sender for the message again (a retry receipt) and the library calls getMessage: the answer comes from here,
//    so it works even after the program was restarted.
//  - Journal: every message received. The same message delivered twice (WhatsApp repeats them after a drop) is
//    handled once; an answer that was cut by a crash is resumed if it is less than 10 minutes old; the text is erased
//    as soon as the conversation is handled.
const KEEP_MS = 24 * 3600000;
const RESUME_MS = 10 * 60000;

class Outbox {
  constructor({ store, clock = Date.now }) {
    Object.assign(this, { store, clock });
  }
  remember(keyId, jid, body) {
    if (!keyId) return;
    this.store.db
      .prepare('INSERT OR REPLACE INTO wa_outbox(key_id,payload,created_at) VALUES(?,?,?)')
      .run(
        String(keyId),
        this.store.vault.seal({ jid: String(jid), body: String(body) }),
        new Date(this.clock()).toISOString(),
      );
  }
  // The message for WhatsApp's retry, in the library's format, or undefined when it is unknown or older than 24 h.
  find(keyId) {
    const row = this.store.db.prepare('SELECT payload,created_at FROM wa_outbox WHERE key_id=?').get(String(keyId));
    if (!row || this.clock() - Date.parse(row.created_at) > KEEP_MS) return undefined;
    return { conversation: this.store.vault.unseal(row.payload).body };
  }
  purge() {
    return Number(
      this.store.db
        .prepare('DELETE FROM wa_outbox WHERE created_at < ?')
        .run(new Date(this.clock() - KEEP_MS).toISOString()).changes,
    );
  }
  count() {
    return this.store.db.prepare('SELECT COUNT(*) AS n FROM wa_outbox').get().n;
  }
}

class Journal {
  constructor({ store, clock = Date.now }) {
    Object.assign(this, { store, clock });
    // Being handled right now by this run: never picked up again as "interrupted".
    this.active = new Set();
  }
  // false when this message was already seen (handled, being handled or abandoned): it must not be handled again.
  begin(record) {
    const now = new Date(this.clock()).toISOString();
    const added = this.store.db
      .prepare("INSERT OR IGNORE INTO wa_journal(msg_id,status,payload,started_at) VALUES(?,'processing',?,?)")
      .run(String(record.id), this.store.vault.seal(record), now).changes;
    if (added > 0) this.active.add(String(record.id));
    return added > 0;
  }
  // The conversation is over: the text is erased and only the fact that it was handled stays (for 24 h).
  finish(id) {
    this.active.delete(String(id));
    this.store.db
      .prepare("UPDATE wa_journal SET status='done',payload=NULL,finished_at=? WHERE msg_id=? AND status='processing'")
      .run(new Date(this.clock()).toISOString(), String(id));
  }
  // Interrupted and recent: [{ record }] to handle again. Older ones are given up (text erased, never answered late).
  interrupted() {
    const now = this.clock();
    const result = [];
    for (const row of this.store.db.prepare("SELECT * FROM wa_journal WHERE status='processing'").all()) {
      if (this.active.has(row.msg_id)) continue;
      if (now - Date.parse(row.started_at) < RESUME_MS && row.payload)
        result.push({ id: row.msg_id, record: this.store.vault.unseal(row.payload) });
      else
        this.store.db
          .prepare("UPDATE wa_journal SET status='abandoned',payload=NULL,finished_at=? WHERE msg_id=?")
          .run(new Date(now).toISOString(), row.msg_id);
    }
    return result;
  }
  purge() {
    return Number(
      this.store.db
        .prepare('DELETE FROM wa_journal WHERE started_at < ?')
        .run(new Date(this.clock() - KEEP_MS).toISOString()).changes,
    );
  }
  status() {
    const rows = this.store.db.prepare('SELECT status, COUNT(*) AS n FROM wa_journal GROUP BY status').all();
    return Object.fromEntries(rows.map(r => [r.status, r.n]));
  }
}
module.exports = { Outbox, Journal, KEEP_MS, RESUME_MS };
