const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const semver = require('semver');
const { assetURL, githubRepository, validateAsset, verifyManifest } = require('./trust.cjs');
const { digest } = require('../backend/backups.cjs');
const version = require('../app/version.cjs');
const build = require('../app/build-config.json');
const execFileAsync = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DAY = 86400000;
const STALL_LIMIT = 60000;
const DOWNLOAD_ATTEMPTS = 4;
const MAX_BACKOFF = 6 * 3600000;
const NETWORK_MESSAGE = 'Não foi possível conectar ao GitHub. Verifique a internet, o proxy ou o antivírus e tente novamente.';

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
function friendly(error) {
  if (error instanceof HttpError) return error;
  const text = `${error?.name || ''} ${error?.message || ''} ${error?.cause?.code || ''}`;
  if (/fetch failed|AbortError|TimeoutError|aborted|net::|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|CERT|SSL|socket/i.test(text)) {
    const wrapped = new Error(NETWORK_MESSAGE);
    wrapped.detail = text.trim().slice(0, 160);
    return wrapped;
  }
  return error;
}
async function fetchBytes(url, max) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': `AdvocaciaGestao/${version}`, Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    const limited = response.status === 403 || response.status === 429;
    throw new HttpError(response.status === 404 ? 'Repositório ou arquivo de versão não encontrado. Use um repositório público com Releases.' : limited ? 'O GitHub limitou as consultas deste computador ou rede. O sistema tentará novamente mais tarde.' : `O GitHub não respondeu à consulta (${response.status}). Tente novamente depois.`, response.status);
  }
  const parts = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('Resposta maior que o limite permitido.'); parts.push(chunk); }
  return Buffer.concat(parts);
}
// Antivirus software commonly locks a freshly written executable for a few seconds.
async function withFileRetry(task, attempts = 6) {
  for (let attempt = 0; ; attempt++) {
    try { return await task(); }
    catch (error) {
      if (attempt + 1 >= attempts || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error;
      await delay(500 * 2 ** attempt);
    }
  }
}
const manifestChannelOf = value => { const pre = semver.prerelease(value); return !pre ? 'stable' : pre[0] === 'beta' ? 'beta' : pre[0] === 'dev' ? 'development' : null; };
// Beta and development users also receive newer stable versions; stable users only receive stable ones.
function acceptedByChannel(release, value, channel) {
  const kind = manifestChannelOf(value);
  if (kind === 'stable') return !release.prerelease;
  if (channel === 'stable') return false;
  return channel === 'development' ? kind !== null : kind === 'beta';
}

class Updater {
  constructor({ store, settings, operations, backups, app, onChange = () => {} }) {
    Object.assign(this, { store, settings, operations, backups, app, onChange });
    this.state = { status: 'idle', currentVersion: version, available: null, progress: 0, error: null, trusted: build.trustedUpdateKeys.length > 0, publisherConfigured: Boolean(build.publisherName), installOnQuit: false };
    this.selection = null; this.busy = false; this.failures = 0; this.nextAttempt = 0;
    this.timer = setInterval(() => { void this.scheduled(); }, 60000); this.timer.unref();
  }
  get() { return { ...this.state }; }
  update(data) { Object.assign(this.state, data); this.onChange(this.get()); }
  get stateFile() { return path.join(this.store.root, 'update-state.json'); }
  targetFile(selected) { return path.join(this.store.root, 'updates', selected.file.name); }
  availableInfo(selected) { return { version: selected.manifest.version, publishedAt: selected.manifest.publishedAt, notes: selected.manifest.notes, mandatory: selected.manifest.mandatory, reason: selected.manifest.reason, bytes: selected.file.bytes, name: selected.file.name, sha256: selected.file.sha256 }; }
  async isTargetValid(selected) {
    try {
      const file = this.targetFile(selected);
      return (await fsp.stat(file)).size === selected.file.bytes && await digest(file) === selected.file.sha256;
    } catch { return false; }
  }
  async persistSelection() {
    if (!this.selection) { await fsp.rm(this.stateFile, { force: true }); return; }
    const { bytes, signature, repository, channel, manifestChannel, asset } = this.selection;
    await fsp.writeFile(this.stateFile, JSON.stringify({ bytes: bytes.toString('base64'), signature, repository, channel, manifestChannel, asset: { name: asset.name, size: asset.size, browser_download_url: asset.browser_download_url } }), { mode: 0o600 });
  }
  // Restores a verified download after a restart, so 134 MB are not downloaded again.
  async restore() {
    try {
      const saved = JSON.parse(await fsp.readFile(this.stateFile, 'utf8'));
      const config = this.settings.get();
      if (saved.repository !== config.repository || saved.channel !== config.channel) throw new Error('stale');
      const bytes = Buffer.from(saved.bytes, 'base64');
      const parsed = JSON.parse(bytes.toString('utf8'));
      const selected = verifyManifest(bytes, saved.signature, build.trustedUpdateKeys, { repository: saved.repository, tag: parsed.tag, channel: saved.manifestChannel, currentVersion: version, platform: process.platform, arch: process.arch, assets: [saved.asset] });
      const selection = { ...selected, repository: saved.repository, channel: saved.channel, manifestChannel: saved.manifestChannel, bytes, signature: saved.signature };
      if (this.state.status !== 'idle' || !await this.isTargetValid(selection)) throw new Error('stale');
      this.selection = selection;
      this.update({ status: 'downloaded', progress: 100, available: this.availableInfo(selection) });
    } catch { await fsp.rm(this.stateFile, { force: true }).catch(() => {}); }
  }
  async selectRelease(release, repository, channel) {
    const value = release.tag_name.replace(/^v/, '');
    const manifestChannel = manifestChannelOf(value);
    const name = `release-${manifestChannel}.json`;
    const metadata = validateAsset(release.assets.find(a => a.name === name), repository, release.tag_name);
    const signature = validateAsset(release.assets.find(a => a.name === name + '.sig'), repository, release.tag_name);
    const [bytes, sig] = await Promise.all([fetchBytes(metadata.browser_download_url, 1024 ** 2), fetchBytes(signature.browser_download_url, 4096)]);
    const selected = verifyManifest(bytes, sig.toString('ascii'), build.trustedUpdateKeys, { repository, tag: release.tag_name, channel: manifestChannel, currentVersion: version, platform: process.platform, arch: process.arch, assets: release.assets });
    return { ...selected, repository, channel, manifestChannel, bytes, signature: sig.toString('ascii') };
  }
  // The GitHub API allows 60 queries per hour per IP address. The static release URL has no such limit.
  async selectFromStaticURL(repository, channel, retryBlocked) {
    const base = `https://github.com/${repository}/releases/latest/download/release-stable.json`;
    const [bytes, sig] = await Promise.all([fetchBytes(base, 1024 ** 2), fetchBytes(base + '.sig', 4096)]);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!semver.valid(parsed.version) || !semver.gt(parsed.version, version) || (!retryBlocked && this.settings.get().blockedVersions.includes(parsed.version))) return null;
    const file = (parsed.files || []).find(f => f.platform === process.platform && f.arch === process.arch);
    const assets = file ? [{ name: file.name, size: file.bytes, browser_download_url: assetURL(repository, parsed.tag, file.name) }] : [];
    const selected = verifyManifest(bytes, sig.toString('ascii'), build.trustedUpdateKeys, { repository, tag: parsed.tag, channel: 'stable', currentVersion: version, platform: process.platform, arch: process.arch, assets });
    return { ...selected, repository, channel, manifestChannel: 'stable', bytes, signature: sig.toString('ascii') };
  }
  async findBest(repository, config, retryBlocked) {
    let releases;
    try {
      releases = JSON.parse((await fetchBytes(`https://api.github.com/repos/${repository}/releases?per_page=100`, 5 * 1024 ** 2)).toString('utf8'));
    } catch (error) {
      if (error.status === 403 || error.status === 429 || error.status >= 500) {
        if (config.channel === 'stable') return this.selectFromStaticURL(repository, config.channel, retryBlocked);
      }
      throw error;
    }
    if (!Array.isArray(releases)) throw new Error('Resposta de versões inválida.');
    const candidates = releases.filter(r => {
      const v = r.tag_name?.replace(/^v/, '');
      if (r.draft || !semver.valid(v) || !semver.gt(v, version) || (!retryBlocked && config.blockedVersions.includes(v))) return false;
      return acceptedByChannel(r, v, config.channel);
    }).sort((a, b) => semver.rcompare(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, '')));
    // One defective release must not stop every installation from receiving an older valid one.
    let firstError = null;
    for (const release of candidates) {
      try { return await this.selectRelease(release, repository, config.channel); }
      catch (error) { firstError ||= error; }
    }
    if (firstError) throw firstError;
    return null;
  }
  // A person clicking "Verificar" during the automatic check simply joins it.
  check(options = {}) {
    if (this.busy && this.state.status === 'checking' && this.running) return this.running;
    this.running = this.runCheck(options).finally(() => { this.running = null; });
    return this.running;
  }
  async runCheck({ retryBlocked = false, reuse = true } = {}) {
    if (this.busy) throw new Error('O atualizador já está em execução.');
    this.busy = true;
    const previous = { selection: this.selection, status: this.state.status, available: this.state.available };
    this.selection = null;
    this.update({ status: 'checking', error: null, available: null, progress: 0 });
    try {
      const config = this.settings.get();
      const repository = githubRepository(config.repository);
      const selected = await this.findBest(repository, config, retryBlocked);
      this.settings.internal({ lastCheck: new Date().toISOString() });
      this.failures = 0; this.nextAttempt = 0;
      if (!selected) { await this.persistSelection(); this.update({ status: 'current', installOnQuit: false }); return this.get(); }
      this.selection = { ...selected, reuse };
      if (reuse && await this.isTargetValid(this.selection)) {
        await this.persistSelection();
        this.update({ status: 'downloaded', progress: 100, available: this.availableInfo(this.selection) });
        return this.get();
      }
      this.update({ status: 'available', installOnQuit: false, available: this.availableInfo(this.selection) });
      this.store.audit('update.available', { version: selected.manifest.version, channel: config.channel });
      return this.get();
    } catch (cause) {
      const error = friendly(cause);
      this.failures++;
      this.nextAttempt = Date.now() + Math.min(5 * 60000 * 2 ** (this.failures - 1), MAX_BACKOFF);
      // A failed check must not discard an installer that is already verified.
      if (previous.status === 'downloaded' && previous.selection) { this.selection = previous.selection; this.update({ status: 'downloaded', progress: 100, available: previous.available, error: error.message }); }
      else this.update({ status: 'error', error: error.message });
      this.store.audit('update.check.failed', { code: 'CHECK_FAILED', detail: error.detail || String(error.status || '') });
      throw error;
    } finally { this.busy = false; }
  }
  assertSelection() {
    const cfg = this.settings.get();
    if (!this.selection || cfg.repository !== this.selection.repository || cfg.channel !== this.selection.channel) throw new Error('Verifique as atualizações novamente após alterar o repositório ou canal.');
    return this.selection;
  }
  async diskRequired(bytes) {
    const info = await fsp.statfs(this.store.root);
    if (Number(info.bavail) * Number(info.bsize) < bytes) throw new Error('Espaço em disco insuficiente para atualização e cópia de segurança.');
    await fsp.access(this.store.root, fs.constants.W_OK);
  }
  async fetchInstaller(selected, partial) {
    const total = selected.file.bytes;
    let existing = await fsp.stat(partial).then(s => s.size, () => 0);
    if (existing > total) { await fsp.rm(partial, { force: true }); existing = 0; }
    if (existing === total) return;
    const controller = new AbortController();
    let stall = setTimeout(() => controller.abort(), STALL_LIMIT);
    const alive = () => { clearTimeout(stall); stall = setTimeout(() => controller.abort(), STALL_LIMIT); };
    try {
      const headers = { 'User-Agent': `AdvocaciaGestao/${version}`, ...(existing ? { Range: `bytes=${existing}-` } : {}) };
      const response = await fetch(selected.asset.browser_download_url, { signal: controller.signal, headers });
      if (response.status === 416) { await fsp.rm(partial, { force: true }); throw new Error('Reiniciando o download.'); }
      if (!response.ok) { const failure = new Error('Falha ao baixar o instalador.'); failure.fatal = response.status < 500 && response.status !== 429; throw failure; }
      const resuming = response.status === 206 && existing > 0 && (response.headers.get('content-range') || '').startsWith(`bytes ${existing}-`);
      const handle = await fsp.open(partial, resuming ? 'a' : 'w', 0o600);
      let count = resuming ? existing : 0; let last = -1;
      try {
        for await (const chunk of response.body) {
          alive();
          count += chunk.length;
          if (count > total) { const failure = new Error('O download excedeu o tamanho assinado.'); failure.fatal = true; failure.discard = true; throw failure; }
          await handle.writeFile(chunk);
          const percent = Math.round(count / total * 100);
          if (percent !== last) { this.update({ progress: percent }); last = percent; }
        }
      } finally { await handle.close(); }
      if (count !== total) throw new Error('O download foi interrompido.');
    } finally { clearTimeout(stall); }
  }
  async download() {
    if (this.busy) throw new Error('O atualizador já está em execução.');
    const selected = this.assertSelection();
    this.busy = true;
    this.update({ status: 'downloading', progress: 0, error: null });
    const target = this.targetFile(selected);
    const partial = `${target}.${selected.file.sha256.slice(0, 12)}.partial`;
    try {
      if (selected.reuse !== false && await this.isTargetValid(selected)) {
        await this.persistSelection();
        this.update({ status: 'downloaded', progress: 100 });
        return this.get();
      }
      if (selected.reuse === false) await fsp.rm(partial, { force: true });
      await this.diskRequired(selected.file.bytes * 3 + 512 * 1024 ** 2);
      for (let attempt = 1; ; attempt++) {
        try { await this.fetchInstaller(selected, partial); break; }
        catch (error) {
          if (error.discard) await fsp.rm(partial, { force: true });
          if (error.fatal || attempt >= DOWNLOAD_ATTEMPTS) throw error;
          await delay(1500 * 2 ** (attempt - 1));
        }
      }
      const size = (await fsp.stat(partial)).size;
      if (size !== selected.file.bytes || await digest(partial) !== selected.file.sha256) {
        await withFileRetry(() => fsp.rm(partial, { force: true }));
        throw new Error('Integridade do instalador inválida. O arquivo foi rejeitado.');
      }
      await this.verifyNative(partial);
      await withFileRetry(() => fsp.rename(partial, target));
      await this.persistSelection();
      this.store.audit('update.downloaded', { version: selected.manifest.version, sha256: selected.file.sha256, url: selected.asset.browser_download_url, actor: 'local-admin', bytes: size });
      this.update({ status: 'downloaded', progress: 100 });
      return this.get();
    } catch (cause) {
      const error = friendly(cause);
      this.update({ status: 'error', error: error.message });
      this.store.audit('update.download.failed', { code: 'DOWNLOAD_FAILED', detail: error.detail || '' });
      throw error;
    } finally { this.busy = false; }
  }
  async verifyNative(file) {
    if (process.platform === 'win32') {
      if (!build.publisherName) {
        if (build.windowsVerification !== 'signed-manifest' || !build.trustedUpdateKeys.length || !this.selection) throw new Error('A assinatura de publicação ainda não foi configurada. A instalação automática foi bloqueada.');
        const selected = this.assertSelection();
        verifyManifest(selected.bytes, selected.signature, build.trustedUpdateKeys, { repository: selected.repository, tag: selected.manifest.tag, channel: selected.manifestChannel, currentVersion: version, platform: process.platform, arch: process.arch, assets: [selected.asset] });
        return;
      }
      const script = this.app.isPackaged ? path.join(process.resourcesPath, 'verify-signature.ps1') : path.join(__dirname, 'verify-signature.ps1');
      try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, file, build.publisherName], { windowsHide: true, timeout: 30000 }); }
      catch { throw new Error('O instalador não possui uma assinatura válida do editor autorizado.'); }
    }
    // Linux is authenticated by the pinned Ed25519 manifest; macOS installation is confirmed in the OS UI.
  }
  async install() {
    if (this.busy || this.state.status !== 'downloaded') throw new Error('Baixe e valide a atualização antes de instalar.');
    if (!this.app.isPackaged) throw new Error('A atualização só pode ser instalada na versão empacotada.');
    const selected = this.assertSelection();
    this.busy = true;
    const pendingFile = path.join(this.store.root, 'pending-update.json');
    try {
      return await this.operations.exclusive(async () => {
        this.update({ status: 'preparing', error: null });
        const file = this.targetFile(selected);
        if (await digest(file) !== selected.file.sha256) throw new Error('O instalador foi alterado após o download.');
        await this.verifyNative(file);
        const { walk } = require('../backend/backups.cjs');
        const runtimeDir = process.platform === 'win32' ? path.dirname(process.execPath) : null;
        const runtimeFiles = runtimeDir ? await walk(runtimeDir) : [];
        const dataFiles = await walk(path.join(this.store.root, 'documents'));
        let required = selected.file.bytes + 512 * 1024 ** 2;
        for (const f of runtimeFiles) required += (await fsp.stat(path.join(runtimeDir, f))).size;
        for (const f of dataFiles) required += (await fsp.stat(path.join(this.store.root, 'documents', f))).size;
        required += (await fsp.stat(path.join(this.store.root, 'database.sqlite'))).size;
        await this.diskRequired(required);
        if (process.platform === 'win32') await fsp.access(path.dirname(process.execPath), fs.constants.W_OK);
        const snapshot = await this.backups.create('pre-update', runtimeDir, selected.manifest.version);
        const pending = { fromVersion: version, version: selected.manifest.version, backupId: snapshot.id, installedAt: new Date().toISOString(), previousExe: process.execPath, attempts: 0, notes: selected.manifest.notes };
        await fsp.writeFile(pendingFile, JSON.stringify(pending, null, 2), { mode: 0o600 });
        this.store.audit('update.installing', { fromVersion: version, version: pending.version, actor: 'local-admin', id: snapshot.id, sha256: selected.file.sha256, url: selected.asset.browser_download_url });
        if (process.platform === 'win32') {
          const { startGuardian } = require('./recovery.cjs');
          await startGuardian(this.store.root, pending, file);
          this.app.quitForUpdate = true;
          this.app.quit();
        } else if (process.platform === 'linux' && process.env.APPIMAGE) {
          await fsp.chmod(file, 0o755);
          // Preserve the old AppImage. The new image is launched alongside, so returning to the old image is always possible.
          await fsp.copyFile(process.env.APPIMAGE, path.join(this.store.root, 'backups', snapshot.id, 'previous.AppImage'));
          const child = spawn(file, [], { detached: true, stdio: 'ignore', env: { ...process.env, APPIMAGE: undefined } }); child.unref();
          this.app.quitForUpdate = true; this.app.quit();
        } else {
          const { shell } = require('electron');
          const error = await shell.openPath(file);
          if (error) throw new Error('Não foi possível abrir o instalador.');
          this.update({ status: 'manual-install', error: 'Conclua a instalação pelo sistema operacional. O backup já foi criado.' });
        }
        return this.get();
      });
    } catch (cause) {
      const error = friendly(cause);
      await fsp.rm(pendingFile, { force: true }).catch(() => {});
      // The verified installer remains valid, so a retry does not need another download.
      const stillValid = await this.isTargetValid(selected);
      this.update({ status: stillValid ? 'downloaded' : 'error', error: error.message });
      this.store.audit('update.install.failed', { code: 'INSTALL_FAILED', detail: String(error.message).slice(0, 160) });
      throw error;
    } finally { this.busy = false; }
  }
  // Fallback when the automatic installation fails on this computer: the same verified installer
  // runs with its screens, so the person sees the Windows permission and the folder. There is no
  // guardian here; the data copy made first is the way back.
  async installManually() {
    if (this.busy || this.state.status !== 'downloaded') throw new Error('Baixe e valide a atualização antes de instalar.');
    if (process.platform !== 'win32' || !this.app.isPackaged) throw new Error('A instalação manual pelo programa está disponível só no Windows, na versão instalada.');
    const selected = this.assertSelection();
    this.busy = true;
    try {
      return await this.operations.exclusive(async () => {
        const file = this.targetFile(selected);
        if (await digest(file) !== selected.file.sha256) throw new Error('O instalador foi alterado após o download.');
        await this.verifyNative(file);
        const snapshot = await this.backups.create('pre-update', null, selected.manifest.version);
        this.store.audit('update.manual', { fromVersion: version, version: selected.manifest.version, id: snapshot.id, sha256: selected.file.sha256 });
        const child = spawn(file, [], { detached: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
        this.app.quitForUpdate = true;
        this.app.quit();
        return this.get();
      });
    } catch (cause) {
      const error = friendly(cause);
      this.update({ error: error.message });
      throw error;
    } finally { this.busy = false; }
  }
  isCheckDue(cfg, now = Date.now()) {
    if (!cfg.lastCheck) return true;
    return now - Date.parse(cfg.lastCheck) >= (cfg.checkFrequency === 'weekly' ? 7 * DAY : DAY);
  }
  isOutsideBusinessHours(cfg, now = new Date()) {
    const day = now.getDay(); const hour = now.getHours();
    return day === 0 || day === 6 || hour < cfg.businessStart || hour >= cfg.businessEnd;
  }
  // Called once at startup. "Ao iniciar" always checks; daily and weekly respect their interval.
  async startupCheck() {
    const cfg = this.settings.get();
    if (this.canOperate && !this.canOperate()) return;
    if (!cfg.automatic || !cfg.repository) return;
    if (cfg.checkFrequency === 'startup' || this.isCheckDue(cfg)) await this.check();
    if (cfg.autoDownload && this.state.status === 'available') await this.download();
  }
  async scheduled() {
    if (this.canOperate && !this.canOperate()) return;
    const cfg = this.settings.get();
    if (!cfg.automatic || !cfg.repository || this.busy || this.operations.maintenance) return;
    try {
      if (this.state.status !== 'downloading' && Date.now() >= this.nextAttempt && this.isCheckDue(cfg)) await this.check();
      if (cfg.autoDownload && this.state.status === 'available' && Date.now() >= this.nextAttempt) await this.download();
      const away = !this.isUserActive || !this.isUserActive();
      if (cfg.installOutsideHours && this.state.status === 'downloaded' && away && this.isOutsideBusinessHours(cfg) && !this.operations.active.size && process.platform === 'win32') await this.install();
    } catch { /* Failures remain visible in the updater state and audit log. */ }
  }
  setInstallOnQuit(value) {
    if (value && this.state.status !== 'downloaded') throw new Error('Baixe e valide a atualização antes de agendar a instalação.');
    this.update({ installOnQuit: Boolean(value) });
    return this.get();
  }
  stop() { clearInterval(this.timer); }
}
module.exports = { Updater, fetchBytes, friendly, manifestChannelOf, acceptedByChannel };
