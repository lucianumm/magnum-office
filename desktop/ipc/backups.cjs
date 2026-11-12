// IPC handlers: Backups, restauração e exportação dos dados.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerBackups(ctx) {
  ctx.register('configureBackups', input =>
    ctx.operations.run('Configurar backups', () => {
      const result = ctx.weeklyBackups.configure(input);
      setTimeout(() => void ctx.weeklyBackups.tick(), 150);
      return result;
    }),
  );
  ctx.register('backupNoticeSeen', () => ctx.weeklyBackups.noticeSeen());
  ctx.register('retryBackupEmail', input => {
    if (input?.reviewed !== true) throw new Error('Confira o resultado no Resend antes de tentar novamente.');
    ctx.weeklyBackups.retry();
    void ctx.weeklyBackups.tick();
    return true;
  });
  ctx.register('exportPortableBackup', input =>
    ctx.operations.exclusive(async () => {
      const pass = input?.password || ctx.store.secret('backup-password');
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Salvar cópia portátil protegida por senha',
        defaultPath: 'Magnum-Office-' + new Date().toISOString().slice(0, 10) + '.magnumbackup',
        filters: [{ name: 'Backup protegido', extensions: ['magnumbackup'] }],
      });
      if (result.canceled) return false;
      const bytes = await ctx.weeklyBackups.portable.create(pass);
      await ctx.fsp.writeFile(result.filePath, bytes, { mode: 0o600 });
      ctx.store.audit('backup.portable.exported');
      return true;
    }),
  );
  ctx.register('restorePortableBackup', input =>
    ctx.operations.exclusive(async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Selecionar backup portátil protegido por senha',
        properties: ['openFile'],
        filters: [{ name: 'Backup protegido', extensions: ['magnumbackup'] }],
      });
      if (result.canceled) return false;
      if ((await ctx.fsp.stat(result.filePaths[0])).size > 220 * 1024 ** 2)
        throw new Error('Arquivo de backup excessivo.');
      const response = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        message: 'Restaurar os cadastros e documentos deste backup e reiniciar?',
        detail:
          'Os dados atuais serão preservados em um backup. Conexões precisarão ser reconfiguradas. Disparos não enviados voltarão para revisão e não serão enviados automaticamente.',
        buttons: ['Cancelar', 'Restaurar e reiniciar'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return false;
      const snapshot = await ctx.weeklyBackups.portable.stageRestore(
        await ctx.fsp.readFile(result.filePaths[0]),
        input?.password,
      );
      await ctx.backups.create('pre-portable-restore');
      ctx.app.relaunch({
        args: [
          ...process.argv
            .slice(ctx.app.isPackaged ? 1 : 2)
            .filter(a => !a.startsWith('--recover=') && !a.startsWith('--user-data=')),
          ...(ctx.app.isPackaged ? [] : ['.']),
          `--recover=${snapshot.id}`,
          `--user-data=${ctx.dataRoot}`,
        ],
      });
      ctx.app.quitForUpdate = true;
      ctx.app.quit();
      return true;
    }),
  );
  ctx.register('createBackup', () => ctx.operations.exclusive(() => ctx.backups.create()));
  ctx.register('restoreBackup', async id => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      title: 'Restaurar backup',
      message: 'Restaurar os dados deste backup e reiniciar?',
      detail:
        'Os dados atuais serão preservados em uma cópia de segurança. Alterações posteriores ao backup não aparecerão na base restaurada.',
      buttons: ['Cancelar', 'Restaurar e reiniciar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response.response !== 1) return false;
    await ctx.operations.exclusive(async () => {
      await ctx.verifyBackup(ctx.dataRoot, id, ctx.store.vault);
      await ctx.backups.create('pre-restore');
      ctx.app.relaunch({
        args: [
          ...process.argv
            .slice(ctx.app.isPackaged ? 1 : 2)
            .filter(
              a => !a.startsWith('--recover=') && !a.startsWith('--user-data=') && !a.startsWith('--rollback-version='),
            ),
          ...(ctx.app.isPackaged ? [] : ['.']),
          `--recover=${id}`,
          `--user-data=${ctx.dataRoot}`,
        ],
      });
      ctx.app.quitForUpdate = true;
      ctx.app.quit();
    });
    return true;
  });
  ctx.register('rollback', async id => {
    if (process.platform !== 'win32')
      throw new Error(
        'Use o aplicativo ou instalador anterior e restaure o backup. Consulte a documentação de recuperação.',
      );
    const manifest = await ctx.verifyBackup(ctx.dataRoot, id, ctx.store.vault);
    if (!manifest.runtime) throw new Error('Este backup contém dados, mas não uma versão anterior do programa.');
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      title: 'Voltar à versão anterior',
      message: `Voltar à versão ${manifest.version}?`,
      detail:
        'O programa será reiniciado a partir da cópia preservada. Os dados atuais serão salvos antes da restauração.',
      buttons: ['Cancelar', 'Voltar à versão anterior'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response.response !== 1) return false;
    await ctx.operations.exclusive(async () => {
      await ctx.backups.create('pre-rollback');
      const { spawn } = require('node:child_process');
      const child = spawn(
        ctx.path.join(ctx.backupPath(ctx.dataRoot, id), 'runtime', manifest.runtime),
        [
          `--recover=${id}`,
          `--user-data=${ctx.dataRoot}`,
          `--wait-pid=${process.pid}`,
          `--rollback-version=${ctx.version}`,
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      ctx.app.quitForUpdate = true;
      ctx.app.quit();
    });
    return true;
  });
  ctx.register('openBackups', () => ctx.shell.openPath(ctx.path.join(ctx.dataRoot, 'backups')));
  ctx.register('exportData', () =>
    ctx.operations.run('Exportação de dados', async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Escolher pasta para exportação dos dados legíveis',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return false;
      const dest = ctx.path.join(result.filePaths[0], 'Advocacia-exportacao-' + Date.now());
      await ctx.fsp.mkdir(dest, { mode: 0o700 });
      await ctx.fsp.mkdir(ctx.path.join(dest, 'documentos'));
      const entities = Object.fromEntries(
        ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes'].map(kind => [
          kind,
          ctx.store.list(kind),
        ]),
      );
      await ctx.fsp.writeFile(
        ctx.path.join(dest, 'dados.json'),
        JSON.stringify(
          {
            version: ctx.version,
            exportedAt: new Date().toISOString(),
            ...entities,
            library: { groups: ctx.library.groups(), templates: ctx.library.list() },
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      for (const doc of entities.documents)
        await ctx.fsp.writeFile(ctx.path.join(dest, 'documentos', doc.id + doc.ext), ctx.documents.read(doc.id), {
          mode: 0o600,
        });
      ctx.store.audit('data.exported');
      return true;
    }),
  );
  ctx.register('removeBackup', async id => {
    const response = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      title: 'Excluir backup',
      message: 'Excluir esta cópia de segurança permanentemente?',
      detail: 'Esta ação não pode ser desfeita. Os dados atuais do sistema não são alterados.',
      buttons: ['Cancelar', 'Excluir'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response.response !== 1) return false;
    return ctx.operations.run('Exclusão de backup', async () => {
      await ctx.backups.remove(id);
      ctx.store.audit('backup.removed', { id });
      return true;
    });
  });
};
