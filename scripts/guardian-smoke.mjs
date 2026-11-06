import {prepareTestApp} from './test-helpers.mjs';
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (process.platform !== 'win32' || !executable || !path.isAbsolute(executable)) throw new Error('Informe o executável Windows instalado em uma pasta de teste.');
const testBase = path.resolve('work', 'guardian-smoke'); await fs.mkdir(testBase, { recursive: true });
const root = await fs.mkdtemp(path.join(testBase, 'run-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
let runtimeExe;
let guardian;
try {
  app = await electron.launch({ executablePath: executable, args: [`--data-dir=${root}`], env });
  const page = await app.firstWindow(); await page.getByRole('heading', { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor();await prepareTestApp(page);
  await page.evaluate(() => window.advocacia.save({ kind: 'clients', entity: {phone:'5564999990000', name: 'Preservado no backup' } }));
  const snapshot = await app.evaluate(async ({ app, safeStorage }) => {
    const path = process.getBuiltinModule('node:path');
    const require = process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(), 'package.json'));
    const { Store } = require('./backend/store.cjs'); const { Vault } = require('./backend/vault.cjs'); const { Settings } = require('./backend/settings.cjs'); const { Backups } = require('./backend/backups.cjs');
    const root = app.getPath('userData'); const store = new Store(root, await Vault.open(root, safeStorage));
    try { await store.migrate(); const snapshot = await new Backups(store, new Settings(root)).create('pre-update', path.dirname(process.execPath), '0.6.0'); return { ...snapshot, startEvents: store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE event='application.started'").get().n }; }
    finally { store.close(); }
  });
  await page.evaluate(() => window.advocacia.save({ kind: 'clients', entity: {phone:'5564999990000', name: 'Posterior ao backup' } }));
  runtimeExe = path.join(root, 'backups', snapshot.id, 'runtime', path.basename(executable));
  await fs.access(path.join(root, 'backups', snapshot.id, 'Recuperar Advocacia.lnk'));
  const invalidInstaller = path.join(root, 'invalid-installer.exe'); await fs.writeFile(invalidInstaller, 'not a Windows executable');
  const request = { root, version: '0.6.0', fromVersion: '0.5.0', backupId: snapshot.id, parentPid: app.process().pid, installer: invalidInstaller, previousExe: executable, recoveryExe: runtimeExe };
  const requestFile = path.join(root, 'update-request.json'); await fs.writeFile(requestFile, JSON.stringify(request));
  await fs.writeFile(path.join(root, 'pending-update.json'), JSON.stringify(request));
  const guardianScript = path.join(root, 'backups', snapshot.id, 'runtime', 'resources', 'guardian.ps1');
  guardian = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', guardianScript, '-RequestFile', requestFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = []; guardian.stdout.on('data', b => output.push(b.toString())); guardian.stderr.on('data', b => output.push(b.toString()));
  await app.close(); app = null;
  const deadline = Date.now() + 55000; let notice; let bootConfirmed = false;
  while (Date.now() < deadline) {
    try {
      notice = JSON.parse(await fs.readFile(path.join(root, 'recovery-notice.json'), 'utf8'));
      const healthDb = new DatabaseSync(path.join(root, 'database.sqlite'), { readOnly: true });
      try { bootConfirmed = healthDb.prepare("SELECT COUNT(*) AS n FROM audit WHERE event='application.started'").get().n > snapshot.startEvents; } finally { healthDb.close(); }
      if (bootConfirmed) break;
    } catch { /* Wait for the restored database and renderer to finish booting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(notice?.failedVersion, '0.6.0', output.join('\n'));
  assert.equal(bootConfirmed, true, 'O programa anterior não confirmou sua inicialização. ' + output.join('\n'));
  const settings = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8')); assert.ok(settings.blockedVersions.includes('0.6.0'));
  const db = new DatabaseSync(path.join(root, 'database.sqlite'), { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entities WHERE kind='clients'").get().n, 1); db.close();
  const log = await fs.readFile(path.join(root, 'logs', 'recovery.jsonl'), 'utf8'); assert.ok(log.includes('update.guardian.rollback'));
  await fs.writeFile(path.join(testBase, 'result.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), backupId: snapshot.id, failedVersionBlocked: true, restoredClientCount: 1, recoveryShortcutCreated: true }, null, 2));
  process.stdout.write('Guardião Windows: falha de instalador detectada, programa anterior iniciado, dados restaurados e versão defeituosa bloqueada.\n');
} finally {
  if (app) await app.close();
  if (guardian && guardian.exitCode === null) guardian.kill();
  if (runtimeExe) {
    const script = path.join(testBase, 'stop-snapshot.ps1');
    await fs.writeFile(script, "param([string]$Image)\nGet-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $Image -and $_.CommandLine.Contains('--recover=') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\n");
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Image', runtimeExe], { windowsHide: true }).catch(() => {});
  }
}
