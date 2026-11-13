const { randomUUID } = require('node:crypto');
const { text, uuid } = require('./validation.cjs');
const { sender } = require('./email-policy.cjs');
const version = require('../app/version.cjs');
const { cleanHTML } = require('./email-content.cjs');
const limits = require('../app/send-limits.mjs');
const hygiene = require('./wa-hygiene.cjs');
const { isIndividualJid } = require('../app/phone-match.mjs');
class Messaging {
  constructor(store, settings, operations) {
    this.store = store;
    this.settings = settings;
    this.operations = operations;
    this.socket = null;
    this.wa = { status: 'disconnected', qr: null };
    this.running = false;
    this.connecting = false;
    this.stopping = false;
    this.manualDisconnect = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    // Pace of the WhatsApp sending (see app/send-limits.mjs) and automatic pause after repeated failures.
    this.nextSendAt = 0;
    this.failStreak = 0;
    this.pausedUntil = 0;
    // Tests only: run without the window, the caps and the pause (they depend on the real clock).
    this.skipSendRules = false;
    this.inbox = null; // set by the main process (backend/wa-inbox.cjs)
    // A crash can leave a provider request with an unknown outcome. Never automatically resend it.
    this.store.db
      .prepare("UPDATE queue SET status='uncertain',last_error='OUTCOME_UNKNOWN' WHERE status='sending'")
      .run();
    this.timer = setInterval(() => {
      void this.process();
    }, 5000);
    this.timer.unref();
  }
  emailReady() {
    const cfg = this.settings.get();
    if (!this.store.secret('resend-key')) return 'unconfigured';
    try {
      sender(cfg.emailFrom, cfg.ownDomain);
    } catch {
      return 'domain-required';
    }
    return cfg.emailDNSConfirmed ? 'configured' : 'dns-required';
  }
  status() {
    return {
      whatsapp: this.wa,
      email: this.emailReady(),
      paused: this.settings.get().queuePaused,
      pending: this.store.db
        .prepare("SELECT COUNT(*) AS n FROM queue WHERE status IN ('pending','failed','uncertain','needs_review')")
        .get().n,
      scheduled: this.store.db
        .prepare("SELECT COUNT(*) AS n FROM queue WHERE status='pending' AND scheduled_for IS NOT NULL")
        .get().n,
    };
  }
  autoconnect() {
    if (this.settings.get().whatsappAutoConnect && this.store.secret('wa:creds'))
      void this.connectWhatsApp().catch(() => this.reconnect());
  }
  reconnect() {
    if (this.stopping || this.manualDisconnect || !this.settings.get().whatsappAutoConnect || this.reconnectTimer)
      return;
    const delay = Math.min(60000, 5000 * 2 ** Math.min(this.reconnectAttempts++, 4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopping && !this.operations.maintenance) void this.connectWhatsApp().catch(() => this.reconnect());
      else if (!this.stopping) this.reconnect();
    }, delay);
    this.reconnectTimer.unref();
  }
  async connectWhatsApp() {
    if (this.socket || this.connecting || this.stopping) return this.wa;
    this.manualDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connecting = true;
    this.wa = { status: 'connecting', qr: null };
    try {
      const {
        default: makeWASocket,
        initAuthCreds,
        BufferJSON,
        proto,
        DisconnectReason,
      } = await import('@whiskeysockets/baileys');
      if (this.stopping) return this.wa;
      const pino = require('pino');
      const QRCode = require('qrcode');
      const read = id => {
        const data = this.store.secret('wa:' + id);
        return data ? JSON.parse(data, BufferJSON.reviver) : null;
      };
      const write = (id, data) =>
        this.store.secret('wa:' + id, data === null ? null : JSON.stringify(data, BufferJSON.replacer));
      this.cleanSessionIfDue();
      const state = {
        creds: read('creds') || initAuthCreds(),
        keys: {
          get: async (type, ids) =>
            Object.fromEntries(
              ids.map(id => {
                let value = read(`${type}:${id}`);
                if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
                return [id, value];
              }),
            ),
          set: async data => {
            this.store.db.exec('BEGIN IMMEDIATE');
            try {
              for (const [type, entries] of Object.entries(data))
                for (const [id, value] of Object.entries(entries)) write(`${type}:${id}`, value);
              this.store.db.exec('COMMIT');
            } catch (error) {
              this.store.db.exec('ROLLBACK');
              throw error;
            }
          },
        },
      };
      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: [this.settings.get().appName || 'Advocacia Gestão', 'Desktop', version],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // The program only sends and receives text with clients: no history, no groups, status, broadcast
        // lists or channels, no link previews, no echo of its own messages.
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: jid => !isIndividualJid(jid),
        generateHighQualityLinkPreview: false,
        emitOwnEvents: false,
      });
      this.socket = socket;
      socket.ev.on('creds.update', () => {
        if (!this.stopping) write('creds', state.creds);
      });
      // The only content listener. With the inbox off nothing is read or stored.
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (this.stopping || this.socket !== socket || type !== 'notify' || !this.inbox) return;
        for (const item of messages || []) {
          try {
            const record = this.inbox.receive(item);
            if (record && this.inbox.onMessage) void Promise.resolve(this.inbox.onMessage(record)).catch(() => {});
          } catch {
            /* One unreadable message must not stop the others. */
          }
        }
      });
      socket.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
        if (this.stopping || this.socket !== socket) return;
        if (qr) {
          const image = await QRCode.toDataURL(qr, { margin: 2, width: 250 });
          if (!this.stopping && this.socket === socket) this.wa = { status: 'qr', qr: image };
        }
        if (connection === 'open') {
          this.wa = { status: 'connected', qr: null };
          this.reconnectAttempts = 0;
          this.store.audit('whatsapp.connected');
        }
        if (connection === 'close') {
          this.socket = null;
          const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
          this.wa = { status: loggedOut ? 'logged-out' : 'disconnected', qr: null };
          this.store.audit('whatsapp.disconnected', { code: loggedOut ? 'LOGGED_OUT' : 'NETWORK' });
          if (loggedOut) this.manualDisconnect = true;
          else this.reconnect();
        }
      });
      return this.wa;
    } catch {
      this.wa = { status: 'error', qr: null };
      throw new Error('Não foi possível iniciar o WhatsApp. Verifique a conexão e tente novamente.');
    } finally {
      this.connecting = false;
    }
  }
  // Weekly housekeeping of the session keys. Runs only while the socket is closed.
  cleanSessionIfDue(force = false) {
    const last = Date.parse(this.settings.get().lastWaCleanup || '') || 0;
    if (!force && Date.now() - last < 7 * 86400000) return null;
    const result = hygiene.clean(this.store);
    this.settings.internal({ lastWaCleanup: new Date().toISOString(), lastWaCleanupRemoved: result.removed });
    return result;
  }
  // "Limpar agora": closes the connection without logging out, cleans and reconnects.
  async cleanSessionNow() {
    const socket = this.socket;
    this.socket = null;
    clearTimeout(this.reconnectTimer);
    if (socket) {
      try {
        socket.end(undefined);
      } catch {
        /* Already closed. */
      }
    }
    const result = this.cleanSessionIfDue(true);
    this.wa = { status: 'disconnected', qr: null };
    if (this.store.secret('wa:creds')) void this.connectWhatsApp().catch(() => this.reconnect());
    return result;
  }
  async disconnectWhatsApp() {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        await socket.logout();
      } finally {
        socket.end(undefined);
      }
    }
    this.store.db.prepare("DELETE FROM secrets WHERE id LIKE 'wa:%'").run();
    this.wa = { status: 'disconnected', qr: null };
    this.store.audit('whatsapp.logged-out');
  }
  configureEmail(key) {
    text(key, 512);
    if (key && !/^re_[\w-]+$/.test(key)) throw new Error('A chave do Resend deve começar com re_.');
    this.store.secret('resend-key', key || null);
    this.store.audit('email.configured');
  }
  validate(input) {
    if (!['email', 'whatsapp'].includes(input.channel)) throw new Error('Canal inválido.');
    const recipient = text(input.recipient, 254);
    const subject = text(input.subject || '', 300);
    const body = text(input.body, 30000);
    if (!body) throw new Error('Escreva a mensagem.');
    if (input.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
      throw new Error('Destinatário inválido.');
    if (input.channel === 'email') {
      const cfg = this.settings.get();
      sender(cfg.emailFrom, cfg.ownDomain);
      if (!cfg.emailDNSConfirmed)
        throw new Error('Confirme a configuração do domínio no Resend e Cloudflare antes de agendar e-mails.');
    }
    if (input.channel === 'whatsapp' && !/^\d{10,15}$/.test(recipient))
      throw new Error('Informe o WhatsApp com código do país e DDD, apenas números.');
    const clientId = input.clientId ? uuid(input.clientId) : '';
    const caseId = input.caseId ? uuid(input.caseId) : '';
    if (clientId) this.store.get('clients', clientId);
    if (caseId) this.store.get('cases', caseId);
    let scheduledFor = null;
    if (input.scheduledFor) {
      if (
        typeof input.scheduledFor !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.scheduledFor)
      )
        throw new Error('Horário do disparo inválido.');
      const time = new Date(input.scheduledFor).getTime();
      if (
        !Number.isFinite(time) ||
        new Date(time).toISOString() !== input.scheduledFor ||
        time < Date.now() + 5000 ||
        time > Date.now() + 5 * 366 * 86400000
      )
        throw new Error('Escolha um horário futuro, dentro dos próximos cinco anos.');
      scheduledFor = new Date(time).toISOString();
    }
    const emailDesign =
      input.channel === 'email'
        ? require('./email-design.cjs').normalize(
            input.emailDesign || this.settings.get().emailDesign,
            this.settings.get(),
          )
        : null;
    const html = input.channel === 'email' ? cleanHTML(input.html || '') : '';
    const attachmentIds = input.channel === 'email' ? input.attachmentIds || [] : [];
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 10) throw new Error('Limite de dez anexos.');
    let attachmentBytes = 0;
    for (const id of attachmentIds) {
      uuid(id);
      const a = this.store.secret('email-attachment:' + id);
      if (!a) throw new Error('Anexo não encontrado. Selecione novamente.');
      attachmentBytes += a.size;
    }
    if (attachmentBytes > 10 * 1024 * 1024) throw new Error('Os anexos devem somar no máximo 10 MB.');
    if (clientId && input.channel === 'email' && this.store.get('clients', clientId).emailPreference === 'Não receber')
      throw new Error('Este cliente optou por não receber e-mails.');
    return { payload: { recipient, subject, body, html, emailDesign, attachmentIds, clientId, caseId }, scheduledFor };
  }
  enqueue(input, series = {}) {
    const { payload, scheduledFor } = this.validate(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.store.db
      .prepare(
        'INSERT INTO queue(id,channel,payload,status,available_at,scheduled_for,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.channel,
        this.store.vault.seal({ ...payload, ...series }),
        'pending',
        scheduledFor || now,
        scheduledFor,
        now,
        now,
      );
    this.store.audit(scheduledFor ? 'message.scheduled' : 'message.queued', { id, channel: input.channel });
    return id;
  }
  series(input, recurrence, review = false) {
    const dates = require('./recurrence.cjs').expandSchedule(input.scheduledFor, recurrence);
    const messages = dates.map(scheduledFor => ({ ...input, scheduledFor }));
    for (const message of messages) this.validate(message);
    const seriesId = randomUUID();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const ids = messages.map((message, index) =>
        this.enqueue(message, {
          seriesId,
          seriesIndex: index + 1,
          seriesCount: dates.length,
          seriesFrequency: recurrence.frequency,
        }),
      );
      if (review)
        for (const id of ids) this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
      this.store.db.exec('COMMIT');
      return {
        seriesId,
        ids,
        count: ids.length,
        dates,
        ...(review ? { requiresLocalApproval: true, status: 'needs_review' } : {}),
      };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
  cancelSeries(id) {
    uuid(id);
    const row = this.store.db.prepare('SELECT payload FROM queue WHERE id=?').get(id);
    if (!row) throw new Error('Disparo não encontrado.');
    const { seriesId } = this.store.vault.unseal(row.payload);
    if (!seriesId) throw new Error('Este disparo não pertence a uma recorrência.');
    const rows = this.store.db
      .prepare("SELECT id,payload FROM queue WHERE status IN ('pending','failed','needs_review','uncertain')")
      .all()
      .filter(r => this.store.vault.unseal(r.payload).seriesId === seriesId);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of rows) this.change(r.id, 'cancel');
      this.store.db.exec('COMMIT');
      return { count: rows.length };
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
  }
  campaign(input) {
    if (!Array.isArray(input.recipients) || input.recipients.length < 1 || input.recipients.length > 100)
      throw new Error('Selecione entre 1 e 100 clientes.');
    const seen = new Set();
    const sharedStart = new Date().toISOString();
    const messages = input.recipients
      .filter(r => r.receive !== false)
      .map(r => {
        const clients = this.store.list('clients');
        const raw = r.clientId ? this.store.get('clients', uuid(r.clientId)) : null;
        const addressInput = raw ? raw.email : text(r.email || '', 254);
        if (
          clients.some(
            c =>
              c.email?.toLowerCase() === addressInput.toLowerCase() &&
              (c.emailPreference === 'Não receber' || c.status === 'Inativo'),
          )
        )
          throw new Error('Há destinatário que optou por não receber ou está inativo no cadastro.');
        const c = raw ||
          clients.find(c => c.email?.toLowerCase() === addressInput.toLowerCase()) || { email: addressInput, id: '' };
        if (c.emailPreference === 'Não receber') throw new Error('Há cliente que optou por não receber e-mails.');
        const address = c.email.toLowerCase();
        if (seen.has(address)) throw new Error('Há destinatários com o mesmo e-mail. Selecione apenas um deles.');
        seen.add(address);
        const m = {
          ...input,
          channel: 'email',
          recipient: c.email,
          clientId: c.id,
          scheduledFor: input.sharedSchedule
            ? input.scheduledFor || null
            : r.scheduledFor || input.scheduledFor || null,
        };
        const { personalizeMessage } = require('../app/message-variables.mjs');
        m.body = personalizeMessage(m.body, c, this.settings.get());
        m.html = personalizeMessage(m.html, c, this.settings.get(), true);
        m.subject = personalizeMessage(m.subject, c, this.settings.get());
        this.validate(m);
        return m;
      });
    if (!messages.length) throw new Error('Marque pelo menos um cliente para receber.');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const ids = messages.map(m => this.enqueue(m));
      if (input.sharedSchedule)
        for (const id of ids)
          this.store.db
            .prepare('UPDATE queue SET available_at=? WHERE id=?')
            .run(input.scheduledFor || sharedStart, id);
      this.store.db.exec('COMMIT');
      return { ids, count: ids.length };
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
  }
  list() {
    return this.store.db
      .prepare('SELECT * FROM queue ORDER BY created_at DESC LIMIT 1000')
      .all()
      .map(row => ({
        id: row.id,
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        createdAt: row.created_at,
        availableAt: row.available_at,
        scheduledFor: row.scheduled_for,
        sentAt: row.sent_at,
        lastError: row.last_error,
        ...this.store.vault.unseal(row.payload),
      }));
  }
  edit(id, input) {
    uuid(id);
    const row = this.store.db.prepare('SELECT * FROM queue WHERE id=?').get(id);
    if (!row || !['pending', 'failed', 'needs_review', 'cancelled'].includes(row.status))
      throw new Error('Esta mensagem não pode ser editada. Confira o resultado antes de reenviar.');
    const { payload, scheduledFor } = this.validate(input);
    const old = this.store.vault.unseal(row.payload);
    for (const key of ['seriesId', 'seriesIndex', 'seriesCount', 'seriesFrequency'])
      if (old[key] !== undefined) payload[key] = old[key];
    this.store.db
      .prepare(
        "UPDATE queue SET channel=?,payload=?,status='pending',available_at=?,scheduled_for=?,last_error=NULL,updated_at=? WHERE id=?",
      )
      .run(
        input.channel,
        this.store.vault.seal(payload),
        scheduledFor || new Date().toISOString(),
        scheduledFor,
        new Date().toISOString(),
        id,
      );
    this.store.audit('message.rescheduled', { id, channel: input.channel });
    return id;
  }
  change(id, action) {
    uuid(id);
    const row = this.store.db.prepare('SELECT * FROM queue WHERE id=?').get(id);
    if (!row || row.status === 'sending' || row.status === 'sent') throw new Error('A mensagem não pode ser alterada.');
    if (!['retry', 'cancel'].includes(action)) throw new Error('Ação inválida.');
    if (action === 'retry' && row.scheduled_for)
      throw new Error('Edite o disparo e escolha um novo horário antes de ativá-lo.');
    this.store.db
      .prepare('UPDATE queue SET status=?,available_at=?,last_error=NULL,updated_at=? WHERE id=?')
      .run(action === 'retry' ? 'pending' : 'cancelled', new Date().toISOString(), new Date().toISOString(), id);
    this.store.audit('message.' + action, { id });
  }
  // Whether one more WhatsApp message may go out now, by the window, the hourly and daily caps and the pause
  // between messages. The counters come from what was really sent, so they survive a restart.
  rulesConfig() {
    const config = this.settings.get();
    return this.skipSendRules
      ? { ...config, sendWindowStart: 0, sendWindowEnd: 24, sendOnSaturday: true, sendOnSunday: true }
      : config;
  }
  sendVerdict(now = Date.now()) {
    if (this.skipSendRules) return { allowed: true, reason: '', retryAt: now };
    if (now < this.pausedUntil) return { allowed: false, reason: 'paused', retryAt: this.pausedUntil };
    const sent = since =>
      this.store.db
        .prepare("SELECT COUNT(*) AS n FROM queue WHERE channel='whatsapp' AND status='sent' AND sent_at >= ?")
        .get(new Date(since).toISOString()).n;
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return limits.decide(now, this.settings.get(), {
      lastHour: sent(now - 3600000),
      today: sent(startOfDay.getTime()),
      nextAt: this.nextSendAt,
    });
  }
  // What the screen shows about the sending rules.
  sendRules() {
    const verdict = this.sendVerdict();
    return {
      ...limits.validateLimits(this.settings.get()),
      allowed: verdict.allowed,
      reason: verdict.reason,
      retryAt: verdict.retryAt ? new Date(verdict.retryAt).toISOString() : null,
    };
  }
  async process() {
    if (this.canProcess && !this.canProcess()) return;
    if (this.running || this.operations.maintenance || this.stopping) return;
    if (this.birthdays)
      try {
        this.birthdays.tick();
      } catch {
        this.store.audit('birthday.schedule.failed', { code: 'BIRTHDAY_CONFIG' });
      }
    const config = this.settings.get();
    const expired = new Date(Date.now() - config.scheduleGraceMinutes * 60000).toISOString();
    const missed = this.store.db
      .prepare(
        "SELECT id,channel,scheduled_for,payload FROM queue WHERE status='pending' AND scheduled_for IS NOT NULL AND scheduled_for<?",
      )
      .all(expired);
    const waPending = this.store.db
      .prepare("SELECT COUNT(*) AS n FROM queue WHERE channel='whatsapp' AND status='pending'")
      .get().n;
    for (const item of missed) {
      // A WhatsApp message only waits "too long" while the sending window is open, and a long queue
      // draining at the hourly cap is not forgotten: the grace period grows with the queue.
      if (item.channel === 'whatsapp') {
        const waited = limits.openMinutes(Date.parse(item.scheduled_for), Date.now(), this.rulesConfig());
        if (waited <= config.scheduleGraceMinutes + limits.drainMinutes(waPending, config)) continue;
      }
      const data = this.store.vault.unseal(item.payload);
      if (data.autoBirthday && data.birthdayDate === require('./birthdays.cjs').dayKey(new Date())) continue;
      this.store.db
        .prepare("UPDATE queue SET status='needs_review',last_error='SCHEDULE_MISSED',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), item.id);
      this.store.audit('message.schedule.missed', { id: item.id, code: 'SCHEDULE_MISSED' });
    }
    if (config.queuePaused) return;
    const ready = this.store.db
      .prepare("SELECT * FROM queue WHERE status='pending' AND available_at<=? ORDER BY available_at,created_at")
      .all(new Date().toISOString());
    const verdict = this.sendVerdict();
    const row = ready.find(item =>
      item.channel === 'whatsapp'
        ? this.wa.status === 'connected' && verdict.allowed
        : this.emailReady() === 'configured',
    );
    if (!row) return;
    this.running = true;
    try {
      await this.operations.run('Envio de mensagem', async () => {
        let data = this.store.vault.unseal(row.payload);
        if (data.autoBirthday && this.birthdays) {
          data = this.birthdays.prepare(data);
          if (!data) {
            this.store.db
              .prepare("UPDATE queue SET status='cancelled',last_error='BIRTHDAY_CONFIG',updated_at=? WHERE id=?")
              .run(new Date().toISOString(), row.id);
            return;
          }
          this.store.db.prepare('UPDATE queue SET payload=? WHERE id=?').run(this.store.vault.seal(data), row.id);
        }
        if (
          row.channel === 'email' &&
          this.store
            .list('clients')
            .some(
              c =>
                c.email?.toLowerCase() === data.recipient.toLowerCase() &&
                (c.emailPreference === 'Não receber' || c.status === 'Inativo'),
            )
        ) {
          this.store.db
            .prepare("UPDATE queue SET status='cancelled',last_error='OPTED_OUT',updated_at=? WHERE id=?")
            .run(new Date().toISOString(), row.id);
          this.store.audit('message.opted-out', { id: row.id });
          return;
        }
        if (row.channel === 'email' && data.clientId) {
          let client;
          try {
            client = this.store.get('clients', data.clientId);
          } catch {
            /* Deleted clients require review. */
          }
          if (!client || client.emailPreference === 'Não receber') {
            this.store.db
              .prepare("UPDATE queue SET status='cancelled',last_error='OPTED_OUT',updated_at=? WHERE id=?")
              .run(new Date().toISOString(), row.id);
            this.store.audit('message.opted-out', { id: row.id });
            return;
          }
        }
        this.store.db
          .prepare("UPDATE queue SET status='sending', attempts=attempts+1, updated_at=? WHERE id=?")
          .run(new Date().toISOString(), row.id);
        try {
          if (row.channel === 'email') {
            const cfg = this.settings.get();
            sender(cfg.emailFrom, cfg.ownDomain);
            if (!cfg.emailDNSConfirmed) {
              const error = new Error('Domínio não confirmado.');
              error.definite = true;
              throw error;
            }
            const designed = require('./email-design.cjs').render(
              { html: data.html, body: data.body, design: data.emailDesign },
              cfg,
            );
            const files = [
              ...(data.attachmentIds || []).map(id => {
                const a = this.store.secret('email-attachment:' + id);
                if (!a) throw new Error('Anexo indisponível.');
                return { filename: a.name, content: a.content };
              }),
              ...designed.attachments,
            ];
            const result = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              signal: AbortSignal.timeout(30000),
              headers: {
                Authorization: `Bearer ${this.store.secret('resend-key')}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': row.id,
              },
              body: JSON.stringify({
                from: this.settings.get().emailFrom,
                to: [data.recipient],
                subject: data.subject,
                text: data.body,
                html: designed.html,
                ...(files.length ? { attachments: files } : {}),
              }),
            });
            if (!result.ok) {
              const error = new Error('Envio recusado pelo serviço.');
              error.definite = true;
              throw error;
            }
          } else
            await this.socket.sendMessage(
              data.recipient + '@s.whatsapp.net',
              { text: data.body },
              { messageId: row.id.replaceAll('-', '').toUpperCase() },
            );
          const now = new Date().toISOString();
          this.store.db
            .prepare("UPDATE queue SET status='sent',sent_at=?,last_error=NULL,updated_at=? WHERE id=?")
            .run(now, now, row.id);
          this.store.audit('message.sent', { id: row.id, channel: row.channel });
          if (row.channel === 'whatsapp') {
            this.failStreak = 0;
            this.nextSendAt = Date.now() + limits.nextDelayMs(this.settings.get());
          }
        } catch (error) {
          this.store.db
            .prepare('UPDATE queue SET status=?,last_error=?,updated_at=? WHERE id=?')
            .run(
              error.definite ? 'failed' : 'uncertain',
              error.definite ? 'PROVIDER_REJECTED' : 'OUTCOME_UNKNOWN',
              new Date().toISOString(),
              row.id,
            );
          this.store.audit('message.failed', {
            id: row.id,
            code: error.definite ? 'PROVIDER_REJECTED' : 'OUTCOME_UNKNOWN',
          });
          // Three failures in a row: pause the WhatsApp sending for an hour instead of insisting.
          if (row.channel === 'whatsapp' && ++this.failStreak >= 3) {
            this.pausedUntil = Date.now() + 3600000;
            this.failStreak = 0;
            this.store.audit('whatsapp.paused', { code: 'FAILURES' });
          }
        }
      });
    } catch {
      /* A maintenance operation can acquire the lock between scheduling and sending. */
    } finally {
      this.running = false;
    }
  }
  stop() {
    this.stopping = true;
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    this.socket?.end(undefined);
    this.socket = null;
  }
}
module.exports = { Messaging };
