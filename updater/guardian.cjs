// Runs in the preserved Electron runtime's headless Node mode. It must outlive
// the old application's UI process, including on Windows without a console.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const HEALTH_LIMIT = 180000;
const MIGRATION_LIMIT = 600000;
const running = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};
// windowsHide makes Windows ignore the first ShowWindow, which would leave the program open and invisible.
async function start(executable, args, env, { hidden = false } = {}) {
  const child = spawn(executable, args, { env, detached: true, stdio: 'ignore', windowsHide: hidden });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  return child;
}
const readJSON = file => fs.readFile(file, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, '')));
async function main() {
  const request = await readJSON(process.argv[2]);
  const root = path.resolve(request.root);
  const log = (event, detail) => fs.appendFile(path.join(root, 'logs', 'recovery.jsonl'), JSON.stringify({ at: new Date().toISOString(), event, version: request.version, ...(detail ? { detail } : {}) }) + '\n');
  const lockFile = path.join(root, 'update-lock.json');
  const progressFile = path.join(root, 'update-progress.json');
  const progress = step => fs.writeFile(progressFile, JSON.stringify({ step, version: request.version, at: new Date().toISOString() })).catch(() => {});
  let step = 'waiting';
  await log('update.guardian.started');
  await fs.writeFile(request.readyFile, JSON.stringify({ id: request.guardianId, pid: process.pid }));
  await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, version: request.version, at: new Date().toISOString() }));
  const parentDeadline = Date.now() + 120000;
  while (running(request.parentPid) && Date.now() < parentDeadline) await delay(250);
  if (running(request.parentPid) || await fs.stat(request.cancelFile).then(() => true, () => false)) {
    await log('update.guardian.aborted', { step });
    await fs.rm(lockFile, { force: true });
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await progress('installing');
  // The progress window is a convenience: its absence must never affect the update.
  await start(request.recoveryExe, [`--update-progress=${root}`], env).then(child => child.unref(), () => {});
  let newProcess;
  try {
    step = 'installing';
    const installer = await start(request.installer, ['/S', '--updated'], env, { hidden: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { installer.kill(); reject(new Error('Installation timed out')); }, 300000);
      installer.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installer exit code ${code}`)); });
    });
    await log('update.guardian.installed');
    step = 'starting';
    await progress('starting');
    newProcess = await start(request.previousExe, [`--data-dir=${root}`, '--guardian-launch'], env);
    const startedAt = Date.now();
    let healthDeadline = startedAt + HEALTH_LIMIT;
    while (Date.now() < healthDeadline) {
      await delay(2000);
      try {
        const health = await readJSON(path.join(root, 'health.json'));
        if (health.version === request.version && health.backupId === request.backupId) {
          await log('update.guardian.success', { seconds: Math.round((Date.now() - startedAt) / 1000) });
          await progress('done');
          await fs.rm(lockFile, { force: true });
          await fs.rm(process.argv[2], { force: true });
          newProcess.unref();
          return;
        }
      } catch { /* The new version has not confirmed startup yet. */ }
      // A long database migration is progress, not a failure.
      const phase = await readJSON(path.join(root, 'startup-phase.json')).catch(() => null);
      if (phase?.phase === 'migrating' && phase.version === request.version) healthDeadline = Math.max(healthDeadline, startedAt + MIGRATION_LIMIT);
      if (newProcess.exitCode !== null) throw new Error(`New version exited with code ${newProcess.exitCode}`);
    }
    throw new Error('New version failed health check');
  } catch (error) {
    await log('update.guardian.failed', { step, message: String(error.message).slice(0, 200) });
    await log('update.guardian.rollback');
    await progress('restoring');
    if (newProcess && newProcess.exitCode === null) {
      const exited = new Promise(resolve => newProcess.once('exit', resolve));
      newProcess.kill();
      await Promise.race([exited, delay(15000)]);
    }
    await fs.rm(lockFile, { force: true });
    const recovery = await start(request.recoveryExe, [`--recover=${request.backupId}`, `--user-data=${root}`, `--rollback-version=${request.version}`, `--rollback-reason=${step}`], env);
    recovery.unref();
    await delay(3000);
    await progress('done');
  }
}
main().catch(() => { process.exitCode = 1; });
