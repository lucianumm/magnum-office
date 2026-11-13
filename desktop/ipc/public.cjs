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
      const { blocks, caseId, title, calculation } = require('../../backend/debt-report.cjs').report(
        input,
        ctx.indices,
      );
      const caseItem = caseId ? ctx.store.get('cases', caseId) : null;
      const pdfBytes = await require('../../backend/document-files.cjs').pdf(blocks, {
        title,
        author: ctx.settings.get().officeName,
      });
      return ctx.documents.save(
        `${title}.pdf`,
        pdfBytes,
        { caseId: caseItem?.id || '', clientId: caseItem?.clientId || '' },
        { calculation },
      );
    }),
  );
  ctx.register('saveLaborReport', input =>
    ctx.operations.run('Memória de cálculo', async () => {
      const { blocks, caseId, title, calculation } = require('../../backend/labor-report.cjs').laborReport(input);
      const caseItem = caseId ? ctx.store.get('cases', caseId) : null;
      // Word (to edit and attach to a petition) or PDF.
      const files = require('../../backend/document-files.cjs');
      const word = input?.format === 'docx';
      const meta = { title, author: ctx.settings.get().officeName };
      const pdfBytes = word ? files.docx(blocks, meta) : await files.pdf(blocks, meta);
      return ctx.documents.save(
        `${title}.${word ? 'docx' : 'pdf'}`,
        pdfBytes,
        { caseId: caseItem?.id || '', clientId: caseItem?.clientId || '' },
        { calculation },
      );
    }),
  );
  ctx.register('saveLiquidationReport', input =>
    ctx.operations.run('Memória de cálculo', async () => {
      const { blocks, caseId, title, calculation } = require('../../backend/liquidation-report.cjs').liquidationReport(
        input,
        ctx.indices,
      );
      const caseItem = caseId ? ctx.store.get('cases', caseId) : null;
      const pdfBytes = await require('../../backend/document-files.cjs').pdf(blocks, {
        title,
        author: ctx.settings.get().officeName,
      });
      return ctx.documents.save(
        `${title}.pdf`,
        pdfBytes,
        { caseId: caseItem?.id || '', clientId: caseItem?.clientId || '' },
        { calculation },
      );
    }),
  );
  ctx.register('caseMovements', caseId => ctx.datajud.movements(caseId));
  ctx.register('lookupCase', number => ctx.datajud.lookup(number));
  ctx.register('lookupCNPJ', value => ctx.cnpj.lookup(value));
  ctx.register('importMovementsAfterLookup', caseId =>
    ctx.operations.run('Consulta ao DataJud', () => ctx.datajud.refresh(caseId, { requested: true })),
  );
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
  ctx.register('searchIntimations', input => ctx.operations.run('Busca no DJEN', () => ctx.djen.search(input || {})));
  ctx.register('keepIntimation', id => ctx.operations.run('Intimação', () => ctx.djen.keep(id)));
  ctx.register('intimationCourts', () => ctx.djen.courts());
  ctx.register('downloadCertificate', id =>
    ctx.operations.run('Certidão do DJEN', async () => {
      const { bytes, name } = await ctx.djen.certificate(id);
      const result = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Salvar certidão',
        defaultPath: name,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await require('node:fs/promises').writeFile(result.filePath, bytes);
      return true;
    }),
  );
  ctx.register('checkAllMovements', () => ctx.operations.run('Consulta ao DataJud', () => ctx.datajud.checkAll()));
};
