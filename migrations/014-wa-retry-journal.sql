-- WhatsApp retry store and received-message journal. Both are short-lived (24 hours) and encrypted.
-- wa_outbox: the text of each message sent, so that when a client's phone shows "Aguardando mensagem" WhatsApp can
--            ask for it again and the program can resend it, even after a restart.
-- wa_journal: the messages received, so the same one delivered twice is handled once, and an answer interrupted by
--            a crash is resumed when it is less than 10 minutes old. The text is erased as soon as it is handled.
CREATE TABLE IF NOT EXISTS wa_outbox (
  key_id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_created ON wa_outbox(created_at);
CREATE TABLE IF NOT EXISTS wa_journal (
  msg_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('processing','done','abandoned')),
  payload BLOB,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_journal_started ON wa_journal(started_at);
