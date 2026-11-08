-- New record kinds: people (opposing parties, witnesses, experts...), finance (fees and expenses) and
-- intakes (first consultations). SQLite cannot change a CHECK constraint, so the table is rebuilt:
-- every row is copied to the new table before the old one is replaced, inside the migration transaction,
-- after the automatic pre-migration backup. Store.migrate also refuses a migration that leaves any
-- table with fewer rows than before.
CREATE TABLE entities_rebuild (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('clients','cases','tasks','notes','documents','people','finance','intakes')),
  payload BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  client_id TEXT,
  case_id TEXT
);
INSERT INTO entities_rebuild (id, kind, payload, created_at, updated_at, client_id, case_id) SELECT id, kind, payload, created_at, updated_at, client_id, case_id FROM entities;
DROP TABLE entities;
ALTER TABLE entities_rebuild RENAME TO entities;
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entities_client ON entities(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_case ON entities(case_id) WHERE case_id IS NOT NULL;
