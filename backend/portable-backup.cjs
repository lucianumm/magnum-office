const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { Store } = require('./store.cjs');
const { Settings } = require('./settings.cjs');
const { Backups, backupPath } = require('./backups.cjs');
const { Library } = require('./library.cjs');
const { entity, uuid, text } = require('./validation.cjs');
const { cleanHTML } = require('./email-content.cjs');
const version = require('../app/version.cjs');
const scrypt = promisify(crypto.scrypt),
  gzip = promisify(zlib.gzip),
  gunzip = promisify(zlib.gunzip);
const MAX = 220 * 1024 ** 2;
const MAGIC = Buffer.from('MOBK1');
function password(value) {
  if (typeof value !== 'string' || value.trim().length < 12 || value.length > 200)
    throw new Error('Use uma senha de backup com 12 a 200 caracteres.');
  return value;
}
async function seal(data, pass) {
  password(pass);
  const json = Buffer.from(JSON.stringify(data));
  if (json.length > MAX) throw new Error('O backup portátil excede 220 MB. Use o backup local completo.');
  const compressed = await gzip(json);
  const salt = crypto.randomBytes(16),
    iv = crypto.randomBytes(12),
    key = await scrypt(pass, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 ** 2 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  key.fill(0);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}
async function unseal(bytes, pass) {
  password(pass);
  if (bytes.length < 50 || bytes.length > MAX || !bytes.subarray(0, 5).equals(MAGIC))
    throw new Error('Arquivo de backup portátil inválido.');
  const key = await scrypt(pass, bytes.subarray(5, 21), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 ** 2 });
  let compressed;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(21, 33));
    decipher.setAuthTag(bytes.subarray(33, 49));
    compressed = Buffer.concat([decipher.update(bytes.subarray(49)), decipher.final()]);
  } catch {
    throw new Error('Senha incorreta ou arquivo de backup alterado.');
  } finally {
    key.fill(0);
  }
  try {
    return JSON.parse((await gunzip(compressed, { maxOutputLength: MAX })).toString('utf8'));
  } catch {
    throw new Error('Conteúdo do backup inválido ou excessivo.');
  }
}
class PortableBackup {
  constructor(store, settings) {
    this.store = store;
    this.settings = settings;
  }
  async create(pass) {
    const cfg = this.settings.get();
    const settings = Object.fromEntries(
      [
        'officeName',
        'userName',
        'appName',
        'appDescription',
        'brandLogo',
        'theme',
        'appearance',
        'density',
        'emailDesign',
        'lawyers',
        'officeCity',
        'officeAddress',
        'courtCalendar',
        'workflows',
      ].map(k => [k, cfg[k]]),
    );
    const entities = Object.fromEntries(
      ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes', 'time'].map(k => [
        k,
        this.store.list(k),
      ]),
    );
    let size = 0;
    const documents = [];
    for (const doc of entities.documents) {
      const bytes = this.store.vault.unseal(
        await fs.readFile(path.join(this.store.root, 'documents', doc.id + '.enc')),
        true,
      );
      size += bytes.length;
      if (size > 150 * 1024 ** 2) throw new Error('Documentos acima de 150 MB. Use o backup local completo.');
      documents.push({ id: doc.id, content: bytes.toString('base64') });
    }
    const library = new Library(this.store);
    const messages = this.store.db
      .prepare('SELECT * FROM queue ORDER BY created_at DESC LIMIT 1000')
      .all()
      .map(r => ({
        id: r.id,
        channel: r.channel,
        status: r.status,
        createdAt: r.created_at,
        scheduledFor: r.scheduled_for,
        sentAt: r.sent_at,
        ...this.store.vault.unseal(r.payload),
      }));
    const ids = [...new Set(messages.flatMap(m => m.attachmentIds || []))];
    const attachments = ids.map(id => ({ id, ...this.store.secret('email-attachment:' + id) })).filter(a => a.content);
    return seal(
      {
        format: 1,
        version,
        createdAt: new Date().toISOString(),
        settings,
        entities,
        legalTemplatesSeeded: library.seeded(),
        movements: this.store.db
          .prepare('SELECT case_id,payload FROM case_movements')
          .all()
          .map(r => ({ caseId: r.case_id, data: this.store.vault.unseal(r.payload) })),
        intimations: this.store.db
          .prepare('SELECT * FROM intimations')
          .all()
          .map(r => ({
            id: r.id,
            status: r.status,
            caseId: r.case_id,
            published: r.published,
            createdAt: r.created_at,
            data: this.store.vault.unseal(r.payload),
          })),
        groups: library.groups(),
        templates: library.list(),
        documents,
        messages,
        attachments,
        birthdayHistory: this.store.db
          .prepare('SELECT dispatch_key AS key,message_id AS messageId FROM birthday_dispatches')
          .all(),
      },
      pass,
    );
  }
  async stageRestore(bytes, pass) {
    const data = await unseal(bytes, pass);
    if (
      data?.format !== 1 ||
      !data.entities ||
      !Array.isArray(data.groups) ||
      !Array.isArray(data.templates) ||
      !Array.isArray(data.documents) ||
      !Array.isArray(data.messages) ||
      !Array.isArray(data.attachments)
    )
      throw new Error('Estrutura de backup inválida.');
    data.entities.people ??= [];
    data.entities.finance ??= [];
    data.entities.intakes ??= [];
    /* Backups made before 1.5/1.7 have no people or finance. */ for (const kind of [
      'clients',
      'cases',
      'tasks',
      'notes',
      'documents',
      'people',
      'finance',
      'intakes',
    ])
      if (!Array.isArray(data.entities[kind]) || data.entities[kind].length > 50000)
        throw new Error('Cadastros inválidos ou excessivos.');
    if (
      data.groups.length > 10000 ||
      data.templates.length > 50000 ||
      data.messages.length > 1000 ||
      data.attachments.length > 10000
    )
      throw new Error('Backup excessivo.');
    const root = await fs.mkdtemp(path.join(this.store.root, 'temporary', 'portable-'));
    if (!path.resolve(root).startsWith(path.resolve(this.store.root, 'temporary') + path.sep))
      throw new Error('Pasta temporária inválida.');
    let staged;
    try {
      staged = new Store(root, this.store.vault);
      await staged.migrate();
      await fs.copyFile(path.join(this.store.root, 'vault.bin'), path.join(root, 'vault.bin'));
      const settings = new Settings(root);
      settings.save(
        Object.fromEntries(
          [
            'officeName',
            'userName',
            'appName',
            'appDescription',
            'theme',
            'appearance',
            'density',
            'emailDesign',
            'lawyers',
            'officeCity',
            'officeAddress',
            'courtCalendar',
            'workflows',
          ]
            .filter(k => k in (data.settings || {}))
            .map(k => [k, data.settings[k]]),
        ),
      );
      if (data.settings?.brandLogo) {
        if (
          !/^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(data.settings.brandLogo) ||
          data.settings.brandLogo.length > 120000
        )
          throw new Error('Logo inválida no backup.');
        settings.internal({ brandLogo: data.settings.brandLogo });
      }
      settings.internal({
        termsAcceptedVersion: this.settings.get().termsAcceptedVersion,
        termsAcceptedAt: this.settings.get().termsAcceptedAt,
        backupMode: 'local',
        backupEmailEnabled: false,
      });
      const refs = Object.fromEntries(
        ['clients', 'cases'].map(k => [k, new Set(data.entities[k].map(r => uuid(r.id)))]),
      );
      for (const kind of ['clients', 'cases', 'tasks', 'notes', 'people', 'finance', 'intakes', 'time'])
        // Hours exist from 1.11 on; older backups have none.
        for (const r of data.entities[kind] || []) {
          const value = entity(
            kind,
            { ...r, ...(kind === 'clients' ? { birthdayEnabled: false } : {}) },
            { allowLegacyContact: true },
          );
          if (
            (value.clientId && !refs.clients.has(value.clientId)) ||
            (value.caseId && !refs.cases.has(value.caseId)) ||
            (value.parentCaseId && !refs.cases.has(value.parentCaseId))
          )
            throw new Error('Vínculo inválido no backup.');
          staged.put(kind, uuid(r.id), value);
        }
      // Movements and intimations exist from 1.8 on; older backups simply have none.
      if (data.movements !== undefined) {
        if (!Array.isArray(data.movements) || data.movements.length > 50000)
          throw new Error('Andamentos inválidos no backup.');
        for (const m of data.movements) {
          const caseId = uuid(m.caseId);
          if (!refs.cases.has(caseId) || !Array.isArray(m.data?.movements))
            throw new Error('Andamento inválido no backup.');
          staged.db
            .prepare('INSERT INTO case_movements(case_id,payload,updated_at) VALUES(?,?,?)')
            .run(caseId, staged.vault.seal(m.data), new Date().toISOString());
        }
      }
      if (data.intimations !== undefined) {
        if (!Array.isArray(data.intimations) || data.intimations.length > 200000)
          throw new Error('Intimações inválidas no backup.');
        for (const i of data.intimations) {
          if (
            !/^[\w-]{1,64}$/.test(String(i.id)) ||
            !['new', 'done', 'dismissed'].includes(i.status) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(String(i.published))
          )
            throw new Error('Intimação inválida no backup.');
          const caseId = i.caseId && refs.cases.has(i.caseId) ? i.caseId : null;
          staged.db
            .prepare('INSERT INTO intimations(id,payload,status,case_id,published,created_at) VALUES(?,?,?,?,?,?)')
            .run(
              String(i.id),
              staged.vault.seal(i.data || {}),
              i.status,
              caseId,
              i.published,
              i.createdAt || new Date().toISOString(),
            );
        }
      }
      if (data.legalTemplatesSeeded === true)
        staged.db
          .prepare("INSERT OR IGNORE INTO maintenance VALUES ('legal-templates',?)")
          .run(new Date().toISOString());
      const docs = new Map(data.documents.map(d => [uuid(d.id), d.content]));
      for (const r of data.entities.documents) {
        const id = uuid(r.id);
        if (
          !docs.has(id) ||
          ![
            '.pdf',
            '.docx',
            '.doc',
            '.odt',
            '.txt',
            '.rtf',
            '.xlsx',
            '.xls',
            '.csv',
            '.png',
            '.jpg',
            '.jpeg',
            '.webp',
          ].includes(r.ext)
        )
          throw new Error('Documento inválido no backup.');
        const bytes = Buffer.from(docs.get(id), 'base64');
        if (bytes.length > 100 * 1024 ** 2) throw new Error('Documento excessivo.');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (r.sha256 && r.sha256 !== sha256) throw new Error('Documento corrompido.');
        if ((r.clientId && !refs.clients.has(r.clientId)) || (r.caseId && !refs.cases.has(r.caseId)))
          throw new Error('Vínculo de documento inválido.');
        await fs.writeFile(path.join(root, 'documents', id + '.enc'), staged.vault.seal(bytes));
        staged.put('documents', id, {
          name: text(r.name, 255),
          ext: r.ext,
          size: bytes.length,
          sha256,
          clientId: r.clientId || '',
          caseId: r.caseId || '',
          notes: text(r.notes || '', 4000),
        });
      }
      for (const g of data.groups)
        staged.db
          .prepare('INSERT INTO template_groups(id,payload) VALUES(?,?)')
          .run(uuid(g.id), staged.vault.seal({ name: text(g.name, 100) }));
      for (const t of data.templates) {
        if (!['document', 'email', 'whatsapp'].includes(t.kind || 'document'))
          throw new Error('Tipo de modelo inválido.');
        staged.db.prepare('INSERT INTO templates(id,group_id,payload) VALUES(?,?,?)').run(
          uuid(t.id),
          uuid(t.groupId),
          staged.vault.seal({
            title: text(t.title, 200),
            body: text(t.body, 60000),
            html: cleanHTML(t.html || ''),
            kind: t.kind || 'document',
            purpose: t.kind === 'whatsapp' && t.purpose === 'birthday' ? 'birthday' : 'general',
            subject: text(t.subject || '', 300),
            emailDesign: t.kind === 'email' ? require('./email-design.cjs').normalize(t.emailDesign || {}) : null,
          }),
        );
      }
      for (const a of data.attachments) {
        const content = Buffer.from(a.content || '', 'base64');
        if (content.length > 10 * 1024 ** 2) throw new Error('Anexo excessivo.');
        staged.secret('email-attachment:' + uuid(a.id), {
          name: text(a.name, 255),
          size: content.length,
          content: content.toString('base64'),
        });
      }
      for (const m of data.messages) {
        if (!['email', 'whatsapp'].includes(m.channel)) throw new Error('Canal inválido.');
        const now = new Date().toISOString();
        const payload = {
          recipient: text(m.recipient, 254),
          body: text(m.body, 30000),
          subject: text(m.subject || '', 300),
          html: cleanHTML(m.html || ''),
          emailDesign: m.channel === 'email' ? require('./email-design.cjs').normalize(m.emailDesign || {}) : null,
          clientId: m.clientId ? uuid(m.clientId) : '',
          caseId: m.caseId ? uuid(m.caseId) : '',
          attachmentIds: (m.attachmentIds || []).map(uuid),
        };
        if (m.autoBirthday) {
          if (
            !Number.isInteger(m.birthdayYear) ||
            m.birthdayYear < 1900 ||
            m.birthdayYear > 9999 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(m.birthdayDate) ||
            !m.birthdayDate.startsWith(m.birthdayYear + '-')
          )
            throw new Error('Data de aniversário inválida no backup.');
          Object.assign(payload, {
            autoBirthday: true,
            birthdayDate: m.birthdayDate,
            birthdayYear: m.birthdayYear,
            birthdayTemplateId: uuid(m.birthdayTemplateId),
          });
        }
        if (m.seriesId) {
          payload.seriesId = uuid(m.seriesId);
          if (
            !Number.isInteger(m.seriesIndex) ||
            !Number.isInteger(m.seriesCount) ||
            m.seriesIndex < 1 ||
            m.seriesIndex > m.seriesCount ||
            m.seriesCount > 260 ||
            !['weekly', 'monthly', 'dates'].includes(m.seriesFrequency)
          )
            throw new Error('Recorrência inválida no backup.');
          Object.assign(payload, {
            seriesIndex: m.seriesIndex,
            seriesCount: m.seriesCount,
            seriesFrequency: m.seriesFrequency,
          });
        }
        if (payload.attachmentIds.some(id => !staged.secret('email-attachment:' + id)))
          throw new Error('Anexo ausente no backup.');
        const status = ['sent', 'cancelled'].includes(m.status) ? m.status : 'needs_review';
        staged.db
          .prepare(
            'INSERT INTO queue(id,channel,payload,status,attempts,available_at,scheduled_for,created_at,updated_at,sent_at,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            uuid(m.id),
            m.channel,
            staged.vault.seal(payload),
            status,
            0,
            now,
            m.scheduledFor || null,
            m.createdAt || now,
            now,
            m.sentAt || null,
            status === 'needs_review' ? 'PORTABLE_RESTORE' : null,
          );
      }
      if (data.birthdayHistory !== undefined) {
        if (!Array.isArray(data.birthdayHistory) || data.birthdayHistory.length > 200000)
          throw new Error('Histórico de aniversário inválido.');
        for (const item of data.birthdayHistory) {
          if (!/^[a-f0-9]{64}$/.test(item.key)) throw new Error('Histórico de aniversário inválido.');
          const messageId =
            item.messageId && data.messages.some(m => m.id === item.messageId) ? uuid(item.messageId) : null;
          staged.db
            .prepare('INSERT INTO birthday_dispatches(dispatch_key,message_id) VALUES(?,?)')
            .run(item.key, messageId);
        }
      }
      const snapshot = await new Backups(staged, settings).create('portable-import');
      const dest = backupPath(this.store.root, snapshot.id);
      await fs.rename(backupPath(root, snapshot.id), dest);
      return snapshot;
    } finally {
      staged?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
}
module.exports = { PortableBackup, seal, unseal, password };
