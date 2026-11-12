// IPC handlers: Atualizações.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerUpdates(ctx) {
  ctx.register('installUpdateOnQuit', value => ctx.updater.setInstallOnQuit(value));
  ctx.register('checkUpdate', () => ctx.updater.check());
  // The last attempt recorded by the update guardian, for the screen and for support.
  ctx.register('updateAttempt', () => require('../../backend/update-history.cjs').lastAttempt(ctx.dataRoot));
  ctx.register('copyUpdateDiagnostic', async () => {
    const { lastAttempt, attemptText } = require('../../backend/update-history.cjs');
    ctx.clipboard.writeText(attemptText(await lastAttempt(ctx.dataRoot), ctx.version));
    return true;
  });
  ctx.register('forceUpdate', async () => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'question',
      title: 'Atualização manual',
      message: 'Buscar e baixar a versão mais recente agora?',
      detail:
        'Funciona com a atualização automática desativada e permite tentar novamente uma versão bloqueada após falha. A assinatura e a integridade continuam obrigatórias. Você confirma a instalação depois do download.',
      buttons: ['Cancelar', 'Buscar e baixar'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (response.response !== 1) return ctx.updater.get();
    const result = await ctx.updater.check({ retryBlocked: true, reuse: false });
    return result.status === 'available' ? ctx.updater.download() : result;
  });
  ctx.register('downloadUpdate', async () => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'question',
      title: 'Baixar atualização',
      message: `Baixar a versão ${ctx.updater.get().available?.version || ''}?`,
      detail: 'O download será validado antes da instalação. Seus dados serão copiados antes de atualizar.',
      buttons: ['Cancelar', 'Baixar atualização'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (response.response === 1) return ctx.updater.download();
    return ctx.updater.get();
  });
  ctx.register('installUpdate', async () => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      title: 'Instalar atualização',
      message: 'Criar backup, instalar e reiniciar o sistema?',
      detail:
        'As filas ficarão pausadas durante a manutenção. Operações em andamento precisam terminar antes da atualização.',
      buttons: ['Cancelar', 'Instalar e reiniciar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response.response === 1) return ctx.updater.install();
    return ctx.updater.get();
  });
  ctx.register('installUpdateManually', async () => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      title: 'Instalar manualmente',
      message: 'Fechar o sistema e abrir o instalador da nova versão?',
      detail:
        'Use quando a instalação automática não concluir. Uma cópia dos seus dados é feita antes. No instalador, mantenha a mesma pasta e, se o Windows pedir, permita a instalação. Ao terminar, abra o Magnum Office pelo atalho.',
      buttons: ['Cancelar', 'Fechar e instalar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response.response === 1) return ctx.updater.installManually();
    return ctx.updater.get();
  });
};
