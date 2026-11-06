const fs = require('node:fs');
const path = require('node:path');
const build = require('../app/build-config.json');
const version = require('../app/version.cjs');
const { ownDomain, sender } = require('./email-policy.cjs');
const defaults = { weeklyBackupEnabled:true,dailyBackupNotice:true,backupMode:'local',backupRecipient:'',termsAcceptedVersion:'',termsAcceptedAt:null, emailDesign:require('./email-design.cjs').defaults, version, officeName: 'Meu escritório', userName: 'Administrador', appName: '', brandLogo: '', appDescription:'SEU ESCRITÓRIO, CONECTADO.', notificationLeadMinutes:60, theme: 'teal', appearance: 'light', density: 'comfortable', queuePaused: false, whatsappAutoConnect: true, scheduleGraceMinutes: 60, ownDomain: '', emailDNSConfirmed: false, favoriteCourts: [], repository: build.repository, channel: 'stable', automatic: false, checkFrequency: 'startup', autoDownload: false, installOutsideHours: false, businessStart: 8, businessEnd: 18, background: true, notifications: true, lastCheck: null, lastUpdate: null, blockedVersions: [], emailFrom: '' };
class Settings {
  constructor(root) {
    this.file = path.join(root, 'config.json');
    this.value = { ...defaults, ...(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {}), repository:build.repository, version };
    this.persist();
  }
  get() { return { ...this.value }; }
  persist() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  internal(data) { this.value = { ...this.value, ...data }; this.persist(); }
  save(data) {
    const next = { ...this.value };
    if('emailDesign' in data)next.emailDesign=require('./email-design.cjs').normalize(data.emailDesign,this.get());
    for (const key of ['officeName', 'userName', 'appName', 'appDescription', 'theme', 'appearance', 'density', 'ownDomain', 'repository', 'channel', 'checkFrequency', 'emailFrom']) if (key in data) {
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
    for (const key of ['automatic', 'autoDownload', 'installOutsideHours', 'background', 'notifications', 'queuePaused', 'whatsappAutoConnect', 'emailDNSConfirmed']) if (key in data) {
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
