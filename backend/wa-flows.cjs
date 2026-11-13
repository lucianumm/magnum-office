// Automatic answers to clients who write on WhatsApp: a small menu, the next hearing, confirmation of presence
// and the progress of a case after the client proves who they are. It only ever answers a number registered
// to a client; strangers get one fixed line a day. Answers that carry case data wait for the office's click
// unless the office chose "answer by itself". Nothing the client types as CPF is stored.
const { phoneKey } = require('../app/phone-match.mjs');
const { classify, flowTexts, progressText } = require('../app/wa-flow-rules.mjs');
const { messageContext, renderMessage } = require('../app/message-vars.mjs');
const limits = require('../app/send-limits.mjs');
const { defaultBodies, eventTypes } = require('../app/message-defaults.mjs');

const STEP_TTL = 15 * 60000;
const MENU_EVERY = 30 * 60000;
const UNKNOWN_EVERY = 24 * 3600000;
const BLOCK_FOR = 24 * 3600000;
const MAX_WRONG = 3;
const MAX_PER_DAY = 5;
const STALE_MS = 12 * 3600000;
const dayKey = t => new Date(t).toISOString().slice(0, 10);

class Flows {
  constructor({ store, settings, messaging, inbox, campaigns, eventNotices, datajud, library, clock = Date.now }) {
    Object.assign(this, { store, settings, messaging, inbox, campaigns, eventNotices, datajud, library, clock });
  }
  mode() {
    const mode = this.settings.get().waFlowMode;
    return ['off', 'review', 'auto'].includes(mode) ? mode : 'review';
  }
  // ---- conversation state (encrypted, one row per number) ----
  state(phone) {
    const row = this.store.db.prepare('SELECT payload FROM wa_flow_state WHERE phone_key=?').get(phoneKey(phone));
    return row ? this.store.vault.unseal(row.payload) : {};
  }
  save(phone, state) {
    this.store.db
      .prepare(
        'INSERT INTO wa_flow_state(phone_key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(phone_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
      )
      .run(phoneKey(phone), this.store.vault.seal(state), new Date(this.clock()).toISOString());
  }
  // ---- sending ----
  // sensitive answers (case data) follow the office's mode; neutral ones go out by themselves.
  reply(phone, body, { clientId, sensitive = false, kind }) {
    // What the program answered by itself needs no attention in the inbox; a stranger or a request for the team does.
    if (this.current && !['human', 'unknown'].includes(kind))
      try {
        this.inbox.setStatus(this.current, 'handled');
      } catch {
        /* the message was already removed */
      }
    const id = this.messaging.enqueue({
      channel: 'whatsapp',
      recipient: phone,
      body,
      ...(clientId ? { clientId } : {}),
    });
    if (sensitive && this.mode() === 'review')
      this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
    this.store.audit('wa.flow.reply', { kind, review: sensitive && this.mode() === 'review' });
    return id;
  }
  office() {
    return this.settings.get().officeName || 'nosso escritório';
  }
  // The menu text: the office's own template for automatic answers, or the standard one.
  menuText(first) {
    const model = this.library.list().find(t => t.kind === 'whatsapp' && t.purpose === 'auto-reply');
    const body = model ? model.body : defaultBodies['auto-reply'];
    return renderMessage(body, messageContext({ client: { name: first }, settings: this.settings.get() }));
  }
  eventsOf(client) {
    const cases = new Map(this.store.list('cases').map(c => [c.id, c]));
    return this.store
      .list('tasks')
      .filter(t => eventTypes.includes(t.type) && t.status !== 'Concluída')
      .filter(t => (t.clientId || cases.get(t.caseId)?.clientId) === client.id)
      .filter(t => new Date(t.due).getTime() > this.clock())
      .sort((a, b) => a.due.localeCompare(b.due))
      .map(t => ({ task: t, caseItem: t.caseId ? cases.get(t.caseId) : null }));
  }
  // ---- entry point ----
  async handle(record) {
    if (this.mode() === 'off' || !record?.phone || record.media) return false;
    const now = this.clock();
    const phone = record.phone;
    this.current = record.id;
    const state = this.state(phone);
    const client = record.clientId ? this.store.get('clients', record.clientId) : null;
    if (!client) {
      // A stranger: one fixed line per day, and the office sees the message in the inbox.
      if (state.lastUnknownAt && now - state.lastUnknownAt < UNKNOWN_EVERY) return false;
      this.save(phone, { ...state, lastUnknownAt: now });
      this.reply(phone, flowTexts.unknown(this.office()), { kind: 'unknown' });
      return true;
    }
    const first = String(client.name).trim().split(/\s+/)[0];
    const fresh = state.stepAt && now - state.stepAt < STEP_TTL;
    const step = fresh ? state.step : '';
    const events = this.eventsOf(client);
    const awaiting = events.find(e => e.task.confirmationStatus === 'awaiting');
    const intent = classify(record.text, { step, awaiting: !!awaiting });
    const say = (body, extra = {}) => this.reply(phone, body, { clientId: client.id, ...extra });
    const next = patch => this.save(phone, { ...state, step: '', stepAt: 0, ...patch });

    if (state.blockedUntil && now < state.blockedUntil) {
      if (intent.intent === 'progress' || intent.intent === 'cpf') say(flowTexts.cpfBlocked, { kind: 'blocked' });
      return true;
    }
    switch (intent.intent) {
      case 'confirm': {
        const when = this.eventNotices.setConfirmation(awaiting.task.id, 'confirmed');
        next({});
        const ctx = messageContext({ client, settings: this.settings.get(), task: when, caseItem: awaiting.caseItem });
        say(renderMessage('Obrigado, {primeiro_nome}! Presença confirmada: {evento}, {data}, às {hora}.', ctx), {
          kind: 'confirm',
        });
        return true;
      }
      case 'human': {
        if (awaiting) this.eventNotices.setConfirmation(awaiting.task.id, 'declined');
        next({});
        say(flowTexts.human(limits.windowOpen(now, this.settings.get())), { kind: 'human' });
        this.store.audit('wa.flow.human', {});
        return true;
      }
      case 'event': {
        next({});
        const found = events[0];
        if (!found) {
          say(flowTexts.noEvent, { kind: 'event' });
          return true;
        }
        const ctx = messageContext({
          client,
          settings: this.settings.get(),
          task: found.task,
          caseItem: found.caseItem,
        });
        say(renderMessage('Sua próxima {evento}{processo_ref}: {dia_semana}, {data}, às {hora}.\n{detalhes}', ctx), {
          kind: 'event',
          sensitive: true,
        });
        return true;
      }
      case 'progress': {
        if (client.whatsappProgressConsent !== true) {
          next({});
          say(flowTexts.noConsent, { kind: 'no-consent' });
          return true;
        }
        if (!/^\d{11}$/.test(String(client.document || '').replace(/\D/g, ''))) {
          next({});
          say(flowTexts.noDocument, { kind: 'no-document' });
          return true;
        }
        if ((state.day === dayKey(now) ? state.queries || 0 : 0) >= MAX_PER_DAY) {
          say(flowTexts.limit, { kind: 'limit' });
          return true;
        }
        next({ step: 'cpf', stepAt: now });
        say(flowTexts.askCpf, { kind: 'ask-cpf' });
        return true;
      }
      case 'cpf': {
        // The CPF typed never stays in the inbox.
        this.inbox.redact?.(record.id, '[CPF informado]');
        const expected = String(client.document).replace(/\D/g, '');
        if (intent.cpf !== expected) {
          const wrong = (state.wrong || 0) + 1;
          if (wrong >= MAX_WRONG) {
            next({ wrong: 0, blockedUntil: now + BLOCK_FOR });
            say(flowTexts.cpfBlocked, { kind: 'blocked' });
            this.store.audit('wa.flow.blocked', { id: client.id });
            return true;
          }
          this.save(phone, { ...state, step: 'cpf', stepAt: now, wrong });
          say(flowTexts.cpfWrong(MAX_WRONG - wrong), { kind: 'cpf-wrong' });
          return true;
        }
        const cases = this.store
          .list('cases')
          .filter(c => c.clientId === client.id && c.status !== 'Arquivado')
          .map(c => ({ c, meta: this.datajud.read(c.id).meta }))
          .filter(x => x.c.secret !== true && !(x.meta?.sigilo > 0))
          .sort((a, b) => a.c.title.localeCompare(b.c.title, 'pt-BR'));
        if (!cases.length) {
          next({ wrong: 0 });
          const secretOnly = this.store.list('cases').some(c => c.clientId === client.id && c.secret === true);
          say(secretOnly ? flowTexts.secret : flowTexts.noCases, { kind: 'no-cases' });
          return true;
        }
        if (cases.length === 1) {
          await this.progress(phone, client, cases[0].c, state, first);
          return true;
        }
        next({ step: 'pick', stepAt: now, wrong: 0, pick: cases.map(x => x.c.id) });
        const list = cases.map((x, i) => `*${i + 1}* ${x.c.title}${x.c.number ? ` (${x.c.number})` : ''}`).join('\n');
        say(`Você tem mais de um processo. Responda com o número:\n${list}`, { kind: 'pick' });
        return true;
      }
      case 'pick': {
        const id = (state.pick || [])[intent.n - 1];
        if (!id) {
          say(flowTexts.badPick, { kind: 'bad-pick' });
          return true;
        }
        await this.progress(phone, client, this.store.get('cases', id), { ...state, step: '', pick: [] }, first);
        return true;
      }
      default: {
        if (state.lastMenuAt && now - state.lastMenuAt < MENU_EVERY) return false;
        this.save(phone, { ...state, step: '', stepAt: 0, lastMenuAt: now });
        say(this.menuText(first), { kind: 'menu' });
        return true;
      }
    }
  }
  // The latest registered movement, refreshed once from the DataJud when it is old and the office uses it.
  async progress(phone, client, caseItem, state, first) {
    const now = this.clock();
    let data = this.datajud.read(caseItem.id);
    const stale = !data.fetchedAt || now - Date.parse(data.fetchedAt) > STALE_MS;
    if (stale && this.settings.get().datajudEnabled && this.datajud.alias(caseItem)) {
      try {
        await this.datajud.refresh(caseItem.id);
        data = this.datajud.read(caseItem.id);
      } catch {
        /* answer with what is registered */
      }
    }
    const day = dayKey(now);
    this.save(phone, {
      ...state,
      step: '',
      stepAt: 0,
      wrong: 0,
      day,
      queries: (state.day === day ? state.queries || 0 : 0) + 1,
    });
    if (caseItem.secret === true || data.meta?.sigilo > 0)
      return this.reply(phone, flowTexts.secret, { clientId: client.id, kind: 'secret' });
    const last = data.movements[0];
    const body = last
      ? progressText({
          first,
          office: this.office(),
          number: caseItem.number,
          date: last.date,
          name: last.name,
          fetchedAt: data.fetchedAt,
        })
      : `Olá, ${first}! Ainda não há andamento registrado para o seu processo. A equipe do ${this.office()} avisa quando houver novidades.`;
    // Only who asked and which case go to the audit: neither the CPF nor the text of the movement.
    this.store.audit('wa.flow.progress', { id: client.id, caseId: caseItem.id });
    return this.reply(phone, body, { clientId: client.id, kind: 'progress', sensitive: true });
  }
}
module.exports = { Flows, MAX_WRONG, MAX_PER_DAY };
