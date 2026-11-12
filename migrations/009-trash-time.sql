-- Trash: excluded records stay here for 30 days and can be restored (payload still encrypted).
CREATE TABLE IF NOT EXISTS trash (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload BLOB NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  client_id TEXT,
  case_id TEXT,
  deleted_at TEXT NOT NULL,
  extra TEXT
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash(deleted_at);
