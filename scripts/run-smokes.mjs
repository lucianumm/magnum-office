// Runs every interface test one after another and summarizes the results.
// Usage: node scripts/run-smokes.mjs [test name filter] [path to packaged executable]
import { spawnSync } from 'node:child_process';
const names = [
  'smoke',
  'features-smoke',
  'email-smoke',
  'workspace-smoke',
  'release-features-smoke',
  'privacy-email-backup-smoke',
  'corrections-smoke',
  'birthdays-smoke',
  'email-layout-smoke',
  'manual-update-smoke',
  'documents-smoke',
  'tools-smoke',
  'new-features-smoke',
  'whatsapp-smoke',
  'letterhead-smoke',
];
const filter = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : '';
const exe = process.argv[3];
const results = [];
for (const name of names.filter(n => !filter || n === filter)) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`scripts/${name}.mjs`, ...(exe ? [exe] : [])], {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 ** 2,
  });
  const ok = run.status === 0;
  results.push({ name, ok, seconds: Math.round((Date.now() - started) / 1000) });
  process.stdout.write(`${ok ? 'OK  ' : 'FALHA'} ${name} (${results.at(-1).seconds}s)\n`);
  if (!ok)
    process.stdout.write(
      `${String(run.stderr || run.stdout)
        .split('\n')
        .filter(l => !/^\s+at /.test(l))
        .slice(0, 14)
        .join('\n')
        .slice(0, 1400)}\n---\n`,
    );
}
const failed = results.filter(r => !r.ok).length;
process.stdout.write(`\n${results.length - failed} de ${results.length} passaram.\n`);
process.exitCode = failed ? 1 : 0;
