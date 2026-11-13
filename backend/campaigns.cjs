// WhatsApp campaigns: a message, a trigger (date, repetition, event, client or system event) and an audience.
// The engine looks 30 days ahead and queues one message per client and date. Everything goes through the normal
// queue, so the sending rules (window, caps, pauses) apply, and nothing is queued twice for the same client and date.
const { createHash, randomUUID } = require('node:crypto');
const rules = require('../app/campaign-rules.mjs');
const { renderMessage, messageContext, unknownVariables } = require('../app/message-vars.mjs');
const { whatsappNumber } = require('./phone.cjs');
const terms = require('../app/terms.json');

const HORIZON_DAYS = 30;
const LATE_MS = 2 * 3600000; // an occurrence missed by more than this is skipped, not sent late
const FOOTER = '\n\nPara não receber mais mensagens como esta, responda SAIR.';
const pad = n => String(n).padStart(2, '0');
const dayKey = rules.dayKey;
const hash = parts => createHash('sha256').update(parts.join('|')).digest('hex');
const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const validDay = k => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(k + 'T12:00:00Z'));

class Campaigns {
  constructor({ store, settings, library, messaging, clock = Date.now }) {
    Object.assign(this, { store, settings, library, messaging, clock });
    this.lastTick = 0;
  }
  // ---- records ----
  rows() {
    return this.store.db.prepare('SELECT * FROM campaigns ORDER BY created_at').all();
  }
  read(row) {
    return { ...this.store.vault.unseal(row.payload), id: row.id, status: row.status, createdAt: row.created_at };
  }
  list() {
    const sent = this.store.db
      .prepare(
        "SELECT s.campaign_id id, COUNT(*) n FROM campaign_sends s JOIN queue q ON q.id=s.message_id WHERE q.status='sent' GROUP BY s.campaign_id",
      )
      .all();
    const planned = this.store.db
      .prepare(
        "SELECT s.campaign_id id, COUNT(*) n FROM campaign_sends s JOIN queue q ON q.id=s.message_id WHERE q.status IN ('pending','needs_review') GROUP BY s.campaign_id",
      )
      .all();
    return this.rows().map(row => {
      const campaign = this.read(row);
      return {
        ...campaign,
        sentCount: sent.find(s => s.id === row.id)?.n || 0,
        plannedCount: planned.find(s => s.id === row.id)?.n || 0,
      };
    });
  }
  get(id) {
    const row = this.store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(String(id));
    if (!row) throw new Error('Campanha não encontrada.');
    return this.read(row);
  }
  validate(input) {
    const name = String(input.name || '').trim();
    if (!name || name.length > 120) throw new Error('Dê um nome à campanha (até 120 caracteres).');
    const templateId = String(input.templateId || '');
    let body = String(input.body || '').trim();
    if (templateId) {
      const model = this.library.list().find(t => t.id === templateId && t.kind === 'whatsapp');
      if (!model) throw new Error('Modelo de mensagem não encontrado.');
    } else if (!body) throw new Error('Escreva a mensagem ou escolha um modelo.');
    if (body.length > 4000) throw new Error('A mensagem deve ter até 4.000 caracteres.');
    if (!templateId) {
      const unknown = unknownVariables(body);
      if (unknown.length) throw new Error(`Variável desconhecida: ${unknown.join(', ')}.`);
    } else body = '';
    const t = input.trigger || {};
    if (!rules.triggerTypes[t.type]) throw new Error('Escolha quando a mensagem será enviada.');
    const trigger = { type: t.type, time: t.time || '09:00' };
    if (!validTime(trigger.time)) throw new Error('Horário inválido.');
    if (t.type === 'yearly') {
      trigger.month = Number(t.month);
      trigger.day = Number(t.day);
      if (!(trigger.month >= 1 && trigger.month <= 12 && trigger.day >= 1 && trigger.day <= 31))
        throw new Error('Informe o dia e o mês da data.');
    } else if (t.type === 'calendar') {
      if (!rules.calendarDates[t.key]) throw new Error('Escolha a data comemorativa.');
      trigger.key = t.key;
    } else if (t.type === 'dates') {
      const dates = [...new Set((t.dates || []).map(String))];
      if (!dates.length || dates.length > 60 || dates.some(d => !validDay(d)))
        throw new Error('Informe de 1 a 60 datas válidas.');
      trigger.dates = dates.sort();
    } else if (t.type === 'recurring') {
      if (!rules.recurrenceKinds[t.every]) throw new Error('Escolha a frequência.');
      if (!validDay(String(t.start))) throw new Error('Informe a data da primeira mensagem.');
      trigger.every = t.every;
      trigger.start = t.start;
      trigger.until = t.until ? String(t.until) : '';
      if (trigger.until && !validDay(trigger.until)) throw new Error('Data final inválida.');
      if (trigger.until && trigger.until < trigger.start)
        throw new Error('A data final vem antes da primeira mensagem.');
      trigger.count = t.count ? Number(t.count) : 0;
      if (!trigger.until && !trigger.count)
        throw new Error('Informe até quando repetir (data final ou número de envios).');
      if (trigger.count && !(trigger.count >= 1 && trigger.count <= 500)) throw new Error('Use de 1 a 500 envios.');
    } else if (t.type === 'before-event') {
      if (!['Audiência', 'Perícia', 'Reunião', 'Diligência', 'Prazo'].includes(t.eventType))
        throw new Error('Escolha o tipo de compromisso.');
      trigger.eventType = t.eventType;
      trigger.days = Number(t.days);
      if (!Number.isInteger(trigger.days) || trigger.days < -60 || trigger.days > 60)
        throw new Error('Use de 60 dias antes a 60 dias depois.');
    } else if (['case-created', 'case-closed'].includes(t.type)) {
      trigger.delayDays = Number(t.delayDays || 0);
      if (!Number.isInteger(trigger.delayDays) || trigger.delayDays < 0 || trigger.delayDays > 30)
        throw new Error('Use de 0 a 30 dias de espera.');
    } else if (t.type === 'finance-overdue') {
      trigger.afterDays = Number(t.afterDays || 3);
      trigger.max = Number(t.max || 2);
      if (!(trigger.afterDays >= 1 && trigger.afterDays <= 60))
        throw new Error('Use de 1 a 60 dias após o vencimento.');
      if (!(trigger.max >= 1 && trigger.max <= 2)) throw new Error('A cobrança gentil tem no máximo 2 avisos.');
    }
    const s = input.segment || { mode: 'all' };
    if (!['all', 'area', 'tag', 'phase', 'cases', 'clients'].includes(s.mode)) throw new Error('Público inválido.');
    const values = (s.values || []).map(v => String(v).trim()).filter(Boolean);
    if (s.mode !== 'all' && !values.length) throw new Error('Escolha quem vai receber.');
    return {
      name,
      body,
      templateId,
      trigger,
      segment: { mode: s.mode, values: s.mode === 'all' ? [] : values.slice(0, 500) },
      review: input.review === true,
      optOutFooter: input.optOutFooter !== false,
    };
  }
  save(input) {
    const payload = this.validate(input);
    const id = input.id ? String(input.id) : randomUUID();
    const now = new Date(this.clock()).toISOString();
    const existing = input.id ? this.store.db.prepare('SELECT status FROM campaigns WHERE id=?').get(id) : null;
    if (input.id && !existing) throw new Error('Campanha não encontrada.');
    // A new or edited campaign starts as a draft: nothing is queued until it is activated.
    this.store.db
      .prepare(
        'INSERT INTO campaigns(id,payload,status,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
      )
      .run(id, this.store.vault.seal(payload), existing?.status || 'draft', now, now);
    this.store.audit('campaign.saved', { id });
    if (existing?.status === 'active') this.tick(true);
    return this.get(id);
  }
  setStatus(id, status) {
    if (!['active', 'paused', 'draft'].includes(status)) throw new Error('Situação inválida.');
    this.get(id);
    this.store.db
      .prepare('UPDATE campaigns SET status=?,updated_at=? WHERE id=?')
      .run(status, new Date(this.clock()).toISOString(), id);
    if (status !== 'active') this.dropPending(id, 'CAMPAIGN_PAUSED');
    this.store.audit('campaign.status', { id, status });
    if (status === 'active') this.tick(true);
    return this.get(id);
  }
  remove(id) {
    this.get(id);
    this.dropPending(id, 'CAMPAIGN_REMOVED');
    this.store.db.prepare('DELETE FROM campaigns WHERE id=?').run(id);
    this.store.audit('campaign.removed', { id });
    return true;
  }
  // Cancels what is still waiting and forgets those dates, so a later activation plans them again.
  dropPending(id, reason) {
    const rows = this.store.db
      .prepare(
        'SELECT s.dispatch_key key, s.message_id mid, q.status FROM campaign_sends s LEFT JOIN queue q ON q.id=s.message_id WHERE s.campaign_id=?',
      )
      .all(id);
    for (const r of rows) {
      if (r.status === 'pending' || r.status === 'needs_review') {
        this.store.db
          .prepare("UPDATE queue SET status='cancelled',last_error=?,updated_at=? WHERE id=?")
          .run(reason, new Date(this.clock()).toISOString(), r.mid);
        this.store.db.prepare('DELETE FROM campaign_sends WHERE dispatch_key=?').run(r.key);
      }
    }
  }
  // ---- audience and plan ----
  reach(client) {
    if (client.campaignOptOut) return 'optout';
    try {
      whatsappNumber(client.phone);
    } catch {
      return 'phone';
    }
    return '';
  }
  audience(campaign) {
    const cases = this.store.list('cases');
    const members = this.store.list('clients').filter(c => rules.inSegment(c, cases, campaign.segment));
    const count = { total: members.length, optedOut: 0, noPhone: 0 };
    const reachable = [];
    for (const client of members) {
      const why = this.reach(client);
      if (why === 'optout') count.optedOut++;
      else if (why === 'phone') count.noPhone++;
      else reachable.push(client);
    }
    return { ...count, reachable: reachable.length, clients: reachable };
  }
  bodyOf(campaign) {
    if (campaign.templateId) {
      const model = this.library.list().find(t => t.id === campaign.templateId && t.kind === 'whatsapp');
      return model?.body || '';
    }
    return campaign.body;
  }
  render(campaign, client, extra = {}) {
    const settings = this.settings.get();
    const context = messageContext({ client, settings, lawyer: (settings.lawyers || [])[0]?.name || '', ...extra });
    let text = renderMessage(this.bodyOf(campaign), context);
    if (campaign.optOutFooter && settings.waInboxEnabled === true) text += FOOTER;
    return text;
  }
  // Every message this campaign should have queued between from and to: [{ key, client, at, body }].
  plan(campaign, from, to) {
    const t = campaign.trigger;
    const { clients } = this.audience(campaign);
    const items = [];
    const add = (client, at, ref, extra) =>
      items.push({
        key: hash([campaign.id, client.id, ...ref]),
        client,
        at,
        body: this.render(campaign, client, extra),
      });
    const dateKeys = d => dayKey(d);
    if (rules.dateTriggers.includes(t.type)) {
      for (const at of rules.occurrences(t, from, to)) for (const c of clients) add(c, at, [dateKeys(at)]);
    } else if (t.type === 'client-birthday' || t.type === 'client-since') {
      for (const c of clients) for (const at of rules.clientOccurrences(t, c, from, to)) add(c, at, [dateKeys(at)]);
    } else if (t.type === 'before-event') {
      const byId = new Map(clients.map(c => [c.id, c]));
      for (const task of this.store.list('tasks')) {
        if (task.type !== t.eventType || task.status === 'Concluída') continue;
        const caseItem = task.caseId ? this.store.list('cases').find(c => c.id === task.caseId) : null;
        const client = byId.get(task.clientId || caseItem?.clientId);
        if (!client) continue;
        const [y, m, d] = task.due.slice(0, 10).split('-').map(Number);
        const at = rules.at(y, m - 1, d - t.days, t.time);
        if (at >= from && at <= to) add(client, at, [task.id], { task, caseItem });
      }
    } else if (t.type === 'case-created' || t.type === 'case-closed') {
      const byId = new Map(clients.map(c => [c.id, c]));
      for (const caseItem of this.store.list('cases')) {
        const client = byId.get(caseItem.clientId);
        if (!client) continue;
        const base =
          t.type === 'case-created' ? caseItem.createdAt : caseItem.status === 'Concluído' ? caseItem.updatedAt : '';
        if (!base) continue;
        const [y, m, d] = new Date(base).toISOString().slice(0, 10).split('-').map(Number);
        const at = rules.at(y, m - 1, d + t.delayDays, t.time);
        if (at >= from && at <= to) add(client, at, [caseItem.id, t.type], { caseItem });
      }
    } else if (t.type === 'finance-overdue') {
      const byId = new Map(clients.map(c => [c.id, c]));
      for (const entry of this.store.list('finance')) {
        if (entry.direction !== 'Receita' || entry.paidDate || !entry.dueDate || !entry.clientId) continue;
        const client = byId.get(entry.clientId);
        if (!client) continue;
        const [y, m, d] = entry.dueDate.split('-').map(Number);
        for (let k = 0; k < t.max; k++) {
          const at = rules.at(y, m - 1, d + t.afterDays + 7 * k, t.time);
          if (at >= from && at <= to) add(client, at, [entry.id, String(k)], { entry });
        }
      }
    }
    return items;
  }
  // ---- queueing ----
  tick(force = false) {
    const now = this.clock();
    if (
      (!force && now - this.lastTick < 60000) ||
      this.messaging.operations?.maintenance ||
      this.settings.get().termsAcceptedVersion !== terms.version
    )
      return;
    this.lastTick = now;
    for (const row of this.rows()) {
      if (row.status !== 'active') continue;
      try {
        this.reconcile(this.read(row), now);
      } catch {
        this.store.audit('campaign.plan.failed', { id: row.id, code: 'CAMPAIGN_CONFIG' });
      }
    }
  }
  reconcile(campaign, now) {
    const from = new Date(now - LATE_MS);
    const to = new Date(now + HORIZON_DAYS * 86400000);
    const wanted = new Map(this.plan(campaign, from, to).map(i => [i.key, i]));
    const known = new Map(
      this.store.db
        .prepare(
          'SELECT s.dispatch_key key, s.message_id mid, s.planned_for planned, q.status, q.payload FROM campaign_sends s LEFT JOIN queue q ON q.id=s.message_id WHERE s.campaign_id=?',
        )
        .all(campaign.id)
        .map(r => [r.key, r]),
    );
    const meta = { campaignId: campaign.id, campaignName: campaign.name };
    for (const item of wanted.values()) {
      const old = known.get(item.key);
      // A slot that ran today a little late goes out in a few seconds; one missed by hours is skipped.
      const when = new Date(Math.max(item.at.getTime(), now + 15000));
      if (!old) {
        this.store.db.exec('BEGIN IMMEDIATE');
        try {
          const id = this.messaging.enqueue(
            {
              channel: 'whatsapp',
              recipient: item.client.phone,
              body: item.body,
              clientId: item.client.id,
              scheduledFor: when.toISOString(),
            },
            { ...meta, campaignKey: item.key },
          );
          if (campaign.review) this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
          this.store.db
            .prepare(
              'INSERT INTO campaign_sends(dispatch_key,campaign_id,client_id,message_id,planned_for) VALUES(?,?,?,?,?)',
            )
            .run(item.key, campaign.id, item.client.id, id, when.toISOString());
          this.store.db.exec('COMMIT');
        } catch (error) {
          this.store.db.exec('ROLLBACK');
          throw error;
        }
      } else if (old.status === 'pending') {
        // The text or the time changed since it was queued: update it instead of sending the old one.
        const payload = this.store.vault.unseal(old.payload);
        const moved = Math.abs(Date.parse(old.planned) - when.getTime()) > 60000 && Date.parse(old.planned) > now;
        if (payload.body !== item.body || moved) {
          const next = { ...payload, body: item.body, recipient: item.client.phone };
          const target = moved ? when.toISOString() : old.planned;
          this.store.db
            .prepare('UPDATE queue SET payload=?,scheduled_for=?,available_at=?,updated_at=? WHERE id=?')
            .run(this.store.vault.seal(next), target, target, new Date(now).toISOString(), old.mid);
          this.store.db.prepare('UPDATE campaign_sends SET planned_for=? WHERE dispatch_key=?').run(target, item.key);
        }
      }
    }
    // Waiting messages whose reason is gone (the event moved, the client left the audience...).
    for (const [key, old] of known) {
      if (wanted.has(key) || old.status !== 'pending' || Date.parse(old.planned) <= now) continue;
      this.store.db
        .prepare("UPDATE queue SET status='cancelled',last_error='CAMPAIGN_CHANGED',updated_at=? WHERE id=?")
        .run(new Date(now).toISOString(), old.mid);
      this.store.db.prepare('DELETE FROM campaign_sends WHERE dispatch_key=?').run(key);
    }
  }
  // Checked again just before a campaign message goes out. null cancels it.
  prepare(data) {
    if (!data.campaignId) return data;
    let campaign;
    try {
      campaign = this.get(data.campaignId);
    } catch {
      return null;
    }
    const row = this.store.db.prepare('SELECT status FROM campaigns WHERE id=?').get(data.campaignId);
    if (row?.status !== 'active') return null;
    let client;
    try {
      client = this.store.get('clients', data.clientId);
    } catch {
      return null;
    }
    if (client.campaignOptOut || client.status !== 'Ativo') return null;
    return campaign ? data : null;
  }
  // What the screen shows before activating: who gets it, the next messages and a filled-in sample.
  preview(input) {
    const campaign = { id: input.id || 'preview', ...this.validate(input) };
    const audience = this.audience(campaign);
    const now = this.clock();
    const next = this.plan(campaign, new Date(now), new Date(now + 90 * 86400000))
      .sort((a, b) => a.at - b.at)
      .slice(0, 10)
      .map(i => ({ at: i.at.toISOString(), client: i.client.name, body: i.body }));
    const sample = audience.clients[0] ? this.render(campaign, audience.clients[0]) : '';
    return {
      total: audience.total,
      reachable: audience.reachable,
      optedOut: audience.optedOut,
      noPhone: audience.noPhone,
      next,
      sample,
      sampleClient: audience.clients[0]?.name || '',
    };
  }
  // A single copy to the office's own number, to see how it looks before activating.
  sendSample(input, phone) {
    const campaign = { id: 'sample', ...this.validate(input) };
    const number = whatsappNumber(phone);
    const client = this.audience(campaign).clients[0] || { name: 'Cliente Exemplo' };
    const body = '[AMOSTRA]\n' + this.render(campaign, client);
    return this.messaging.enqueue({ channel: 'whatsapp', recipient: number, body });
  }
  // What goes out in the next days, by day (to pause a campaign or cancel a single message).
  calendar(days = HORIZON_DAYS) {
    const until = new Date(this.clock() + days * 86400000).toISOString();
    return this.messaging
      .list()
      .filter(m => m.campaignId && ['pending', 'needs_review'].includes(m.status) && (m.scheduledFor || '') <= until)
      .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)))
      .map(m => ({
        id: m.id,
        campaignId: m.campaignId,
        campaignName: m.campaignName,
        at: m.scheduledFor,
        recipient: m.recipient,
        clientId: m.clientId,
        status: m.status,
        body: m.body,
      }));
  }
  // ---- opt-out ----
  optOut(clientId, value = true) {
    const { id, createdAt, updatedAt, ...payload } = this.store.get('clients', clientId);
    void createdAt;
    void updatedAt;
    this.store.put('clients', id, {
      ...payload,
      campaignOptOut: value,
      campaignOptOutAt: value ? new Date(this.clock()).toISOString() : '',
    });
    if (value) {
      for (const m of this.messaging.list())
        if (m.campaignId && m.clientId === id && ['pending', 'needs_review'].includes(m.status))
          this.messaging.change(m.id, 'cancel');
    }
    this.store.audit(value ? 'campaign.opt-out' : 'campaign.opt-in', { id });
  }
  // A reply such as SAIR from a client: stop campaigns and say so once.
  handleReply(record) {
    if (!record?.clientId || !rules.isStopReply(record.text)) return false;
    const client = this.store.get('clients', record.clientId);
    if (client.campaignOptOut) return true;
    this.optOut(client.id, true);
    try {
      this.messaging.enqueue({
        channel: 'whatsapp',
        recipient: client.phone,
        clientId: client.id,
        body: 'Combinado, você não receberá mais mensagens de campanhas. Os avisos sobre o seu processo continuam normalmente.',
      });
    } catch {
      /* the opt-out already took effect */
    }
    return true;
  }
}
module.exports = { Campaigns, FOOTER, HORIZON_DAYS, pad };
