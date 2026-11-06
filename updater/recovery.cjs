const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { backupPath } = require('../backend/backups.cjs');
async function startGuardian(root, pending, installer) {
  const runtime = path.join(backupPath(root, pending.backupId), 'runtime');
  const recoveryExe = path.join(runtime, path.basename(process.execPath));
  await fs.access(recoveryExe);
  const request = { ...pending, root, installer, parentPid: process.pid, recoveryExe };
  const requestFile = path.join(root, 'update-request.json');
  await fs.writeFile(requestFile, JSON.stringify(request), { mode: 0o600 });
  const script = path.join(runtime, 'resources', 'guardian.ps1');
  await fs.access(script);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script, '-RequestFile', requestFile], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
module.exports = { startGuardian };
