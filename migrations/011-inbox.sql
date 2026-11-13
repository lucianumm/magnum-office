-- Messages received on WhatsApp from clients (and from unknown numbers), kept encrypted for 30 days.
-- Off by default: nothing is stored unless the office turns the inbox on.
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  client_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_client ON inbox(client_id) WHERE client_id IS NOT NULL;
