const { contextBridge, ipcRenderer } = require('electron');
const commands = ['previewRecurrence','enqueueSeries','cancelMessageSeries','extractEmails','saveTemplateGroup','saveTemplate','removeTemplate','importTemplate','chooseImport','previewImport','commitImport','configureAgent','copyAgentToken','pdfTool','cancelPDF','openPDFOutput','testNotification','previewEmail','importEmailImage','declineTerms','acceptTerms','legalText','configureBackups','backupNoticeSeen','retryBackupEmail','exportPortableBackup','restorePortableBackup','ready', 'state', 'save', 'remove', 'importDocument', 'openDocument', 'exportDocument', 'createBackup', 'restoreBackup', 'rollback', 'openBackups', 'exportData', 'diagnostic', 'openLogs', 'openLink', 'saveSettings', 'importLogo', 'removeLogo', 'copyPix', 'courtLink', 'dismissRecoveryNotice', 'dismissWhatsNew', 'installUpdateOnQuit', 'removeBackup', 'checkUpdate', 'forceUpdate', 'downloadUpdate', 'installUpdate', 'connectWhatsApp', 'disconnectWhatsApp', 'configureEmail', 'enqueue', 'emailCampaign', 'emailAttachments', 'editMessage', 'changeMessage', 'window'];
const api = Object.fromEntries(commands.map(command => [command, async data => {
  const result = await ipcRenderer.invoke('advocacia:' + command, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}]));
contextBridge.exposeInMainWorld('advocacia', Object.freeze(api));
