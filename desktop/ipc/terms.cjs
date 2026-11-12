// IPC handlers: Termos, configurações, personalização, janela e estado da interface.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerTerms(ctx) {
  ctx.register('declineTerms', () => {
    ctx.quitting = true;
    ctx.app.quit();
    return true;
  });
  ctx.register('acceptTerms', input => {
    if (input?.version !== ctx.terms.version || input?.accepted !== true)
      throw new Error('É necessário aceitar a versão atual dos termos.');
    ctx.settings.internal({ termsAcceptedVersion: ctx.terms.version, termsAcceptedAt: new Date().toISOString() });
    ctx.store.audit('terms.accepted', { version: ctx.terms.version });
    ctx.messaging.autoconnect();
    setTimeout(() => void ctx.weeklyBackups.tick(), 1000);
    return true;
  });
  ctx.register('legalText', id => {
    const files = {
      license: ctx.path.join(ctx.desktopDir, '..', 'LICENSE'),
      privacy: ctx.path.join(ctx.desktopDir, '..', 'docs', 'PRIVACIDADE.md'),
    };
    if (!files[id]) throw new Error('Documento inválido.');
    return ctx.fsp.readFile(files[id], 'utf8');
  });
  ctx.register('testNotification', () => {
    if (!ctx.Notification.isSupported()) throw new Error('Notificações indisponíveis neste computador.');
    const notice = new ctx.Notification({
      title: ctx.displayName(),
      body: 'As notificações do escritório estão ativadas.',
      icon: ctx.icon(),
    });
    notice.on('click', ctx.show);
    notice.show();
    return true;
  });
  ctx.register('ready', () => {
    ctx.markRendererReady();
    return true;
  });
  ctx.register('state', ctx.state);
  ctx.register('diagnostic', () =>
    ctx.operations.run('Exportação de diagnóstico', async () => {
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Exportar diagnóstico técnico',
        defaultPath: `advocacia-diagnostico-${ctx.version}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled) return false;
      await ctx.fsp.writeFile(
        result.filePath,
        JSON.stringify(await ctx.diagnostics(ctx.store, ctx.settings, ctx.messaging, ctx.backups), null, 2),
        { mode: 0o600 },
      );
      return true;
    }),
  );
  ctx.register('openLogs', () => ctx.shell.openPath(ctx.path.join(ctx.dataRoot, 'logs')));
  ctx.register('openLink', link => {
    const repo = ctx.settings.get().repository;
    const urls = {
      developer: ctx.support.whatsappURL,
      services:
        ctx.support.whatsappURL +
        '?text=' +
        encodeURIComponent(
          'Olá, Lucianum Magnum. Gostaria de conversar sobre um sistema, automações ou presença digital para minha empresa.',
        ),
      professionalSetup:
        ctx.support.whatsappURL +
        '?text=' +
        encodeURIComponent(
          'Olá, Lucianum. Gostaria de contratar a configuração profissional do domínio, Resend e Cloudflare para meu sistema.',
        ),
      resendDomains: 'https://resend.com/domains',
      datajudKey: 'https://datajud-wiki.cnj.jus.br/api-publica/acesso',
      cloudflare: 'https://dash.cloudflare.com/',
      resendGuide: 'https://resend.com/docs/dashboard/domains/introduction',
      courtsSource: ctx.courts.source,
      repository: repo ? `https://github.com/${repo}` : null,
      changelog: repo ? `https://github.com/${repo}/releases` : null,
      documentation: repo ? `https://github.com/${repo}/blob/main/docs/INSTALACAO.md` : null,
    };
    if (!urls[link]) throw new Error('Configure o repositório do GitHub nas configurações.');
    return ctx.shell.openExternal(urls[link]);
  });
  ctx.register('saveSettings', data =>
    ctx.operations.run('Configuração', () => {
      const result = ctx.settings.save(data);
      ctx.applyBranding();
      if ('openAtLogin' in data) ctx.applyStartup();
      ctx.store.audit('settings.saved');
      return result;
    }),
  );
  ctx.register('importLogo', () =>
    ctx.operations.run('Importação da logo', async () => {
      const chosen = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Escolher a logo do escritório',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (chosen.canceled) return false;
      const file = chosen.filePaths[0];
      if (!/\.(png|jpe?g|webp)$/i.test(file) || (await ctx.fsp.stat(file)).size > 5 * 1024 ** 2)
        throw new Error('Escolha uma imagem PNG, JPG ou WebP de até 5 MB.');
      let image = ctx.nativeImage.createFromPath(file);
      if (image.isEmpty()) throw new Error('Não foi possível ler a imagem selecionada.');
      const size = image.getSize();
      const width = Math.min(size.width, 200),
        height = Math.round((size.height / size.width) * width);
      image = image.resize(height > 200 ? { height: 200 } : { width });
      if (image.toPNG().length > 90000) image = image.resize({ width: 128 });
      if (image.toPNG().length > 90000) throw new Error('A imagem é muito complexa. Use uma logo menor.');
      ctx.settings.internal({ brandLogo: image.toDataURL() });
      ctx.store.audit('branding.logo.saved');
      return true;
    }),
  );
  ctx.register('completeSetup', data =>
    ctx.operations.run('Configuração inicial', () => {
      const result = ctx.settings.completeSetup(data, { hasLogo: Boolean(ctx.settings.get().brandLogo) });
      ctx.applyBranding();
      ctx.store.audit('setup.completed');
      return result;
    }),
  );
  ctx.register('removeLogo', () =>
    ctx.operations.run('Personalização', () => {
      ctx.settings.internal({ brandLogo: '' });
      ctx.store.audit('branding.logo.removed');
      return true;
    }),
  );
  ctx.register('copyPix', () => {
    ctx.clipboard.writeText(ctx.support.pixPayload);
    return true;
  });
  ctx.register('courtLink', input => {
    const court = ctx.courts.courts.find(c => c.id === input.id);
    if (!court) throw new Error('Tribunal não encontrado.');
    const link =
      input.system === undefined ? court.url : Number.isInteger(input.system) ? court.systems[input.system]?.url : null;
    if (!link || new URL(link).protocol !== 'https:' || !new URL(link).hostname.endsWith('.jus.br'))
      throw new Error('Acesso oficial inválido.');
    return ctx.shell.openExternal(link);
  });
  ctx.register('dismissRecoveryNotice', () =>
    ctx.fsp.rm(ctx.path.join(ctx.dataRoot, 'recovery-notice.json'), { force: true }).then(() => true),
  );
  ctx.register('dismissWhatsNew', () =>
    ctx.fsp.rm(ctx.path.join(ctx.dataRoot, 'whats-new.json'), { force: true }).then(() => true),
  );
  ctx.register('window', action => {
    if (action === 'minimize') ctx.win.minimize();
    if (action === 'maximize') ctx.win.isMaximized() ? ctx.win.unmaximize() : ctx.win.maximize();
    if (action === 'close') {
      if (ctx.settings.get().background) ctx.keepInBackground();
      else ctx.win.close();
    }
  });
};
