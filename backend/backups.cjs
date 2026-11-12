// Electron virtualizes .asar paths. Runtime snapshots must copy archives as actual
// files, rather than traversing them as directories through Electron's patched fs.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { backup, DatabaseSync } = require('node:sqlite');
const version = require('../app/version.cjs');
const BACKUP_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}$/;
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function walk(root, prefix = '') {
  const result = [];
  for (const item of await fsp.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isSymbolicLink()) throw new Error('Links simbólicos não são permitidos em backups.');
    if (item.isDirectory()) result.push(...(await walk(root, relative)));
    else if (item.isFile()) result.push(relative);
  }
  return result;
}
function backupPath(root, id) {
  if (!BACKUP_ID.test(id)) throw new Error('Identificador de backup inválido.');
  return path.join(root, 'backups', id);
}
class Backups {
  constructor(store, settings) {
    this.store = store;
    this.settings = settings;
  }
  list() {
    return fs
      .readdirSync(path.join(this.store.root, 'backups'))
      .filter(id => BACKUP_ID.test(id))
      .map(id => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(backupPath(this.store.root, id), 'manifest.json'), 'utf8'));
          return {
            id,
            version: m.version,
            createdAt: m.createdAt,
            reason: m.reason,
            bytes: m.files.reduce((n, f) => n + f.bytes, 0),
            runtime: Boolean(m.runtime),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  listDetails() {
    return fs
      .readdirSync(path.join(this.store.root, 'backups'))
      .filter(id => BACKUP_ID.test(id))
      .map(id => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(backupPath(this.store.root, id), 'manifest.json'), 'utf8'));
          return {
            id,
            reason: m.reason,
            createdAt: m.createdAt,
            runtime: Boolean(m.runtime),
            targetVersion: m.targetVersion || null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  async remove(id) {
    await fsp.rm(backupPath(this.store.root, id), { recursive: true, force: true });
  }
  // Removes the 450 MB program copy but keeps the data restorable: the authenticated manifest
  // is rewritten first, so an interruption leaves extra files instead of an invalid backup.
  async stripRuntime(id) {
    const dir = backupPath(this.store.root, id);
    const sealed = this.store.vault.unseal(await fsp.readFile(path.join(dir, 'manifest.auth')));
    if (!sealed.runtime) return;
    const manifest = {
      ...sealed,
      runtime: null,
      installedExecutable: null,
      files: sealed.files.filter(file => !file.path.startsWith('runtime/') && !file.path.endsWith('.lnk')),
    };
    await fsp.writeFile(path.join(dir, 'manifest.auth'), this.store.vault.seal(manifest), { mode: 0o600 });
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await fsp.rm(path.join(dir, 'runtime'), { recursive: true, force: true });
    await fsp.rm(path.join(dir, 'Recuperar Advocacia.lnk'), { force: true });
    await verifyBackup(this.store.root, id, this.store.vault);
  }
  async create(reason = 'manual', runtimeDirectory = null, targetVersion = null) {
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    const dest = backupPath(this.store.root, id);
    const stage = dest + '.partial';
    await fsp.mkdir(stage, { mode: 0o700 });
    await backup(this.store.db, path.join(stage, 'database.sqlite'));
    for (const name of ['vault.bin', 'config.json'])
      if (fs.existsSync(path.join(this.store.root, name)))
        await fsp.copyFile(path.join(this.store.root, name), path.join(stage, name));
    await fsp.cp(path.join(this.store.root, 'documents'), path.join(stage, 'documents'), { recursive: true });
    let runtime = null;
    if (runtimeDirectory) {
      await fsp.cp(runtimeDirectory, path.join(stage, 'runtime'), {
        recursive: true,
        dereference: true,
        filter: source => !source.includes(path.join(this.store.root, 'backups')),
      });
      runtime = path.basename(process.execPath);
      if (process.platform === 'win32') {
        const { execFile } = require('node:child_process');
        const { promisify } = require('node:util');
        const script = path.join(process.resourcesPath, 'create-recovery-shortcut.ps1');
        const args = [
          `--recover=${id}`,
          `--user-data=${this.store.root}`,
          '--recovery-confirm',
          ...(targetVersion ? [`--rollback-version=${targetVersion}`] : []),
        ]
          .map(arg => '"' + arg + '"')
          .join(' ');
        // The shortcut is a convenience. A blocked PowerShell must not cancel the backup or the update.
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            '-Target',
            path.join(dest, 'runtime', runtime),
            '-Arguments',
            args,
            '-Shortcut',
            path.join(stage, 'Recuperar Advocacia.lnk'),
          ],
          { windowsHide: true, timeout: 30000 },
        ).catch(error =>
          this.store.audit('backup.shortcut.failed', { code: String(error.code || 'UNKNOWN').slice(0, 40) }),
        );
      }
    }
    const files = [];
    for (const relative of await walk(stage))
      files.push({
        path: relative.replaceAll('\\', '/'),
        sha256: await digest(path.join(stage, relative)),
        bytes: (await fsp.stat(path.join(stage, relative))).size,
      });
    const manifest = {
      format: 1,
      id,
      version,
      createdAt: new Date().toISOString(),
      reason,
      runtime,
      targetVersion,
      installedExecutable: runtimeDirectory ? process.execPath : null,
      files,
    };
    // The manifest is authenticated with the local data key; hashes alone cannot authenticate a backup.
    await fsp.writeFile(path.join(stage, 'manifest.auth'), this.store.vault.seal(manifest), { mode: 0o600 });
    await fsp.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await fsp.rename(stage, dest);
    await verifyBackup(this.store.root, id, this.store.vault);
    this.store.audit('backup.created', { id, reason, version });
    return { id, ...manifest, files: undefined };
  }
}
async function verifyBackup(root, id, vault) {
  const dir = backupPath(root, id);
  const manifest = vault.unseal(await fsp.readFile(path.join(dir, 'manifest.auth')));
  if (manifest.id !== id || manifest.format !== 1 || !Array.isArray(manifest.files))
    throw new Error('Manifesto de backup inválido.');
  for (const file of manifest.files) {
    if (
      typeof file.path !== 'string' ||
      file.path.includes('\\') ||
      file.path.split('/').some(p => !p || p === '.' || p === '..') ||
      path.isAbsolute(file.path) ||
      file.path.includes(':')
    )
      throw new Error('Caminho de backup inválido.');
    const target = path.join(dir, file.path);
    const real = await fsp.realpath(target);
    const realRoot = await fsp.realpath(dir);
    if (
      !real.startsWith(realRoot + path.sep) ||
      (await fsp.stat(target)).size !== file.bytes ||
      (await digest(target)) !== file.sha256
    )
      throw new Error('O backup foi alterado ou está corrompido.');
  }
  const db = new DatabaseSync(path.join(dir, 'database.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('Banco do backup inválido.');
  } finally {
    db.close();
  }
  return manifest;
}
async function restoreBackup(root, id, vault) {
  const manifest = await verifyBackup(root, id, vault);
  const source = backupPath(root, id);
  const stage = path.join(root, 'restore-' + randomUUID());
  await fsp.mkdir(stage);
  for (const file of ['database.sqlite', 'config.json', 'vault.bin'])
    if (fs.existsSync(path.join(source, file))) await fsp.copyFile(path.join(source, file), path.join(stage, file));
  await fsp.cp(path.join(source, 'documents'), path.join(stage, 'documents'), { recursive: true });
  const preserved = path.join(root, 'backups', 'before-restore-' + Date.now());
  await fsp.mkdir(preserved);
  for (const file of [
    'database.sqlite',
    'database.sqlite-wal',
    'database.sqlite-shm',
    'config.json',
    'vault.bin',
    'documents',
  ]) {
    if (fs.existsSync(path.join(root, file))) await fsp.rename(path.join(root, file), path.join(preserved, file));
  }
  try {
    for (const file of ['database.sqlite', 'config.json', 'vault.bin', 'documents'])
      if (fs.existsSync(path.join(stage, file))) await fsp.rename(path.join(stage, file), path.join(root, file));
  } catch (error) {
    for (const file of await fsp.readdir(preserved)) {
      if (fs.existsSync(path.join(root, file)))
        await fsp.rename(path.join(root, file), path.join(stage, 'failed-' + file));
      await fsp.rename(path.join(preserved, file), path.join(root, file));
    }
    throw error;
  }
  await fsp.rmdir(stage);
  return manifest;
}
module.exports = { Backups, verifyBackup, restoreBackup, backupPath, digest, walk };
