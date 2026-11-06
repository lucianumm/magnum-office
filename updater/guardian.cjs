// Runs in the preserved Electron runtime's headless Node mode. It must outlive
// the old application's UI process, including on Windows without a console.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const running = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};
async function start(executable, args, env) {
  const child = spawn(executable, args, { env, detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  return child;
}
async function main() {
  const request = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const root = path.resolve(request.root);
  const log = event => fs.appendFile(path.join(root, 'logs', 'recovery.jsonl'), JSON.stringify({ at: new Date().toISOString(), event, version: request.version }) + '\n');
  await log('update.guardian.started');
  await fs.writeFile(request.readyFile, JSON.stringify({ id: request.guardianId, pid: process.pid }));
  const parentDeadline = Date.now() + 120000;
  while (running(request.parentPid) && Date.now() < parentDeadline) await delay(250);
  if (running(request.parentPid) || await fs.stat(request.cancelFile).then(() => true, () => false)) {
    await log('update.guardian.aborted');
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let newProcess;
  try {
    const installer = await start(request.installer, ['/S'], env);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { installer.kill(); reject(new Error('Installation timed out')); }, 300000);
      installer.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Installation failed')); });
    });
    newProcess = await start(request.previousExe, [`--data-dir=${root}`], env);
    const healthDeadline = Date.now() + 180000;
    while (Date.now() < healthDeadline) {
      await delay(2000);
      try {
        const health = JSON.parse(await fs.readFile(path.join(root, 'health.json'), 'utf8'));
        if (health.version === request.version && health.backupId === request.backupId) {
          await log('update.guardian.success');
          newProcess.unref();
          return;
        }
      } catch { /* The new version has not confirmed startup yet. */ }
      if (newProcess.exitCode !== null) break;
    }
    throw new Error('New version failed health check');
  } catch {
    await log('update.guardian.rollback');
    if (newProcess && newProcess.exitCode === null) {
      const exited = new Promise(resolve => newProcess.once('exit', resolve));
      newProcess.kill();
      await exited;
    }
    const recovery = await start(request.recoveryExe, [`--recover=${request.backupId}`, `--user-data=${root}`, `--rollback-version=${request.version}`], env);
    recovery.unref();
  }
}
main().catch(() => { process.exitCode = 1; });
