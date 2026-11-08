-- Text extracted from documents for the search, encrypted like the documents themselves.
-- status: 'ok' (text found), 'empty' (scanned image or no text), 'skipped' (format or size not indexed).
CREATE TABLE IF NOT EXISTS document_text (
  document_id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  status TEXT NOT NULL,
  extracted_at TEXT NOT NULL
);
