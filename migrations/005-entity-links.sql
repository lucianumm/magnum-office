-- Links between records (random UUIDs only, no personal data) kept outside the encrypted payload,
-- so link checks no longer decrypt every case, task and document.
ALTER TABLE entities ADD COLUMN client_id TEXT;
ALTER TABLE entities ADD COLUMN case_id TEXT;
CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_case ON entities(case_id) WHERE case_id IS NOT NULL;
-- One-time data tasks that need the vault, run by the application after the migrations.
CREATE TABLE IF NOT EXISTS maintenance (name TEXT PRIMARY KEY, done_at TEXT NOT NULL);
