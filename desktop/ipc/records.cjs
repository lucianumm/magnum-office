// IPC handlers: Cadastros, importação, financeiro, agenda, fluxos e API de agentes.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerRecords(ctx) {
  ctx.register('chooseImport', () =>
    ctx.operations.run('Ler importação', async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Importar contatos ou agenda',
        properties: ['openFile'],
        filters: [{ name: 'Planilhas e CSV', extensions: ['csv', 'tsv', 'txt', 'xlsx'] }],
      });
      return result.canceled ? false : ctx.imports.read(result.filePaths[0]);
    }),
  );
  ctx.register('previewImport', input => ctx.operations.run('Revisar importação', () => ctx.imports.preview(input)));
  ctx.register('commitImport', input =>
    ctx.operations.exclusive(async () => {
      await ctx.backups.create('pre-import');
      return ctx.imports.commit(input);
    }),
  );
  ctx.register('configureAgent', input =>
    ctx.operations.run('Configurar integração', () => ctx.agentAPI.configure(input)),
  );
  ctx.register('copyAgentToken', () => {
    const token = ctx.agentAPI.token();
    if (!token) throw new Error('Gere o token primeiro.');
    ctx.clipboard.writeText(token);
    return true;
  });
  ctx.register('save', data =>
    ctx.operations.run('Gravação de cadastro', () => {
      let result = ctx.store.save(data.kind, data.entity);
      if (data.kind === 'clients') ctx.birthdays.tick(true);
      if (data.kind === 'tasks') {
        const synced = ctx.reminders.sync(result);
        result = { ...synced.task, reminderStatus: synced.status, reminderProblem: synced.reason || '' };
      }
      return result;
    }),
  );
  ctx.register('remove', data =>
    ctx.operations.run('Exclusão de registro', async () => {
      const response = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        title: 'Excluir registro',
        message: 'Excluir este registro permanentemente?',
        detail: 'Os vínculos existentes serão verificados antes da exclusão.',
        buttons: ['Cancelar', 'Excluir'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return false;
      const before = data.kind === 'tasks' ? ctx.store.get('tasks', data.id) : null;
      ctx.store.remove(data.kind, data.id);
      if (before) ctx.reminders.cancel(before);
      return true;
    }),
  );
  ctx.register('createInstallments', input =>
    ctx.operations.run('Parcelamento', () => ctx.finance.createInstallments(input)),
  );
  ctx.register('exportFinance', () =>
    ctx.operations.run('Exportação financeira', async () => {
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Exportar lançamentos',
        defaultPath: `financeiro-${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: 'Planilha Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      await ctx.fsp.writeFile(result.filePath, await ctx.finance.workbook(today), { mode: 0o600 });
      ctx.store.audit('finance.exported');
      return true;
    }),
  );
  ctx.register('exportCalendar', input =>
    ctx.operations.run('Exportação da agenda', async () => {
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Exportar agenda',
        defaultPath: 'agenda.ics',
        filters: [{ name: 'Calendário', extensions: ['ics'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const { agendaICS } = require('../../app/ics.mjs');
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const tasks = ctx.store.list('tasks').filter(t => t.status !== 'Concluída' && t.due >= since);
      const includeNames = input?.includeNames === true;
      const content = agendaICS(tasks, {
        includeNames,
        clients: new Map(ctx.store.list('clients').map(c => [c.id, c.name])),
        cases: new Map(ctx.store.list('cases').map(c => [c.id, c.title])),
        officeName: ctx.settings.get().officeName,
      });
      await ctx.fsp.writeFile(result.filePath, content, { mode: 0o600 });
      ctx.store.audit('agenda.exported');
      return tasks.length;
    }),
  );
  ctx.register('convertIntake', input =>
    ctx.operations.run('Converter atendimento', () =>
      ctx.intakes.convert(input?.id, { createCase: input?.createCase !== false }),
    ),
  );
  ctx.register('previewWorkflow', input => ctx.workflowRunner.preview(input).tasks);
  ctx.register('applyWorkflow', input => ctx.operations.run('Aplicar fluxo', () => ctx.workflowRunner.apply(input)));
};
