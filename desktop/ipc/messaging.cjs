// IPC handlers: WhatsApp, e-mail e fila de mensagens.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerMessaging(ctx) {
  ctx.register('connectWhatsApp', () => ctx.operations.run('Conexão WhatsApp', () => ctx.messaging.connectWhatsApp()));
  ctx.register('disconnectWhatsApp', () =>
    ctx.operations.run('Desconexão WhatsApp', () => ctx.messaging.disconnectWhatsApp()),
  );
  // WhatsApp settings screen: session housekeeping, sending rules and the inbox.
  ctx.register('waStatus', () => ({
    hygiene: require('../../backend/wa-hygiene.cjs').report(ctx.store),
    rules: ctx.messaging.sendRules(),
    inbox: { enabled: ctx.inbox.enabled(), newCount: ctx.inbox.newCount() },
    lastCleanup: ctx.settings.get().lastWaCleanup,
    lastCleanupRemoved: ctx.settings.get().lastWaCleanupRemoved || 0,
    whatsapp: ctx.messaging.wa.status,
  }));
  ctx.register('cleanWhatsApp', () => ctx.operations.run('Limpeza do WhatsApp', () => ctx.messaging.cleanSessionNow()));
  ctx.register('inboxList', () => ctx.inbox.list());
  ctx.register('setInboxStatus', input => ctx.inbox.setStatus(input?.id, input?.status));
  ctx.register('configureEmail', key =>
    ctx.operations.run('Configuração do e-mail', () => ctx.messaging.configureEmail(key)),
  );
  ctx.register('emailCampaign', input =>
    ctx.operations.run('Cadastro de campanha', () => ctx.messaging.campaign(input)),
  );
  ctx.register('emailAttachments', () =>
    ctx.operations.run('Importação de anexos', async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Anexar arquivos ao e-mail',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Documentos e imagens',
            extensions: [
              'pdf',
              'doc',
              'docx',
              'odt',
              'txt',
              'rtf',
              'xls',
              'xlsx',
              'csv',
              'png',
              'jpg',
              'jpeg',
              'webp',
              'zip',
            ],
          },
        ],
      });
      if (result.canceled) return [];
      if (result.filePaths.length > 10) throw new Error('Selecione até dez arquivos.');
      const items = [];
      let total = 0;
      for (const file of result.filePaths) {
        const stat = await ctx.fsp.stat(file);
        total += stat.size;
        if (
          !stat.isFile() ||
          total > 10 * 1024 * 1024 ||
          !/\.(pdf|docx?|odt|txt|rtf|xlsx?|csv|png|jpe?g|webp|zip)$/i.test(file)
        )
          throw new Error('Selecione documentos de até 10 MB no total.');
        items.push({ file, name: ctx.path.basename(file), size: stat.size });
      }
      const out = [];
      for (const item of items) {
        const id = require('node:crypto').randomUUID();
        ctx.store.secret('email-attachment:' + id, {
          name: item.name,
          size: item.size,
          content: (await ctx.fsp.readFile(item.file)).toString('base64'),
        });
        out.push({ id, name: item.name, size: item.size });
      }
      return out;
    }),
  );
  ctx.register('enqueue', data => ctx.operations.run('Agendamento de mensagem', () => ctx.messaging.enqueue(data)));
  ctx.register('previewRecurrence', data => {
    const dates = require('../../backend/recurrence.cjs').expandSchedule(data.first, data.recurrence);
    if (dates.some(d => Date.parse(d) < Date.now() + 5000 || Date.parse(d) > Date.now() + 5 * 366 * 86400000))
      throw new Error('Todas as datas devem ser futuras, dentro dos próximos cinco anos.');
    return dates;
  });
  ctx.register('enqueueSeries', data =>
    ctx.operations.run('Cadastrar disparos recorrentes', () => ctx.messaging.series(data.message, data.recurrence)),
  );
  ctx.register('cancelMessageSeries', id =>
    ctx.operations.run('Cancelar recorrência', () => ctx.messaging.cancelSeries(id)),
  );
  ctx.register('editMessage', data =>
    ctx.operations.run('Edição de disparo', () => ctx.messaging.edit(data.id, data.message)),
  );
  ctx.register('changeMessage', data =>
    ctx.operations.run('Alteração de mensagem', () => ctx.messaging.change(data.id, data.action)),
  );
};
