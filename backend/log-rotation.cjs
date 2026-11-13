// Keeps the log files from growing for ever. A file over the size limit is renamed with the date and a
// new one starts; rotated files and old audit rows are removed after the retention period.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP_DAYS = 365;
const stamp = date => date.toISOString().slice(0, 10).replace(/-/g, '');

function rotateFile(file, { maxBytes = DEFAULT_MAX_BYTES, now = Date.now() } = {}) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return null;
  }
  if (size <= maxBytes) return null;
  const { dir, name, ext } = path.parse(file);
  let target = path.join(dir, `${name}-${stamp(new Date(now))}${ext}`);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${name}-${stamp(new Date(now))}-${i}${ext}`);
  fs.renameSync(file, target);
  return target;
}

// Removes rotated copies (name-AAAAMMDD[-n].jsonl) older than the retention period.
function purgeRotated(dir, { keepDays = DEFAULT_KEEP_DAYS, now = Date.now() } = {}) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!/^[a-z-]+-\d{8}(-\d+)?\.jsonl$/.test(name)) continue;
    const file = path.join(dir, name);
    if (now - fs.statSync(file).mtimeMs > keepDays * 86400000) {
      fs.rmSync(file, { force: true });
      removed++;
    }
  }
  return removed;
}

// Whole routine for a data folder: rotates the logs, purges old copies and old audit rows.
function maintain(store, { keepDays = DEFAULT_KEEP_DAYS, maxBytes = DEFAULT_MAX_BYTES, now = Date.now() } = {}) {
  const logs = path.join(store.root, 'logs');
  const rotated = ['audit.jsonl', 'recovery.jsonl']
    .map(n => rotateFile(path.join(logs, n), { maxBytes, now }))
    .filter(Boolean);
  const purged = purgeRotated(logs, { keepDays, now });
  const cutoff = new Date(now - keepDays * 86400000).toISOString();
  const rows = store.db.prepare('DELETE FROM audit WHERE created_at < ?').run(cutoff).changes;
  return { rotated: rotated.length, purgedFiles: purged, purgedRows: Number(rows) };
}

module.exports = { rotateFile, purgeRotated, maintain, DEFAULT_KEEP_DAYS };
