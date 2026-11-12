const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { startGuardian } = require('../updater/recovery.cjs');
async function fixture(t) {
  const base = path.resolve('work/guardian-startup-tests');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  const backupId = '2026-11-06T01-00-00-000Z-1234abcd';
  const runtime = path.join(root, 'backups', backupId, 'runtime');
  fs.mkdirSync(path.join(runtime, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(runtime, path.basename(process.execPath)), 'fixture');
  fs.writeFileSync(path.join(runtime, 'resources', 'guardian.cjs'), 'fixture');
  t.after(() => {
    if (!root.startsWith(base + path.sep)) throw Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, pending: { backupId, version: '1.2.0', previousExe: process.execPath } };
}
test('updater acknowledges a started helper even with a UTF-8 BOM', async t => {
  const { root, pending } = await fixture(t);
  let unref = false;
  await startGuardian(root, pending, 'fixture.exe', {
    launcher: () => {
      const request = JSON.parse(fs.readFileSync(path.join(root, 'update-request.json'), 'utf8'));
      fs.writeFileSync(request.readyFile, '\uFEFF' + JSON.stringify({ id: request.guardianId }));
      const child = new EventEmitter();
      child.exitCode = null;
      child.unref = () => {
        unref = true;
      };
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  assert.equal(unref, true);
  const request = JSON.parse(fs.readFileSync(path.join(root, 'update-request.json'), 'utf8'));
  assert.equal(fs.existsSync(request.readyFile), false);
  assert.equal(fs.existsSync(request.cancelFile), false);
});
test('a helper that exits without acknowledging startup cancels the update instead of closing the application', async t => {
  const { root, pending } = await fixture(t);
  await assert.rejects(
    startGuardian(root, pending, 'fixture.exe', {
      launcher: () => {
        const child = new EventEmitter();
        child.exitCode = 1;
        child.unref = () => {};
        process.nextTick(() => child.emit('spawn'));
        return child;
      },
    }),
    /continuará aberto/,
  );
  const request = JSON.parse(fs.readFileSync(path.join(root, 'update-request.json'), 'utf8'));
  assert.equal(fs.existsSync(request.cancelFile), true);
});

test('headless runtime executes the helper and acknowledges startup', async t => {
  const { root, pending } = await fixture(t);
  const script = path.join(root, 'backups', pending.backupId, 'runtime', 'resources', 'guardian.cjs');
  fs.writeFileSync(
    script,
    "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(r.readyFile,JSON.stringify({id:r.guardianId}));",
  );
  await startGuardian(root, pending, 'fixture.exe', {
    launcher: (exe, args, options) => {
      assert.equal(options.detached, true);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
      assert.equal(exe, path.join(root, 'backups', pending.backupId, 'runtime', path.basename(process.execPath)));
      return require('node:child_process').spawn(process.execPath, args, options);
    },
  });
  const request = JSON.parse(fs.readFileSync(path.join(root, 'update-request.json'), 'utf8'));
  assert.equal(fs.existsSync(request.cancelFile), false);
});
