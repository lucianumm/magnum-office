CREATE TABLE birthday_dispatches (
  dispatch_key TEXT PRIMARY KEY,
  message_id TEXT UNIQUE REFERENCES queue(id) ON DELETE SET NULL
);
