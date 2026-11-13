// Housekeeping of the WhatsApp session kept in the encrypted `secrets` table as `wa:<type>:<id>`.
// The session only grows: group sender keys, device lists and the sessions of people who never wrote.
// Only keys that WhatsApp rebuilds on its own are removed. `creds`, `pre-key`, `identity-key` and
// `app-state-sync-*` are never touched: deleting them disconnects the number.
const TYPES = [
  'app-state-sync-version',
  'app-state-sync-key',
  'sender-key-memory',
  'sender-key',
  'pre-key',
  'session',
  'lid-mapping',
  'device-list',
  'tctoken',
  'identity-key',
];
const parse = id => {
  const m = /^wa:(.+?):(.*)$/.exec(id);
  if (!m) return { type: id === 'wa:creds' ? 'creds' : 'other', key: '' };
  return TYPES.includes(m[1]) ? { type: m[1], key: m[2] } : { type: 'other', key: m[2] };
};
const SESSION_KEEP_DAYS = 90;

// How many keys of each kind exist and how much space they use.
function report(store) {
  const rows = store.db.prepare("SELECT id, LENGTH(payload) AS bytes FROM secrets WHERE id LIKE 'wa:%'").all();
  const byType = {};
  for (const row of rows) {
    const { type } = parse(row.id);
    byType[type] ||= { count: 0, bytes: 0 };
    byType[type].count++;
    byType[type].bytes += row.bytes;
  }
  const total = Object.values(byType).reduce((n, t) => ({ count: n.count + t.count, bytes: n.bytes + t.bytes }), {
    count: 0,
    bytes: 0,
  });
  const safe = ['sender-key', 'sender-key-memory', 'device-list'].reduce((n, t) => n + (byType[t]?.count || 0), 0);
  return { total, byType, removable: safe };
}

// People the office talks to: client numbers and recent recipients. Their sessions are kept.
function contactsToKeep(store, now) {
  const keep = new Set();
  for (const c of store.list('clients')) {
    const digits = String(c.phone || '').replace(/\D/g, '');
    if (digits) keep.add(digits.startsWith('55') ? digits : '55' + digits);
  }
  const since = new Date(now - SESSION_KEEP_DAYS * 86400000).toISOString();
  for (const r of store.db
    .prepare("SELECT payload FROM queue WHERE channel='whatsapp' AND created_at >= ?")
    .all(since)) {
    try {
      const to = String(store.vault.unseal(r.payload).recipient || '').replace(/\D/g, '');
      if (to) keep.add(to);
    } catch {
      /* A row that cannot be read keeps nothing extra. */
    }
  }
  return keep;
}

// Removes what is safe. Run only while the socket is closed (the live key cache would not notice).
function clean(store, { now = Date.now() } = {}) {
  const rows = store.db.prepare("SELECT id FROM secrets WHERE id LIKE 'wa:%'").all();
  const keep = contactsToKeep(store, now);
  const remove = [];
  for (const { id } of rows) {
    const { type, key } = parse(id);
    if (['sender-key', 'sender-key-memory', 'device-list'].includes(type)) remove.push(id);
    // "<number>.<device>": only plain phone sessions of people who are not clients nor recent recipients.
    else if (type === 'session') {
      const m = /^(\d{10,15})(?:[._:]\d+)*$/.exec(key);
      if (m && !keep.has(m[1])) remove.push(id);
    }
  }
  const del = store.db.prepare('DELETE FROM secrets WHERE id=?');
  store.db.exec('BEGIN');
  try {
    for (const id of remove) del.run(id);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  if (remove.length) store.audit('whatsapp.cleaned', { code: String(remove.length) });
  return { removed: remove.length };
}

module.exports = { report, clean, parse, TYPES };
