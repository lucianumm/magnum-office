// IPC handlers: Consultas públicas (DataJud, DJEN, CNPJ, Banco Central) e cálculos.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerPublic(ctx) {
  ctx.register('updateIndices', input =>
    ctx.operations.run('Índices do Banco Central', () =>
      ctx.indices.update(
        Array.isArray(input?.keys) ? input.keys.filter(k => typeof k === 'string').slice(0, 10) : undefined,
      ),
    ),
  );
  ctx.register('debtSeries', input =>
    ctx.indices.values(Array.isArray(input?.keys) ? input.keys.filter(k => typeof k === 'string').slice(0, 10) : []),
  );
  ctx.register('saveDebtReport', input =>
    ctx.operations.run('Memória de cálculo', async () => {
      const { blocks, caseId, title } = require('../../backend/debt-report.cjs').report(input, ctx.indices);
      const caseItem = caseId ? ctx.store.get('cases', caseId) : null;
      const pdfBytes = await require('../../backend/document-files.cjs').pdf(blocks, {
        title,
        author: ctx.settings.get().officeName,
      });
      return ctx.documents.save(`${title}.pdf`, pdfBytes, {
        caseId: caseItem?.id || '',
        clientId: caseItem?.clientId || '',
      });
    }),
  );
  ctx.register('saveLaborReport', input =>
    ctx.operations.run('Memória de cálculo', async () => {
      const { blocks, caseId, title } = require('../../backend/labor-report.cjs').laborReport(input);
      const caseItem = caseId ? ctx.store.get('cases', caseId) : null;
      const pdfBytes = await require('../../backend/document-files.cjs').pdf(blocks, {
        title,
        author: ctx.settings.get().officeName,
      });
      return ctx.documents.save(`${title}.pdf`, pdfBytes, {
        caseId: caseItem?.id || '',
        clientId: caseItem?.clientId || '',
      });
    }),
  );
  ctx.register('caseMovements', caseId => ctx.datajud.movements(caseId));
  ctx.register('lookupCase', number => ctx.datajud.lookup(number));
  ctx.register('lookupCNPJ', value => ctx.cnpj.lookup(value));
  ctx.register('refreshMovements', caseId =>
    ctx.operations.run('Consulta ao DataJud', () => ctx.datajud.refresh(caseId)),
  );
  ctx.register('addMovement', input =>
    ctx.operations.run('Andamento', () => ctx.datajud.addManual(input?.caseId, input)),
  );
  ctx.register('removeMovement', input =>
    ctx.operations.run('Andamento', () => ctx.datajud.removeManual(input?.caseId, input?.id)),
  );
  ctx.register('seenMovements', caseId => ctx.datajud.markSeen(caseId));
  ctx.register('checkIntimations', () => ctx.operations.run('Consulta ao DJEN', () => ctx.djen.check()));
  ctx.register('setIntimation', input =>
    ctx.operations.run('Intimação', () => ctx.djen.setStatus(input?.id, input?.status)),
  );
  ctx.register('openIntimation', id => {
    const link = ctx.djen.link(id);
    if (new URL(link).protocol !== 'https:' || !new URL(link).hostname.endsWith('.jus.br'))
      throw new Error('Link inválido.');
    return ctx.shell.openExternal(link);
  });
  ctx.register('checkAllMovements', () => ctx.operations.run('Consulta ao DataJud', () => ctx.datajud.checkAll()));
};
