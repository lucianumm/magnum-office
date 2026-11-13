const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Vault } = require('../backend/vault.cjs');
const { Store } = require('../backend/store.cjs');
const limits = require('../app/send-limits.mjs');
const { phoneKey, samePhone, numberFromJid, isIndividualJid } = require('../app/phone-match.mjs');
const hygiene = require('../backend/wa-hygiene.cjs');
const { Inbox, readMessage } = require('../backend/wa-inbox.cjs');
const { rotateFile, purgeRotated, maintain } = require('../backend/log-rotation.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(base, 'wa-'));
  const store = new Store(root, new Vault(randomBytes(32)));
  await store.migrate();
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}
// 2026-11-11 is a Wednesday, 14 a Saturday, 15 a Sunday.
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();

test('sending window: weekdays 8h-19h, Saturday allowed, Sunday closed; next opening', () => {
  const c = limits.defaultLimits;
  assert.equal(limits.windowOpen(at(11, 7, 59), c), false);
  assert.equal(limits.windowOpen(at(11, 8), c), true);
  assert.equal(limits.windowOpen(at(11, 18, 59), c), true);
  assert.equal(limits.windowOpen(at(11, 19), c), false);
  assert.equal(limits.windowOpen(at(14, 10), c), true, 'Saturday');
  assert.equal(limits.windowOpen(at(15, 10), c), false, 'Sunday');
  assert.equal(limits.nextWindow(at(11, 20), c), at(12, 8));
  assert.equal(limits.nextWindow(at(14, 20), c), at(16, 8), 'Saturday night waits for Monday');
  assert.equal(limits.nextWindow(at(11, 10), c), at(11, 10), 'already open');
});

test('grace period counts only the minutes the window was open', () => {
  const c = limits.defaultLimits;
  assert.equal(limits.openMinutes(at(11, 9), at(11, 9, 30), c), 30);
  // scheduled 20:00, sent at 08:05 the next morning: waited 5 minutes
  assert.equal(limits.openMinutes(at(11, 20), at(12, 8, 5), c), 5);
  // forgotten over a Sunday: Saturday 18:00 to Monday 09:00 = 60 + 60
  assert.equal(limits.openMinutes(at(14, 18), at(16, 9), c), 120);
  assert.equal(limits.openMinutes(at(11, 9), at(11, 8), c), 0);
  assert.equal(limits.drainMinutes(100, c), 240, '100 messages at 30 per hour');
  assert.deepEqual(
    [1, 31, 32].map(n => limits.drainMinutes(n, c)),
    [0, 60, 120],
    'a single message waits for nobody',
  );
});

test('caps per hour and per day, pause between messages, and validation', () => {
  const c = limits.defaultLimits;
  const now = at(11, 10);
  assert.deepEqual(limits.decide(now, c, { lastHour: 29, today: 50 }), { allowed: true, reason: '', retryAt: now });
  assert.equal(limits.decide(now, c, { lastHour: 30 }).reason, 'hourly');
  const daily = limits.decide(now, c, { today: 200 });
  assert.deepEqual([daily.reason, daily.retryAt], ['daily', at(12, 8)]);
  assert.equal(limits.decide(now, c, { nextAt: now + 5000 }).reason, 'delay');
  assert.equal(limits.decide(at(11, 21), c).reason, 'window');
  assert.equal(
    limits.nextDelayMs(c, () => 0),
    8000,
  );
  assert.equal(
    limits.nextDelayMs(c, () => 1),
    25000,
  );
  assert.throws(() => limits.validateLimits({ ...c, sendWindowEnd: 8 }), /depois do início/);
  assert.throws(() => limits.validateLimits({ ...c, dailyLimit: 10 }), /por dia/);
  assert.throws(() => limits.validateLimits({ ...c, minDelaySec: 30, maxDelaySec: 10 }), /pausa máxima/);
});

test('phone numbers match with or without +55 and the ninth digit; only one-to-one chats count', () => {
  assert.equal(phoneKey('(64) 99999-0000'), '556499990000');
  assert.equal(phoneKey('+55 64 99999-0000'), '556499990000');
  assert.equal(phoneKey('556499990000'), '556499990000', 'eight digits stay');
  assert.ok(samePhone('5564999990000', '556499990000'), 'with and without the ninth digit');
  assert.ok(!samePhone('5564999990000', '5564999991111'));
  assert.equal(phoneKey('+1 202 555 0100'), '12025550100', 'foreign numbers are left alone');
  assert.equal(phoneKey('12025550100'), '12025550100', 'a stored US number is not taken for a Brazilian one');
  assert.equal(phoneKey('(64) 9999-0000'), '556499990000', 'eight-digit local format');
  assert.ok(!samePhone('12025550100', '5512025550100'));
  assert.equal(numberFromJid('5564999990000@s.whatsapp.net'), '5564999990000');
  assert.equal(numberFromJid('5564999990000:12@s.whatsapp.net'), '5564999990000');
  assert.equal(
    numberFromJid('1234567890123@lid', '5564999990000@s.whatsapp.net'),
    '5564999990000',
    'LID chats use the alt address',
  );
  assert.equal(numberFromJid('1234567890123@lid'), '');
  assert.deepEqual(
    ['120363@g.us', 'status@broadcast', '120@newsletter', '5564@s.whatsapp.net', '99@lid'].map(isIndividualJid),
    [false, false, false, true, true],
  );
});

test('session housekeeping removes only what WhatsApp rebuilds and keeps clients and credentials', async t => {
  const { store } = await fixture(t);
  store.save('clients', { name: 'Ana', phone: '5564999990000', status: 'Ativo' });
  const put = (id, value = 'x') => store.secret('wa:' + id, value);
  put('creds');
  put('pre-key:1');
  put('identity-key:5564999990000.0');
  put('app-state-sync-key:AAA');
  put('app-state-sync-version:regular');
  put('sender-key:120363@g.us::5511.0');
  put('sender-key-memory:120363@g.us');
  put('device-list:5511988887777');
  put('session:5564999990000.0'); // a client
  put('session:5511988887777.0'); // a stranger
  put('session:123456789_1.0'); // LID: kept, the number is unknown
  const report = hygiene.report(store);
  assert.equal(report.total.count, 11);
  assert.equal(report.byType.session.count, 3);
  assert.equal(report.removable, 3);
  assert.deepEqual(hygiene.clean(store), { removed: 4 });
  const left = store.db
    .prepare("SELECT id FROM secrets WHERE id LIKE 'wa:%' ORDER BY id")
    .all()
    .map(r => r.id);
  assert.deepEqual(left, [
    'wa:app-state-sync-key:AAA',
    'wa:app-state-sync-version:regular',
    'wa:creds',
    'wa:identity-key:5564999990000.0',
    'wa:pre-key:1',
    'wa:session:123456789_1.0',
    'wa:session:5564999990000.0',
  ]);
  assert.deepEqual(hygiene.clean(store), { removed: 0 }, 'nothing more to remove');
});

test('inbox is off by default, ignores groups and own messages, matches the client and does not store twice', async t => {
  const { store } = await fixture(t);
  const ana = store.save('clients', { name: 'Ana Souza', phone: '5564999990000', status: 'Ativo' });
  let enabled = false;
  const inbox = new Inbox({ store, settings: { get: () => ({ waInboxEnabled: enabled }) } });
  const incoming = (over = {}) => ({
    key: { id: 'M1', remoteJid: '556499990000@s.whatsapp.net', fromMe: false, ...(over.key || {}) },
    message: over.message || { conversation: ' 1 ' },
    messageTimestamp: 1794000000,
  });
  assert.equal(inbox.receive(incoming()), null, 'off: nothing is stored');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM inbox').get().n, 0);
  enabled = true;
  assert.equal(inbox.receive(incoming({ key: { fromMe: true } })), null);
  assert.equal(inbox.receive(incoming({ key: { remoteJid: '120363@g.us' } })), null);
  assert.equal(inbox.receive(incoming({ message: { reactionMessage: {} } })), null, 'nothing to read');
  const record = inbox.receive(incoming());
  assert.deepEqual([record.text, record.clientId, record.phone, record.media], ['1', ana.id, '556499990000', false]);
  assert.equal(inbox.receive(incoming()), null, 'redelivered message');
  const photo = inbox.receive(
    incoming({ key: { id: 'M2', remoteJid: '5511977776666@s.whatsapp.net' }, message: { imageMessage: {} } }),
  );
  assert.deepEqual([photo.media, photo.text, photo.clientId], [true, '', ''], 'unknown number, media only noted');
  assert.equal(inbox.newCount(), 2);
  assert.equal(inbox.list().length, 2);
  inbox.setStatus('M1', 'handled');
  assert.equal(inbox.newCount(), 1);
  assert.deepEqual(readMessage({ ephemeralMessage: { message: { extendedTextMessage: { text: 'oi' } } } }), {
    text: 'oi',
    media: false,
  });
  const later = new Inbox({
    store,
    settings: { get: () => ({ waInboxEnabled: true }) },
    clock: () => Date.now() + 31 * 86400000,
  });
  assert.equal(later.purge(), 2, 'messages are removed after 30 days');
});

test('logs rotate by size, old copies and audit rows are purged', async t => {
  const { root, store } = await fixture(t);
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const file = path.join(logs, 'audit.jsonl');
  fs.writeFileSync(file, 'x'.repeat(2000));
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(rotateFile(file, { maxBytes: 5000, now }), null, 'small file stays');
  const moved = rotateFile(file, { maxBytes: 1000, now });
  assert.equal(path.basename(moved), 'audit-20261113.jsonl');
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'y'.repeat(2000));
  assert.equal(path.basename(rotateFile(file, { maxBytes: 1000, now })), 'audit-20261113-2.jsonl', 'same day twice');
  fs.writeFileSync(path.join(logs, 'audit-20250101.jsonl'), 'old');
  fs.utimesSync(path.join(logs, 'audit-20250101.jsonl'), new Date('2025-01-01'), new Date('2025-01-01'));
  assert.equal(purgeRotated(logs, { keepDays: 365, now }), 1);
  assert.ok(fs.existsSync(path.join(logs, 'audit-20261113.jsonl')));
  store.db.prepare("INSERT INTO audit(event,metadata,created_at) VALUES ('old','{}','2024-01-01T00:00:00.000Z')").run();
  const before = store.db.prepare('SELECT COUNT(*) n FROM audit').get().n;
  const result = maintain(store, { keepDays: 365, now });
  assert.equal(result.purgedRows, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM audit').get().n, before - 1);
});
