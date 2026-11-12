const http = require('node:http');
const { randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const version = require('../app/version.cjs');
const kinds = ['clients', 'tasks', 'notes', 'cases', 'people', 'finance', 'intakes'];
// Read-only legal tools (1.9). None of them saves, sends or changes anything.
const legalReadTools = [
  'get_case_summary',
  'list_deadlines',
  'calculate_deadline',
  'calculate_debt',
  'preview_document',
  'list_movements',
  'list_intimations',
];
class AgentAPI {
  constructor({
    store,
    settings,
    operations,
    library,
    messaging,
    reminders = null,
    datajud = null,
    djen = null,
    indices = null,
    generator = null,
    courts = [],
  }) {
    Object.assign(this, {
      store,
      settings,
      operations,
      library,
      messaging,
      reminders,
      datajud,
      djen,
      indices,
      generator,
      courts,
    });
    this.server = null;
    this.error = '';
  }
  status() {
    const cfg = this.settings.get();
    return {
      enabled: !!cfg.agentEnabled,
      running: !!this.server?.listening,
      port: cfg.agentPort || 47831,
      write: !!cfg.agentWrite,
      error: this.error,
      hasToken: !!this.store.secret('agent-api-token'),
    };
  }
  token() {
    return this.store.secret('agent-api-token');
  }
  async configure(input) {
    if (
      typeof input.enabled !== 'boolean' ||
      typeof input.write !== 'boolean' ||
      !Number.isInteger(input.port) ||
      input.port < 1024 ||
      input.port > 65535
    )
      throw new Error('Configuração da API inválida.');
    if (!input.enabled || input.port !== this.status().port) await this.stop();
    if (input.rotate || !this.token()) this.store.secret('agent-api-token', randomBytes(32).toString('base64url'));
    this.settings.internal({ agentEnabled: input.enabled, agentPort: input.port, agentWrite: input.write });
    await this.start();
    this.store.audit('agent.configured');
    return this.status();
  }
  async start() {
    this.error = '';
    if (!this.settings.get().agentEnabled || this.server) return;
    if (!this.token()) {
      this.error = 'Gere um token nas configurações.';
      return;
    }
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 40;
    server.on('error', () => {
      this.error = 'Não foi possível abrir a porta local. Escolha outra porta.';
    });
    this.server = server;
    await new Promise(resolve => {
      server.once('error', resolve);
      server.listen(this.status().port, '127.0.0.1', resolve);
    });
    if (!server.listening) this.server = null;
  }
  async stop() {
    const server = this.server;
    this.server = null;
    if (server)
      await new Promise(resolve => {
        server.close(resolve);
        server.closeIdleConnections();
      });
  }
  authorized(req) {
    const port = this.status().port;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return false;
    if (req.headers.origin) return false;
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const actual = this.token() || '';
    const hash = s => createHash('sha256').update(s).digest();
    return !!actual && timingSafeEqual(hash(supplied), hash(actual));
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (!this.authorized(req))
        return json(401, { error: 'Acesso local autenticado obrigatório; origens de navegador não são aceitas.' });
      if (req.method === 'GET' && req.url === '/api/v1')
        return json(200, {
          name: 'Advocacia Gestão API',
          version,
          tools: this.tools().map(t => ({ name: t.name, description: t.description, input: t.schema.toJSONSchema() })),
          mcp: '/mcp',
        });
      if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 160000) return json(413, { error: 'Solicitação muito grande.' });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/mcp') {
        const server = new McpServer({ name: 'advocacia-gestao', version });
        for (const tool of this.tools())
          server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, async args => {
            try {
              return { content: [{ type: 'text', text: JSON.stringify(await this.execute(tool.name, args)) }] };
            } catch (e) {
              return { isError: true, content: [{ type: 'text', text: e.message }] };
            }
          });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      const match = req.url?.match(/^\/api\/v1\/tools\/([a-z_]+)$/);
      if (!match) return json(404, { error: 'Rota não encontrada.' });
      return json(200, { result: await this.execute(match[1], body) });
    } catch (e) {
      json(400, { error: e.message || 'Solicitação inválida.' });
    }
  }
  tools() {
    const record = z.record(z.string(), z.union([z.string(), z.boolean()]));
    return [
      {
        name: 'list_records',
        description:
          'Lista contatos (clients), agenda/prazos (tasks), anotações (notes), processos (cases) ou pessoas envolvidas que não são clientes (people: parte contrária, testemunha, perito...). Filtro textual opcional, paginação; datas da agenda no horário local do computador.',
        schema: z.object({
          kind: z.enum(kinds),
          query: z.string().max(200).optional(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      },
      {
        name: 'save_record',
        description:
          'Cria ou atualiza contato, compromisso, anotação ou processo. Para editar, envie id e apenas os campos alterados. Agenda: title, due AAAA-MM-DDTHH:mm, type, priority, status, clientId opcional. Contato: name e phone (WhatsApp com DDD) obrigatórios; email e birthDate AAAA-MM-DD opcionais. Automação de aniversário exige ativação local no cadastro. Contato também aceita personType (Física/Jurídica), document (CPF/CNPJ validado), nationality, maritalStatus, profession, rg, rgIssuer, legalRepresentative, representativeDocument, zip, street, addressNumber, complement, district, city, state (UF). Processo: title, status (Em andamento/Aguardando/Concluído/Arquivado), number (CNJ de 20 dígitos tem o dígito verificador conferido), clientId, clientRole (Polo ativo/Polo passivo/Terceiro interessado), opposingParty, opposingDocument, opposingLawyer, opposingLawyerOab (12345/UF), county, court (vara), instance, judge, phase, procedure, claimValue (reais), filedAt AAAA-MM-DD, tags, parentCaseId, secret (booleano). Pessoa: name, role (Parte contrária, Advogado da parte contrária, Testemunha, Perito, Assistente técnico, Correspondente, Servidor / cartório, Outro), document, email, phone, oab, caseId, notes. Lançamento financeiro (finance): description, direction (Receita/Despesa), category, amount (reais), dueDate e paidDate AAAA-MM-DD, method, clientId, caseId, reimbursable (booleano). Anotação: title,content.',
        schema: z.object({ kind: z.enum(kinds), id: z.string().uuid().optional(), data: record }),
      },
      {
        name: 'delete_record',
        description: 'Exclui um cadastro; vínculos existentes impedem exclusão.',
        schema: z.object({ kind: z.enum(kinds), id: z.string().uuid() }),
      },
      { name: 'list_templates', description: 'Lista grupos e modelos locais.', schema: z.object({}) },
      {
        name: 'save_template_group',
        description: 'Cria ou renomeia grupo de modelos.',
        schema: z.object({ id: z.string().uuid().optional(), name: z.string().min(1).max(100) }),
      },
      {
        name: 'save_template',
        description: 'Cria ou edita modelo. Conteúdo HTML é sanitizado.',
        schema: z.object({
          id: z.string().uuid().optional(),
          groupId: z.string().uuid(),
          kind: z.enum(['document', 'whatsapp', 'email']).optional(),
          purpose: z.enum(['general', 'birthday']).optional(),
          emailDesign: z.record(z.string(), z.unknown()).optional(),
          subject: z.string().max(300).optional(),
          title: z.string().max(200),
          body: z.string().max(60000),
          html: z.string().max(90000).optional(),
        }),
      },
      {
        name: 'delete_template',
        description: 'Exclui modelo ou grupo vazio.',
        schema: z.object({ type: z.enum(['group', 'template']), id: z.string().uuid() }),
      },
      {
        name: 'list_message_schedules',
        description: 'Lista disparos para revisão. Não inclui anexos nem credenciais.',
        schema: z.object({
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      },
      {
        name: 'draft_message_schedule',
        description:
          'Cria proposta de disparo em revisão. O usuário precisa editar e confirmar na tela Mensagens para autorizar envio. scheduledFor é ISO UTC; não envia automaticamente.',
        schema: z.object({
          channel: z.enum(['email', 'whatsapp']),
          recipient: z.string().max(254),
          subject: z.string().max(300).optional(),
          body: z.string().max(30000),
          scheduledFor: z.string().optional(),
          clientId: z.string().uuid().optional(),
          caseId: z.string().uuid().optional(),
        }),
      },
      {
        name: 'draft_recurring_message_schedule',
        description:
          'Propõe disparos em datas específicas ou repetição semanal/mensal. Todas as ocorrências ficam em revisão até confirmação individual no aplicativo.',
        schema: z.object({
          message: z.object({
            channel: z.enum(['email', 'whatsapp']),
            recipient: z.string().max(254),
            subject: z.string().max(300).optional(),
            body: z.string().max(30000),
            scheduledFor: z.string(),
            clientId: z.string().uuid().optional(),
            caseId: z.string().uuid().optional(),
          }),
          recurrence: z.object({
            frequency: z.enum(['weekly', 'monthly', 'dates']),
            timeZone: z.string().max(80),
            count: z.number().int().min(2).max(260).optional(),
            interval: z.number().int().min(1).max(12).optional(),
            dates: z.array(z.string()).max(99).optional(),
          }),
        }),
      },
      {
        name: 'revise_message_schedule',
        description:
          'Altera uma proposta ou disparo pendente, mantendo em revisão. Requer confirmação local para autorizar o novo envio.',
        schema: z.object({
          id: z.string().uuid(),
          channel: z.enum(['email', 'whatsapp']),
          recipient: z.string().max(254),
          subject: z.string().max(300).optional(),
          body: z.string().max(30000),
          scheduledFor: z.string().optional(),
          clientId: z.string().uuid().optional(),
          caseId: z.string().uuid().optional(),
        }),
      },
      {
        name: 'cancel_message_schedule',
        description: 'Cancela disparo pendente; não reativa ou autoriza envios.',
        schema: z.object({ id: z.string().uuid() }),
      },
      {
        name: 'get_case_summary',
        description:
          'Resumo de um processo: dados, cliente, partes e pessoas, próximos compromissos, últimos andamentos e financeiro. Somente leitura.',
        schema: z.object({ caseId: z.string().uuid() }),
      },
      {
        name: 'list_deadlines',
        description:
          'Prazos, audiências e demais compromissos pendentes entre duas datas (AAAA-MM-DD), em ordem. Somente leitura.',
        schema: z.object({
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          includeDone: z.boolean().optional(),
        }),
      },
      {
        name: 'calculate_deadline',
        description:
          'Calcula o vencimento de um prazo processual com feriados, recesso e o calendário do escritório, devolvendo a memória de cálculo. rule: cpc, clt, jec ou cpp; mode: publicacao ou disponibilizacao. Resultado para conferência, não cria compromisso.',
        schema: z.object({
          start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          days: z.number().int().min(1).max(365),
          rule: z.enum(['cpc', 'clt', 'jec', 'cpp']).default('cpc'),
          mode: z.enum(['publicacao', 'disponibilizacao']).default('publicacao'),
          double: z.boolean().default(false),
          profile: z.enum(['padrao', 'federal']).default('padrao'),
          courtId: z.string().max(60).optional(),
        }),
      },
      {
        name: 'calculate_debt',
        description:
          'Atualiza um valor com os índices do Banco Central já baixados no aplicativo. correction: none, IPCA, INPC, IGP-M ou IPCA-E; interest: none, simple, legal, cc ou selic. Somente leitura.',
        schema: z.object({
          principal: z.string().max(20),
          start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          correction: z.enum(['none', 'IPCA', 'INPC', 'IGP-M', 'IPCA-E']).default('IPCA'),
          interest: z.enum(['none', 'simple', 'legal', 'cc', 'selic']).default('none'),
          rate: z.string().max(10).optional(),
          interestFrom: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          fine: z.string().max(6).optional(),
          fees: z.string().max(6).optional(),
          selicMode: z.enum(['composta', 'simples']).optional(),
        }),
      },
      {
        name: 'preview_document',
        description:
          'Preenche um modelo de documento com os dados do cliente/processo e devolve o texto como rascunho, com os dados que faltam e as perguntas do modelo. Não salva arquivo.',
        schema: z.object({
          templateId: z.string().uuid(),
          caseId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          answers: z.record(z.string(), z.string()).optional(),
        }),
      },
      {
        name: 'list_movements',
        description:
          'Andamentos de um processo já obtidos do DataJud ou registrados pelo escritório. Não consulta o CNJ.',
        schema: z.object({ caseId: z.string().uuid() }),
      },
      {
        name: 'list_intimations',
        description:
          'Intimações do Diário de Justiça Eletrônico Nacional já baixadas pelo aplicativo. status: new, done, dismissed ou all.',
        schema: z.object({
          status: z.enum(['new', 'done', 'dismissed', 'all']).default('new'),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      },
    ];
  }
  legal(name, args) {
    const need = x => {
      if (!x) throw new Error('Recurso indisponível nesta instalação.');
      return x;
    };
    switch (name) {
      case 'get_case_summary': {
        const c = this.store.get('cases', args.caseId);
        const client = c.clientId ? this.store.get('clients', c.clientId) : null;
        const today = new Date().toISOString().slice(0, 10);
        const tasks = this.store
          .list('tasks')
          .filter(t => t.caseId === c.id && t.status !== 'Concluída')
          .sort((a, b) => a.due.localeCompare(b.due));
        const finance = this.store.list('finance').filter(e => e.caseId === c.id);
        const { summarize } = require('../app/finance.mjs');
        const movements = this.datajud ? this.datajud.read(c.id).movements.slice(0, 10) : [];
        return {
          case: c,
          client: client && { id: client.id, name: client.name, email: client.email, phone: client.phone },
          people: this.store
            .list('people')
            .filter(p => p.caseId === c.id)
            .map(({ id, name, role }) => ({ id, name, role })),
          pendingTasks: tasks.map(({ id, title, type, due, priority }) => ({ id, title, type, due, priority })),
          recentMovements: movements.map(({ date, name, source }) => ({ date, name, source })),
          finance: { entries: finance.length, ...summarize(finance, today) },
        };
      }
      case 'list_deadlines': {
        const items = this.store
          .list('tasks')
          .filter(
            t =>
              (args.includeDone || t.status !== 'Concluída') &&
              (!args.from || t.due.slice(0, 10) >= args.from) &&
              (!args.to || t.due.slice(0, 10) <= args.to),
          )
          .sort((a, b) => a.due.localeCompare(b.due))
          .slice(0, 500);
        return {
          total: items.length,
          items: items.map(({ id, title, type, due, priority, status, caseId, clientId }) => ({
            id,
            title,
            type,
            due,
            priority,
            status,
            caseId,
            clientId,
          })),
        };
      }
      case 'calculate_deadline': {
        const { calculateDeadline } = require('../app/deadlines.mjs');
        return calculateDeadline({
          ...args,
          custom: this.settings.get().courtCalendar || [],
          courtId: args.courtId || '',
        });
      }
      case 'calculate_debt': {
        const { calculateDebt, seriesNeeded } = require('../app/debt.mjs');
        return calculateDebt({ ...args, series: need(this.indices).values(seriesNeeded(args)) });
      }
      case 'preview_document': {
        const { blocksText } = require('../app/document-template.mjs');
        const r = need(this.generator).preview(args);
        return {
          text: blocksText(r.blocks),
          missing: r.missing,
          invalid: r.invalid,
          questions: r.questions,
          draft: true,
        };
      }
      case 'list_movements': {
        this.store.get('cases', args.caseId);
        return need(this.datajud).read(args.caseId);
      }
      case 'list_intimations': {
        const items = need(this.djen)
          .list(1000)
          .filter(i => args.status === 'all' || i.status === args.status);
        return { total: items.length, items: items.slice(0, args.limit) };
      }
    }
  }
  async execute(name, args) {
    if (this.requireTerms && this.settings.get().termsAcceptedVersion !== require('../app/terms.json').version)
      throw new Error('Aceite os termos no aplicativo antes de usar a integração.');
    const tool = this.tools().find(t => t.name === name);
    if (!tool) throw new Error('Ferramenta não encontrada.');
    args = tool.schema.parse(args);
    const read = ['list_records', 'list_templates', 'list_message_schedules', ...legalReadTools].includes(name);
    if (!read && !this.settings.get().agentWrite) throw new Error('Edição por agentes desativada nas configurações.');
    return this.operations.run('Integração com agente', () => {
      if (legalReadTools.includes(name)) return this.legal(name, args);
      switch (name) {
        case 'list_records': {
          let items = this.store.list(args.kind);
          if (args.query)
            items = items.filter(r =>
              Object.values(r).some(v => String(v).toLowerCase().includes(args.query.toLowerCase())),
            );
          return { total: items.length, items: items.slice(args.offset, args.offset + args.limit) };
        }
        case 'save_record': {
          const previous = args.id ? this.store.get(args.kind, args.id) : {};
          if (
            args.kind === 'clients' &&
            (args.data.birthdayEnabled === true ||
              (previous.birthdayEnabled &&
                ['birthDate', 'birthdayTime', 'birthdayTemplateId'].some(
                  k => k in args.data && args.data[k] !== previous[k],
                )))
          )
            throw new Error('Ative ou altere o envio automático de aniversário no cadastro local do cliente.');
          if (
            args.kind === 'tasks' &&
            [
              'clientReminder',
              'reminderLead',
              'reminderTime',
              'reminderTemplateId',
              'reminderMessageId',
              'reminderKey',
            ].some(k => k in args.data)
          )
            throw new Error('Ative ou altere o aviso ao cliente no cadastro local do compromisso.');
          const saved = this.store.save(args.kind, { ...previous, ...args.data, id: args.id });
          /* A date changed by an agent reschedules the client reminder, which then waits for local review. */ if (
            args.kind === 'tasks' &&
            this.reminders
          )
            return this.reminders.sync(saved, { review: true }).task;
          return saved;
        }
        case 'delete_record': {
          const before = args.kind === 'tasks' ? this.store.get('tasks', args.id) : null;
          this.store.remove(args.kind, args.id);
          if (before && this.reminders) this.reminders.cancel(before);
          return { removed: true };
        }
        case 'list_templates':
          return { groups: this.library.groups(), templates: this.library.list() };
        case 'save_template_group':
          return this.library.saveGroup(args);
        case 'save_template':
          return this.library.save(args);
        case 'delete_template':
          return this.library.remove(args.type, args.id);
        case 'list_message_schedules': {
          const items = this.messaging.list();
          return {
            total: items.length,
            items: items
              .slice(args.offset, args.offset + args.limit)
              .map(({ attachmentIds, ...m }) => ({ ...m, attachmentCount: attachmentIds?.length || 0 })),
          };
        }
        case 'draft_recurring_message_schedule':
          return this.messaging.series(args.message, args.recurrence, true);
        case 'revise_message_schedule': {
          this.store.db.exec('BEGIN');
          try {
            this.messaging.edit(args.id, args);
            this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(args.id);
            this.store.db.exec('COMMIT');
            return { id: args.id, status: 'needs_review', requiresLocalApproval: true };
          } catch (e) {
            this.store.db.exec('ROLLBACK');
            throw e;
          }
        }
        case 'draft_message_schedule': {
          this.store.db.exec('BEGIN');
          try {
            const id = this.messaging.enqueue(args);
            this.store.db.prepare("UPDATE queue SET status='needs_review' WHERE id=?").run(id);
            this.store.db.exec('COMMIT');
            return { id, status: 'needs_review', requiresLocalApproval: true };
          } catch (e) {
            this.store.db.exec('ROLLBACK');
            throw e;
          }
        }
        case 'cancel_message_schedule':
          this.messaging.change(args.id, 'cancel');
          return { cancelled: true };
      }
    });
  }
}
module.exports = { AgentAPI };
