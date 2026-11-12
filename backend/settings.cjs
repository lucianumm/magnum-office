const fs = require('node:fs');
const path = require('node:path');
const build = require('../app/build-config.json');
const version = require('../app/version.cjs');
const { ownDomain, sender } = require('./email-policy.cjs');
const defaults = { weeklyBackupEnabled:true,dailyBackupNotice:true,backupMode:'local',backupRecipient:'',termsAcceptedVersion:'',termsAcceptedAt:null, emailDesign:require('./email-design.cjs').defaults, version, officeName: 'Meu escritório', userName: 'Administrador', appName: '', brandLogo: '', appDescription:'Gestão jurídica', notificationLeadMinutes:60, theme: 'teal', appearance: 'light', density: 'comfortable', queuePaused: false, whatsappAutoConnect: true, scheduleGraceMinutes: 60, ownDomain: '', emailDNSConfirmed: false, favoriteCourts: [], lawyers: [], officeCity: '', officeAddress: '', courtCalendar: [], workflows: null, datajudEnabled: false, caseLookupEnabled: false, cnpjLookupEnabled: false, datajudKey: '', djenEnabled: false, lastDatajudCheck: null, lastDjenCheck: null, datajudError: '', djenError: '', repository: build.repository, channel: 'stable', automatic: true, checkFrequency: 'startup', autoDownload: true, updatePolicyVersion: 1, openAtLogin: false, installOutsideHours: false, businessStart: 8, businessEnd: 18, background: true, notifications: true, lastCheck: null, lastUpdate: null, blockedVersions: [], emailFrom: '' };
// Lawyers of the office, used in qualifications and powers of attorney. OAB data is public professional information.
function lawyers(list) {
  const { cnjStates } = require('../app/cnj.mjs');
  if (!Array.isArray(list) || list.length > 30) throw new Error('Cadastre até 30 advogados.');
  return list.map(item => {
    const field = (value, max) => {
      if (value !== undefined && (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value))) throw new Error('Dados do advogado inválidos.');
      return String(value || '').trim();
    };
    const name = field(item?.name, 160), oab = field(item?.oab, 20).replace(/[.\s-]/g, '').toUpperCase(), uf = field(item?.uf, 2).toUpperCase(), email = field(item?.email, 254);
    if (!name) throw new Error('Informe o nome de cada advogado.');
    if (!/^\d{1,6}[A-Z]?$/.test(oab)) throw new Error(`Informe o número da OAB de ${name} só com números, e a letra final quando houver.`);
    if (!cnjStates.includes(uf)) throw new Error(`Escolha a UF da OAB de ${name}.`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`E-mail de ${name} inválido.`);
    return { name, oab, uf, email };
  });
}
const limited = (value, max) => {
  if (value !== undefined && (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value))) throw new Error('Configuração inválida.');
  return String(value || '').trim();
};
// Days the office registers for its courts: local holidays, suspensions, or reopened days.
function courtCalendar(list) {
  const { isDateKey } = require('../app/deadlines.mjs');
  if (!Array.isArray(list) || list.length > 2000) throw new Error('Cadastre até 2.000 dias no calendário.');
  const seen = new Set();
  return list.map(item => {
    const date = limited(item?.date, 10), description = limited(item?.description, 120), courtId = limited(item?.courtId, 60), type = item?.type;
    if (!isDateKey(date)) throw new Error('Data inválida no calendário de prazos.');
    if (!['holiday', 'reduced', 'workday'].includes(type)) throw new Error('Tipo de dia inválido no calendário de prazos.');
    if (courtId && !/^[a-z0-9-]{1,60}$/.test(courtId)) throw new Error('Tribunal inválido no calendário de prazos.');
    if (seen.has(date + courtId)) throw new Error(`O dia ${date.split('-').reverse().join('/')} está repetido no calendário.`);
    seen.add(date + courtId);
    return { date, type, description, courtId };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
function workflows(list) {
  const { caseAreas } = require('../app/legal-options.mjs');
  if (!Array.isArray(list) || list.length > 50) throw new Error('Cadastre até 50 fluxos.');
  return list.map(w => {
    const name = limited(w?.name, 100), area = limited(w?.area, 60), id = limited(w?.id, 60);
    if (!name) throw new Error('Dê um nome a cada fluxo.');
    if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new Error('Identificador de fluxo inválido.');
    if (area && !caseAreas.includes(area)) throw new Error('Área inválida no fluxo.');
    if (!Array.isArray(w.items) || !w.items.length || w.items.length > 40) throw new Error(`O fluxo ${name} precisa de 1 a 40 tarefas.`);
    const items = w.items.map(i => {
      const title = limited(i?.title, 200);
      if (!title) throw new Error(`Há tarefa sem título no fluxo ${name}.`);
      if (!Number.isInteger(i.offset) || i.offset < 0 || i.offset > 365) throw new Error(`Use de 0 a 365 dias nas tarefas do fluxo ${name}.`);
      if (!['Prazo', 'Audiência', 'Reunião', 'Tarefa'].includes(i.type) || !['Normal', 'Alta', 'Urgente'].includes(i.priority)) throw new Error(`Tipo ou prioridade inválida no fluxo ${name}.`);
      return { title, offset: i.offset, type: i.type, priority: i.priority };
    });
    return { id, name, area, items };
  });
}
class Settings {
  constructor(root) {
    this.file = path.join(root, 'config.json');
    const stored = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    // Installations created before 1.3 had updates off by default, so nobody ever heard of new versions.
    // Installing still requires confirmation.
    const policy = (stored.updatePolicyVersion || 0) < 1 ? { automatic: true, autoDownload: true, updatePolicyVersion: 1 } : {};
    if (stored.appDescription === 'SEU ESCRITÓRIO, CONECTADO.') stored.appDescription = defaults.appDescription;
    this.value = { ...defaults, ...stored, ...policy, repository:build.repository, version };
    // Standard workflows are offered once; after that the office's list (even empty) is kept.
    if (!Array.isArray(this.value.workflows)) this.value.workflows = require('../app/workflows.mjs').defaultWorkflows;
    this.persist();
  }
  get() { return { ...this.value }; }
  persist() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  internal(data) { this.value = { ...this.value, ...data }; this.persist(); }
  // Every installation is configured once before use: name, lawyers and visual identity.
  // Installations updated from older versions go through it too, with their values already filled in.
  setupRequired() { return !this.value.setupCompletedAt; }
  completeSetup(data, { hasLogo = false } = {}) {
    if (!data || typeof data !== 'object') throw new Error('Preencha a configuração inicial.');
    const text = (key, label, min, max) => {
      const value = data[key];
      if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error(`Informe ${label}.`);
      const clean = value.trim();
      if (clean.length < min) throw new Error(`Informe ${label}.`);
      if (clean.length > max) throw new Error(`Use até ${max} caracteres em ${label}.`);
      return clean;
    };
    const office = {
      officeName: text('officeName', 'o nome do escritório', 2, 160),
      userName: text('userName', 'o seu nome', 2, 160),
      officeCity: text('officeCity', 'a cidade do escritório', 2, 120),
      officeAddress: data.officeAddress === undefined ? '' : text('officeAddress', 'o endereço', 0, 254),
      appName: text('appName', 'o nome exibido no sistema', 2, 60),
      appDescription: text('appDescription', 'a descrição abaixo do nome', 3, 100),
    };
    if (office.officeName.toLowerCase() === defaults.officeName.toLowerCase()) throw new Error('Troque "Meu escritório" pelo nome do seu escritório.');
    if (office.userName.toLowerCase() === defaults.userName.toLowerCase()) throw new Error('Troque "Administrador" pelo seu nome.');
    if (!Array.isArray(data.lawyers) || !data.lawyers.length) throw new Error('Cadastre pelo menos um advogado com a OAB.');
    if (!hasLogo && data.noLogo !== true) throw new Error('Escolha a logo do escritório ou indique que ainda não tem uma.');
    const extra = {};
    for (const key of ['theme', 'appearance']) if (key in data) extra[key] = data[key];
    const saved = this.save({ ...office, ...extra, lawyers: data.lawyers });
    this.internal({ setupCompletedAt: new Date().toISOString() });
    return { ...saved, setupCompletedAt: this.value.setupCompletedAt };
  }
  save(data) {
    const next = { ...this.value };
    if('emailDesign' in data)next.emailDesign=require('./email-design.cjs').normalize(data.emailDesign,this.get());
    for (const key of ['officeName', 'officeCity', 'officeAddress', 'userName', 'appName', 'appDescription', 'theme', 'appearance', 'density', 'ownDomain', 'repository', 'channel', 'checkFrequency', 'emailFrom']) if (key in data) {
      if (typeof data[key] !== 'string' || data[key].length > 254 || /[\r\n\0]/.test(data[key])) throw new Error('Configuração inválida.');
      next[key] = data[key].trim();
    }
    if(next.appDescription.length>100)throw new Error('Use uma descrição de até 100 caracteres.');
    if('repository' in data&&data.repository!==build.repository)throw new Error('O repositório de atualização é fixo: lucianumm/magnum-office.');
    if('notificationLeadMinutes' in data){if(![0,5,15,30,60,1440].includes(data.notificationLeadMinutes))throw new Error('Antecedência inválida.');next.notificationLeadMinutes=data.notificationLeadMinutes;}
    if (next.appName.length > 60) throw new Error('O nome visível do sistema deve ter até 60 caracteres.');
    if (!['teal', 'blue', 'navy', 'emerald', 'purple', 'rose', 'amber', 'graphite'].includes(next.theme) || !['light', 'dark', 'system'].includes(next.appearance) || !['comfortable', 'compact'].includes(next.density)) throw new Error('Tema ou aparência inválida.');
    next.ownDomain = ownDomain(next.ownDomain, true);
    if (next.emailFrom) sender(next.emailFrom, next.ownDomain);
    if (next.repository) {
      next.repository = next.repository.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+$/.test(next.repository) || next.repository.includes('..')) throw new Error('Use proprietário/repositório ou uma URL https://github.com/proprietário/repositório.');
    }
    if (!['stable', 'beta', 'development'].includes(next.channel) || !['startup', 'daily', 'weekly'].includes(next.checkFrequency)) throw new Error('Canal ou frequência inválida.');
    if ('datajudKey' in data) {
      if (typeof data.datajudKey !== 'string' || data.datajudKey.length > 300 || (data.datajudKey.trim() && !/^[A-Za-z0-9+/=_-]+$/.test(data.datajudKey.trim()))) throw new Error('Chave do DataJud inválida. Cole somente a chave, sem "APIKey".');
      next.datajudKey = data.datajudKey.trim();
    }
    for (const key of ['automatic', 'autoDownload', 'installOutsideHours', 'openAtLogin', 'background', 'notifications', 'queuePaused', 'whatsappAutoConnect', 'emailDNSConfirmed', 'datajudEnabled', 'djenEnabled', 'caseLookupEnabled', 'cnpjLookupEnabled']) if (key in data) {
      if (typeof data[key] !== 'boolean') throw new Error('Configuração inválida.');
      next[key] = data[key];
    }
    if ('scheduleGraceMinutes' in data) {
      if (![15, 60, 240, 1440].includes(data.scheduleGraceMinutes)) throw new Error('Tolerância de agendamento inválida.');
      next.scheduleGraceMinutes = data.scheduleGraceMinutes;
    }
    if ('favoriteCourts' in data) {
      if (!Array.isArray(data.favoriteCourts) || data.favoriteCourts.length > 150 || data.favoriteCourts.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(id))) throw new Error('Lista de favoritos inválida.');
      next.favoriteCourts = [...new Set(data.favoriteCourts)];
    }
    if ('lawyers' in data) next.lawyers = lawyers(data.lawyers);
    if ('courtCalendar' in data) next.courtCalendar = courtCalendar(data.courtCalendar);
    if ('workflows' in data) next.workflows = workflows(data.workflows);
    for (const key of ['businessStart', 'businessEnd']) if (key in data) {
      if (!Number.isInteger(data[key]) || data[key] < 0 || data[key] > 23) throw new Error('Horário inválido.');
      next[key] = data[key];
    }
    if (next.businessEnd <= next.businessStart) throw new Error('O fim do expediente deve ser posterior ao início.');
    this.value = next;
    this.persist();
    return this.get();
  }
}
module.exports = { Settings, defaults };
