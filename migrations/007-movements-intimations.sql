-- Case movements (from the DataJud or typed by the office), one encrypted document per case.
CREATE TABLE IF NOT EXISTS case_movements (
  case_id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
-- Communications published in the Diário de Justiça Eletrônico Nacional for the office's lawyers.
-- The id is the DJEN's own id, so the same publication is never stored twice.
CREATE TABLE IF NOT EXISTS intimations (
  id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','done','dismissed')),
  case_id TEXT,
  published TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intimations_status ON intimations(status, published DESC);
