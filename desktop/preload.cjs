const { contextBridge, ipcRenderer } = require('electron');
const commands = ['previewRecurrence','enqueueSeries','cancelMessageSeries','extractEmails','saveTemplateGroup','saveTemplate','previewDocument','generateDocument','previewWorkflow','applyWorkflow','createInstallments','exportFinance','exportCalendar','updateIndices','debtSeries','saveDebtReport','saveLaborReport','caseMovements','lookupCase','lookupCNPJ','refreshMovements','addMovement','removeMovement','seenMovements','checkIntimations','setIntimation','openIntimation','checkAllMovements','convertIntake','searchDocuments','saveTextReport','removeTemplate','importTemplate','chooseImport','previewImport','commitImport','configureAgent','copyAgentToken','pdfTool','cancelPDF','openPDFOutput','testNotification','previewEmail','importEmailImage','declineTerms','acceptTerms','legalText','configureBackups','backupNoticeSeen','retryBackupEmail','exportPortableBackup','restorePortableBackup','ready', 'state', 'save', 'remove', 'importDocument', 'openDocument', 'exportDocument', 'createBackup', 'restoreBackup', 'rollback', 'openBackups', 'exportData', 'diagnostic', 'openLogs', 'openLink', 'saveSettings', 'importLogo', 'removeLogo', 'completeSetup', 'copyPix', 'courtLink', 'dismissRecoveryNotice', 'dismissWhatsNew', 'installUpdateOnQuit', 'removeBackup', 'checkUpdate', 'forceUpdate', 'downloadUpdate', 'installUpdate', 'installUpdateManually', 'connectWhatsApp', 'disconnectWhatsApp', 'configureEmail', 'enqueue', 'emailCampaign', 'emailAttachments', 'editMessage', 'changeMessage', 'window'];
const api = Object.fromEntries(commands.map(command => [command, async data => {
  const result = await ipcRenderer.invoke('advocacia:' + command, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}]));
// The main process announces data changes; the page reloads instead of polling.
api.onChanged = callback => {
  const listener = () => callback();
  ipcRenderer.on('advocacia:changed', listener);
  return () => ipcRenderer.removeListener('advocacia:changed', listener);
};
contextBridge.exposeInMainWorld('advocacia', Object.freeze(api));
