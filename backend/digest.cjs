// Morning summary for the lawyer: deadlines and hearings of the day, overdue items, new intimations
// and overdue fees, sent once a day to the office's own WhatsApp or e-mail through the normal queue.
// Off by default. The text has no client data beyond task titles, which the lawyer wrote.
const { entryStatus, cents } = require('../app/finance.mjs');

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const brl = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/gu, ' ');
const hour = due => String(due || '').slice(11, 16);

function digestText({ tasks = [], finance = [], intimations = [], officeName = '', now = new Date() }) {
  const today = dayKey(now);
  const week = dayKey(new Date(now.getTime() + 7 * 86400000));
  const open = tasks.filter(t => t.status !== 'Concluída');
  const ofToday = open.filter(t => String(t.due).slice(0, 10) === today).sort((a, b) => a.due.localeCompare(b.due));
  const overdue = open.filter(t => String(t.due).slice(0, 10) < today);
  const nextWeek = open.filter(t => String(t.due).slice(0, 10) > today && String(t.due).slice(0, 10) <= week);
  const newIntimations = intimations.filter(i => i.status === 'new');
  const late = finance.filter(e => e.direction === 'Receita' && entryStatus(e, today) === 'overdue');
  const lines = [
    `Bom dia! Resumo de ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}${officeName ? ` — ${officeName}` : ''}`,
    '',
  ];
  if (ofToday.length) {
    lines.push(`Hoje (${ofToday.length}):`);
    for (const t of ofToday.slice(0, 15)) lines.push(`• ${hour(t.due)} ${t.type ? t.type + ': ' : ''}${t.title}`);
    if (ofToday.length > 15) lines.push(`• e mais ${ofToday.length - 15}`);
  } else lines.push('Nenhum prazo ou compromisso para hoje.');
  if (overdue.length) lines.push('', `Atrasados: ${overdue.length} (confira na Agenda).`);
  if (nextWeek.length) lines.push(`Próximos 7 dias: ${nextWeek.length}.`);
  if (newIntimations.length) lines.push(`Intimações novas: ${newIntimations.length}.`);
  if (late.length)
    lines.push(`Honorários atrasados: ${late.length}, somando ${brl(late.reduce((n, e) => n + cents(e.amount), 0))}.`);
  lines.push('', 'Enviado pelo Magnum Office. Para desligar: Configurações → Escritório → Resumo diário.');
  return lines.join('\n');
}

class Digest {
  constructor({ store, settings, messaging, djen = null, clock = () => new Date() }) {
    Object.assign(this, { store, settings, messaging, djen, clock });
  }
  config() {
    const s = this.settings.get();
    return {
      enabled: Boolean(s.digestEnabled),
      channel: s.digestChannel || 'whatsapp',
      recipient: s.digestRecipient || '',
      time: s.digestTime || '08:00',
      lastDate: s.lastDigestDate || '',
    };
  }
  configure(input = {}) {
    const channel = input.channel === 'email' ? 'email' : 'whatsapp';
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '') ? input.time : '08:00';
    const recipient = String(input.recipient || '')
      .trim()
      .slice(0, 254);
    if (input.enabled) this.messaging.validate({ channel, recipient, subject: 'Resumo', body: 'teste' });
    this.settings.internal({
      digestEnabled: Boolean(input.enabled),
      digestChannel: channel,
      digestRecipient: recipient,
      digestTime: time,
    });
    return this.config();
  }
  text(now = this.clock()) {
    return digestText({
      tasks: this.store.list('tasks'),
      finance: this.store.list('finance'),
      intimations: this.djen ? this.djen.list() : [],
      officeName: this.settings.get().officeName,
      now,
    });
  }
  // Called every minute; sends at most once a day, at or after the chosen time.
  tick(now = this.clock()) {
    const cfg = this.config();
    if (!cfg.enabled || !cfg.recipient) return false;
    const today = dayKey(now);
    if (cfg.lastDate === today || `${pad(now.getHours())}:${pad(now.getMinutes())}` < cfg.time) return false;
    this.settings.internal({ lastDigestDate: today });
    this.messaging.enqueue({
      channel: cfg.channel,
      recipient: cfg.recipient,
      subject: `Resumo do dia — ${now.toLocaleDateString('pt-BR')}`,
      body: this.text(now),
    });
    this.store.audit('digest.queued', { channel: cfg.channel });
    return true;
  }
}

module.exports = { Digest, digestText };
