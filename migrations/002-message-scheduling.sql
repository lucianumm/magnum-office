ALTER TABLE queue ADD COLUMN scheduled_for TEXT;
ALTER TABLE queue ADD COLUMN sent_at TEXT;
ALTER TABLE queue ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON queue(scheduled_for, status);
