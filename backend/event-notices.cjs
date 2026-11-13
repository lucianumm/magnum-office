// WhatsApp notices to the client about an event on the agenda (hearing, expert exam, meeting, errand):
// a confirmation right away, reminders before it, and a notice when it is rescheduled or cancelled.
// Everything goes through the normal queue, so the sending rules (window, caps, pauses) apply. The task keeps
// the ids of the queued messages ("7d:<id>,conf:<id>"), so editing the event replaces the old ones without duplicates.
const { renderMessage, messageContext } = require('../app/message-vars.mjs');
const { defaultBodies, reminderOffsets, defaultOffsets, eventTypes } = require('../app/message-defaults.mjs');

const open = ['pending', 'needs_review', 'failed'];
const pad = n => String(n).padStart(2, '0');
const localIso = d => d.toISOString();

class EventNotices {
  constructor({ store, settings, library, messaging, clock = Date.now }) {
    Object.assign(this, { store, settings, library, messaging, clock });
  }
  // Runs fn inside a transaction, or inside the caller's when there is one already.
  tx(fn) {
    if (this.store.db.isTransaction) return fn();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.store.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  ids(task) {
    const map = {};
    for (const part of String(task.noticeMessageIds || '').split(',')) {
      const [key, id] = part.split(':');
      if (key && id) map[key] = id;
    }
    return map;
  }
  row(id) {
    return id ? this.store.db.prepare('SELECT id,status FROM queue WHERE id=?').get(id) : null;
  }
  status(id) {
    return this.row(id)?.status || '';
  }
  // Who gets the notice, or why nobody can.
  audience(task) {
    if (!eventTypes.includes(task.type))
      return { reason: 'Só audiência, perícia, reunião e diligência têm aviso ao cliente.' };
    const caseItem = task.caseId ? this.store.get('cases', task.caseId) : null;
    const clientId = task.clientId || caseItem?.clientId;
    if (!clientId) return { reason: 'Vincule um cliente ou um processo com cliente para enviar o aviso.' };
    const client = this.store.get('clients', clientId);
    const phone = String(client.phone || '').replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(phone))
      return { reason: 'O cliente não tem WhatsApp válido no cadastro.', client, caseItem };
    return { client, caseItem, phone };
  }
  template(purpose) {
    return this.library.list().find(t => t.kind === 'whatsapp' && t.purpose === purpose) || null;
  }
  render(task, purpose, audience) {
    const settings = this.settings.get();
    const model = this.template(purpose);
    const context = messageContext({
      client: audience.client,
      settings,
      task,
      caseItem: audience.caseItem,
      lawyer: (settings.lawyers || [])[0]?.name || '',
    });
    return renderMessage(model ? model.body : defaultBodies[purpose], context);
  }
  // When a reminder goes out: "7d" at the reminder hour of that day, "2h" counting back from the event.
  when(task, key) {
    const rule = reminderOffsets[key];
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(task.due || ''));
    if (!rule || !m) return null;
    const [y, mo, d, h, min] = m.slice(1).map(Number);
    if (rule.days) {
      const [rh, rmin] = String(task.reminderTime || '09:00')
        .split(':')
        .map(Number);
      return new Date(y, mo - 1, d - rule.days, rh, rmin);
    }
    return new Date(y, mo - 1, d, h - rule.hours, min);
  }
  future(date) {
    return !!date && date.getTime() > this.clock() + 60000;
  }
  // What the confirmation window shows: texts already filled in, with the times, ready to edit.
  preview(taskId) {
    const task = this.store.get('tasks', taskId);
    const audience = this.audience(task);
    const ids = this.ids(task);
    const base = {
      taskId,
      title: task.title,
      type: task.type,
      due: task.due,
      confirmationStatus: task.confirmationStatus || '',
      offsetLabels: Object.fromEntries(Object.entries(reminderOffsets).map(([k, v]) => [k, v.label])),
    };
    if (!audience.phone) return { ...base, eligible: false, reason: audience.reason };
    if (new Date(task.due).getTime() < this.clock())
      return { ...base, eligible: false, reason: 'O compromisso já passou.' };
    const chosen = task.noticeOffsets ? task.noticeOffsets.split(',') : defaultOffsets;
    const confirmationSent = this.status(ids.conf) === 'sent';
    return {
      ...base,
      eligible: true,
      client: { id: audience.client.id, name: audience.client.name, phone: audience.phone },
      confirmationSent,
      confirmationBody: this.render(task, 'event-confirmation', audience),
      reminderBody: this.render(task, 'event-reminder', audience),
      reminders: Object.keys(reminderOffsets).map(key => {
        const at = this.when(task, key);
        return {
          key,
          label: reminderOffsets[key].label,
          scheduledFor: at ? localIso(at) : '',
          past: !this.future(at),
          selected: chosen.includes(key) && this.future(at),
        };
      }),
    };
  }
  cancelOpen(ids, keys = Object.keys(ids)) {
    for (const key of keys) {
      const row = this.row(ids[key]);
      if (row && open.includes(row.status)) this.messaging.change(row.id, 'cancel');
    }
  }
  save(task, patch) {
    const { id, createdAt, updatedAt, ...payload } = this.store.get('tasks', task.id);
    void createdAt;
    void updatedAt;
    return this.store.put('tasks', id, { ...payload, ...patch });
  }
  // Queues what the user chose in the confirmation window. review=true leaves everything waiting for approval.
  apply(taskId, choice = {}, { review = false } = {}) {
    const task = this.store.get('tasks', taskId);
    const audience = this.audience(task);
    if (!audience.phone) throw new Error(audience.reason);
    const offsets = (choice.offsets || []).filter((k, i, all) => reminderOffsets[k] && all.indexOf(k) === i);
    const send = (body, scheduledFor) => {
      const id = this.messaging.enqueue({
        channel: 'whatsapp',
        recipient: audience.phone,
        body,
        ...(scheduledFor ? { scheduledFor: localIso(scheduledFor) } : {}),
        clientId: audience.client.id,
        caseId: task.caseId || undefined,
      });
      if (review) this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
      return id;
    };
    return this.tx(() => {
      // The single reminder of earlier versions gives way to the new notices.
      const legacy = this.row(task.reminderMessageId);
      if (legacy && open.includes(legacy.status)) this.messaging.change(legacy.id, 'cancel');
      const old = this.ids(task);
      const next = {};
      // A confirmation that was already sent stays on record unless the user asks for a new one.
      if (old.conf && this.status(old.conf) === 'sent' && !choice.confirmation) next.conf = old.conf;
      else this.cancelOpen(old, ['conf']);
      this.cancelOpen(
        old,
        Object.keys(old).filter(k => k !== 'conf'),
      );
      let status = task.confirmationStatus || '';
      if (choice.confirmation) {
        const body = String(choice.confirmationBody || '').trim() || this.render(task, 'event-confirmation', audience);
        next.conf = send(body);
        status = 'awaiting';
      }
      const reminderBody = String(choice.reminderBody || '').trim() || this.render(task, 'event-reminder', audience);
      const kept = [];
      for (const key of offsets) {
        const at = this.when(task, key);
        if (!this.future(at)) continue;
        next[key] = send(reminderBody, at);
        kept.push(key);
      }
      const saved = this.save(task, {
        noticeOffsets: kept.join(','),
        noticeMessageIds: Object.entries(next)
          .map(([k, v]) => `${k}:${v}`)
          .join(','),
        confirmationStatus: status,
      });
      this.store.audit('event.notice.applied', {
        id: taskId,
        confirmation: !!choice.confirmation,
        reminders: kept.length,
      });
      return { task: saved, confirmation: !!choice.confirmation, reminders: kept, review };
    });
  }
  // After an agenda item is edited: a new date replaces the reminders and warns the client; done stops them.
  afterSave(before, saved) {
    const ids = this.ids(saved);
    if (!before || !Object.keys(ids).length) return saved;
    const reminderKeys = Object.keys(ids).filter(k => k !== 'conf');
    if (saved.status === 'Concluída' && before.status !== 'Concluída') {
      this.cancelOpen(ids);
      return saved;
    }
    if (before.due === saved.due) return saved;
    const audience = this.audience(saved);
    if (!audience.phone) return saved;
    return this.tx(() => {
      this.cancelOpen(ids, [...reminderKeys, 'conf']);
      const next = {};
      if (ids.conf && this.status(ids.conf) === 'sent') next.conf = ids.conf;
      const body = this.render(saved, 'event-reminder', audience);
      for (const key of reminderKeys) {
        const at = this.when(saved, key);
        if (!this.future(at)) continue;
        next[key] = this.messaging.enqueue({
          channel: 'whatsapp',
          recipient: audience.phone,
          body,
          scheduledFor: localIso(at),
          clientId: audience.client.id,
          caseId: saved.caseId || undefined,
        });
      }
      let status = saved.confirmationStatus;
      // The client had been told the old date: the correction waits for the office to approve it.
      if (ids.conf && this.status(ids.conf) === 'sent') {
        const id = this.messaging.enqueue({
          channel: 'whatsapp',
          recipient: audience.phone,
          body: this.render(saved, 'event-reschedule', audience),
          clientId: audience.client.id,
          caseId: saved.caseId || undefined,
        });
        this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
        status = 'awaiting';
      }
      return this.save(saved, {
        noticeOffsets: Object.keys(next)
          .filter(k => k !== 'conf')
          .join(','),
        noticeMessageIds: Object.entries(next)
          .map(([k, v]) => `${k}:${v}`)
          .join(','),
        confirmationStatus: status,
      });
    });
  }
  // After an agenda item is deleted: nothing more is sent, and a client who was told about it hears about the cancellation.
  afterRemove(task) {
    const ids = this.ids(task);
    if (!Object.keys(ids).length) return;
    this.tx(() => {
      this.cancelOpen(ids);
      const audience = this.audience(task);
      if (audience.phone && ids.conf && this.status(ids.conf) === 'sent') {
        const id = this.messaging.enqueue({
          channel: 'whatsapp',
          recipient: audience.phone,
          body: this.render(task, 'event-cancel', audience),
          clientId: audience.client.id,
          caseId: task.caseId || undefined,
        });
        this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
      }
    });
  }
  // The client answered (Phase D reads the reply and calls this).
  setConfirmation(taskId, value) {
    if (!['awaiting', 'confirmed', 'declined'].includes(value)) throw new Error('Situação inválida.');
    return this.save(this.store.get('tasks', taskId), { confirmationStatus: value });
  }
}
module.exports = { EventNotices, open, pad };
