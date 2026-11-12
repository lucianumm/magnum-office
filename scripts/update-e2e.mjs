// Real update test with the real NSIS installer, without touching the real installation:
// a separate appId gives its own registry entry, a test folder receives the program, and
// the data folder is temporary. Network and signing keys are simulated inside the test only.
//
// Usage: node scripts/update-e2e.mjs [--skip-build]
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import semver from 'semver';
import { createRequire } from 'node:module';
import { testOffice } from './test-helpers.mjs';
if (process.platform !== 'win32') throw new Error('Este teste é somente para Windows.');
// In a disposable machine the published installer is used as it is, with the real identity.
const publishedBase = process.env.E2E_BASE_INSTALLER || '';
const APP_ID = publishedBase ? 'br.advocacia.gestao' : 'br.advocacia.gestao.e2e';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const baseVersion = process.env.E2E_BASE_VERSION || '1.2.0';
const candidate = pkg.version;
const second = semver.inc(candidate, 'patch');
const failing = semver.inc(second, 'patch');
const interrupted = semver.inc(failing, 'patch');
const brokenStart = semver.inc(interrupted, 'patch');
// E2E_ALLUSERS=1 runs everything as an installation "for all users" (needs an elevated prompt, as in CI).
const allUsers = process.env.E2E_ALLUSERS === '1';
const hive = allUsers ? 'HKLM' : 'HKCU';
// Registry key of the NSIS installer for this appId (electron-builder derives it from the appId).
const { UUID } = createRequire(import.meta.url)('builder-util-runtime');
const installKey = `${hive}\\Software\\${UUID.v5(APP_ID, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'))}`;
const work = path.resolve('work', 'update-e2e');
const builds = path.join(work, 'builds');
const runDir = path.join(work, 'run-' + Date.now());
const installDir = path.join(runDir, 'programa instalado');
const dataRoot = publishedBase ? path.join(process.env.APPDATA, 'AdvocaciaGestao') : path.join(runDir, 'dados');
const exe = path.join(installDir, 'Advocacia Gestao.exe');
// A folder the registry points at by mistake, as when an older installation was made elsewhere.
const strayDir = path.join(runDir, 'outra pasta');
const results = [];
// The test must never touch the program installed on this computer.
const realInstallation = () => {
  const dir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Advocacia Gestao', 'resources', 'app.asar');
  return fss.existsSync(dir) ? `${fss.statSync(dir).size}:${fss.statSync(dir).mtimeMs}` : 'ausente';
};
const realBefore = realInstallation();
const say = text => process.stdout.write(`[${new Date().toLocaleTimeString('pt-BR')}] ${text}\n`);
await fs.mkdir(builds, { recursive: true });
await fs.mkdir(path.join(dataRoot, 'logs'), { recursive: true });

function builder(args, include = 'work/update-e2e/e2e.nsh') {
  // Leftovers of earlier runs must not be mistaken for this build.
  const output = args.find(arg => arg.startsWith('--config.directories.output='));
  if (output) fss.rmSync(path.resolve(output.split('=')[1]), { recursive: true, force: true });
  const r = spawnSync(
    'npx',
    [
      'electron-builder',
      '--win',
      'nsis',
      '--x64',
      '--publish',
      'never',
      `--config.appId=${APP_ID}`,
      '--config.nsis.createDesktopShortcut=false',
      '--config.nsis.createStartMenuShortcut=false',
      ...(publishedBase ? [] : [`--config.nsis.include=${include}`]),
      ...args,
    ],
    {
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      maxBuffer: 64 * 1024 ** 2,
    },
  );
  if (r.status !== 0) throw new Error('Falha ao gerar instalador:\n' + (r.stdout + r.stderr).slice(-3000));
}
// Same process-closing rule as the release, without copying the installer to the real data folder.
const includeFile = path.join(work, 'e2e.nsh');
const custom = await fs.readFile('installers/custom.nsh', 'utf8');
// The installer looks for pending-update.json in %APPDATA%; the test data lives in its own folder.
await fs.writeFile(
  includeFile,
  custom
    .replace(/!macro customInstall[\s\S]*?!macroend/, '')
    .replace(
      "Join-Path $$env:APPDATA 'AdvocaciaGestao\\pending-update.json'",
      `'${path.join(dataRoot, 'pending-update.json').replace(/'/g, "''")}'`,
    ),
);
if (!(await fs.readFile(includeFile, 'utf8')).includes(dataRoot)) throw new Error('custom.nsh mudou: ajuste o teste.');
await fs.writeFile(path.join(work, 'e2e-base.nsh'), '; Same process-closing rule as the published installers.\n');
// Each build folder holds one installer (builder() empties it first). If an older one is still there,
// the newest wins: picking by name once installed a 1.10.0 candidate in a 1.11.0 run.
const installerOf = dir => {
  const names = fss
    .readdirSync(dir)
    .filter(n => n.endsWith('.exe') && n.includes('setup') && !n.includes('uninstaller'));
  if (!names.length) throw new Error('Instalador não encontrado em ' + dir);
  const newest = names.sort(
    (a, b) => fss.statSync(path.join(dir, b)).mtimeMs - fss.statSync(path.join(dir, a)).mtimeMs,
  )[0];
  return path.join(dir, newest);
};
if (!process.argv.includes('--skip-build')) {
  if (!publishedBase) {
    say(`Gerando instalador base ${baseVersion} a partir do programa já publicado`);
    builder(
      [
        `--prepackaged=installers/artifacts/v${baseVersion}/win-unpacked`,
        '--config.directories.output=work/update-e2e/builds/base',
      ],
      'work/update-e2e/e2e-base.nsh',
    );
  }
  say(`Compilando interface e gerando candidato ${candidate}`);
  const vite = spawnSync('npx', ['vite', 'build'], { shell: true, encoding: 'utf8' });
  if (vite.status !== 0) throw new Error(vite.stderr);
  builder(['--config.directories.output=work/update-e2e/builds/candidate']);
  say(`Gerando segunda versão ${second}`);
  builder(['--config.directories.output=work/update-e2e/builds/second', `--config.extraMetadata.version=${second}`]);
  say(`Gerando versão ${brokenStart}, que instala mas não abre`);
  builder([
    '--config.directories.output=work/update-e2e/builds/broken',
    `--config.extraMetadata.version=${brokenStart}`,
    '--config.extraMetadata.e2eFailStart=true',
  ]);
}
const stopProgram = () =>
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$d='${runDir.replace(/'/g, "''")}'; $e='${dataRoot.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($d) -or $_.ExecutablePath.StartsWith($e)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ]);
const log = () => {
  try {
    return fss.readFileSync(path.join(dataRoot, 'logs', 'recovery.jsonl'), 'utf8');
  } catch {
    return '';
  }
};
const readJSON = name => {
  try {
    return JSON.parse(fss.readFileSync(path.join(dataRoot, name), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};
function clientCount() {
  const db = new DatabaseSync(path.join(dataRoot, 'database.sqlite'), { readOnly: true });
  try {
    return db.prepare("SELECT COUNT(*) AS n FROM entities WHERE kind='clients'").get().n;
  } finally {
    db.close();
  }
}
function auditEvents(name) {
  const db = new DatabaseSync(path.join(dataRoot, 'database.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM audit WHERE event=?').get(name).n;
  } finally {
    db.close();
  }
}
// Titles of windows the person can actually see, for programs running from the test folders.
const visibleWindows = () =>
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$d='${runDir.replace(/'/g, "''")}'; $e='${dataRoot.replace(/'/g, "''")}'; Get-Process | Where-Object { $_.Path -and ($_.Path.StartsWith($d) -or $_.Path.StartsWith($e)) -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.MainWindowTitle }`,
    ],
    { encoding: 'utf8' },
  )
    .stdout.split('\n')
    .map(s => s.trim())
    .filter(Boolean);
const snapshot = () =>
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$d='${runDir.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($d)) -or $_.Name -like '*setup*' -or $_.Name -like 'Un*.exe' -or $_.Name -like '*nsu*' -or $_.CommandLine -like ('*' + 'programa instalado' + '*') } | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)".Substring(0, [Math]::Min(170, "$($_.ProcessId) $($_.Name) $($_.CommandLine)".Length)) }`,
    ],
    { encoding: 'utf8' },
  ).stdout.trim();
async function waitForGuardian(limit) {
  const end = Date.now() + limit;
  let next = 0;
  while (Date.now() < end) {
    if (log().includes('update.guardian.success') || log().includes('update.guardian.rollback')) return true;
    // Published versions may have their guardian closed by the old uninstaller; the new version must still come up.
    if (
      publishedBase &&
      readJSON('health.json')?.version === candidate &&
      !fss.existsSync(path.join(dataRoot, 'pending-update.json'))
    )
      return true;
    if (Date.now() >= next) {
      next = Date.now() + 20000;
      say(`Situação: programa instalado=${fss.existsSync(exe)}\n${snapshot() || '(nenhum processo)'}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Tempo esgotado: guardião\nLog:\n' + log());
}
async function waitFor(test, limit, label) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = await test();
    if (value) return value;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Tempo esgotado: ' + label + '\nLog:\n' + log());
}

async function firstInstall() {
  say(`Instalando ${baseVersion} em uma pasta de teste (com espaço no caminho)`);
  await new Promise((resolve, reject) => {
    const mode = allUsers ? '/allusers ' : '';
    const c = spawn(`"${publishedBase || installerOf(path.join(builds, 'base'))}" /S ${mode}/D=${installDir}`, {
      shell: true,
      windowsVerbatimArguments: true,
    });
    c.once('exit', code => (code === 0 ? resolve() : reject(new Error('Instalação inicial: código ' + code))));
  });
  assert.ok(fss.existsSync(exe), 'Programa não instalado na pasta pedida');
}
// Points the installer's registry entry at another folder. Without the fix the silent update installs
// there, reports success and the program in use stays old.
function strayRegistry() {
  const r = spawnSync(
    'reg.exe',
    ['add', installKey, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', strayDir, '/f', '/reg:64'],
    {
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) throw new Error('Não foi possível alterar o registro de teste: ' + r.stderr);
}
const strayUntouched = () => !fss.existsSync(path.join(strayDir, 'Advocacia Gestao.exe'));
const launch = async ({ noPowerShell = false } = {}) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (noPowerShell)
    for (const key of Object.keys(env))
      if (key.toLowerCase() === 'path')
        env[key] = env[key]
          .split(';')
          .filter(dir => !/WindowsPowerShell/i.test(dir))
          .join(';');
  const app = await electron.launch({
    executablePath: exe,
    args: publishedBase ? [] : [`--data-dir=${dataRoot}`],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', e => say('Erro na página: ' + e.message));
  await page.waitForFunction(() => document.querySelector('.app-shell,.sidebar'), null, { timeout: 45000 });
  return { app, page };
};
const prepare = async page => {
  const state = await page.evaluate(() => window.advocacia.state());
  if (!state.termsAccepted)
    await page
      .evaluate(v => window.advocacia.acceptTerms({ version: v, accepted: true }), state.terms.version)
      .catch(() => {});
  const after = await page.evaluate(() => window.advocacia.state());
  if (!after.termsAccepted) {
    await page.getByRole('switch', { name: /^Li e aceito os termos/ }).check();
    await page.getByRole('button', { name: 'Aceitar e continuar', exact: true }).click();
  }
  const pending = await page.evaluate(() => window.advocacia.state());
  if (pending.setupRequired) await page.evaluate(o => window.advocacia.completeSetup(o), testOffice);
  await page.evaluate(() =>
    window.advocacia.configureBackups({
      enabled: false,
      dailyNotice: false,
      mode: 'local',
      recipient: '',
      acknowledged: true,
    }),
  );
  await page.evaluate(() => window.advocacia.saveSettings({ automatic: false, autoDownload: false }));
};
async function update(app, page, { target, installer, notes = 'Notas do teste', onQuit = false }) {
  const body = await fs.readFile(installer);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  await app.evaluate(
    ({ app: electronApp, dialog }, { target, installer, bytes, sha256, notes }) => {
      const path = process.getBuiltinModule('node:path');
      const crypto = process.getBuiltinModule('node:crypto');
      const fs = process.getBuiltinModule('node:fs');
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(path.join(electronApp.getAppPath(), 'package.json'));
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      require('./app/build-config.json').trustedUpdateKeys = [publicKey.export({ type: 'spki', format: 'pem' })];
      const name = `advocacia-gestao-setup-${target}-x64.exe`;
      const tag = `v${target}`;
      const repo = 'lucianumm/magnum-office';
      const url = n => `https://github.com/${repo}/releases/download/${tag}/${n}`;
      const manifest = Buffer.from(
        JSON.stringify({
          schema: 1,
          repository: repo,
          tag,
          version: target,
          channel: 'stable',
          minimumVersion: '0.1.0',
          mandatory: false,
          reason: '',
          notes,
          publishedAt: new Date().toISOString(),
          files: [{ name, bytes, sha256, platform: 'win32', arch: 'x64' }],
        }),
      );
      const signature = Buffer.from(crypto.sign(null, manifest, privateKey).toString('base64'));
      const assets = [
        { name, size: bytes, browser_download_url: url(name) },
        { name: 'release-stable.json', size: manifest.length, browser_download_url: url('release-stable.json') },
        {
          name: 'release-stable.json.sig',
          size: signature.length,
          browser_download_url: url('release-stable.json.sig'),
        },
      ];
      global.fetch = async input => {
        if (String(input).includes('api.github.com'))
          return new Response(JSON.stringify([{ tag_name: tag, draft: false, prerelease: false, assets }]));
        if (input === url('release-stable.json')) return new Response(manifest);
        if (input === url('release-stable.json.sig')) return new Response(signature);
        if (input === url(name)) return new Response(fs.readFileSync(installer));
        throw new Error('Rede inesperada: ' + input);
      };
      dialog.showMessageBox = async () => ({ response: 1 });
    },
    { target, installer, bytes: body.length, sha256, notes },
  );
  // A real automatic check may still be running after startup; wait for it before using the test network.
  await waitFor(
    () =>
      page.evaluate(async () => !['checking', 'downloading'].includes((await window.advocacia.state()).updates.status)),
    60000,
    'verificação inicial',
  );
  const checked = await page.evaluate(() => window.advocacia.checkUpdate());
  assert.equal(checked.status, 'available');
  assert.equal(checked.available.version, target);
  const downloaded = await page.evaluate(() => window.advocacia.downloadUpdate());
  assert.equal(downloaded.status, 'downloaded');
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  if (onQuit) {
    // Window closed to the tray, update left for when the person leaves the program.
    await page.evaluate(() => window.advocacia.installUpdateOnQuit(true));
    await page.evaluate(() => {
      void window.advocacia.window('close');
    });
    await new Promise(r => setTimeout(r, 800));
    assert.equal(visibleWindows().length, 0, 'A janela deveria estar na bandeja');
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
  } else {
    await page.evaluate(() => {
      void window.advocacia.installUpdate();
    });
  }
  await exited;
}
async function step(name, task) {
  const t = Date.now();
  try {
    say('▶ ' + name);
    const detail = await task();
    results.push({ name, ok: true, seconds: Math.round((Date.now() - t) / 1000), detail });
    say('✔ ' + name);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    say('✖ ' + name + '\n' + error.message);
    throw error;
  }
}
// E2E_TRACE records every process that starts or ends, to explain a guardian that stops without a word.
let tracer = null;
if (process.env.E2E_TRACE) {
  const file = path.join(work, 'trace.log').replace(/'/g, "''");
  tracer = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$seen=@{}; while($true){ $now=@{}; Get-CimInstance Win32_Process | ForEach-Object { $now[[int]$_.ProcessId]=1; if(-not $seen.ContainsKey([int]$_.ProcessId)){ $seen[[int]$_.ProcessId]=$_.Name; $c="$($_.CommandLine)"; if($c.Length -gt 400){$c=$c.Substring(0,400)}; Add-Content -LiteralPath '${file}' ((Get-Date -Format 'HH:mm:ss.fff')+' + '+$_.ProcessId+' pai='+$_.ParentProcessId+' '+$_.Name+' '+$c) } }; foreach($k in @($seen.Keys)){ if(-not $now.ContainsKey($k)){ Add-Content -LiteralPath '${file}' ((Get-Date -Format 'HH:mm:ss.fff')+' - '+$k+' '+$seen[$k]); $seen.Remove($k) } }; Start-Sleep -Milliseconds 100 }`,
    ],
    { stdio: 'ignore' },
  );
}
try {
  await firstInstall();
  let session = await launch();
  await prepare(session.page);
  await session.page.evaluate(() =>
    window.advocacia.save({
      kind: 'clients',
      entity: { name: 'Cliente preservado', phone: '5564999990000', status: 'Ativo', emailPreference: 'Receber' },
    }),
  );
  if (!publishedBase) strayRegistry();
  await step(
    `${baseVersion} → ${candidate}: atualizador publicado + instalador real${publishedBase ? '' : ', registro apontando para outra pasta'}`,
    async () => {
      await update(session.app, session.page, {
        target: candidate,
        installer: installerOf(path.join(builds, 'candidate')),
      });
      await waitForGuardian(process.env.E2E_TRACE ? 240000 : 600000);
      assert.ok(!log().includes('update.guardian.rollback'), 'O guardião reverteu:\n' + log());
      assert.equal(readJSON('health.json').version, candidate);
      assert.ok(strayUntouched(), 'O instalador usou a pasta errada do registro');
      await new Promise(r => setTimeout(r, 2500));
      assert.equal(fss.existsSync(path.join(dataRoot, 'pending-update.json')), false);
      assert.ok(visibleWindows().length > 0, 'A nova versão abriu sem janela visível');
      return {
        janelas: visibleWindows(),
        reaberto: log().includes('update.guardian.success') ? 'pelo guardião' : 'pelo vigia do instalador',
      };
    },
  );
  stopProgram();
  await new Promise(r => setTimeout(r, 2000));
  await step('Dados preservados e versão registrada', async () => {
    assert.equal(clientCount(), 1);
    assert.equal(auditEvents('update.success'), 1);
    assert.ok(readJSON('config.json').lastUpdate);
  });
  session = await launch();
  await step(`${candidate} abre normalmente pelo atalho (sem argumentos do guardião)`, async () => {
    const state = await session.page.evaluate(() => window.advocacia.state());
    assert.equal(state.version, candidate);
    assert.equal(state.entities.clients.length, 1);
  });
  await fs.rm(path.join(dataRoot, 'logs', 'recovery.jsonl'), { force: true });
  if (!publishedBase) strayRegistry();
  await step(
    `${candidate} → ${second}: atualizador novo, janela de progresso, novidades e registro errado`,
    async () => {
      await prepare(session.page);
      await update(session.app, session.page, {
        target: second,
        installer: installerOf(path.join(builds, 'second')),
        notes: 'Novidades da versão de teste',
        onQuit: true,
      });
      // Someone double-clicks the shortcut while the update is running.
      let midInstall = 'programa já removido pelo instalador';
      if (fss.existsSync(exe)) {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const opened = spawn(exe, [`--data-dir=${dataRoot}`], { env, detached: true, stdio: 'ignore' });
        opened.on('error', () => {});
        opened.unref();
        for (let i = 0; i < 6 && midInstall.startsWith('programa'); i++) {
          await new Promise(r => setTimeout(r, 700));
          if (visibleWindows().includes('Atualização em andamento')) midInstall = 'aviso exibido';
        }
      }
      results.midInstall = midInstall;
      await waitFor(
        async () => {
          if (visibleWindows().some(title => title.startsWith('Atualiza'))) results.progressSeen = true;
          return log().includes('update.guardian.success') || log().includes('update.guardian.rollback');
        },
        420000,
        'guardião',
      );
      assert.ok(log().includes('update.guardian.success'), 'O guardião reverteu:\n' + log());
      assert.ok(strayUntouched(), 'O instalador usou a pasta errada do registro');
      assert.ok(log().includes(allUsers ? '"mode":"/allusers"' : '"mode":"/currentuser"'), log());
      assert.ok(results.progressSeen, 'Janela de progresso não apareceu');
      await new Promise(r => setTimeout(r, 2500));
      assert.equal(readJSON('whats-new.json')?.notes, 'Novidades da versão de teste');
      assert.equal(fss.existsSync(path.join(dataRoot, 'update-lock.json')), false);
      assert.ok(visibleWindows().length > 0, 'A nova versão abriu sem janela visível');
      return { abertoDuranteInstalacao: results.midInstall };
    },
  );
  stopProgram();
  await new Promise(r => setTimeout(r, 2000));
  await fs.rm(path.join(dataRoot, 'logs', 'recovery.jsonl'), { force: true });
  session = await launch({ noPowerShell: true });
  await step(
    `${second} → ${failing} defeituosa, sem PowerShell no PATH: instalador não substitui o programa e volta à anterior`,
    async () => {
      await prepare(session.page);
      // The "new" installer actually installs the same version: it reports success without replacing the
      // program, which the guardian detects right after the installer, before opening anything.
      await update(session.app, session.page, { target: failing, installer: installerOf(path.join(builds, 'second')) });
      await waitFor(() => readJSON('recovery-notice.json'), 420000, 'aviso de recuperação');
      const notice = readJSON('recovery-notice.json');
      assert.equal(notice.failedVersion, failing);
      assert.equal(notice.reason, 'verifying');
      assert.ok(log().includes('update.guardian.not-replaced'), log());
      // The audit table was restored with the data, so the proof is the backup itself: no shortcut, yet the update went on.
      const preserved = fss
        .readdirSync(path.join(dataRoot, 'backups'))
        .filter(name => /^\d{4}-/.test(name) && fss.existsSync(path.join(dataRoot, 'backups', name, 'runtime')))
        .sort()
        .pop();
      assert.equal(
        fss.existsSync(path.join(dataRoot, 'backups', preserved, 'Recuperar Advocacia.lnk')),
        false,
        'O teste deveria rodar sem PowerShell',
      );
      assert.ok(readJSON('config.json').blockedVersions.includes(failing));
      assert.ok(log().includes('update.guardian.failed'), log());
      assert.equal(clientCount(), 1);
      await waitFor(() => visibleWindows().length > 0, 30000, 'janela depois da reversão');
      return { motivo: notice.reason };
    },
  );
  stopProgram();
  await new Promise(r => setTimeout(r, 2500));
  session = await launch();
  await step('Depois da reversão o programa instalado abre e a versão com defeito fica bloqueada', async () => {
    const state = await session.page.evaluate(() => window.advocacia.state());
    assert.equal(state.version, second);
    assert.equal(state.entities.clients.length, 1);
    assert.ok(state.recovery?.failedVersion === failing);
  });
  await session.page.evaluate(() => window.advocacia.dismissRecoveryNotice());
  await fs.rm(path.join(dataRoot, 'logs', 'recovery.jsonl'), { force: true });
  await step(`${second} → ${brokenStart}: instala, mas a nova versão não abre e volta à anterior`, async () => {
    await update(session.app, session.page, {
      target: brokenStart,
      installer: installerOf(path.join(builds, 'broken')),
    });
    await waitFor(() => readJSON('recovery-notice.json'), 420000, 'aviso de recuperação');
    const notice = readJSON('recovery-notice.json');
    assert.equal(notice.failedVersion, brokenStart);
    assert.equal(notice.reason, 'starting');
    assert.ok(log().includes('update.guardian.installed'), 'A instalação deveria ter sido conferida:\n' + log());
    await waitFor(() => visibleWindows().length > 0, 60000, 'janela depois da reversão');
    stopProgram();
    await new Promise(r => setTimeout(r, 2500));
    session = await launch();
    const state = await session.page.evaluate(() => window.advocacia.state());
    assert.equal(state.version, second, 'o programa anterior foi restaurado na pasta');
    assert.equal(state.entities.clients.length, 1);
    assert.ok(state.settings.blockedVersions.includes(brokenStart));
    await session.page.evaluate(() => window.advocacia.dismissRecoveryNotice());
    return { motivo: notice.reason };
  });
  await fs.rm(path.join(dataRoot, 'logs', 'recovery.jsonl'), { force: true });
  await step(`Queda de energia durante a instalação de ${interrupted}`, async () => {
    await update(session.app, session.page, {
      target: interrupted,
      installer: installerOf(path.join(builds, 'second')),
    });
    await new Promise(r => setTimeout(r, 3000));
    stopProgram();
    await new Promise(r => setTimeout(r, 4000));
    let way = 'o programa abriu e avisou';
    let opened = null;
    if (fss.existsSync(exe)) {
      try {
        opened = await launch();
      } catch {
        opened = null;
      }
    }
    if (!opened) {
      // The documented manual recovery: the preserved copy restores program and data.
      way = 'recuperação pela cópia preservada';
      stopProgram();
      const id = fss
        .readdirSync(path.join(dataRoot, 'backups'))
        .filter(name => /^\d{4}-/.test(name) && fss.existsSync(path.join(dataRoot, 'backups', name, 'runtime')))
        .sort()
        .pop();
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      await fs.rm(path.join(dataRoot, 'recovery-notice.json'), { force: true });
      spawn(
        path.join(dataRoot, 'backups', id, 'runtime', path.basename(exe)),
        [`--recover=${id}`, `--user-data=${dataRoot}`, `--rollback-version=${interrupted}`],
        { env, detached: true, stdio: 'ignore' },
      ).unref();
      await waitFor(() => readJSON('recovery-notice.json'), 120000, 'recuperação');
      await new Promise(r => setTimeout(r, 4000));
      stopProgram();
      await new Promise(r => setTimeout(r, 2500));
      opened = await launch();
    }
    session = opened;
    // The notice is written after the window opens, once the startup checks run.
    await waitFor(
      () => session.page.evaluate(async () => Boolean((await window.advocacia.state()).recovery)),
      30000,
      'aviso de atualização interrompida',
    );
    const state = await session.page.evaluate(() => window.advocacia.state());
    assert.equal(state.version, second);
    assert.equal(state.entities.clients.length, 1);
    assert.equal(state.recovery?.failedVersion, interrupted);
    assert.ok(state.settings.blockedVersions.includes(interrupted));
    assert.equal(fss.existsSync(path.join(dataRoot, 'pending-update.json')), false);
    return { caminho: way };
  });
  await step('Espaço em disco depois de 4 atualizações', async () => {
    await new Promise(r => setTimeout(r, 70000));
    const backups = fss.readdirSync(path.join(dataRoot, 'backups')).filter(name => /^\d{4}-/.test(name));
    const manifests = backups
      .map(name => JSON.parse(fss.readFileSync(path.join(dataRoot, 'backups', name, 'manifest.json'), 'utf8')))
      .filter(m => m.reason === 'pre-update');
    assert.ok(manifests.length <= 3, `Cópias de atualização: ${manifests.length}`);
    assert.ok(manifests.filter(m => m.runtime).length <= 1, 'Mais de uma cópia do programa');
    assert.equal(fss.readdirSync(path.join(dataRoot, 'updates')).length, 0, 'Instaladores sobrando');
    const state = await session.page.evaluate(() => window.advocacia.state());
    assert.equal(state.dbStatus, 'ok');
    return { copias: manifests.length, comPrograma: manifests.filter(m => m.runtime).length };
  });
  await session.app.close().catch(() => {});
  say('Todos os cenários passaram.');
} finally {
  tracer?.kill();
  stopProgram();
  await new Promise(r => setTimeout(r, 1500));
  // Never run the test uninstaller. Once its Windows entry is gone (for example after the interrupted
  // installation) it falls back to the default folder, which is the REAL installation of this computer.
  if (!publishedBase) {
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$d='${runDir.replace(/'/g, "''")}'; foreach ($root in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\Software'${allUsers ? ",'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software'" : ''}) { Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; $p.InstallLocation -like ($d + '*') -or $p.UninstallString -like ('*' + $d + '*') } | Remove-Item -Recurse -Force }`,
    ]);
    await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
    say('Instalação de teste removida.');
  }
  if (realBefore !== realInstallation()) {
    results.push({
      name: 'Instalação real intacta',
      ok: false,
      error: `Antes: ${realBefore}; depois: ${realInstallation()}`,
    });
    process.exitCode = 1;
    say('ERRO GRAVE: a instalação real deste computador foi alterada pelo teste.');
  } else results.push({ name: 'Instalação real intacta', ok: true });
  await fs.writeFile(
    path.join(work, 'result.json'),
    JSON.stringify(
      { at: new Date().toISOString(), baseVersion, candidate, second, failing, brokenStart, allUsers, results },
      null,
      2,
    ),
  );
  say('Resultado: ' + path.join(work, 'result.json'));
}
