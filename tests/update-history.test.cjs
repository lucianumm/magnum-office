const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lastAttempt, attemptText } = require('../backend/update-history.cjs');

const base = path.resolve('work', 'tests');
fs.mkdirSync(base, { recursive: true });
const line = (event, version, detail) =>
  JSON.stringify({ at: '2026-11-12T10:00:00.000Z', event, version, ...(detail ? { detail } : {}) });

test('the last guardian attempt is summarised from recovery.jsonl', async t => {
  const root = fs.mkdtempSync(path.join(base, 'history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(await lastAttempt(root), null, 'no log yet');
  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(
    path.join(root, 'logs', 'recovery.jsonl'),
    [
      line('update.guardian.started', '1.9.2'),
      line('update.guardian.success', '1.9.2', { seconds: 20 }),
      line('update.guardian.started', '1.10.0'),
      line('update.guardian.installer.started', '1.10.0', {
        dir: 'C:\\Program Files\\Advocacia Gestao',
        mode: '/allusers',
      }),
      line('update.guardian.installer.exited', '1.10.0', { code: 0, seconds: 31 }),
      line('update.guardian.not-replaced', '1.10.0', { dir: 'C:\\Program Files\\Advocacia Gestao', found: '1.9.2' }),
      line('update.guardian.failed', '1.10.0', {
        step: 'verifying',
        message: 'Installed version is 1.9.2, expected 1.10.0',
      }),
      'linha corrompida',
      line('update.guardian.rollback', '1.10.0'),
      line('update.recovery.program-restore.failed', '1.10.0', {
        code: 'EBUSY',
        message: 'resource busy or locked',
        attempts: 8,
      }),
    ].join('\n'),
  );
  const attempt = await lastAttempt(root);
  assert.equal(attempt.version, '1.10.0');
  assert.equal(attempt.outcome, 'failed');
  assert.equal(attempt.step, 'verifying');
  assert.equal(attempt.stepLabel, 'conferência da versão instalada');
  assert.equal(attempt.mode, '/allusers');
  assert.equal(attempt.installerCode, 0);
  assert.equal(attempt.foundVersion, '1.9.2');
  assert.equal(attempt.lines.length, 7, 'only the last attempt, without the broken line');
  assert.equal(attempt.restoreError, 'resource busy or locked');
  const text = attemptText(attempt, '1.9.2');
  assert.match(text, /Resultado: failed/);
  assert.match(text, /Versão encontrada na pasta: 1\.9\.2/);
  assert.match(text, /não pôde ser copiada de volta: resource busy or locked/);
  assert.match(attemptText(null, '1.9.2'), /nenhuma tentativa/);
});
