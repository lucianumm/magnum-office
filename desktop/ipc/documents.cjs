// IPC handlers: Documentos, modelos, PDF e busca no texto dos documentos.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerDocuments(ctx) {
  ctx.register('previewEmail', input =>
    require('../../backend/email-design.cjs').render(input, ctx.settings.get(), true),
  );
  ctx.register('importEmailImage', async () => {
    const chosen = await ctx.dialog.showOpenDialog(ctx.win, {
      title: 'Imagem para o e-mail',
      properties: ['openFile'],
      filters: [{ name: 'PNG ou JPG', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (chosen.canceled) return false;
    const file = chosen.filePaths[0];
    if ((await ctx.fsp.stat(file)).size > 5 * 1024 ** 2) throw new Error('Escolha uma imagem de até 5 MB.');
    let img = ctx.nativeImage.createFromPath(file);
    if (img.isEmpty()) throw new Error('Imagem inválida.');
    img = img.resize({ width: Math.min(900, img.getSize().width) });
    let buffer = img.toJPEG(75);
    if (buffer.length > 60000) {
      img = img.resize({ width: 600 });
      buffer = img.toJPEG(55);
    }
    if (buffer.length > 60000) throw new Error('Use uma imagem menor ou mais simples.');
    return 'data:image/jpeg;base64,' + buffer.toString('base64');
  });
  ctx.register('pdfTool', input =>
    ctx.operations.run('Processamento local de PDF', async () => {
      if (!['images', 'split', 'merge', 'archive'].includes(input.mode)) throw new Error('Operação inválida.');
      if (ctx.pdfTools.get().status === 'running') throw new Error('Já há um processamento em andamento.');
      const chosen = await ctx.dialog.showOpenDialog(ctx.win, {
        title: input.mode === 'images' ? 'Selecionar imagens para PDF' : 'Selecionar PDF',
        properties: ['split', 'archive'].includes(input.mode) ? ['openFile'] : ['openFile', 'multiSelections'],
        filters: [
          {
            name: input.mode === 'images' ? 'Imagens' : 'PDF',
            extensions: input.mode === 'images' ? ['png', 'jpg', 'jpeg'] : ['pdf'],
          },
        ],
      });
      if (chosen.canceled) return false;
      const confirm = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'question',
        message: 'Processar estes arquivos no computador?',
        detail:
          'Saída PDF/A-2b. As páginas são convertidas em imagens: texto pesquisável, links, formulários e assinaturas digitais não são preservados. CPU e memória do computador serão utilizados e ele pode ficar lento. Guarde os originais. Ordem de processamento:\n' +
          chosen.filePaths.map((f, i) => i + 1 + '. ' + ctx.path.basename(f)).join('\n'),
        buttons: ['Cancelar', 'Continuar'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (confirm.response !== 1) return false;
      let output;
      if (input.mode === 'split') {
        const folder = await ctx.dialog.showOpenDialog(ctx.win, {
          title: 'Escolher pasta de destino',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (folder.canceled) return false;
        output = ctx.path.join(folder.filePaths[0], 'PDF-partes-' + require('node:crypto').randomUUID());
        await ctx.fsp.mkdir(output, { mode: 0o700 });
      } else {
        const file = await ctx.dialog.showSaveDialog(ctx.win, {
          title: 'Salvar novo PDF',
          defaultPath:
            input.mode === 'images'
              ? 'imagens-pdfa.pdf'
              : input.mode === 'archive'
                ? 'documento-pdfa.pdf'
                : 'documentos-reunidos-pdfa.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (file.canceled) return false;
        output = file.filePath;
        if (!output.toLowerCase().endsWith('.pdf')) output += '.pdf';
      }
      const result = await ctx.pdfTools.run({
        mode: input.mode,
        limitMB: input.limitMB,
        pagesPerPart: input.pagesPerPart,
        files: chosen.filePaths,
        output,
      });
      if (result) ctx.store.audit('pdf.processed', { kind: input.mode });
      return result;
    }),
  );
  ctx.register('cancelPDF', () => ctx.pdfTools.cancel());
  ctx.register('openPDFOutput', () => {
    if (!ctx.pdfTools.folder) throw new Error('Nenhuma pasta de destino foi selecionada.');
    return ctx.shell.openPath(ctx.pdfTools.folder);
  });
  ctx.register('extractEmails', input => ctx.extractEmails(input));
  ctx.register('saveTemplateGroup', input =>
    ctx.operations.run('Grupo de modelos', () => ctx.library.saveGroup(input)),
  );
  ctx.register('saveTemplate', input => ctx.operations.run('Modelo', () => ctx.library.save(input)));
  ctx.register('previewDocument', input => ctx.generator.preview(input));
  ctx.register('generateDocument', input =>
    ctx.operations.run('Geração de documento', () => ctx.generator.generate(input)),
  );
  ctx.register('removeTemplate', input =>
    ctx.operations.run('Excluir modelo', async () => {
      const result = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        message: 'Excluir este modelo ou grupo?',
        buttons: ['Cancelar', 'Excluir'],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return false;
      return ctx.library.remove(input.type, input.id);
    }),
  );
  ctx.register('importTemplate', () =>
    ctx.operations.run('Importar modelo', async () => {
      const result = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Importar modelo para edição',
        properties: ['openFile'],
        filters: [{ name: 'Modelos', extensions: ['docx', 'txt', 'html', 'htm'] }],
      });
      return result.canceled ? false : ctx.library.readFile(result.filePaths[0]);
    }),
  );
  ctx.register('searchDocuments', query =>
    typeof query === 'string' && query.length <= 200 ? ctx.docIndex.search(query) : [],
  );
  ctx.register('saveTextReport', input =>
    ctx.operations.run('Relatório', async () => {
      const caseItem = ctx.store.get('cases', require('../../backend/validation.cjs').uuid(input?.caseId));
      const text = require('../../backend/validation.cjs').text(String(input?.text || ''), 20000);
      if (!text.trim()) throw new Error('O relatório está vazio.');
      const blocks = text.split('\n').map(line => ({ align: 'left', heading: false, runs: [{ text: line }] }));
      const now = new Date();
      const title = `Relatório ao cliente ${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
      const bytes = await require('../../backend/document-files.cjs').pdf(blocks, {
        title,
        author: ctx.settings.get().officeName,
      });
      return ctx.documents.save(`${title}.pdf`, bytes, { caseId: caseItem.id, clientId: caseItem.clientId || '' });
    }),
  );
  ctx.register('importDocument', links =>
    ctx.operations.run('Importação de documentos', async () => {
      const chosen = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Importar documentos para o cofre local',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Documentos',
            extensions: ['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      });
      if (chosen.canceled) return [];
      const result = [];
      for (const file of chosen.filePaths) result.push(await ctx.documents.import(file, links || {}));
      return result;
    }),
  );
  ctx.register('openDocument', id =>
    ctx.operations.run('Abertura de documento', async () => {
      const result = await ctx.shell.openPath(await ctx.documents.temporary(id));
      if (result) throw new Error('Nenhum programa conseguiu abrir este documento. Use a opção Exportar.');
    }),
  );
  ctx.register('exportDocument', id =>
    ctx.operations.run('Exportação de documento', async () => {
      const item = ctx.store.get('documents', id);
      const chosen = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Exportar documento sem criptografia',
        defaultPath: item.name,
      });
      if (chosen.canceled) return false;
      await ctx.fsp.writeFile(chosen.filePath, ctx.documents.read(id), { mode: 0o600 });
      ctx.store.audit('document.exported', { id });
      return true;
    }),
  );
};
