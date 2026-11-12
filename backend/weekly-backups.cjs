const { PortableBackup, password } = require('./portable-backup.cjs');
const terms = require('../app/terms.json');
const { sender } = require('./email-policy.cjs');
const WEEK = 7 * 86400000;
const day = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
class WeeklyBackups {
  constructor({ store, settings, backups, operations, messaging }) {
    Object.assign(this, { store, settings, backups, operations, messaging });
    if (this.settings.get().backupEmailState === 'sending') this.settings.internal({ backupEmailState: 'uncertain' });
    this.running = false;
    this.lastAttempt = 0;
    this.status = { state: 'idle', error: '' };
    this.portable = new PortableBackup(store, settings);
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref();
  }
  get() {
    const cfg = this.settings.get();
    const latest = this.backups.list()[0];
    return {
      ...this.status,
      enabled: cfg.weeklyBackupEnabled !== false,
      mode: cfg.backupMode || 'local',
      recipient: cfg.backupRecipient || '',
      folder: cfg.backupFolder || '',
      lastFolder: cfg.lastFolderBackupAt || null,
      folderError: cfg.folderBackupError || '',
      hasPassword: !!this.store.secret('backup-password'),
      lastLocal: cfg.lastAutoBackupAt || null,
      nextLocal: cfg.lastAutoBackupAt ? new Date(Date.parse(cfg.lastAutoBackupAt) + WEEK).toISOString() : null,
      lastEmail: cfg.lastBackupEmailAt || null,
      emailState: cfg.backupEmailState || 'idle',
      dailyNotice:
        cfg.dailyBackupNotice !== false &&
        cfg.termsAcceptedVersion === terms.version &&
        (!!latest || !!this.status.error) &&
        cfg.lastBackupNoticeDay !== day(Date.now()),
      latest: latest ? { createdAt: latest.createdAt, reason: latest.reason } : null,
    };
  }
  configure(input) {
    if (
      typeof input.enabled !== 'boolean' ||
      typeof input.dailyNotice !== 'boolean' ||
      !['local', 'email', 'folder'].includes(input.mode) ||
      input.acknowledged !== true
    )
      throw new Error('Confirme as opções e o cuidado com os backups.');
    const recipient = String(input.recipient || '').trim();
    if (input.mode === 'email' && input.enabled) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254)
        throw new Error('Informe um único e-mail do responsável.');
      const cfg = this.settings.get();
      sender(cfg.emailFrom, cfg.ownDomain);
      if (!cfg.emailDNSConfirmed || this.messaging.emailReady() !== 'configured')
        throw new Error('Configure o Resend e confirme o domínio antes de ativar o backup por e-mail.');
      if (!input.password && !this.store.secret('backup-password'))
        throw new Error('Defina uma senha para proteger o arquivo de backup.');
    }
    // A synced folder (OneDrive, Google Drive, network): the protected portable copy is written there.
    const folder = String(input.folder || '').trim();
    if (input.mode === 'folder' && input.enabled) {
      const fs = require('node:fs');
      const path = require('node:path');
      if (!folder || !path.isAbsolute(folder) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory())
        throw new Error('Escolha a pasta onde a cópia protegida será gravada.');
      if (path.resolve(folder).toLowerCase().startsWith(path.resolve(this.store.root).toLowerCase()))
        throw new Error('Escolha uma pasta fora dos dados do programa.');
      if (!input.password && !this.store.secret('backup-password'))
        throw new Error('Defina uma senha para proteger o arquivo de backup.');
    }
    if (input.password) this.store.secret('backup-password', password(input.password));
    const cfg = this.settings.get();
    const changed = cfg.backupRecipient !== recipient || cfg.backupMode !== input.mode;
    this.settings.internal({
      weeklyBackupEnabled: input.enabled,
      dailyBackupNotice: input.dailyNotice,
      backupMode: input.mode,
      backupRecipient: recipient,
      backupFolder: input.mode === 'folder' ? folder : this.settings.get().backupFolder || '',
      ...(input.mode === 'folder' ? { lastFolderBackupAt: null, folderBackupError: '' } : {}),
      ...(changed ? { lastBackupEmailAt: null, backupEmailState: 'idle' } : {}),
    });
    this.lastAttempt = 0;
    this.store.audit('backup.schedule.configured');
    return this.get();
  }
  // Weekly protected copy in the chosen folder; the four most recent are kept there.
  async writeFolder(cfg, now) {
    if (!cfg.backupFolder) return;
    if (cfg.lastFolderBackupAt && now - Date.parse(cfg.lastFolderBackupAt) < WEEK) return;
    if (cfg.folderBackupError && cfg.lastFolderAttempt && now - Date.parse(cfg.lastFolderAttempt) < 3600000) return;
    const fs = require('node:fs/promises');
    const path = require('node:path');
    this.settings.internal({ lastFolderAttempt: new Date(now).toISOString() });
    try {
      await this.operations.exclusive(async () => {
        const pass = this.store.secret('backup-password');
        if (!pass) throw new Error('Senha do backup não configurada.');
        const bytes = await this.portable.create(pass);
        const name = `Magnum-Office-backup-${day(now)}.magnumbackup`;
        const temp = path.join(cfg.backupFolder, name + '.parcial');
        await fs.writeFile(temp, bytes, { mode: 0o600 });
        await fs.rename(temp, path.join(cfg.backupFolder, name));
        const old = (await fs.readdir(cfg.backupFolder))
          .filter(f => /^Magnum-Office-backup-\d{4}-\d{2}-\d{2}\.magnumbackup$/.test(f))
          .sort()
          .slice(0, -4);
        for (const f of old) await fs.rm(path.join(cfg.backupFolder, f), { force: true });
      });
      this.settings.internal({ lastFolderBackupAt: new Date(now).toISOString(), folderBackupError: '' });
      this.store.audit('backup.folder.saved');
      this.status = { state: 'saved', error: '' };
    } catch (error) {
      const message = /ENOENT|EACCES|EPERM|EBUSY/.test(error.code || '')
        ? 'Não foi possível gravar na pasta escolhida. Confira se ela existe e se a sincronização está ativa.'
        : error.message;
      this.settings.internal({ folderBackupError: message });
      this.status = { state: 'error', error: message };
    }
  }
  noticeSeen() {
    this.settings.internal({ lastBackupNoticeDay: day(Date.now()) });
    return true;
  }
  async tick(now = Date.now()) {
    const cfg = this.settings.get();
    if (
      this.running ||
      cfg.termsAcceptedVersion !== terms.version ||
      cfg.weeklyBackupEnabled === false ||
      this.operations.maintenance ||
      this.operations.active.size ||
      now - this.lastAttempt < 60000
    )
      return;
    this.lastAttempt = now;
    this.running = true;
    try {
      const due = !cfg.lastAutoBackupAt || now - Date.parse(cfg.lastAutoBackupAt) >= WEEK;
      if (due) {
        this.status = { state: 'creating', error: '' };
        await this.operations.exclusive(async () => {
          const snapshot = await this.backups.create('weekly');
          this.settings.internal({ lastAutoBackupAt: snapshot.createdAt, lastAutoBackupId: snapshot.id });
        });
        this.status = { state: 'saved', error: '' };
      }
      const current = this.settings.get();
      if (current.backupMode === 'folder') {
        await this.writeFolder(current, now);
        return;
      }
      if (
        current.backupMode !== 'email' ||
        current.queuePaused ||
        !current.backupRecipient ||
        this.messaging.emailReady() !== 'configured' ||
        !current.emailDNSConfirmed ||
        (current.lastBackupEmailAt && now - Date.parse(current.lastBackupEmailAt) < WEEK) ||
        ['sending', 'uncertain'].includes(current.backupEmailState)
      )
        return;
      if (
        current.backupEmailState === 'failed' &&
        current.lastBackupEmailAttempt &&
        now - Date.parse(current.lastBackupEmailAttempt) < 3600000
      )
        return;
      await this.operations.exclusive(async () => {
        this.status = { state: 'sending', error: '' };
        const pass = this.store.secret('backup-password');
        if (!pass) throw new Error('Senha do backup não configurada.');
        const bytes = await this.portable.create(pass);
        if (bytes.length > 18 * 1024 ** 2)
          throw new Error(
            'A cópia portátil excede o limite de 18 MB para envio. O backup local continua preservado; exporte e guarde em local seguro.',
          );
        sender(current.emailFrom, current.ownDomain);
        const key = 'backup-' + require('node:crypto').randomUUID();
        this.settings.internal({ backupEmailState: 'sending', lastBackupEmailAttempt: new Date(now).toISOString() });
        let response;
        try {
          response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
            headers: {
              Authorization: 'Bearer ' + this.store.secret('resend-key'),
              'Content-Type': 'application/json',
              'Idempotency-Key': key,
            },
            body: JSON.stringify({
              from: current.emailFrom,
              to: [current.backupRecipient],
              subject: 'Backup semanal protegido — ' + (current.officeName || 'Magnum Office'),
              text: 'Sua cópia de segurança está anexada e protegida por senha. Guarde o arquivo e a senha em lugares seguros e separados. O arquivo não contém chaves de integração ou sessão WhatsApp. Para restaurar, use Backups e recuperação no Magnum Office. Não responda com a senha.',
              attachments: [
                { filename: 'Magnum-Office-backup-' + day(now) + '.magnumbackup', content: bytes.toString('base64') },
              ],
            }),
          });
        } catch {
          this.settings.internal({ backupEmailState: 'uncertain' });
          throw new Error(
            'Não foi possível confirmar o envio do backup. Confira no Resend antes de tentar novamente; a cópia local está preservada.',
          );
        }
        if (!response.ok) {
          this.settings.internal({ backupEmailState: response.status >= 500 ? 'uncertain' : 'failed' });
          throw new Error(
            'O Resend recusou o backup. Confira domínio, limites e destinatário. A cópia local está preservada.',
          );
        }
        this.settings.internal({ lastBackupEmailAt: new Date(now).toISOString(), backupEmailState: 'accepted' });
        this.store.audit('backup.email.accepted');
        this.status = { state: 'email-accepted', error: '' };
      });
    } catch (e) {
      this.status = { state: 'error', error: e.message };
      this.store.audit('backup.schedule.failed', { code: 'BACKUP_FAILED' });
    } finally {
      this.running = false;
    }
  }
  retry() {
    this.settings.internal({ backupEmailState: 'idle', lastBackupEmailAttempt: null, lastBackupEmailAt: null });
    this.lastAttempt = 0;
    return true;
  }
  stop() {
    clearInterval(this.timer);
  }
}
module.exports = { WeeklyBackups, WEEK, day };
