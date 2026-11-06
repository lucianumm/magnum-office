const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell, safeStorage, Menu, Tray, nativeImage, Notification, clipboard } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL}=require('node:url');
const { Store } = require('../backend/store.cjs');
const { Vault } = require('../backend/vault.cjs');
const { Settings } = require('../backend/settings.cjs');
const { Operations } = require('../backend/operations.cjs');
const { Backups, restoreBackup, backupPath, verifyBackup } = require('../backend/backups.cjs');
const { Documents } = require('../backend/documents.cjs');
const { Messaging } = require('../backend/messaging.cjs');
const { diagnostics } = require('../backend/diagnostics.cjs');
const { Updater } = require('../updater/updater.cjs');
const {WeeklyBackups}=require('../backend/weekly-backups.cjs');
const {PDFTools}=require('../backend/pdf-tools.cjs');
const {Library}=require('../backend/library.cjs');
const {Imports}=require('../backend/imports.cjs');
const {AgentAPI}=require('../backend/agent-api.cjs');
const {extractEmails}=require('../backend/email-addresses.cjs');
const version = require('../app/version.cjs');
const support = require('../app/support.json');
const terms=require('../app/terms.json');
const courts = require('../app/courts.json');

app.setName('Advocacia Gestão');
app.setAppUserModelId('br.advocacia.gestao');
protocol.registerSchemesAsPrivileged([{ scheme: 'advocacia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const getArg = prefix => process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
const recovering = getArg('--recover=');
const recoveryRoot = recovering ? getArg('--user-data=') : null;
const testRoot = !app.isPackaged ? process.env.ADVOCACIA_TEST_DATA : null;
const customRoot = getArg('--data-dir=');
if (customRoot && !path.isAbsolute(customRoot)) throw new Error('A pasta de dados deve usar um caminho absoluto.');
const dataRoot = recoveryRoot || customRoot || testRoot || path.join(app.getPath('appData'), 'AdvocaciaGestao');
app.setPath('userData', dataRoot);
const deferredLock = Boolean(recovering && getArg('--wait-pid='));
let isPrimary = deferredLock || app.requestSingleInstanceLock();
if (!isPrimary) app.quit();
let win, tray, store, settings, messaging, updater, documents, backups, library, imports, agentAPI, pdfTools, weeklyBackups;
const operations = new Operations();
let notificationTimer;
let quitting = false;
const notified = new Set();
let markRendererReady;
const rendererReady = new Promise(resolve => { markRendererReady = resolve; });
const devURL = !app.isPackaged && process.env.ADVOCACIA_DEV_URL === 'http://127.0.0.1:5173' ? process.env.ADVOCACIA_DEV_URL : null;
function icon() { return nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')); }
function show() { if (win) { win.show(); win.focus(); } }
function displayName() { return settings?.get().appName || 'Advocacia — Gestão'; }
function applyBranding() {
  win?.setTitle(displayName()); tray?.setToolTip(displayName());
  tray?.setContextMenu(Menu.buildFromTemplate([{ label: `Abrir ${displayName()}`, click: show }, { type: 'separator' }, { label: 'Sair do sistema', click: () => { quitting = true; app.quit(); } }]));
}

function register(command, handler) {
  ipcMain.handle('advocacia:' + command, async (event, data) => {
    try {
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || (event.senderFrame.url !== 'advocacia://app/index.html' && !event.senderFrame.url.startsWith(devURL ? devURL + '/' : 'advocacia://app/index.html#'))) throw new Error('Origem não autorizada.');
      if(settings&&settings.get().termsAcceptedVersion!==terms.version&&!['ready','state','acceptTerms','declineTerms','legalText','window','openLink','exportData','exportDocument','createBackup','openBackups'].includes(command))throw new Error('Leia e aceite os termos antes de usar esta função.');
      if (data !== undefined && JSON.stringify(data).length > 400000) throw new Error('Solicitação maior que o limite permitido.');
      return { ok: true, value: await handler(data) };
    } catch (error) { return { ok: false, error: error.message || 'A operação não pôde ser concluída.' }; }
  });
}
function state() {
  return { backupSchedule:weeklyBackups.get(), terms,termsAccepted:settings.get().termsAcceptedVersion===terms.version, pdfJob:pdfTools.get(),notificationsSupported:Notification.isSupported(), library: {groups:library.groups(),templates:library.list()}, agent:agentAPI.status(), version, packaged: app.isPackaged, platform: process.platform, support, courts, settings: settings.get(), counts: store.counts(), entities: Object.fromEntries(['clients', 'cases', 'tasks', 'notes', 'documents'].map(kind => [kind, store.list(kind)])), services: messaging.status(), messages: messaging.list(), backups: backups.list(), updates: updater.get(), operations: operations.status(), audit: store.auditList(), dbStatus: store.integrity() ? 'ok' : 'error', recovery: fs.existsSync(path.join(dataRoot, 'recovery-notice.json')) ? JSON.parse(fs.readFileSync(path.join(dataRoot, 'recovery-notice.json'), 'utf8')) : null };
}
function bindHandlers() {
  register('configureBackups',input=>operations.run('Configurar backups',()=>{const result=weeklyBackups.configure(input);setTimeout(()=>void weeklyBackups.tick(),150);return result;}));
  register('backupNoticeSeen',()=>weeklyBackups.noticeSeen());
  register('retryBackupEmail',input=>{if(input?.reviewed!==true)throw new Error('Confira o resultado no Resend antes de tentar novamente.');weeklyBackups.retry();void weeklyBackups.tick();return true;});
  register('exportPortableBackup',input=>operations.exclusive(async()=>{const pass=input?.password||store.secret('backup-password');const result=await dialog.showSaveDialog(win,{title:'Salvar cópia portátil protegida por senha',defaultPath:'Magnum-Office-'+new Date().toISOString().slice(0,10)+'.magnumbackup',filters:[{name:'Backup protegido',extensions:['magnumbackup']}]});if(result.canceled)return false;const bytes=await weeklyBackups.portable.create(pass);await fsp.writeFile(result.filePath,bytes,{mode:0o600});store.audit('backup.portable.exported');return true;}));
  register('restorePortableBackup',input=>operations.exclusive(async()=>{const result=await dialog.showOpenDialog(win,{title:'Selecionar backup portátil protegido por senha',properties:['openFile'],filters:[{name:'Backup protegido',extensions:['magnumbackup']}]});if(result.canceled)return false;if((await fsp.stat(result.filePaths[0])).size>220*1024**2)throw new Error('Arquivo de backup excessivo.');const response=await dialog.showMessageBox(win,{type:'warning',message:'Restaurar os cadastros e documentos deste backup e reiniciar?',detail:'Os dados atuais serão preservados em um backup. Conexões precisarão ser reconfiguradas. Disparos não enviados voltarão para revisão e não serão enviados automaticamente.',buttons:['Cancelar','Restaurar e reiniciar'],defaultId:0,cancelId:0,noLink:true});if(response.response!==1)return false;const snapshot=await weeklyBackups.portable.stageRestore(await fsp.readFile(result.filePaths[0]),input?.password);await backups.create('pre-portable-restore');app.relaunch({args:[...process.argv.slice(app.isPackaged?1:2).filter(a=>!a.startsWith('--recover=')&&!a.startsWith('--user-data=')),...(app.isPackaged?[]:['.']),`--recover=${snapshot.id}`,`--user-data=${dataRoot}`]});app.quitForUpdate=true;app.quit();return true;}));
  register('declineTerms',()=>{quitting=true;app.quit();return true;});
  register('acceptTerms',input=>{if(input?.version!==terms.version||input?.accepted!==true)throw new Error('É necessário aceitar a versão atual dos termos.');settings.internal({termsAcceptedVersion:terms.version,termsAcceptedAt:new Date().toISOString()});store.audit('terms.accepted',{version:terms.version});messaging.autoconnect();setTimeout(()=>void weeklyBackups.tick(),1000);return true;});
  register('legalText',id=>{const files={license:path.join(__dirname,'..','LICENSE'),privacy:path.join(__dirname,'..','docs','PRIVACIDADE.md')};if(!files[id])throw new Error('Documento inválido.');return fsp.readFile(files[id],'utf8');});
  register('previewEmail', input=>require('../backend/email-design.cjs').render(input,settings.get(),true));
  register('importEmailImage', async()=>{const chosen=await dialog.showOpenDialog(win,{title:'Imagem para o e-mail',properties:['openFile'],filters:[{name:'PNG ou JPG',extensions:['png','jpg','jpeg']}]});if(chosen.canceled)return false;const file=chosen.filePaths[0];if((await fsp.stat(file)).size>5*1024**2)throw new Error('Escolha uma imagem de até 5 MB.');let img=nativeImage.createFromPath(file);if(img.isEmpty())throw new Error('Imagem inválida.');img=img.resize({width:Math.min(900,img.getSize().width)});let buffer=img.toJPEG(75);if(buffer.length>60000){img=img.resize({width:600});buffer=img.toJPEG(55);}if(buffer.length>60000)throw new Error('Use uma imagem menor ou mais simples.');return 'data:image/jpeg;base64,'+buffer.toString('base64');});
  register('testNotification', ()=>{if(!Notification.isSupported())throw new Error('Notificações indisponíveis neste computador.');const notice=new Notification({title:displayName(),body:'As notificações do escritório estão ativadas.',icon:icon()});notice.on('click',show);notice.show();return true;});
  register('pdfTool', input=>operations.run('Processamento local de PDF',async()=>{if(!['images','split','merge','archive'].includes(input.mode))throw new Error('Operação inválida.');if(pdfTools.get().status==='running')throw new Error('Já há um processamento em andamento.');const chosen=await dialog.showOpenDialog(win,{title:input.mode==='images'?'Selecionar imagens para PDF':'Selecionar PDF',properties:['split','archive'].includes(input.mode)?['openFile']:['openFile','multiSelections'],filters:[{name:input.mode==='images'?'Imagens':'PDF',extensions:input.mode==='images'?['png','jpg','jpeg']:['pdf']}]});if(chosen.canceled)return false;const confirm=await dialog.showMessageBox(win,{type:'question',message:'Processar estes arquivos no computador?',detail:'Saída PDF/A-2b. As páginas são convertidas em imagens: texto pesquisável, links, formulários e assinaturas digitais não são preservados. CPU e memória do computador serão utilizados e ele pode ficar lento. Guarde os originais. Ordem de processamento:\n'+chosen.filePaths.map((f,i)=>(i+1)+'. '+path.basename(f)).join('\n'),buttons:['Cancelar','Continuar'],defaultId:1,cancelId:0,noLink:true});if(confirm.response!==1)return false;let output;if(input.mode==='split'){const folder=await dialog.showOpenDialog(win,{title:'Escolher pasta de destino',properties:['openDirectory','createDirectory']});if(folder.canceled)return false;output=path.join(folder.filePaths[0],'PDF-partes-'+require('node:crypto').randomUUID());await fsp.mkdir(output,{mode:0o700});}else{const file=await dialog.showSaveDialog(win,{title:'Salvar novo PDF',defaultPath:input.mode==='images'?'imagens-pdfa.pdf':input.mode==='archive'?'documento-pdfa.pdf':'documentos-reunidos-pdfa.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(file.canceled)return false;output=file.filePath;if(!output.toLowerCase().endsWith('.pdf'))output+='.pdf';}const result=await pdfTools.run({mode:input.mode,limitMB:input.limitMB,pagesPerPart:input.pagesPerPart,files:chosen.filePaths,output});if(result)store.audit('pdf.processed',{kind:input.mode});return result;}));
  register('cancelPDF', ()=>pdfTools.cancel());
  register('openPDFOutput', ()=>{if(!pdfTools.folder)throw new Error('Nenhuma pasta de destino foi selecionada.');return shell.openPath(pdfTools.folder);});
  register('extractEmails', input=>extractEmails(input));
  register('saveTemplateGroup', input=>operations.run('Grupo de modelos',()=>library.saveGroup(input)));
  register('saveTemplate', input=>operations.run('Modelo',()=>library.save(input)));
  register('removeTemplate', input=>operations.run('Excluir modelo',async()=>{const result=await dialog.showMessageBox(win,{type:'warning',message:'Excluir este modelo ou grupo?',buttons:['Cancelar','Excluir'],defaultId:0,cancelId:0});if(result.response!==1)return false;return library.remove(input.type,input.id);}));
  register('importTemplate', ()=>operations.run('Importar modelo',async()=>{const result=await dialog.showOpenDialog(win,{title:'Importar modelo para edição',properties:['openFile'],filters:[{name:'Modelos',extensions:['docx','txt','html','htm']}]});return result.canceled?false:library.readFile(result.filePaths[0]);}));
  register('chooseImport', ()=>operations.run('Ler importação',async()=>{const result=await dialog.showOpenDialog(win,{title:'Importar contatos ou agenda',properties:['openFile'],filters:[{name:'Planilhas e CSV',extensions:['csv','tsv','txt','xlsx']}]});return result.canceled?false:imports.read(result.filePaths[0]);}));
  register('previewImport', input=>operations.run('Revisar importação',()=>imports.preview(input)));
  register('commitImport', input=>operations.exclusive(async()=>{await backups.create('pre-import');return imports.commit(input);}));
  register('configureAgent', input=>operations.run('Configurar integração',()=>agentAPI.configure(input)));
  register('copyAgentToken', ()=>{const token=agentAPI.token();if(!token)throw new Error('Gere o token primeiro.');clipboard.writeText(token);return true;});
  register('ready', () => { markRendererReady(); return true; });
  register('state', state);
  register('save', data => operations.run('Gravação de cadastro', () => store.save(data.kind, data.entity)));
  register('remove', data => operations.run('Exclusão de registro', async () => {
    const response = await dialog.showMessageBox(win, { type: 'warning', title: 'Excluir registro', message: 'Excluir este registro permanentemente?', detail: 'Os vínculos existentes serão verificados antes da exclusão.', buttons: ['Cancelar', 'Excluir'], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response !== 1) return false;
    store.remove(data.kind, data.id); return true;
  }));
  register('importDocument', links => operations.run('Importação de documentos', async () => {
    const chosen = await dialog.showOpenDialog(win, { title: 'Importar documentos para o cofre local', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'webp'] }] });
    if (chosen.canceled) return [];
    const result = [];
    for (const file of chosen.filePaths) result.push(await documents.import(file, links || {}));
    return result;
  }));
  register('openDocument', id => operations.run('Abertura de documento', async () => { const result = await shell.openPath(await documents.temporary(id)); if (result) throw new Error('Nenhum programa conseguiu abrir este documento. Use a opção Exportar.'); }));
  register('exportDocument', id => operations.run('Exportação de documento', async () => {
    const item = store.get('documents', id);
    const chosen = await dialog.showSaveDialog(win, { title: 'Exportar documento sem criptografia', defaultPath: item.name });
    if (chosen.canceled) return false;
    await fsp.writeFile(chosen.filePath, documents.read(id), { mode: 0o600 }); store.audit('document.exported', { id }); return true;
  }));
  register('createBackup', () => operations.exclusive(() => backups.create()));
  register('restoreBackup', async id => {
    const response = await dialog.showMessageBox(win, { type: 'warning', title: 'Restaurar backup', message: 'Restaurar os dados deste backup e reiniciar?', detail: 'Os dados atuais serão preservados em uma cópia de segurança. Alterações posteriores ao backup não aparecerão na base restaurada.', buttons: ['Cancelar', 'Restaurar e reiniciar'], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response !== 1) return false;
    await operations.exclusive(async () => { await verifyBackup(dataRoot, id, store.vault); await backups.create('pre-restore'); app.relaunch({ args: [...process.argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('--recover=') && !a.startsWith('--user-data=') && !a.startsWith('--rollback-version=')), ...(app.isPackaged ? [] : ['.']), `--recover=${id}`, `--user-data=${dataRoot}`] }); app.quitForUpdate = true; app.quit(); });
    return true;
  });
  register('rollback', async id => {
    if (process.platform !== 'win32') throw new Error('Use o aplicativo ou instalador anterior e restaure o backup. Consulte a documentação de recuperação.');
    const manifest = await verifyBackup(dataRoot, id, store.vault);
    if (!manifest.runtime) throw new Error('Este backup contém dados, mas não uma versão anterior do programa.');
    const response = await dialog.showMessageBox(win, { type: 'warning', title: 'Voltar à versão anterior', message: `Voltar à versão ${manifest.version}?`, detail: 'O programa será reiniciado a partir da cópia preservada. Os dados atuais serão salvos antes da restauração.', buttons: ['Cancelar', 'Voltar à versão anterior'], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response !== 1) return false;
    await operations.exclusive(async () => {
      await backups.create('pre-rollback');
      const { spawn } = require('node:child_process');
      const child = spawn(path.join(backupPath(dataRoot, id), 'runtime', manifest.runtime), [`--recover=${id}`, `--user-data=${dataRoot}`, `--wait-pid=${process.pid}`, `--rollback-version=${version}`], { detached: true, stdio: 'ignore', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
      app.quitForUpdate = true; app.quit();
    }); return true;
  });
  register('openBackups', () => shell.openPath(path.join(dataRoot, 'backups')));
  register('exportData', () => operations.run('Exportação de dados', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Escolher pasta para exportação dos dados legíveis', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return false;
    const dest = path.join(result.filePaths[0], 'Advocacia-exportacao-' + Date.now());
    await fsp.mkdir(dest, { mode: 0o700 }); await fsp.mkdir(path.join(dest, 'documentos'));
    const entities = Object.fromEntries(['clients', 'cases', 'tasks', 'notes', 'documents'].map(kind => [kind, store.list(kind)]));
    await fsp.writeFile(path.join(dest, 'dados.json'), JSON.stringify({ version, exportedAt: new Date().toISOString(), ...entities, library:{groups:library.groups(),templates:library.list()} }, null, 2), { mode: 0o600 });
    for (const doc of entities.documents) await fsp.writeFile(path.join(dest, 'documentos', doc.id + doc.ext), documents.read(doc.id), { mode: 0o600 });
    store.audit('data.exported'); return true;
  }));
  register('diagnostic', () => operations.run('Exportação de diagnóstico', async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Exportar diagnóstico técnico', defaultPath: `advocacia-diagnostico-${version}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return false;
    await fsp.writeFile(result.filePath, JSON.stringify(await diagnostics(store, settings, messaging, backups), null, 2), { mode: 0o600 }); return true;
  }));
  register('openLogs', () => shell.openPath(path.join(dataRoot, 'logs')));
  register('openLink', link => {
    const repo = settings.get().repository;
    const urls = { developer: support.whatsappURL, services: support.whatsappURL+'?text='+encodeURIComponent('Olá, Lucianum Magnum. Gostaria de conversar sobre um sistema, automações ou presença digital para minha empresa.'), professionalSetup: support.whatsappURL + '?text=' + encodeURIComponent('Olá, Lucianum. Gostaria de contratar a configuração profissional do domínio, Resend e Cloudflare para meu sistema.'), resendDomains: 'https://resend.com/domains', cloudflare: 'https://dash.cloudflare.com/', resendGuide: 'https://resend.com/docs/dashboard/domains/introduction', courtsSource: courts.source, repository: repo ? `https://github.com/${repo}` : null, changelog: repo ? `https://github.com/${repo}/releases` : null, documentation: repo ? `https://github.com/${repo}/blob/main/docs/INSTALACAO.md` : null };
    if (!urls[link]) throw new Error('Configure o repositório do GitHub nas configurações.');
    return shell.openExternal(urls[link]);
  });
  register('saveSettings', data => operations.run('Configuração', () => { const result = settings.save(data); applyBranding(); store.audit('settings.saved'); return result; }));
  register('importLogo', () => operations.run('Importação da logo', async () => {
    const chosen = await dialog.showOpenDialog(win, { title: 'Escolher a logo do escritório', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (chosen.canceled) return false;
    const file = chosen.filePaths[0];
    if (!/\.(png|jpe?g|webp)$/i.test(file) || (await fsp.stat(file)).size > 5 * 1024 ** 2) throw new Error('Escolha uma imagem PNG, JPG ou WebP de até 5 MB.');
    let image = nativeImage.createFromPath(file); if (image.isEmpty()) throw new Error('Não foi possível ler a imagem selecionada.');
    const size = image.getSize(); const width = Math.min(size.width, 200), height = Math.round(size.height / size.width * width);
    image = image.resize(height > 200 ? { height: 200 } : { width });
    if (image.toPNG().length > 90000) image = image.resize({ width: 128 });
    if (image.toPNG().length > 90000) throw new Error('A imagem é muito complexa. Use uma logo menor.');
    settings.internal({ brandLogo: image.toDataURL() }); store.audit('branding.logo.saved'); return true;
  }));
  register('removeLogo', () => operations.run('Personalização', () => { settings.internal({ brandLogo: '' }); store.audit('branding.logo.removed'); return true; }));
  register('copyPix', () => { clipboard.writeText(support.pixPayload); return true; });
  register('courtLink', input => {
    const court = courts.courts.find(c => c.id === input.id); if (!court) throw new Error('Tribunal não encontrado.');
    const link = input.system === undefined ? court.url : Number.isInteger(input.system) ? court.systems[input.system]?.url : null;
    if (!link || new URL(link).protocol !== 'https:' || !new URL(link).hostname.endsWith('.jus.br')) throw new Error('Acesso oficial inválido.');
    return shell.openExternal(link);
  });
  register('checkUpdate', () => updater.check());
  register('downloadUpdate', async () => {
    const response = await dialog.showMessageBox(win, { type: 'question', title: 'Baixar atualização', message: `Baixar a versão ${updater.get().available?.version || ''}?`, detail: 'O download será validado antes da instalação. Seus dados serão copiados antes de atualizar.', buttons: ['Cancelar', 'Baixar atualização'], defaultId: 1, cancelId: 0, noLink: true });
    if (response.response === 1) return updater.download(); return updater.get();
  });
  register('installUpdate', async () => {
    const response = await dialog.showMessageBox(win, { type: 'warning', title: 'Instalar atualização', message: 'Criar backup, instalar e reiniciar o sistema?', detail: 'As filas ficarão pausadas durante a manutenção. Operações em andamento precisam terminar antes da atualização.', buttons: ['Cancelar', 'Instalar e reiniciar'], defaultId: 0, cancelId: 0, noLink: true });
    if (response.response === 1) return updater.install(); return updater.get();
  });
  register('connectWhatsApp', () => operations.run('Conexão WhatsApp', () => messaging.connectWhatsApp()));
  register('disconnectWhatsApp', () => operations.run('Desconexão WhatsApp', () => messaging.disconnectWhatsApp()));
  register('configureEmail', key => operations.run('Configuração do e-mail', () => messaging.configureEmail(key)));
  register('emailCampaign', input => operations.run('Cadastro de campanha',()=>messaging.campaign(input)));
  register('emailAttachments', ()=>operations.run('Importação de anexos',async()=>{
    const result=await dialog.showOpenDialog(win,{title:'Anexar arquivos ao e-mail',properties:['openFile','multiSelections'],filters:[{name:'Documentos e imagens',extensions:['pdf','doc','docx','odt','txt','rtf','xls','xlsx','csv','png','jpg','jpeg','webp','zip']}]});
    if(result.canceled)return [];
    if(result.filePaths.length>10)throw new Error('Selecione até dez arquivos.');
    const items=[];let total=0;
    for(const file of result.filePaths){const stat=await fsp.stat(file);total+=stat.size;if(!stat.isFile()||total>10*1024*1024||!/\.(pdf|docx?|odt|txt|rtf|xlsx?|csv|png|jpe?g|webp|zip)$/i.test(file))throw new Error('Selecione documentos de até 10 MB no total.');items.push({file,name:path.basename(file),size:stat.size});}
    const out=[];for(const item of items){const id=require('node:crypto').randomUUID();store.secret('email-attachment:'+id,{name:item.name,size:item.size,content:(await fsp.readFile(item.file)).toString('base64')});out.push({id,name:item.name,size:item.size});}return out;
  }));
  register('enqueue', data => operations.run('Agendamento de mensagem', () => messaging.enqueue(data)));
  register('previewRecurrence',data=>{const dates=require('../backend/recurrence.cjs').expandSchedule(data.first,data.recurrence);if(dates.some(d=>Date.parse(d)<Date.now()+5000||Date.parse(d)>Date.now()+5*366*86400000))throw new Error('Todas as datas devem ser futuras, dentro dos próximos cinco anos.');return dates;});
  register('enqueueSeries',data=>operations.run('Cadastrar disparos recorrentes',()=>messaging.series(data.message,data.recurrence)));
  register('cancelMessageSeries',id=>operations.run('Cancelar recorrência',()=>messaging.cancelSeries(id)));
  register('editMessage', data => operations.run('Edição de disparo', () => messaging.edit(data.id, data.message)));
  register('changeMessage', data => operations.run('Alteração de mensagem', () => messaging.change(data.id, data.action)));
  register('window', action => { if (action === 'minimize') win.minimize(); if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); if (action === 'close') win.close(); });
}
async function createWindow() {
  win = new BrowserWindow({ width: 1460, height: 980, minWidth: 1040, minHeight: 700, title: displayName(), icon: icon(), backgroundColor: '#f6f7f9', frame: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== 'advocacia://app/index.html' && (!devURL || !url.startsWith(devURL + '/'))) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.once('ready-to-show', show);
  win.on('close', event => { if (!quitting && !app.quitForUpdate && settings.get().background) { event.preventDefault(); win.hide(); } });
  Menu.setApplicationMenu(null);
  if (devURL) await win.loadURL(devURL); else await win.loadURL('advocacia://app/index.html');
  tray = new Tray(icon()); tray.setToolTip('Advocacia — Gestão');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir Advocacia — Gestão', click: show }, { type: 'separator' }, { label: 'Sair do sistema', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', show);
  applyBranding();
}
async function boot() {
  const waitPid = Number(getArg('--wait-pid='));
  if (recovering && waitPid > 0) {
    for (let i = 0; i < 120; i++) { try { process.kill(waitPid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (deferredLock) { isPrimary = app.requestSingleInstanceLock(); if (!isPrimary) { app.quit(); return; } }
  if (!isPrimary) return;
  await app.whenReady();
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  let vault = await Vault.open(dataRoot, safeStorage);
  if (recovering) {
    if (process.argv.includes('--recovery-confirm')) {
      const answer = await dialog.showMessageBox({ type: 'warning', title: 'Recuperar Advocacia — Gestão', message: 'Restaurar os dados e o programa preservados antes da atualização?', detail: 'O estado atual será guardado antes de restaurar. Encerre outras janelas do sistema e aguarde a conclusão.', buttons: ['Cancelar', 'Recuperar'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) { app.quit(); return; }
    }
    const restored = await restoreBackup(dataRoot, recovering, vault);
    vault = await Vault.open(dataRoot, safeStorage);
    const failed = getArg('--rollback-version=');
    const cfg = new Settings(dataRoot);
    if (failed) cfg.internal({ blockedVersions: [...new Set([...cfg.get().blockedVersions, failed])] });
    await fsp.rm(path.join(dataRoot, 'pending-update.json'), { force: true });
    await fsp.writeFile(path.join(dataRoot, 'recovery-notice.json'), JSON.stringify({ at: new Date().toISOString(), restoredVersion: restored.version, failedVersion: failed || null }));
    if (restored.runtime && restored.installedExecutable && process.platform === 'win32') {
      const sourceRuntime = path.join(backupPath(dataRoot, recovering), 'runtime');
      const expectedExe = path.join(sourceRuntime, restored.runtime);
      const destination = path.dirname(path.resolve(restored.installedExecutable));
      // Only an authenticated backup created by the installed app may name its old install directory.
      if (path.resolve(process.execPath).toLowerCase() === expectedExe.toLowerCase() && destination !== path.parse(destination).root && !destination.toLowerCase().startsWith(path.resolve(dataRoot).toLowerCase()) && path.basename(restored.installedExecutable) === restored.runtime) {
        try { await require('original-fs').promises.cp(sourceRuntime, destination, { recursive: true, force: true }); }
        catch { /* The preserved runtime remains runnable if replacing the original install is denied. */ }
      }
    }
  }
  const frontend = path.join(__dirname, '..', 'dist', 'frontend');
  protocol.handle('advocacia', request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname);
    const file = path.resolve(frontend, '.' + relative);
    if (url.hostname !== 'app' || !file.startsWith(frontend + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  store = new Store(dataRoot, vault); await store.migrate();
  settings = new Settings(dataRoot);
  backups = new Backups(store, settings);
  documents = new Documents(store); documents.clean();
  messaging = new Messaging(store, settings, operations);messaging.canProcess=()=>settings.get().termsAcceptedVersion===terms.version;
  pdfTools=new PDFTools();library=new Library(store);imports=new Imports(store);agentAPI=new AgentAPI({store,settings,operations,library,messaging});agentAPI.requireTerms=true;await agentAPI.start();
  weeklyBackups=new WeeklyBackups({store,settings,backups,operations,messaging});
  updater = new Updater({ store, settings, operations, backups, app });updater.canOperate=()=>settings.get().termsAcceptedVersion===terms.version;
  bindHandlers(); await createWindow();
  let readyTimeout;
  try { await Promise.race([rendererReady, new Promise((_resolve, reject) => { readyTimeout = setTimeout(() => reject(new Error('A interface não confirmou a inicialização.')), 20000); })]); }
  finally { clearTimeout(readyTimeout); }
  store.audit('application.started', { version });setTimeout(()=>void weeklyBackups.tick(),3000);
  if(settings.get().termsAcceptedVersion===terms.version)messaging.autoconnect();
  const pendingFile = path.join(dataRoot, 'pending-update.json');
  if (fs.existsSync(pendingFile)) {
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    if (pending.version === version && store.integrity()) {
      await fsp.writeFile(path.join(dataRoot, 'health.json'), JSON.stringify({ version, backupId: pending.backupId, pid: process.pid, at: new Date().toISOString() }));
      settings.internal({ lastUpdate: new Date().toISOString() });
      store.audit('update.success', { fromVersion: pending.fromVersion, version });
      await fsp.rm(pendingFile);
    }
  }
  if (settings.get().termsAcceptedVersion===terms.version&&settings.get().automatic && settings.get().repository) void updater.check().catch(() => {});
  notificationTimer = setInterval(() => {
    if (settings.get().termsAcceptedVersion!==terms.version||!settings.get().notifications || operations.maintenance) return;
    const soon = store.list('tasks').filter(task => task.status !== 'Concluída' && new Date(task.due).getTime() - Date.now() <= settings.get().notificationLeadMinutes*60000 && new Date(task.due).getTime() > Date.now()-60000);
    for (const task of soon) if (!notified.has(task.id + task.due)) { notified.add(task.id + task.due); const n = new Notification({ title: 'Compromisso próximo', body: 'Há um prazo ou compromisso próximo. Abra a agenda do escritório.', icon: icon() }); n.on('click', show); n.show(); }
  }, 60000);
}
app.on('second-instance', show);
app.on('activate', show);
app.on('before-quit', event => {
  if (operations.active.size && !app.quitForUpdate) { event.preventDefault(); if (win) void dialog.showMessageBox(win, { type: 'info', message: 'Aguarde a operação em andamento antes de sair.' }); return; }
  quitting = true;
});
app.on('will-quit', () => { clearInterval(notificationTimer); weeklyBackups?.stop(); void agentAPI?.stop(); updater?.stop(); messaging?.stop(); void pdfTools?.stop(); documents?.clean(); store?.close(); tray?.destroy(); });
if (isPrimary) boot().catch(async error => {
  await app.whenReady();
  if(testRoot)console.error('TEST_BOOT_FAILED',error.stack);else dialog.showErrorBox('Não foi possível iniciar Advocacia — Gestão', error.message + '\n\nSe houve uma atualização, a ferramenta de recuperação tentará restaurar a versão anterior. Seus dados locais foram preservados.');
  quitting = true; app.exit(1);
});
