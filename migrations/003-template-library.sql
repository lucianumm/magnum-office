CREATE TABLE template_groups (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE templates (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES template_groups(id), payload TEXT NOT NULL);
