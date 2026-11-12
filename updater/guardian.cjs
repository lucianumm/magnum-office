// Runs in the preserved Electron runtime's headless Node mode. It must outlive
// the old application's UI process, including on Windows without a console.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
// The installed app.asar is read as a plain file, never as Electron's virtual folder.
process.noAsar = true;
const rawFs = (() => {
  try {
    return require('original-fs').promises;
  } catch {
    return fs;
  }
})();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const HEALTH_LIMIT = 180000;
const MIGRATION_LIMIT = 600000;
const running = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
// windowsHide makes Windows ignore the first ShowWindow, which would leave the program open and invisible.
async function start(executable, args, env, { hidden = false } = {}) {
  const child = spawn(executable, args, { env, detached: true, stdio: 'ignore', windowsHide: hidden });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
}
const readJSON = file => fs.readFile(file, 'utf8').then(text => JSON.parse(text.replace(/^\uFEFF/, '')));

// Version written in <install dir>\resources\app.asar \u2192 package.json. The archive starts with two
// little-endian uint32 headers: [4][header size] then [payload][JSON length][JSON], and the files
// begin right after the header.
async function installedVersion(dir) {
  const handle = await rawFs.open(path.join(dir, 'resources', 'app.asar'), 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (jsonSize > 64 * 1024 ** 2) throw new Error('Invalid archive header');
    const json = Buffer.alloc(jsonSize);
    await handle.read(json, 0, jsonSize, 16);
    const entry = JSON.parse(json.toString('utf8')).files['package.json'];
    const data = Buffer.alloc(entry.size);
    await handle.read(data, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return String(JSON.parse(data.toString('utf8')).version || '');
  } finally {
    await handle.close();
  }
}

// The NSIS installer chooses "for me" or "for everyone" from the registry. When both entries exist,
// or none, it falls back to a per-user folder and the program in use is never replaced. The mode is
// read from the uninstall entry that points at the folder in use, and passed explicitly.
function installMode(dir) {
  if (process.platform !== 'win32') return '';
  const needle = `"${dir.toLowerCase()}\\`;
  for (const [hive, flag] of [
    ['HKLM', '/allusers'],
    ['HKCU', '/currentuser'],
  ]) {
    const result = spawnSync(
      'reg.exe',
      ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, '/s', '/f', dir, '/d', '/reg:64'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    const found = String(result.stdout || '')
      .split(/\r?\n/)
      .some(line => /UninstallString/i.test(line) && line.toLowerCase().includes(needle));
    if (found) return flag;
  }
  return '';
}

// /D= must be the last argument and unquoted, so the command line is written verbatim.
function runInstaller(installer, dir, mode, env) {
  const args = ['/S', '--updated', ...(mode ? [mode] : []), `/D=${dir}`];
  const child = spawn(installer, args, {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: mode !== '/allusers',
    windowsVerbatimArguments: true,
    argv0: `"${installer}"`,
  });
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child));
    child.once('error', reject);
  });
}
async function main() {
  const request = await readJSON(process.argv[2]);
  const root = path.resolve(request.root);
  const log = (event, detail) =>
    fs.appendFile(
      path.join(root, 'logs', 'recovery.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), event, version: request.version, ...(detail ? { detail } : {}) }) +
        '\n',
    );
  const lockFile = path.join(root, 'update-lock.json');
  const progressFile = path.join(root, 'update-progress.json');
  const progress = step =>
    fs
      .writeFile(progressFile, JSON.stringify({ step, version: request.version, at: new Date().toISOString() }))
      .catch(() => {});
  let step = 'waiting';
  await log('update.guardian.started');
  await fs.writeFile(request.readyFile, JSON.stringify({ id: request.guardianId, pid: process.pid }));
  await fs.writeFile(
    lockFile,
    JSON.stringify({ pid: process.pid, version: request.version, at: new Date().toISOString() }),
  );
  const parentDeadline = Date.now() + 120000;
  while (running(request.parentPid) && Date.now() < parentDeadline) await delay(250);
  if (
    running(request.parentPid) ||
    (await fs.stat(request.cancelFile).then(
      () => true,
      () => false,
    ))
  ) {
    await log('update.guardian.aborted', { step });
    await fs.rm(lockFile, { force: true });
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await progress('installing');
  // The progress window is a convenience: its absence must never affect the update.
  await start(request.recoveryExe, [`--update-progress=${root}`], env).then(
    child => child.unref(),
    () => {},
  );
  let newProcess;
  try {
    step = 'installing';
    const installDir = path.dirname(path.resolve(request.previousExe));
    const mode = installMode(installDir);
    const installStarted = Date.now();
    await log('update.guardian.installer.started', { dir: installDir, mode: mode || 'registro' });
    const installer = await runInstaller(request.installer, installDir, mode, env);
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        installer.kill();
        reject(new Error('Installation timed out'));
      }, 300000);
      installer.once('exit', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    await log('update.guardian.installer.exited', {
      code: exitCode,
      seconds: Math.round((Date.now() - installStarted) / 1000),
    });
    if (exitCode !== 0) throw new Error(`Installer exit code ${exitCode}`);
    // The installer can report success without touching the folder in use (Windows permission
    // refused, antivirus, another folder chosen). Opening the old program would only fail later.
    step = 'verifying';
    const found = await installedVersion(installDir).catch(error => `ilegível (${error.code || error.message})`);
    if (found !== request.version) {
      await log('update.guardian.not-replaced', { dir: installDir, mode: mode || 'registro', found });
      throw new Error(`Installed version is ${found}, expected ${request.version}`);
    }
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
      } catch {
        /* The new version has not confirmed startup yet. */
      }
      // A long database migration is progress, not a failure.
      const phase = await readJSON(path.join(root, 'startup-phase.json')).catch(() => null);
      if (phase?.phase === 'migrating' && phase.version === request.version)
        healthDeadline = Math.max(healthDeadline, startedAt + MIGRATION_LIMIT);
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
    const recovery = await start(
      request.recoveryExe,
      [
        `--recover=${request.backupId}`,
        `--user-data=${root}`,
        `--rollback-version=${request.version}`,
        `--rollback-reason=${step}`,
      ],
      env,
    );
    recovery.unref();
    await delay(3000);
    await progress('done');
  }
}
main().catch(() => {
  process.exitCode = 1;
});
