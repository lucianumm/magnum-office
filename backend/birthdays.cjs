const { createHash } = require('node:crypto');
const { personalizeMessage } = require('../app/message-variables.mjs');
const terms = require('../app/terms.json');
const keyFor = (id, year) =>
  createHash('sha256')
    .update(id + ':' + year)
    .digest('hex');
const dayKey = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function occurrence(client, year) {
  const month = Number(client.birthDate.slice(5, 7)) - 1;
  const day = Math.min(Number(client.birthDate.slice(8, 10)), new Date(year, month + 1, 0).getDate());
  const [h, m] = (client.birthdayTime || '09:00').split(':').map(Number);
  return new Date(year, month, day, h, m);
}
class Birthdays {
  constructor({ store, settings, library, messaging, clock = Date.now }) {
    Object.assign(this, { store, settings, library, messaging, clock });
    this.lastCheck = 0;
    this.seed();
  }
  seed() {
    if (this.settings.get().birthdayModelSeeded) return;
    let model = this.library.list().find(t => t.kind === 'whatsapp' && t.purpose === 'birthday');
    if (!model) {
      const group =
        this.library.groups().find(g => g.name === 'Mensagem aniversário') ||
        this.library.saveGroup({ name: 'Mensagem aniversário' });
      model = this.library.save({
        kind: 'whatsapp',
        purpose: 'birthday',
        title: 'Mensagem aniversário',
        groupId: group.id,
        body: 'Olá, {2}! 🎉\n\nFeliz aniversário! Desejamos um novo ciclo com muita saúde, alegria e realizações.\n\nUm abraço de toda a equipe do {3}!',
      });
    }
    this.settings.internal({ birthdayModelSeeded: true });
  }
  cancel(row, reason) {
    this.store.db
      .prepare("UPDATE queue SET status='cancelled',last_error=?,updated_at=? WHERE id=? AND status='pending'")
      .run(reason, new Date(this.clock()).toISOString(), row.id);
  }
  tick(force = false) {
    const now = this.clock();
    if (
      (!force && now - this.lastCheck < 60000) ||
      this.messaging.operations.maintenance ||
      this.settings.get().termsAcceptedVersion !== terms.version
    )
      return;
    this.lastCheck = now;
    const today = new Date(now),
      todayKey = dayKey(today);
    const clients = new Map(this.store.list('clients').map(c => [c.id, c]));
    const models = new Map(this.library.list().map(m => [m.id, m]));
    for (const row of this.store.db.prepare("SELECT id,payload FROM queue WHERE status='pending'").all()) {
      const data = this.store.vault.unseal(row.payload);
      if (!data.autoBirthday) continue;
      const client = clients.get(data.clientId);
      if (data.birthdayDate < todayKey) this.cancel(row, 'BIRTHDAY_EXPIRED');
      else if (!client?.birthdayEnabled || client.status !== 'Ativo') this.cancel(row, 'BIRTHDAY_DISABLED');
      else if (
        !models.has(client.birthdayTemplateId) ||
        dayKey(occurrence(client, data.birthdayYear)) !== data.birthdayDate
      )
        this.cancel(row, 'BIRTHDAY_CONFIG');
    }
    for (const client of clients.values()) {
      try {
        if (!client.birthdayEnabled || !client.birthDate || client.status !== 'Ativo') continue;
        const model = models.get(client.birthdayTemplateId);
        if (!model || model.kind !== 'whatsapp' || model.purpose !== 'birthday') continue;
        let year = today.getFullYear();
        if (dayKey(occurrence(client, year)) < todayKey) year++;
        for (let attempt = 0; attempt < 2; attempt++, year++) {
          const date = occurrence(client, year),
            dateKey = dayKey(date),
            key = keyFor(client.id, year);
          const prior = this.store.db
            .prepare(
              'SELECT q.* FROM birthday_dispatches b LEFT JOIN queue q ON q.id=b.message_id WHERE b.dispatch_key=?',
            )
            .get(key);
          if (
            prior &&
            (!prior.id ||
              !['pending', 'cancelled'].includes(prior.status) ||
              prior.attempts > 0 ||
              (prior.status === 'cancelled' && !['BIRTHDAY_DISABLED', 'BIRTHDAY_CONFIG'].includes(prior.last_error)))
          )
            continue;
          const when = date.getTime() <= now ? new Date(now + 15000) : date;
          const message = {
            channel: 'whatsapp',
            recipient: client.phone,
            clientId: client.id,
            body: personalizeMessage(model.body, client, this.settings.get()),
            scheduledFor: when.toISOString(),
          };
          const meta = { autoBirthday: true, birthdayYear: year, birthdayDate: dateKey, birthdayTemplateId: model.id };
          if (prior?.id) {
            const old = this.store.vault.unseal(prior.payload);
            const scheduled = prior.scheduled_for && Date.parse(prior.scheduled_for);
            if (
              prior.status === 'pending' &&
              scheduled <= now &&
              date.getTime() <= now &&
              old.birthdayDate === todayKey
            ) {
              const payload = { ...old, ...meta, body: message.body, recipient: message.recipient };
              this.store.db
                .prepare('UPDATE queue SET payload=? WHERE id=?')
                .run(this.store.vault.seal(payload), prior.id);
              break;
            }
            const payload = { ...this.messaging.validate(message).payload, ...meta };
            this.store.db
              .prepare(
                "UPDATE queue SET payload=?,status='pending',available_at=?,scheduled_for=?,last_error=NULL,updated_at=? WHERE id=?",
              )
              .run(
                this.store.vault.seal(payload),
                message.scheduledFor,
                message.scheduledFor,
                new Date(now).toISOString(),
                prior.id,
              );
            break;
          }
          this.store.db.exec('BEGIN IMMEDIATE');
          try {
            const id = this.messaging.enqueue(message, meta);
            this.store.db.prepare('INSERT INTO birthday_dispatches(dispatch_key,message_id) VALUES(?,?)').run(key, id);
            this.store.db.exec('COMMIT');
          } catch (e) {
            this.store.db.exec('ROLLBACK');
            throw e;
          }
          break;
        }
      } catch {
        this.store.audit('birthday.schedule.failed', { id: client.id, code: 'BIRTHDAY_CONFIG' });
      }
    }
  }
  prepare(data) {
    if (!data.autoBirthday) return data;
    const today = new Date(this.clock());
    if (data.birthdayDate !== dayKey(today)) return null;
    let client;
    try {
      client = this.store.get('clients', data.clientId);
    } catch {
      return null;
    }
    if (
      !client.birthdayEnabled ||
      client.status !== 'Ativo' ||
      !client.birthDate ||
      dayKey(occurrence(client, today.getFullYear())) !== data.birthdayDate
    )
      return null;
    const model = this.library
      .list()
      .find(t => t.id === client.birthdayTemplateId && t.kind === 'whatsapp' && t.purpose === 'birthday');
    if (!model || occurrence(client, today.getFullYear()).getTime() > this.clock()) return null;
    const body = personalizeMessage(model.body, client, this.settings.get());
    if (!body || body.length > 30000) return null;
    return { ...data, recipient: client.phone, body, birthdayTemplateId: model.id };
  }
}
module.exports = { Birthdays, keyFor, occurrence, dayKey };
