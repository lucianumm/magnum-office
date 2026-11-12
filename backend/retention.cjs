// Keeps update leftovers from filling the disk. Only copies the updater created itself are
// removed: manual, weekly and before-restore backups are never deleted automatically.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const semver = require('semver');
const version = require('../app/version.cjs');
const DAY = 86400000;
const KEEP_PRE_UPDATE = 3;
const KEEP_PRE_MIGRATION = 5;
const RUNTIME_GRACE = 7 * DAY;

// Pure decision, separated from the file operations so that it can be tested directly.
function planPreUpdate(backups, currentVersion, now = Date.now()) {
  const list = backups.filter(b => b.reason === 'pre-update').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const remove = list.slice(KEEP_PRE_UPDATE).map(b => b.id);
  const strip = [];
  list.slice(0, KEEP_PRE_UPDATE).forEach((backup, index) => {
    if (!backup.runtime) return;
    if (index > 0) {
      strip.push(backup.id);
      return;
    }
    const confirmed =
      semver.valid(backup.targetVersion) &&
      semver.valid(currentVersion) &&
      semver.lte(backup.targetVersion, currentVersion);
    if (confirmed && now - Date.parse(backup.createdAt) > RUNTIME_GRACE) strip.push(backup.id);
  });
  return { remove, strip };
}
function planInstallers(names, currentVersion) {
  const versions = names
    .map(name => ({ name, value: name.replace(/\.exe$/i, '') }))
    .filter(item => semver.valid(item.value));
  const older = versions
    .filter(item => semver.lte(item.value, currentVersion))
    .sort((a, b) => semver.rcompare(a.value, b.value));
  return older.slice(2).map(item => item.name);
}
async function names(dir) {
  return fsp.readdir(dir).catch(() => []);
}
async function cleanUpdates(root, keep) {
  const dir = path.join(root, 'updates');
  for (const name of await names(dir)) {
    if (keep && (name === keep || name.startsWith(keep + '.'))) continue;
    await fsp.rm(path.join(dir, name), { force: true, recursive: true }).catch(() => {});
  }
}
async function applyRetention({ root, backups, keepUpdate = null, currentVersion = version }) {
  if (fs.existsSync(path.join(root, 'pending-update.json')) || fs.existsSync(path.join(root, 'update-lock.json')))
    return { skipped: true };
  const plan = planPreUpdate(backups.listDetails(), currentVersion);
  for (const id of plan.strip) await backups.stripRuntime(id).catch(() => {});
  for (const id of plan.remove) await backups.remove(id).catch(() => {});
  await cleanUpdates(root, keepUpdate);
  const backupDir = path.join(root, 'backups');
  const migrations = (await names(backupDir))
    .filter(name => /^pre-migration-\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  for (const name of migrations.slice(KEEP_PRE_MIGRATION))
    await fsp.rm(path.join(backupDir, name), { force: true }).catch(() => {});
  const installerDir = path.join(root, 'installers');
  for (const name of planInstallers(await names(installerDir), currentVersion))
    await fsp.rm(path.join(installerDir, name), { force: true }).catch(() => {});
  for (const name of ['update-request.json', 'update-progress.json'])
    await fsp.rm(path.join(root, name), { force: true }).catch(() => {});
  for (const name of await names(root))
    if (/^guardian-(ready|cancel)-/.test(name)) await fsp.rm(path.join(root, name), { force: true }).catch(() => {});
  return plan;
}
module.exports = { applyRetention, planPreUpdate, planInstallers };
