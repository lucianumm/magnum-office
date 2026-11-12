const os = require('node:os');
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  shell,
  safeStorage,
  Menu,
  Tray,
  nativeImage,
  Notification,
  clipboard,
  powerMonitor,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Backups, restoreBackup, backupPath, verifyBackup, walk } = require('../backend/backups.cjs');
const { Documents } = require('../backend/documents.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { diagnostics } = require('../backend/diagnostics.cjs');
const { Updater } = require('../updater/updater.cjs');
const { applyRetention } = require('../backend/retention.cjs');
const { WeeklyBackups } = require('../backend/weekly-backups.cjs');
const { PDFTools } = require('../backend/pdf-tools.cjs');
const { Library } = require('../backend/library.cjs');
const { Imports } = require('../backend/imports.cjs');
const { AgentAPI } = require('../backend/agent-api.cjs');
const { DocumentGenerator } = require('../backend/document-generator.cjs');
const { HearingReminders } = require('../backend/hearing-reminders.cjs');
const { WorkflowRunner } = require('../backend/workflow-runner.cjs');
const { Finance } = require('../backend/finance.cjs');
const { Indices } = require('../backend/indices.cjs');
const { DataJud } = require('../backend/datajud.cjs');
const { CNPJLookup } = require('../backend/cnpj.cjs');
const { CEPLookup } = require('../backend/cep.cjs');
const { AppLock } = require('../backend/app-lock.cjs');
const { Digest } = require('../backend/digest.cjs');
const { DJEN } = require('../backend/djen.cjs');
const { Intakes } = require('../backend/intakes.cjs');
const { DocumentIndex } = require('../backend/document-index.cjs');
const { extractEmails } = require('../backend/email-addresses.cjs');
const version = require('../app/version.cjs');
const support = require('../app/support.json');
const terms = require('../app/terms.json');
const courts = require('../app/courts.json');

app.setName('Magnum Office');
app.setAppUserModelId('br.advocacia.gestao');
protocol.registerSchemesAsPrivileged([
  { scheme: 'advocacia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const getArg = prefix => process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const recovering = getArg('--recover=');
const recoveryRoot = recovering ? getArg('--user-data=') : null;
const testRoot = !app.isPackaged ? process.env.ADVOCACIA_TEST_DATA : null;
const customRoot = getArg('--data-dir=');
const progressRoot = getArg('--update-progress=');
const guardianLaunch = process.argv.includes('--guardian-launch');
const relaunchWatch = process.argv.includes('--relaunch-after-update');
if (customRoot && !path.isAbsolute(customRoot)) throw new Error('A pasta de dados deve usar um caminho absoluto.');
const dataRoot = recoveryRoot || customRoot || testRoot || path.join(app.getPath('appData'), 'AdvocaciaGestao');
app.setPath(
  'userData',
  progressRoot || relaunchWatch ? path.join(os.tmpdir(), 'magnum-office-update-progress') : dataRoot,
);
const deferredLock = Boolean(recovering && getArg('--wait-pid='));
let isPrimary = !progressRoot && !relaunchWatch && (deferredLock || app.requestSingleInstanceLock());
if (!isPrimary && !progressRoot && !relaunchWatch) app.quit();
// The uninstaller of versions up to 1.2.0 can close programs by name, and the guardian shares that name. If the
// guardian was closed, nobody reopens the program: this watcher, started by the installer, does it. When the
// update is already confirmed there is nothing pending and it leaves without showing anything.
if (relaunchWatch)
  setTimeout(() => {
    void app.whenReady().then(() => {
      try {
        if (fs.existsSync(path.join(dataRoot, 'pending-update.json')))
          app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== '--relaunch-after-update') });
      } finally {
        app.exit(0);
      }
    });
  }, 30000);
if (progressRoot)
  void require('../updater/progress-window.cjs')
    .runProgressWindow(path.resolve(progressRoot))
    .catch(() => app.quit());
let win,
  tray,
  store,
  settings,
  messaging,
  updater,
  documents,
  backups,
  library,
  imports,
  agentAPI,
  pdfTools,
  weeklyBackups,
  birthdays,
  generator,
  reminders,
  workflowRunner,
  finance,
  indices,
  datajud,
  djen,
  intakes,
  docIndex,
  cnpj,
  cep,
  appLock,
  digest;
const operations = new Operations();
let notificationTimer;
let quitting = false;
const notified = new Set();
const startHidden = process.argv.includes('--start-hidden');
let startedHiddenOnce = false;
let markRendererReady;
const rendererReady = new Promise(resolve => {
  markRendererReady = resolve;
});
const devURL =
  !app.isPackaged && process.env.ADVOCACIA_DEV_URL === 'http://127.0.0.1:5173' ? process.env.ADVOCACIA_DEV_URL : null;
function icon() {
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
}
function show() {
  if (!app.isReady()) {
    void app.whenReady().then(show);
    return;
  }
  if (!settings || !store) return;
  if (!win || win.isDestroyed()) {
    void createWindow().catch(error => dialog.showErrorBox('Não foi possível reabrir a janela', error.message));
    return;
  }
  win.show();
  // The published 1.2.0 guardian starts this program with SW_HIDE, and Windows ignores the first ShowWindow in that case.
  if (!win.isVisible()) win.show();
  win.focus();
}
function keepInBackground() {
  ensureTray();
  if (win && !win.isDestroyed()) win.hide();
  if (appLock?.config().onHide && appLock.lock()) dataChanged();
  store?.audit('window.background');
}
function ensureTray() {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(icon());
  tray.on('click', show);
  tray.on('double-click', show);
  applyBranding();
}
let notifiedUpdate = '';
function notifyUpdate(update) {
  const key = update.status === 'downloaded' ? update.available?.version : '';
  if (!key || key === notifiedUpdate) return;
  notifiedUpdate = key;
  if (!Notification.isSupported() || !settings?.get().notifications) return;
  const notice = new Notification({
    title: 'Atualização pronta',
    body: `A versão ${key} foi baixada e conferida. Instale quando for conveniente.`,
    icon: icon(),
  });
  notice.on('click', show);
  notice.show();
}
function applyStartup() {
  if (!app.isPackaged || process.platform === 'linux') return;
  app.setLoginItemSettings({ openAtLogin: Boolean(settings.get().openAtLogin), args: ['--start-hidden'] });
}
function displayName() {
  return settings?.get().appName || 'Magnum Office';
}
function applyBranding() {
  if (win && !win.isDestroyed()) win.setTitle(displayName());
  if (tray && !tray.isDestroyed()) tray.setToolTip(displayName());
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${displayName()}`, click: show },
      { type: 'separator' },
      {
        label: 'Sair do sistema',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// The window reloads its data only when something changed, instead of decrypting everything every few
// seconds. Commands that only read never announce a change (and "state" must not, or it would loop).
const readOnlyCommands = new Set([
  'ready',
  'state',
  'trashList',
  'lockConfig',
  'lookupCEP',
  'digestConfig',
  'previewDigest',
  'certificateInfo',
  'legalText',
  'previewDocument',
  'previewWorkflow',
  'previewEmail',
  'previewImport',
  'previewRecurrence',
  'extractEmails',
  'window',
  'openLink',
  'openDocument',
  'courtLink',
  'copyPix',
  'copyAgentToken',
  'openLogs',
  'openBackups',
  'openPDFOutput',
  'diagnostic',
  'exportDocument',
  'exportData',
  'exportFinance',
  'exportCalendar',
  'testNotification',
  'chooseImport',
  'emailAttachments',
  'importEmailImage',
  'importTemplate',
  'caseMovements',
  'debtSeries',
  'openIntimation',
  'searchDocuments',
]);
let changeTimer = null;
// Locking (idle time, Windows session lock), the morning summary and the trash cleanup.
function startLockAndDailyTasks() {
  const lockNow = () => {
    if (appLock?.lock()) dataChanged();
  };
  powerMonitor.on('lock-screen', () => {
    if (appLock?.config().onHide) lockNow();
  });
  let lastPurge = '';
  const tick = () => {
    try {
      if (appLock?.idle(powerMonitor.getSystemIdleTime())) dataChanged();
      const day = new Date().toISOString().slice(0, 10);
      if (lastPurge !== day) {
        lastPurge = day;
        if (store.purgeTrash({ olderThanDays: 30 })) dataChanged();
      }
      if (settings.get().termsAcceptedVersion === terms.version && !operations.maintenance && digest.tick())
        dataChanged();
    } catch {
      /* Each part records its own failures; the next tick tries again. */
    }
  };
  tick();
  setInterval(tick, 30000).unref();
}
function dataChanged() {
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('advocacia:changed');
  }, 150);
}
// Background work (sending queue, updates, PDF jobs, WhatsApp, backups, birthdays) changes data without
// any command. A cheap fingerprint of counters and states, checked every 2 s, catches it without decrypting.
let lastFingerprint = '';
function watchChanges() {
  setInterval(() => {
    try {
      if (!store || !win || win.isDestroyed()) return;
      const db = store.db;
      const fingerprint = JSON.stringify([
        db.prepare('SELECT MAX(id) AS n FROM audit').get().n,
        db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM entities').get(),
        db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM queue').get(),
        messaging?.status(),
        updater?.get(),
        operations.status(),
        pdfTools?.get(),
        settings.get(),
      ]);
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        dataChanged();
      }
    } catch {
      /* the database may be closed during a restore; the next tick tries again */
    }
  }, 2000).unref();
}
// DataJud and DJEN, when the office turned them on, are checked about once a day while the program is
// open or in the tray. Errors are kept in the settings and shown on the screen, never thrown here.
let publicChecking = false;
function schedulePublicChecks() {
  const due = last => !last || Date.now() - Date.parse(last) > 20 * 3600000;
  const tick = async () => {
    if (publicChecking || operations.maintenance || settings.get().termsAcceptedVersion !== terms.version) return;
    publicChecking = true;
    try {
      const cfg = settings.get();
      if (cfg.djenEnabled && due(cfg.lastDjenCheck))
        await djen.check().catch(e => settings.internal({ djenError: e.message }));
      if (cfg.datajudEnabled && due(cfg.lastDatajudCheck))
        await datajud.checkAll().catch(e => settings.internal({ datajudError: e.message }));
    } finally {
      publicChecking = false;
    }
  };
  setTimeout(() => void tick(), 60000).unref();
  setInterval(() => void tick(), 30 * 60000).unref();
}
function register(command, handler) {
  ipcMain.handle('advocacia:' + command, async (event, data) => {
    try {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        (event.senderFrame.url !== 'advocacia://app/index.html' &&
          !event.senderFrame.url.startsWith(devURL ? devURL + '/' : 'advocacia://app/index.html#'))
      )
        throw new Error('Origem não autorizada.');
      if (
        settings &&
        settings.get().termsAcceptedVersion !== terms.version &&
        ![
          'ready',
          'state',
          'acceptTerms',
          'declineTerms',
          'legalText',
          'window',
          'openLink',
          'exportData',
          'exportDocument',
          'createBackup',
          'openBackups',
        ].includes(command)
      )
        throw new Error('Leia e aceite os termos antes de usar esta função.');
      if (appLock?.locked && !['ready', 'state', 'unlockApp', 'window', 'legalText'].includes(command))
        throw new Error('O programa está bloqueado. Digite a senha para continuar.');
      if (data !== undefined && JSON.stringify(data).length > 400000)
        throw new Error('Solicitação maior que o limite permitido.');
      const value = await handler(data);
      if (!readOnlyCommands.has(command)) {
        dataChanged();
        // New documents (imported, generated, restored) get their text indexed in the background.
        if (docIndex)
          void docIndex
            .indexPending()
            .then(n => n && dataChanged())
            .catch(() => {});
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error.message || 'A operação não pôde ser concluída.' };
    }
  });
}
function state() {
  if (appLock?.locked)
    return {
      locked: true,
      settings: {
        appName: settings.get().appName,
        theme: settings.get().theme,
        appearance: settings.get().appearance,
        density: settings.get().density,
      },
      version,
    };
  return {
    locked: false,
    backupSchedule: weeklyBackups.get(),
    terms,
    termsAccepted: settings.get().termsAcceptedVersion === terms.version,
    setupRequired: settings.setupRequired(),
    pdfJob: pdfTools.get(),
    notificationsSupported: Notification.isSupported(),
    library: { groups: library.groups(), templates: library.list() },
    agent: agentAPI.status(),
    version,
    packaged: app.isPackaged,
    platform: process.platform,
    support,
    courts,
    settings: settings.get(),
    counts: store.counts(),
    entities: Object.fromEntries(
      ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes', 'time'].map(kind => [
        kind,
        store.list(kind),
      ]),
    ),
    services: messaging.status(),
    messages: messaging.list(),
    backups: backups.list(),
    updates: updater.get(),
    operations: operations.status(),
    audit: store.auditList(),
    intimations: djen ? djen.list() : [],
    movementsNew: datajud ? datajud.newCounts() : {},
    documentIndex: docIndex ? docIndex.status() : null,
    indices: indices ? indices.status() : null,
    dbStatus: store.integrity() ? 'ok' : 'error',
    recovery: fs.existsSync(path.join(dataRoot, 'recovery-notice.json'))
      ? JSON.parse(fs.readFileSync(path.join(dataRoot, 'recovery-notice.json'), 'utf8'))
      : null,
    whatsNew: fs.existsSync(path.join(dataRoot, 'whats-new.json'))
      ? JSON.parse(fs.readFileSync(path.join(dataRoot, 'whats-new.json'), 'utf8'))
      : null,
  };
}
function bindHandlers() {
  // The IPC files under desktop/ipc read the current objects through this context.
  const ctx = {
    desktopDir: __dirname,
    get appLock() {
      return appLock;
    },
    get cep() {
      return cep;
    },
    get digest() {
      return digest;
    },
    get Notification() {
      return Notification;
    },
    get agentAPI() {
      return agentAPI;
    },
    get app() {
      return app;
    },
    get applyBranding() {
      return applyBranding;
    },
    get applyStartup() {
      return applyStartup;
    },
    get backupPath() {
      return backupPath;
    },
    get backups() {
      return backups;
    },
    get birthdays() {
      return birthdays;
    },
    get clipboard() {
      return clipboard;
    },
    get cnpj() {
      return cnpj;
    },
    get courts() {
      return courts;
    },
    get dataRoot() {
      return dataRoot;
    },
    get datajud() {
      return datajud;
    },
    get diagnostics() {
      return diagnostics;
    },
    get dialog() {
      return dialog;
    },
    get displayName() {
      return displayName;
    },
    get djen() {
      return djen;
    },
    get docIndex() {
      return docIndex;
    },
    get documents() {
      return documents;
    },
    get extractEmails() {
      return extractEmails;
    },
    get finance() {
      return finance;
    },
    get fsp() {
      return fsp;
    },
    get generator() {
      return generator;
    },
    get icon() {
      return icon;
    },
    get imports() {
      return imports;
    },
    get indices() {
      return indices;
    },
    get intakes() {
      return intakes;
    },
    get keepInBackground() {
      return keepInBackground;
    },
    get library() {
      return library;
    },
    get markRendererReady() {
      return markRendererReady;
    },
    get messaging() {
      return messaging;
    },
    get nativeImage() {
      return nativeImage;
    },
    get operations() {
      return operations;
    },
    get path() {
      return path;
    },
    get pdfTools() {
      return pdfTools;
    },
    get quitting() {
      return quitting;
    },
    set quitting(value) {
      quitting = value;
    },
    get register() {
      return register;
    },
    get reminders() {
      return reminders;
    },
    get settings() {
      return settings;
    },
    get shell() {
      return shell;
    },
    get show() {
      return show;
    },
    get state() {
      return state;
    },
    get store() {
      return store;
    },
    get support() {
      return support;
    },
    get terms() {
      return terms;
    },
    get updater() {
      return updater;
    },
    get verifyBackup() {
      return verifyBackup;
    },
    get version() {
      return version;
    },
    get weeklyBackups() {
      return weeklyBackups;
    },
    get win() {
      return win;
    },
    get workflowRunner() {
      return workflowRunner;
    },
  };
  for (const group of ['backups', 'terms', 'documents', 'records', 'public', 'updates', 'messaging', 'extras'])
    require(`./ipc/${group}.cjs`)(ctx);
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1460,
    height: 980,
    minWidth: 1040,
    minHeight: 700,
    title: displayName(),
    icon: icon(),
    backgroundColor: '#f6f7f9',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== 'advocacia://app/index.html' && (!devURL || !url.startsWith(devURL + '/'))) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  // Started with Windows: stay in the tray, ready to run reminders and scheduled messages.
  win.once('ready-to-show', () => {
    if (startHidden && !startedHiddenOnce) {
      startedHiddenOnce = true;
      ensureTray();
      return;
    }
    show();
  });
  win.on('close', event => {
    if (!quitting && !app.quitForUpdate && settings.get().background) {
      event.preventDefault();
      keepInBackground();
    }
  });
  Menu.setApplicationMenu(null);
  if (devURL) await win.loadURL(devURL);
  else await win.loadURL('advocacia://app/index.html');
  ensureTray();
  applyBranding();
}
function updateInProgress() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dataRoot, 'update-lock.json'), 'utf8'));
    if (Date.now() - Date.parse(lock.at) > 20 * 60000) return false;
    process.kill(lock.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
async function boot() {
  // Only the "broken" build of scripts/update-e2e.mjs carries this flag: a version that installs but does
  // not start, to prove the guardian restores the previous one. Released packages never have it.
  if (app.isPackaged && require('../package.json').e2eFailStart === true && !recovering) {
    app.exit(3);
    return;
  }
  const waitPid = Number(getArg('--wait-pid='));
  if (recovering && waitPid > 0) {
    for (let i = 0; i < 120; i++) {
      try {
        process.kill(waitPid, 0);
      } catch {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (deferredLock) {
    isPrimary = app.requestSingleInstanceLock();
    if (!isPrimary) {
      app.quit();
      return;
    }
  }
  if (!isPrimary) return;
  await app.whenReady();
  // Node's fetch ignores the Windows proxy and certificate store; Chromium's network stack honours both.
  global.fetch = (input, init) => net.fetch(input, init);
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  if (!recovering && !guardianLaunch && updateInProgress()) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Atualização em andamento',
      message: 'O sistema está sendo atualizado.',
      detail: 'Ele será aberto automaticamente ao terminar. Aguarde alguns minutos e não desligue o computador.',
      buttons: ['Entendi'],
      noLink: true,
    });
    quitting = true;
    app.exit(0);
    return;
  }
  let vault = await Vault.open(dataRoot, safeStorage);
  if (recovering) {
    if (process.argv.includes('--recovery-confirm')) {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: 'Recuperar Magnum Office',
        message: 'Restaurar os dados e o programa preservados antes da atualização?',
        detail:
          'O estado atual será guardado antes de restaurar. Encerre outras janelas do sistema e aguarde a conclusão.',
        buttons: ['Cancelar', 'Recuperar'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer.response !== 1) {
        app.quit();
        return;
      }
    }
    const restored = await restoreBackup(dataRoot, recovering, vault);
    vault = await Vault.open(dataRoot, safeStorage);
    const failed = getArg('--rollback-version=');
    const cfg = new Settings(dataRoot);
    if (failed) cfg.internal({ blockedVersions: [...new Set([...cfg.get().blockedVersions, failed])] });
    await fsp.rm(path.join(dataRoot, 'pending-update.json'), { force: true });
    await fsp.writeFile(
      path.join(dataRoot, 'recovery-notice.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        restoredVersion: restored.version,
        failedVersion: failed || null,
        reason: getArg('--rollback-reason=') || null,
      }),
    );
    if (restored.runtime && restored.installedExecutable && process.platform === 'win32') {
      const sourceRuntime = path.join(backupPath(dataRoot, recovering), 'runtime');
      const expectedExe = path.join(sourceRuntime, restored.runtime);
      const destination = path.dirname(path.resolve(restored.installedExecutable));
      // Only an authenticated backup created by the installed app may name its old install directory.
      if (
        path.resolve(process.execPath).toLowerCase() === expectedExe.toLowerCase() &&
        destination !== path.parse(destination).root &&
        !destination.toLowerCase().startsWith(path.resolve(dataRoot).toLowerCase()) &&
        path.basename(restored.installedExecutable) === restored.runtime
      ) {
        try {
          const originalFs = require('original-fs').promises;
          await originalFs.cp(sourceRuntime, destination, { recursive: true, force: true });
          // Files that only exist in the failed version must not stay mixed with the restored one.
          const keep = new Set((await walk(sourceRuntime)).map(file => file.toLowerCase()));
          for (const file of await walk(destination))
            if (!keep.has(file.toLowerCase()) && !file.toLowerCase().startsWith('uninstall '))
              await originalFs.rm(path.join(destination, file), { force: true });
        } catch {
          /* The preserved runtime remains runnable if replacing the original install is denied. */
        }
      }
    }
  }
  const frontend = path.join(__dirname, '..', 'dist', 'frontend');
  protocol.handle('advocacia', request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname);
    const file = path.resolve(frontend, '.' + relative);
    if (url.hostname !== 'app' || !file.startsWith(frontend + path.sep))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  const pendingFile = path.join(dataRoot, 'pending-update.json');
  const phaseFile = path.join(dataRoot, 'startup-phase.json');
  // Tells the guardian that a slow migration is progress, not a failed start.
  if (fs.existsSync(pendingFile))
    fs.writeFileSync(phaseFile, JSON.stringify({ phase: 'migrating', version, at: new Date().toISOString() }));
  store = new Store(dataRoot, vault);
  await store.migrate();
  settings = new Settings(dataRoot);
  backups = new Backups(store, settings);
  documents = new Documents(store);
  documents.clean();
  messaging = new Messaging(store, settings, operations);
  let updateConfirmed = !fs.existsSync(pendingFile);
  // No message may leave before the new version is confirmed: a rollback would resend it.
  messaging.canProcess = () => updateConfirmed && settings.get().termsAcceptedVersion === terms.version;
  pdfTools = new PDFTools();
  library = new Library(store);
  generator = new DocumentGenerator({ store, library, settings, documents, courts: courts.courts });
  reminders = new HearingReminders({ store, settings, library, messaging });
  workflowRunner = new WorkflowRunner({ store, settings });
  finance = new Finance({ store });
  // Public consultations use Chromium's network stack (Windows proxy and certificates).
  const publicFetch = (url, options) =>
    net.fetch(url, { ...options, headers: { 'User-Agent': `MagnumOffice/${version}`, ...options?.headers } });
  indices = new Indices({ root: dataRoot, fetch: publicFetch, store });
  datajud = new DataJud({ store, settings, fetch: publicFetch });
  cnpj = new CNPJLookup({ store, fetch: publicFetch });
  cep = new CEPLookup({ store, fetch: publicFetch });
  appLock = new AppLock({ store, settings });
  digest = new Digest({ store, settings, messaging, djen: null });
  djen = new DJEN({ store, settings, fetch: publicFetch });
  intakes = new Intakes({ store });
  docIndex = new DocumentIndex({ store, documents });
  imports = new Imports(store);
  agentAPI = new AgentAPI({
    store,
    settings,
    operations,
    library,
    messaging,
    reminders,
    datajud,
    djen,
    indices,
    generator,
    courts: courts.courts,
  });
  agentAPI.cnpj = cnpj;
  agentAPI.requireTerms = true;
  // While the program is locked the agents' API answers nothing.
  agentAPI.isLocked = () => Boolean(appLock?.locked);
  digest.djen = djen;
  await agentAPI.start();
  birthdays = new (require('../backend/birthdays.cjs').Birthdays)({ store, settings, library, messaging });
  messaging.birthdays = birthdays;
  weeklyBackups = new WeeklyBackups({ store, settings, backups, operations, messaging });
  updater = new Updater({ store, settings, operations, backups, app, onChange: notifyUpdate });
  updater.canOperate = () => settings.get().termsAcceptedVersion === terms.version;
  updater.isUserActive = () => Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
  await updater.restore();
  bindHandlers();
  await createWindow();
  watchChanges();
  schedulePublicChecks();
  // Documents imported before 1.9 are indexed for the search once, in the background.
  setTimeout(
    () =>
      void docIndex
        .indexPending()
        .then(n => n && dataChanged())
        .catch(() => {}),
    10000,
  ).unref();
  let readyTimeout;
  try {
    await Promise.race([
      rendererReady,
      new Promise((_resolve, reject) => {
        readyTimeout = setTimeout(() => reject(new Error('A interface não confirmou a inicialização.')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(readyTimeout);
  }
  store.audit('application.started', { version });
  startLockAndDailyTasks();
  setTimeout(() => void weeklyBackups.tick(), 3000);
  if (fs.existsSync(pendingFile)) {
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    if (require('semver').valid(pending.version) && require('semver').gt(version, pending.version)) {
      await fsp.rm(pendingFile);
      store.audit('update.superseded', { fromVersion: pending.version, version });
    } else if (pending.version === version && store.integrity()) {
      await fsp.writeFile(
        path.join(dataRoot, 'health.json'),
        JSON.stringify({ version, backupId: pending.backupId, pid: process.pid, at: new Date().toISOString() }),
      );
      settings.internal({ lastUpdate: new Date().toISOString() });
      store.audit('update.success', { fromVersion: pending.fromVersion, version });
      if (pending.notes)
        await fsp.writeFile(
          path.join(dataRoot, 'whats-new.json'),
          JSON.stringify({ version, fromVersion: pending.fromVersion, notes: pending.notes }),
          { mode: 0o600 },
        );
      await fsp.rm(pendingFile);
    } else if (
      require('semver').valid(pending.version) &&
      require('semver').gt(pending.version, version) &&
      !updateInProgress()
    ) {
      // The installer never finished (power loss, antivirus, closed by hand). Say so instead of staying silent.
      store.audit('update.failed', {
        fromVersion: pending.fromVersion,
        version: pending.version,
        code: 'NOT_COMPLETED',
      });
      settings.internal({ blockedVersions: [...new Set([...settings.get().blockedVersions, pending.version])] });
      await fsp.writeFile(
        path.join(dataRoot, 'recovery-notice.json'),
        JSON.stringify({
          at: new Date().toISOString(),
          restoredVersion: null,
          failedVersion: pending.version,
          reason: 'interrupted',
        }),
      );
      await fsp.rm(pendingFile);
    }
  }
  await fsp.rm(phaseFile, { force: true }).catch(() => {});
  updateConfirmed = true;
  // A guardian killed by a power cut leaves its lock behind; it would block cleanup forever.
  if (!updateInProgress()) await fsp.rm(path.join(dataRoot, 'update-lock.json'), { force: true }).catch(() => {});
  if (settings.get().termsAcceptedVersion === terms.version) messaging.autoconnect();
  setTimeout(() => {
    void operations
      .run('Limpeza de arquivos de atualização', () =>
        applyRetention({ root: dataRoot, backups, keepUpdate: updater.get().available?.name || null }),
      )
      .catch(() => {});
  }, 60000).unref();
  void updater.startupCheck().catch(() => {});
  notificationTimer = setInterval(() => {
    if (
      settings.get().termsAcceptedVersion !== terms.version ||
      !settings.get().notifications ||
      operations.maintenance
    )
      return;
    const soon = store
      .list('tasks')
      .filter(
        task =>
          task.status !== 'Concluída' &&
          new Date(task.due).getTime() - Date.now() <= settings.get().notificationLeadMinutes * 60000 &&
          new Date(task.due).getTime() > Date.now() - 60000,
      );
    for (const task of soon)
      if (!notified.has(task.id + task.due)) {
        notified.add(task.id + task.due);
        const n = new Notification({
          title: 'Compromisso próximo',
          body: 'Há um prazo ou compromisso próximo. Abra a agenda do escritório.',
          icon: icon(),
        });
        n.on('click', show);
        n.show();
      }
  }, 60000);
}
app.on('window-all-closed', () => {
  if (!quitting && !app.quitForUpdate && settings?.get().background) {
    ensureTray();
    return;
  }
  app.quit();
});
app.on('second-instance', show);
app.on('activate', show);
app.on('before-quit', event => {
  if (
    updater?.get().installOnQuit &&
    updater.get().status === 'downloaded' &&
    !app.quitForUpdate &&
    !operations.active.size
  ) {
    event.preventDefault();
    updater.setInstallOnQuit(false);
    void updater.install().catch(() => {
      quitting = true;
      app.quit();
    });
    return;
  }
  if (operations.active.size && !app.quitForUpdate) {
    event.preventDefault();
    if (win)
      void dialog.showMessageBox(win, { type: 'info', message: 'Aguarde a operação em andamento antes de sair.' });
    return;
  }
  quitting = true;
});
app.on('will-quit', () => {
  clearInterval(notificationTimer);
  weeklyBackups?.stop();
  void agentAPI?.stop();
  updater?.stop();
  messaging?.stop();
  void pdfTools?.stop();
  documents?.clean();
  store?.close();
  tray?.destroy();
});
if (isPrimary)
  boot().catch(async error => {
    await app.whenReady();
    if (testRoot) console.error('TEST_BOOT_FAILED', error.stack);
    else
      dialog.showErrorBox(
        'Não foi possível iniciar Magnum Office',
        error.message +
          '\n\nSe houve uma atualização, a ferramenta de recuperação tentará restaurar a versão anterior. Seus dados locais foram preservados.',
      );
    quitting = true;
    app.exit(1);
  });
