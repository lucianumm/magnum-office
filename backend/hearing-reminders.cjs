// WhatsApp reminder to the client before a hearing or meeting. The message lives in the normal queue;
// the task keeps its id and a fingerprint, so editing the task reschedules it without duplicates.
const { createHash } = require('node:crypto');
const { personalizeReminder } = require('../app/message-variables.mjs');

const open = ['pending', 'needs_review', 'failed'];
const defaultBody = type =>
  `Olá, {2}! Passando para lembrar da sua ${type === 'Reunião' ? 'reunião' : 'audiência'} em {4}, às {5}. Em caso de dúvida, fale com a equipe do {3}.`;

class HearingReminders {
  constructor({ store, settings, library, messaging, clock = Date.now }) {
    Object.assign(this, { store, settings, library, messaging, clock });
  }
  // What should be scheduled for this task right now: { message, key } or { reason }.
  plan(task) {
    if (!task.clientReminder || task.status === 'Concluída' || !['Audiência', 'Reunião'].includes(task.type))
      return { reason: 'off' };
    const caseItem = task.caseId ? this.store.get('cases', task.caseId) : null;
    const clientId = task.clientId || caseItem?.clientId;
    if (!clientId) return { reason: 'Vincule um cliente ou um processo com cliente para enviar o aviso.' };
    const client = this.store.get('clients', clientId);
    const phone = String(client.phone || '').replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(phone)) return { reason: 'O cliente não tem WhatsApp válido no cadastro.' };
    const [date, time] = task.due.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = task.reminderTime.split(':').map(Number);
    const when = new Date(y, m - 1, d - Number(task.reminderLead), h, min);
    if (when.getTime() <= this.clock() + 60000)
      return { reason: 'O horário do aviso já passou; ele não será enviado.' };
    const model =
      task.reminderTemplateId &&
      this.library.list().find(t => t.id === task.reminderTemplateId && t.kind === 'whatsapp');
    const body = personalizeReminder(model ? model.body : defaultBody(task.type), client, this.settings.get(), task);
    const message = {
      channel: 'whatsapp',
      recipient: phone,
      body,
      scheduledFor: when.toISOString(),
      clientId: client.id,
      caseId: task.caseId || undefined,
    };
    const key = createHash('sha256')
      .update(JSON.stringify([phone, body, message.scheduledFor, time]))
      .digest('hex');
    return { message, key };
  }
  row(id) {
    return id ? this.store.db.prepare('SELECT id,status FROM queue WHERE id=?').get(id) : null;
  }
  remember(task, messageId, key) {
    const { id, createdAt, updatedAt, ...payload } = this.store.get('tasks', task.id);
    void createdAt;
    void updatedAt;
    if (payload.reminderMessageId === messageId && payload.reminderKey === key) return this.store.get('tasks', id);
    return this.store.put('tasks', id, { ...payload, reminderMessageId: messageId, reminderKey: key });
  }
  // review: messages scheduled by agents wait for confirmation in the Messages screen.
  sync(task, { review = false } = {}) {
    const plan = this.plan(task);
    const current = this.row(task.reminderMessageId);
    if (current && task.reminderKey === plan.key && current.status !== 'cancelled')
      return { task, status: 'unchanged' };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      if (current && open.includes(current.status)) this.messaging.change(current.id, 'cancel');
      let saved;
      if (!plan.message) saved = this.remember(task, '', '');
      else {
        const id = this.messaging.enqueue(plan.message);
        if (review) this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
        saved = this.remember(task, id, plan.key);
      }
      this.store.db.exec('COMMIT');
      return {
        task: saved,
        status: plan.message ? (review ? 'needs_review' : 'pending') : 'none',
        reason: plan.reason === 'off' ? '' : plan.reason || '',
      };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  // Called after the task is deleted.
  cancel(task) {
    const current = this.row(task?.reminderMessageId);
    if (current && open.includes(current.status)) this.messaging.change(current.id, 'cancel');
  }
}
module.exports = { HearingReminders, defaultBody };
