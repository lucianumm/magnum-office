const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const semver = require('semver');
const { githubRepository, validateAsset, verifyManifest } = require('./trust.cjs');
const { digest } = require('../backend/backups.cjs');
const version = require('../app/version.cjs');
const build = require('../app/build-config.json');
const execFileAsync = promisify(execFile);

async function fetchBytes(url, max) {
  const response = await fetch(url, { headers: { 'User-Agent': `AdvocaciaGestao/${version}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'Repositório ou arquivo de versão não encontrado. Use um repositório público com Releases.' : `O GitHub não respondeu à consulta (${response.status}). Tente novamente depois.`);
  const parts = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('Resposta maior que o limite permitido.'); parts.push(chunk); }
  return Buffer.concat(parts);
}
class Updater {
  constructor({ store, settings, operations, backups, app, onChange = () => {} }) {
    Object.assign(this, { store, settings, operations, backups, app, onChange });
    this.state = { status: 'idle', currentVersion: version, available: null, progress: 0, error: null, trusted: build.trustedUpdateKeys.length > 0, publisherConfigured: Boolean(build.publisherName) };
    this.selection = null; this.busy = false;
    this.timer = setInterval(() => { void this.scheduled(); }, 60000); this.timer.unref();
  }
  get() { return { ...this.state }; }
  update(data) { Object.assign(this.state, data); this.onChange(this.get()); }
  async check() {
    if (this.busy) throw new Error('O atualizador já está em execução.');
    this.busy = true; this.selection = null;
    this.update({ status: 'checking', error: null, available: null, progress: 0 });
    try {
      const config = this.settings.get();
      const repository = githubRepository(config.repository);
      const releases = JSON.parse((await fetchBytes(`https://api.github.com/repos/${repository}/releases?per_page=100`, 5 * 1024 ** 2)).toString('utf8'));
      if (!Array.isArray(releases)) throw new Error('Resposta de versões inválida.');
      const candidates = releases.filter(r => {
        const v = r.tag_name?.replace(/^v/, '');
        if (r.draft || !semver.valid(v) || !semver.gt(v, version) || config.blockedVersions.includes(v)) return false;
        const pre = semver.prerelease(v);
        if (config.channel === 'stable') return !pre && !r.prerelease;
        if (config.channel === 'beta') return pre?.[0] === 'beta';
        return pre?.[0] === 'dev';
      }).sort((a, b) => semver.rcompare(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, '')));
      this.settings.internal({ lastCheck: new Date().toISOString() });
      if (!candidates.length) { this.update({ status: 'current' }); return this.get(); }
      const release = candidates[0];
      const name = `release-${config.channel}.json`;
      const metadata = validateAsset(release.assets.find(a => a.name === name), repository, release.tag_name);
      const signature = validateAsset(release.assets.find(a => a.name === name + '.sig'), repository, release.tag_name);
      const [bytes, sig] = await Promise.all([fetchBytes(metadata.browser_download_url, 1024 ** 2), fetchBytes(signature.browser_download_url, 4096)]);
      const selected = verifyManifest(bytes, sig.toString('ascii'), build.trustedUpdateKeys, { repository, tag: release.tag_name, channel: config.channel, currentVersion: version, platform: process.platform, arch: process.arch, assets: release.assets });
      this.selection = { ...selected, repository, channel: config.channel, bytes, signature: sig.toString('ascii') };
      this.update({ status: 'available', available: { version: selected.manifest.version, publishedAt: selected.manifest.publishedAt, notes: selected.manifest.notes, mandatory: selected.manifest.mandatory, reason: selected.manifest.reason, bytes: selected.file.bytes, name: selected.file.name, sha256: selected.file.sha256 } });
      this.store.audit('update.available', { version: selected.manifest.version, channel: config.channel });
      return this.get();
    } catch (error) { this.update({ status: 'error', error: error.message }); this.store.audit('update.check.failed', { code: 'CHECK_FAILED' }); throw error; }
    finally { this.busy = false; }
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
  async download() {
    if (this.busy) throw new Error('O atualizador já está em execução.');
    const selected = this.assertSelection();
    this.busy = true;
    this.update({ status: 'downloading', progress: 0, error: null });
    const target = path.join(this.store.root, 'updates', selected.file.name);
    const partial = target + '.partial' + path.extname(target);
    try {
      await this.diskRequired(selected.file.bytes * 3 + 512 * 1024 ** 2);
      const response = await fetch(selected.asset.browser_download_url, { signal: AbortSignal.timeout(20 * 60 * 1000), headers: { 'User-Agent': `AdvocaciaGestao/${version}` } });
      if (!response.ok) throw new Error('Falha ao baixar o instalador.');
      const handle = await fsp.open(partial, 'w', 0o600);
      let count = 0; let last = 0;
      try {
        for await (const chunk of response.body) {
          count += chunk.length;
          if (count > selected.file.bytes) throw new Error('O download excedeu o tamanho assinado.');
          await handle.writeFile(chunk);
          const percent = Math.round(count / selected.file.bytes * 100);
          if (percent !== last) { this.update({ progress: percent }); last = percent; }
        }
      } finally { await handle.close(); }
      if (count !== selected.file.bytes || await digest(partial) !== selected.file.sha256) throw new Error('Integridade do instalador inválida. O arquivo foi rejeitado.');
      await this.verifyNative(partial);
      await fsp.rename(partial, target);
      this.store.audit('update.downloaded', { version: selected.manifest.version, sha256: selected.file.sha256, url: selected.asset.browser_download_url, actor: 'local-admin', bytes: count });
      this.update({ status: 'downloaded', progress: 100 });
      return this.get();
    } catch (error) { await fsp.rm(partial, { force: true }); this.update({ status: 'error', error: error.message }); this.store.audit('update.download.failed', { code: 'DOWNLOAD_FAILED' }); throw error; }
    finally { this.busy = false; }
  }
  async verifyNative(file) {
    if (process.platform === 'win32') {
      if (!build.publisherName) {
        if(build.windowsVerification!=='signed-manifest'||!build.trustedUpdateKeys.length||!this.selection)throw new Error('A assinatura de publicação ainda não foi configurada. A instalação automática foi bloqueada.');
        const selected=this.assertSelection();
        verifyManifest(selected.bytes,selected.signature,build.trustedUpdateKeys,{repository:selected.repository,tag:selected.manifest.tag,channel:selected.channel,currentVersion:version,platform:process.platform,arch:process.arch,assets:[selected.asset]});
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
    try {
      return await this.operations.exclusive(async () => {
        this.update({ status: 'preparing', error: null });
        const file = path.join(this.store.root, 'updates', selected.file.name);
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
        const pending = { fromVersion: version, version: selected.manifest.version, backupId: snapshot.id, installedAt: new Date().toISOString(), previousExe: process.execPath, attempts: 0 };
        await fsp.writeFile(path.join(this.store.root, 'pending-update.json'), JSON.stringify(pending, null, 2), { mode: 0o600 });
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
    } catch (error) { this.update({ status: 'error', error: error.message }); this.store.audit('update.install.failed', { code: 'INSTALL_FAILED' }); throw error; }
    finally { this.busy = false; }
  }
  async scheduled() {
    if(this.canOperate&&!this.canOperate())return;
    const cfg = this.settings.get();
    if (!cfg.automatic || !cfg.repository || this.busy || this.operations.maintenance) return;
    const interval = cfg.checkFrequency === 'weekly' ? 7 * 86400000 : 86400000;
    try {
      if (!cfg.lastCheck || (cfg.checkFrequency !== 'startup' && Date.now() - Date.parse(cfg.lastCheck) > interval)) await this.check();
      if (cfg.autoDownload && this.state.status === 'available') await this.download();
      const hour = new Date().getHours();
      if (cfg.installOutsideHours && this.state.status === 'downloaded' && (hour < cfg.businessStart || hour >= cfg.businessEnd) && !this.operations.active.size && process.platform === 'win32') await this.install();
    } catch { /* Failures remain visible in the updater state and audit log. */ }
  }
  stop() { clearInterval(this.timer); }
}
module.exports = { Updater, fetchBytes };
