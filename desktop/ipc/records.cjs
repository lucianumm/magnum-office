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
  // legacy: the single reminder of earlier versions, still used for a series (one notice window per date would not fit).
  const saveTask = (entity, { legacy = false } = {}) => {
    // The links to the queued notices belong to the program, never to what the form sends.
    const before = entity.id ? ctx.store.get('tasks', entity.id) : null;
    const kept = {
      noticeOffsets: before?.noticeOffsets || '',
      noticeMessageIds: before?.noticeMessageIds || '',
      confirmationStatus: before?.confirmationStatus || '',
    };
    const stored = ctx.store.save('tasks', { ...entity, ...kept });
    const saved = ctx.eventNotices.afterSave(before, stored);
    // Tasks that already use the old reminder keep it until the office moves them to the new notices.
    const synced =
      legacy || saved.reminderMessageId || !saved.clientReminder
        ? ctx.reminders.sync(saved)
        : { task: saved, status: 'none', reason: '' };
    // Ask for the notices (confirmation + reminders) when the event asks for them and none were set up yet.
    const noticeNeeded =
      !legacy &&
      synced.task.clientReminder === true &&
      !synced.task.noticeMessageIds &&
      (!before || !before.clientReminder || !!before.reminderMessageId);
    return {
      ...synced.task,
      reminderStatus: synced.status,
      reminderProblem: synced.reason || '',
      noticeNeeded,
    };
  };
  ctx.register('save', data =>
    ctx.operations.run('Gravação de cadastro', () => {
      const entity = data.entity || {};
      // A new repeating appointment becomes one appointment per date, linked by seriesId.
      if (data.kind === 'tasks' && !entity.id && entity.repeat) {
        const { seriesDates } = require('../../app/task-series.mjs');
        const dates = seriesDates(entity.due, entity.repeat, entity.repeatUntil);
        const seriesId = require('node:crypto').randomUUID();
        ctx.store.db.exec('BEGIN');
        try {
          const saved = dates.map(due => saveTask({ ...entity, due, seriesId }, { legacy: true }));
          ctx.store.db.exec('COMMIT');
          return { ...saved[0], seriesCount: saved.length };
        } catch (error) {
          ctx.store.db.exec('ROLLBACK');
          throw error;
        }
      }
      // "Este e os próximos": the same changes, keeping each date, on the later appointments of the series.
      if (data.kind === 'tasks' && entity.id && data.applyToSeries) {
        const current = ctx.store.get('tasks', entity.id);
        if (!current.seriesId) throw new Error('Este compromisso não faz parte de uma série.');
        const time = String(entity.due || '').slice(11, 16);
        const later = ctx.store
          .list('tasks')
          .filter(t => t.seriesId === current.seriesId && t.id !== current.id && t.due >= current.due);
        const first = saveTask(entity);
        for (const t of later)
          saveTask({
            ...entity,
            id: t.id,
            due: `${t.due.slice(0, 10)}T${time || t.due.slice(11, 16)}`,
            status: t.status,
          });
        return { ...first, seriesUpdated: later.length };
      }
      if (data.kind === 'tasks') return saveTask(entity);
      const result = ctx.store.save(data.kind, entity);
      if (data.kind === 'clients') ctx.birthdays.tick(true);
      return result;
    }),
  );
  ctx.register('remove', data =>
    ctx.operations.run('Exclusão de registro', async () => {
      const response = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        title: 'Excluir registro',
        message: 'Mover este registro para a lixeira?',
        detail:
          'Ele fica na lixeira por 30 dias e pode ser restaurado em Configurações → Lixeira. Os vínculos são verificados antes.',
        buttons: ['Cancelar', 'Mover para a lixeira'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return false;
      const before = data.kind === 'tasks' ? ctx.store.get('tasks', data.id) : null;
      ctx.store.remove(data.kind, data.id);
      if (before) {
        ctx.reminders.cancel(before);
        ctx.eventNotices.afterRemove(before);
      }
      return true;
    }),
  );
  ctx.register('campaignList', () => ctx.campaigns.list());
  ctx.register('saveCampaign', input => ctx.operations.run('Campanha', () => ctx.campaigns.save(input)));
  ctx.register('setCampaignStatus', ({ id, status }) =>
    ctx.operations.run('Campanha', () => ctx.campaigns.setStatus(id, status)),
  );
  ctx.register('removeCampaign', id => ctx.operations.run('Campanha', () => ctx.campaigns.remove(id)));
  ctx.register('previewCampaign', input => ctx.campaigns.preview(input));
  ctx.register('sampleCampaign', ({ campaign, phone }) =>
    ctx.operations.run('Amostra de campanha', () => ctx.campaigns.sendSample(campaign, phone)),
  );
  ctx.register('campaignCalendar', () => ctx.campaigns.calendar());
  ctx.register('setCampaignOptOut', ({ id, value }) =>
    ctx.operations.run('Campanha', () => ctx.campaigns.optOut(id, value === true)),
  );
  ctx.register('previewEventNotice', id => ctx.eventNotices.preview(id));
  ctx.register('applyEventNotice', ({ id, choice }) =>
    ctx.operations.run('Aviso ao cliente', () => ctx.eventNotices.apply(id, choice)),
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
