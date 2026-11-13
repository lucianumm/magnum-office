-- WhatsApp campaigns (messages by date, repetition, event or client) and the record of what was already
-- planned for each client, so the same campaign never reaches the same client twice for the same date.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign_sends (
  dispatch_key TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  message_id TEXT,
  planned_for TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends(campaign_id);
