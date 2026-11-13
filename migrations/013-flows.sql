-- Where each WhatsApp conversation stands in the automatic answers (waiting for a CPF, a choice of case,
-- how many wrong CPFs, when the menu was last sent). Encrypted; the CPF typed is never stored.
CREATE TABLE IF NOT EXISTS wa_flow_state (
  phone_key TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
