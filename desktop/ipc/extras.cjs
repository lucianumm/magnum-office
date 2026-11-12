// IPC handlers: trash, program password, CEP, daily summary, hours, document validity and PDF signing.
// ctx gives the main process objects (see the context in desktop/main.cjs).
module.exports = function registerExtras(ctx) {
  // Trash (records excluded in the last 30 days).
  ctx.register('trashList', () => ctx.store.trashList());
  ctx.register('restoreTrash', id => ctx.operations.run('Restauração da lixeira', () => ctx.store.restore(id)));
  ctx.register('purgeTrash', input =>
    ctx.operations.run('Lixeira', async () => {
      const all = input?.all === true;
      const response = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        title: all ? 'Esvaziar lixeira' : 'Excluir definitivamente',
        message: all ? 'Apagar de vez tudo o que está na lixeira?' : 'Apagar este item de vez?',
        detail: 'Esta ação não pode ser desfeita. Documentos são apagados com o arquivo.',
        buttons: ['Cancelar', all ? 'Esvaziar' : 'Excluir de vez'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response.response !== 1) return false;
      return ctx.store.purgeTrash(all ? { all: true } : { id: input?.id });
    }),
  );

  // Program password. unlockApp and lockConfig work while locked (see the guard in main.cjs).
  ctx.register('lockConfig', () => ctx.appLock.config());
  ctx.register('setLockPassword', input => ctx.appLock.setPassword(input || {}));
  ctx.register('disableLock', input => ctx.appLock.disable(input || {}));
  ctx.register('configureLock', input => ctx.appLock.configure(input || {}));
  ctx.register('lockApp', () => {
    ctx.appLock.lock();
    return true;
  });
  ctx.register('unlockApp', password => ctx.appLock.unlock(typeof password === 'string' ? password : ''));

  // Address by CEP: only the CEP digits leave the computer.
  ctx.register('lookupCEP', value => ctx.cep.lookup(value));

  // Morning summary.
  ctx.register('digestConfig', () => ctx.digest.config());
  ctx.register('configureDigest', input => ctx.digest.configure(input || {}));
  ctx.register('previewDigest', () => ctx.digest.text());

  // Hours of a case become a receivable.
  ctx.register('billTime', input =>
    ctx.operations.run('Cobrança de horas', () =>
      require('../../backend/time-billing.cjs').billTime(ctx.store, input?.caseId),
    ),
  );

  // Expiry date of a document (procuração, contrato), for the alerts on the home screen.
  ctx.register('setDocumentValidity', input => {
    const { uuid } = require('../../backend/validation.cjs');
    const doc = ctx.store.get('documents', uuid(input?.id));
    const value = String(input?.validUntil || '');
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data de validade inválida.');
    const { id, createdAt, updatedAt, ...payload } = doc;
    void createdAt;
    void updatedAt;
    return ctx.store.put('documents', id, { ...payload, validUntil: value });
  });

  // Signs a PDF with an A1 certificate. Both files are chosen here; the password comes from the screen
  // and is used only for this signature.
  ctx.register('chooseSignFiles', () =>
    ctx.operations.run('Assinatura digital', async () => {
      const pdf = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'PDF a assinar',
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (pdf.canceled) return null;
      const cert = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Certificado digital A1',
        properties: ['openFile'],
        filters: [{ name: 'Certificado A1', extensions: ['pfx', 'p12'] }],
      });
      if (cert.canceled) return null;
      ctx.signFiles = { pdf: pdf.filePaths[0], cert: cert.filePaths[0] };
      return { pdf: ctx.path.basename(pdf.filePaths[0]), cert: ctx.path.basename(cert.filePaths[0]) };
    }),
  );
  ctx.register('certificateInfo', async password => {
    if (!ctx.signFiles) throw new Error('Escolha o PDF e o certificado.');
    const { certificateInfo } = require('../../backend/pdf-sign.cjs');
    return certificateInfo(await ctx.fsp.readFile(ctx.signFiles.cert), String(password || ''));
  });
  ctx.register('signPdf', input =>
    ctx.operations.run('Assinatura digital', async () => {
      if (!ctx.signFiles) throw new Error('Escolha o PDF e o certificado.');
      const { signPdf } = require('../../backend/pdf-sign.cjs');
      const { bytes, info } = await signPdf({
        pdfBytes: await ctx.fsp.readFile(ctx.signFiles.pdf),
        p12Bytes: await ctx.fsp.readFile(ctx.signFiles.cert),
        password: String(input?.password || ''),
        reason: String(input?.reason || 'Assinatura digital'),
        location: ctx.settings.get().officeCity || '',
      });
      const name = ctx.path.basename(ctx.signFiles.pdf, '.pdf') + ' - assinado.pdf';
      const target = await ctx.dialog.showSaveDialog(ctx.win, {
        title: 'Salvar PDF assinado',
        defaultPath: ctx.path.join(ctx.path.dirname(ctx.signFiles.pdf), name),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      ctx.signFiles = null;
      if (target.canceled) return null;
      await ctx.fsp.writeFile(target.filePath, bytes, { mode: 0o600 });
      ctx.store.audit('pdf.signed');
      return { file: target.filePath, signer: info.name };
    }),
  );
};
