import { useState } from 'react';
import {
  Users,
  BriefcaseBusiness,
  CalendarClock,
  FileText,
  NotebookPen,
  Plus,
  Upload,
  Pencil,
  Trash2,
  Download,
  ExternalLink,
  Check,
  Search,
  Filter,
  ArrowRight,
  MessageCircle,
  Mail,
  Contact,
  Handshake,
  UserCheck,
  FilePenLine,
} from 'lucide-react';
import { personRoles, intakeStatuses } from '../../app/legal-options.mjs';
import { localDateTime } from './MessageComposer.jsx';
import { messageLabels } from './Messages.jsx';
import CaseBoard from './CaseBoard.jsx';
import {
  PageHeading,
  Button,
  Panel,
  Empty,
  Badge,
  SearchBox,
  DataTable,
  initials,
  date,
  bytes,
  Calendar,
  dayKey,
  Modal,
  Toggle,
  plural,
  formatPhone,
  capitalize,
} from './components.jsx';

const config = {
  clients: { title: 'Clientes', singular: 'cliente', icon: Users },
  cases: { title: 'Processos', singular: 'processo', icon: BriefcaseBusiness },
  tasks: { title: 'Compromissos', singular: 'compromisso', icon: CalendarClock },
  documents: { title: 'Documentos', singular: 'documento', icon: FileText },
  notes: { title: 'Anotações', singular: 'anotação', icon: NotebookPen, feminine: true },
  people: { title: 'Pessoas', singular: 'pessoa', icon: Contact, feminine: true },
  intakes: { title: 'Atendimentos', singular: 'atendimento', icon: Handshake },
};
const searchable = [
  'name',
  'title',
  'number',
  'email',
  'phone',
  'document',
  'court',
  'county',
  'opposingParty',
  'judge',
  'tags',
  'city',
  'role',
  'oab',
  'area',
  'content',
  'notes',
  'type',
  'priority',
  'status',
  'ext',
];
function EditDelete({ kind, item, edit, act, remove }) {
  return (
    <>
      <button className="icon-button" aria-label={`Editar ${item.name || item.title}`} onClick={() => edit(kind, item)}>
        <Pencil size={15} />
      </button>
      <button
        className="icon-button danger"
        aria-label={`Excluir ${item.name || item.title}`}
        onClick={() => act(() => remove(kind, item.id))}
      >
        <Trash2 size={15} />
      </button>
    </>
  );
}
export default function Records({
  kind,
  data,
  create,
  edit,
  act,
  save,
  remove,
  reload,
  openDetail,
  embedded = false,
  headerExtra = null,
  generateDocument,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todos');
  // Cases can be seen as a list or as a board by phase; the choice is remembered on this computer.
  const [board, setBoard] = useState(() => {
    try {
      return kind === 'cases' && localStorage.getItem('magnum-cases-view') === 'board';
    } catch {
      return false;
    }
  });
  const toggleBoard = () =>
    setBoard(value => {
      try {
        localStorage.setItem('magnum-cases-view', value ? 'list' : 'board');
      } catch {
        /* Only a preference of this window. */
      }
      return !value;
    });
  const [importModal, setImportModal] = useState(false);
  const [links, setLinks] = useState({ clientId: '', caseId: '' });
  const cfg = config[kind];
  const all = data.entities[kind];
  const clientName = id => data.entities.clients.find(c => c.id === id)?.name || 'Sem cliente vinculado';
  const caseName = id => data.entities.cases.find(c => c.id === id)?.title || 'Sem processo vinculado';
  const today = dayKey(new Date());
  const needle = query.toLocaleLowerCase('pt-BR');
  // Lets "00000016320248090051" find "0000001-63.2024.8.09.0051", and the other way around.
  const digits = query.replace(/\D/g, '');
  const rows = all.filter(item => {
    const found =
      searchable.some(field => item[field] && String(item[field]).toLocaleLowerCase('pt-BR').includes(needle)) ||
      (digits.length >= 6 && [item.number, item.document].some(v => v && v.replace(/\D/g, '').includes(digits))) ||
      (item.clientId && clientName(item.clientId).toLocaleLowerCase('pt-BR').includes(needle));
    if (!found) return false;
    if (filter === 'Todos') return true;
    if (filter === 'Hoje') return item.due?.startsWith(today);
    if (filter === 'Atrasados') return item.status !== 'Concluída' && item.due < today + 'T00:00';
    if (kind === 'people') return item.role === filter;
    return item.status === filter;
  });
  const filters =
    kind === 'clients'
      ? ['Todos', 'Ativo', 'Inativo']
      : kind === 'cases'
        ? ['Todos', 'Em andamento', 'Aguardando', 'Concluído', 'Arquivado']
        : kind === 'tasks'
          ? ['Todos', 'Pendente', 'Hoje', 'Atrasados', 'Concluída']
          : kind === 'people'
            ? ['Todos', ...personRoles.filter(r => all.some(p => p.role === r))]
            : kind === 'intakes'
              ? ['Todos', ...intakeStatuses]
              : [];
  const columns = {
    clients: [
      {
        key: 'name',
        label: 'Cliente',
        value: c => c.name,
        render: c => {
          const count = data.entities.cases.filter(x => x.clientId === c.id).length;
          return (
            <button className="person-cell" onClick={() => openDetail('clients', c.id)}>
              <span className="avatar">{initials(c.name)}</span>
              <div>
                <strong>{c.name}</strong>
                <small>{plural(count, 'processo vinculado', 'processos vinculados')}</small>
              </div>
            </button>
          );
        },
      },
      {
        key: 'contact',
        label: 'Contato',
        value: c => c.email || c.phone,
        render: c => (
          <div className="cell-stack">
            <span>{c.email || 'E-mail não informado'}</span>
            <small>{formatPhone(c.phone) || 'Telefone não informado'}</small>
          </div>
        ),
      },
      {
        key: 'document',
        label: 'CPF / CNPJ',
        className: 'mono',
        render: c => (c.document ? c.document.replace(/\d(?=.{4})/g, '•') : '—'),
      },
      { key: 'status', label: 'Situação', value: c => c.status, render: c => <Badge>{c.status}</Badge> },
      {
        key: 'actions',
        label: 'Ações',
        render: c => (
          <div className="row-actions">
            <EditDelete {...{ kind, item: c, edit, act, remove }} />
          </div>
        ),
      },
    ],
    cases: [
      {
        key: 'title',
        label: 'Processo',
        value: c => c.title,
        render: c => (
          <button className="cell-open" onClick={() => openDetail('cases', c.id)}>
            <strong>{c.title}</strong>
            <small className="tabular">{c.number || 'Sem número informado'}</small>
          </button>
        ),
      },
      {
        key: 'client',
        label: 'Cliente',
        value: c => clientName(c.clientId),
        render: c => (
          <div className="cell-stack">
            <span>{clientName(c.clientId)}</span>
            {c.opposingParty && <small>× {c.opposingParty}</small>}
          </div>
        ),
      },
      { key: 'area', label: 'Área', value: c => c.area, render: c => <span className="area-tag">{c.area}</span> },
      { key: 'status', label: 'Situação', value: c => c.status, render: c => <Badge>{c.status}</Badge> },
      {
        key: 'actions',
        label: 'Ações',
        render: c => (
          <div className="row-actions">
            <button
              className="icon-button"
              aria-label={`Adicionar prazo a ${c.title}`}
              onClick={() => create('tasks', { caseId: c.id, clientId: c.clientId })}
            >
              <CalendarClock size={15} />
            </button>
            <EditDelete {...{ kind, item: c, edit, act, remove }} />
          </div>
        ),
      },
    ],
    intakes: [
      {
        key: 'date',
        label: 'Data',
        value: i => i.date,
        render: i => <span className="tabular">{date(i.date + 'T12:00', { year: 'numeric' })}</span>,
      },
      {
        key: 'name',
        label: 'Atendimento',
        value: i => i.name,
        render: i => (
          <button className="cell-open" onClick={() => edit('intakes', i)}>
            <strong>{i.name}</strong>
            <small>{(i.subject || '').split('\n')[0].slice(0, 90) || i.area || 'Sem assunto'}</small>
          </button>
        ),
      },
      { key: 'source', label: 'Origem', value: i => i.source, render: i => i.source || '—' },
      {
        key: 'followUp',
        label: 'Retorno',
        value: i => i.followUp,
        render: i =>
          i.followUp ? (
            <span
              className={
                'tabular ' +
                (i.followUp <= today && !['Contratado', 'Não contratado'].includes(i.status) ? 'danger-text' : '')
              }
            >
              {date(i.followUp + 'T12:00', { year: 'numeric' })}
            </span>
          ) : (
            '—'
          ),
      },
      { key: 'status', label: 'Situação', value: i => i.status, render: i => <Badge>{i.status}</Badge> },
      {
        key: 'actions',
        label: 'Ações',
        render: i => (
          <div className="row-actions">
            {i.convertedClientId ? (
              <button
                className="icon-button"
                aria-label={`Abrir cliente de ${i.name}`}
                title="Abrir cliente"
                onClick={() => openDetail('clients', i.convertedClientId)}
              >
                <Users size={15} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label={`Converter ${i.name} em cliente`}
                title="Converter em cliente e processo"
                onClick={async () => {
                  const result = await act(
                    () => window.advocacia.convertIntake({ id: i.id }),
                    'Atendimento convertido em cliente e processo.',
                  );
                  if (result?.client) openDetail('clients', result.client.id);
                }}
              >
                <UserCheck size={15} />
              </button>
            )}
            <EditDelete {...{ kind, item: i, edit, act, remove }} />
          </div>
        ),
      },
    ],
    people: [
      {
        key: 'name',
        label: 'Pessoa',
        value: p => p.name,
        render: p => (
          <button className="person-cell" onClick={() => edit('people', p)}>
            <span className="avatar">{initials(p.name)}</span>
            <div>
              <strong>{p.name}</strong>
              <small>{[p.document, p.oab && `OAB ${p.oab}`].filter(Boolean).join(' · ') || p.role}</small>
            </div>
          </button>
        ),
      },
      { key: 'role', label: 'Papel', value: p => p.role, render: p => <Badge tone="neutral">{p.role}</Badge> },
      {
        key: 'case',
        label: 'Processo',
        value: p => caseName(p.caseId),
        render: p =>
          p.caseId ? (
            <button className="text-link" onClick={() => openDetail('cases', p.caseId)}>
              {caseName(p.caseId)}
            </button>
          ) : (
            '—'
          ),
      },
      {
        key: 'contact',
        label: 'Contato',
        value: p => p.email || p.phone,
        render: p => (
          <div className="cell-stack">
            <span>{p.email || '—'}</span>
            {p.phone && <small>{p.phone}</small>}
          </div>
        ),
      },
      {
        key: 'actions',
        label: 'Ações',
        render: p => (
          <div className="row-actions">
            <EditDelete {...{ kind, item: p, edit, act, remove }} />
          </div>
        ),
      },
    ],
    tasks: [
      {
        key: 'title',
        label: 'Compromisso',
        value: t => t.title,
        render: t => (
          <div className="task-cell">
            <button
              className={'task-checkbox ' + (t.status === 'Concluída' ? 'done' : '')}
              aria-label={`${t.status === 'Concluída' ? 'Reabrir' : 'Concluir'} ${t.title}`}
              onClick={() =>
                act(
                  () => save(kind, { ...t, status: t.status === 'Concluída' ? 'Pendente' : 'Concluída' }),
                  'Compromisso atualizado.',
                )
              }
            >
              <Check size={13} />
            </button>
            <button
              className={'cell-open ' + (t.status === 'Concluída' ? 'completed' : '')}
              onClick={() => edit(kind, t)}
            >
              <strong>{t.title}</strong>
              <small>
                {t.type} · {t.status}
              </small>
            </button>
          </div>
        ),
      },
      {
        key: 'due',
        label: 'Data e horário',
        value: t => t.due,
        render: t => (
          <div className="cell-stack">
            <span className={t.status !== 'Concluída' && t.due < today + 'T00:00' ? 'danger-text' : ''}>
              {date(t.due, { year: 'numeric' })}
            </span>
            <small>{t.due.slice(11)}</small>
          </div>
        ),
      },
      {
        key: 'link',
        label: 'Vínculo',
        render: t => (t.caseId ? caseName(t.caseId) : t.clientId ? clientName(t.clientId) : '—'),
      },
      { key: 'priority', label: 'Prioridade', value: t => t.priority, render: t => <Badge>{t.priority}</Badge> },
      {
        key: 'actions',
        label: 'Ações',
        render: t => (
          <div className="row-actions">
            <EditDelete {...{ kind, item: t, edit, act, remove }} />
          </div>
        ),
      },
    ],
    documents: [
      {
        key: 'name',
        label: 'Documento',
        value: d => d.name,
        render: d => (
          <button className="document-cell" onClick={() => act(() => window.advocacia.openDocument(d.id))}>
            <span className="file-icon">
              <FileText size={20} />
            </span>
            <div>
              <strong>{d.name}</strong>
              <small>{d.ext.slice(1).toUpperCase()} · Criptografado</small>
            </div>
          </button>
        ),
      },
      {
        key: 'link',
        label: 'Vínculo',
        render: d => (d.caseId ? caseName(d.caseId) : d.clientId ? clientName(d.clientId) : 'Acervo geral'),
      },
      { key: 'size', label: 'Tamanho', value: d => String(d.size).padStart(14, '0'), render: d => bytes(d.size) },
      {
        key: 'validUntil',
        label: 'Validade',
        value: d => d.validUntil || '9999',
        render: d => (
          <input
            type="date"
            className="inline-date"
            aria-label={`Validade de ${d.name}`}
            value={d.validUntil || ''}
            onChange={e => act(() => window.advocacia.setDocumentValidity({ id: d.id, validUntil: e.target.value }))}
          />
        ),
      },
      {
        key: 'createdAt',
        label: 'Importado em',
        value: d => d.createdAt,
        render: d => date(d.createdAt, { year: 'numeric' }),
      },
      {
        key: 'actions',
        label: 'Ações',
        render: d => (
          <div className="row-actions">
            {d.generation && generateDocument && (
              <button
                className="icon-button"
                aria-label={`Gerar de novo ${d.name}`}
                title="Gerar de novo com as mesmas respostas"
                onClick={() =>
                  generateDocument({
                    templateId: d.generation.templateId,
                    answers: d.generation.answers,
                    values: d.generation.values,
                    lawyers: d.generation.lawyers,
                    layout: d.generation.layout,
                    ...(d.caseId ? { caseId: d.caseId } : d.clientId ? { clientId: d.clientId } : {}),
                  })
                }
              >
                <FilePenLine size={15} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`Abrir ${d.name}`}
              onClick={() => act(() => window.advocacia.openDocument(d.id))}
            >
              <ExternalLink size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Exportar ${d.name}`}
              onClick={() => act(() => window.advocacia.exportDocument(d.id), 'Documento exportado.')}
            >
              <Download size={15} />
            </button>
            <button
              className="icon-button danger"
              aria-label={`Excluir ${d.name}`}
              onClick={() => act(() => remove(kind, d.id))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      },
    ],
  };
  const newLabel = `${cfg.feminine ? 'Nova' : 'Novo'} ${cfg.singular}`;
  const importDocuments = () =>
    act(async () => {
      const result = await window.advocacia.importDocument(links);
      await reload();
      if (result.length) setImportModal(false);
      return result.length ? `${result.length} documento(s) importado(s).` : false;
    });
  return (
    <>
      {!embedded && (
        <PageHeading title={cfg.title} count={all.length}>
          {kind === 'documents' ? (
            <>
              {generateDocument && (
                <Button tone="secondary" icon={FilePenLine} onClick={() => generateDocument({})}>
                  Gerar documento
                </Button>
              )}
              <Button icon={Upload} onClick={() => setImportModal(true)}>
                Importar documentos
              </Button>
            </>
          ) : (
            <Button icon={Plus} onClick={() => create(kind)}>
              {newLabel}
            </Button>
          )}
        </PageHeading>
      )}
      {headerExtra}
      <Panel className="records-panel">
        <div className="records-toolbar">
          <div className="tabs" role="tablist" aria-label="Filtrar registros">
            {filters.map(f => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={filter === f ? 'active' : ''}
                onClick={() => setFilter(f)}
              >
                {f === 'Todos' && kind === 'tasks' ? 'Todos os compromissos' : f}
              </button>
            ))}
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder={`Buscar ${cfg.title.toLowerCase()}...`} />
          {kind === 'cases' && !embedded && (
            <button className="text-link" onClick={toggleBoard} aria-pressed={board}>
              {board ? 'Ver em lista' : 'Ver quadro por fase'}
            </button>
          )}
        </div>
        {!rows.length ? (
          <Empty
            icon={query ? Search : cfg.icon}
            title={
              all.length
                ? 'Nenhum registro encontrado'
                : cfg.feminine
                  ? `Nenhuma ${cfg.singular} cadastrada`
                  : `Nenhum ${cfg.singular} cadastrado`
            }
            description={
              all.length
                ? 'Experimente outra busca ou altere o filtro selecionado.'
                : kind === 'documents'
                  ? 'Importe documentos do computador. Os arquivos serão criptografados automaticamente.'
                  : kind === 'people'
                    ? 'Cadastre partes contrárias, testemunhas, peritos e correspondentes. O sistema avisa quando alguém já está do outro lado em outro processo.'
                    : `Cadastre ${cfg.feminine ? 'uma' : 'um'} ${cfg.singular} para começar.`
            }
            action={
              all.length ? (
                <Button
                  tone="secondary"
                  onClick={() => {
                    setQuery('');
                    setFilter('Todos');
                  }}
                >
                  Limpar filtros
                </Button>
              ) : (
                <Button
                  tone="secondary"
                  icon={kind === 'documents' ? Upload : Plus}
                  onClick={() => (kind === 'documents' ? setImportModal(true) : create(kind))}
                >
                  {kind === 'documents' ? 'Escolher arquivos' : `Cadastrar ${cfg.singular}`}
                </Button>
              )
            }
          />
        ) : kind === 'cases' && board && !embedded ? (
          <CaseBoard cases={rows} clients={data.entities.clients} save={save} openDetail={openDetail} />
        ) : kind === 'notes' ? (
          <div className="notes-grid">
            {rows.map(item => (
              <article className="note-card" key={item.id}>
                <div>
                  <NotebookPen size={16} />
                  <div className="row-actions">
                    <EditDelete {...{ kind, item, edit, act, remove }} />
                  </div>
                </div>
                <button className="note-open" onClick={() => edit(kind, item)}>
                  <h3>{item.title}</h3>
                  <p>{item.content}</p>
                </button>
                {item.caseId && <small>{caseName(item.caseId)}</small>}
                <footer>Atualizada em {date(item.updatedAt, { year: 'numeric' })}</footer>
              </article>
            ))}
          </div>
        ) : (
          <DataTable
            label={cfg.title}
            rowKey={row => row.id}
            rows={rows}
            columns={columns[kind]}
            initialSort={kind === 'tasks' ? { key: 'due', dir: 'asc' } : undefined}
            onRowClick={kind === 'clients' || kind === 'cases' ? row => openDetail(kind, row.id) : undefined}
          />
        )}
        <div className="table-footer">
          <span>
            {rows.length} de {plural(all.length, 'registro')}
          </span>
          {(query || filter !== 'Todos') && (
            <span>
              <Filter size={13} />
              Filtro aplicado
            </span>
          )}
        </div>
      </Panel>
      {importModal && (
        <Modal
          title="Importar documentos"
          subtitle="Vincule os arquivos a um cliente ou processo, se desejar."
          onClose={() => setImportModal(false)}
        >
          <div className="form-grid">
            <label className="field">
              <span>Cliente vinculado</span>
              <select value={links.clientId} onChange={e => setLinks(l => ({ ...l, clientId: e.target.value }))}>
                <option value="">Acervo geral</option>
                {data.entities.clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Processo vinculado</span>
              <select value={links.caseId} onChange={e => setLinks(l => ({ ...l, caseId: e.target.value }))}>
                <option value="">Sem processo</option>
                {data.entities.cases.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="help-text full">
              Selecione documentos, imagens ou planilhas de até 100 MB por arquivo. Os originais permanecem na pasta de
              origem; a cópia no cofre é criptografada.
            </p>
          </div>
          <div className="form-footer">
            <div>
              <Button tone="secondary" onClick={() => setImportModal(false)}>
                Cancelar
              </Button>
              <Button icon={Upload} onClick={importDocuments}>
                Selecionar e importar arquivos
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Agenda({ data, create, edit, composeMessage, navigate, initialView = 'calendar', ...rest }) {
  const [view, setView] = useState(initialView === 'list' ? 'list' : 'calendar');
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [exporting, setExporting] = useState(false);
  const [includeNames, setIncludeNames] = useState(false);
  const dispatches = data.messages
    .filter(m => m.scheduledFor && m.status !== 'cancelled')
    .map(m => ({
      id: m.id,
      due: localDateTime(m.scheduledFor),
      title:
        (m.autoBirthday ? '🎂 Aniversário' : m.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail') +
        ' · ' +
        (data.entities.clients.find(c => c.id === m.clientId)?.name || m.recipient),
      type:
        (m.channel === 'whatsapp' ? 'Disparo de WhatsApp' : 'Disparo de e-mail') +
        (m.seriesId ? ` · ${m.seriesIndex}/${m.seriesCount}` : ''),
      status: m.status === 'sent' ? 'Concluída' : 'Pendente',
      notes: m.body,
      sourceMessage: m,
    }));
  const all = [...data.entities.tasks, ...dispatches];
  const tasks = all.filter(t => t.due.startsWith(selected)).sort((a, b) => a.due.localeCompare(b.due));
  const scheduleDate = () =>
    selected === dayKey(new Date()) ? localDateTime(Date.now() + 3600000) : selected + 'T09:00';
  const schedule = () => composeMessage({ channel: 'whatsapp', scheduleDate: scheduleDate() }, true);
  const open = t =>
    t.sourceMessage
      ? ['pending', 'failed', 'needs_review'].includes(t.sourceMessage.status)
        ? composeMessage(t.sourceMessage)
        : navigate('messages')
      : edit('tasks', t);
  const viewTabs = (
    <div className="workspace-tabs" role="tablist" aria-label="Visão da agenda">
      {[
        ['calendar', 'Calendário'],
        ['list', 'Lista'],
      ].map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={view === id}
          className={view === id ? 'active' : ''}
          onClick={() => setView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <PageHeading title="Agenda">
        {view === 'calendar' && (
          <Button
            tone="secondary"
            onClick={() => {
              setMonth(new Date());
              setSelected(dayKey(new Date()));
            }}
          >
            Hoje
          </Button>
        )}
        <Button tone="secondary" icon={MessageCircle} onClick={schedule}>
          Agendar WhatsApp
        </Button>
        <Button
          tone="secondary"
          icon={Mail}
          onClick={() => composeMessage({ bulk: true, channel: 'email', scheduleDate: scheduleDate() }, true)}
        >
          Agendar e-mails
        </Button>
        <Button tone="secondary" icon={Download} onClick={() => setExporting(true)}>
          Exportar
        </Button>
        <Button icon={Plus} onClick={() => create('tasks', { due: selected + 'T09:00' })}>
          Novo compromisso
        </Button>
      </PageHeading>
      {exporting && (
        <Modal
          title="Exportar agenda"
          subtitle="Arquivo .ics para Google Agenda, Outlook ou celular."
          onClose={() => setExporting(false)}
        >
          <div className="settings-body">
            <p className="help-text">
              Exporta os compromissos pendentes a partir de 30 dias atrás. Prazos entram como evento de dia inteiro.
              Para atualizar, exporte de novo e importe por cima: cada compromisso tem um identificador próprio.
            </p>
            <Toggle
              checked={includeNames}
              onChange={setIncludeNames}
              title="Incluir nomes de clientes e processos"
              description="O arquivo sai do cofre sem criptografia. Sem esta opção, vão apenas o tipo e o título de cada compromisso."
            />
          </div>
          <div className="form-footer">
            <div>
              <Button tone="secondary" onClick={() => setExporting(false)}>
                Cancelar
              </Button>
              <Button
                icon={Download}
                onClick={async () => {
                  const done = await rest.act(async () => {
                    const count = await window.advocacia.exportCalendar({ includeNames });
                    return count === false ? false : `${count} compromisso(s) exportado(s).`;
                  });
                  if (done) setExporting(false);
                }}
              >
                Salvar arquivo
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {viewTabs}
      {view === 'list' ? (
        <Records kind="tasks" embedded data={data} create={create} edit={edit} {...rest} />
      ) : (
        <>
          <div className="agenda-layout">
            <Panel>
              <Calendar month={month} setMonth={setMonth} selected={selected} onSelect={setSelected} tasks={all} />
            </Panel>
            <Panel
              title={capitalize(date(selected + 'T12:00', { weekday: 'long', month: 'long', year: 'numeric' }))}
              aside={<Badge tone="neutral">{plural(tasks.length, 'evento')}</Badge>}
            >
              {tasks.length ? (
                <div className="schedule">
                  {tasks.map(t => (
                    <button
                      key={t.id}
                      className={
                        'schedule-event ' +
                        (t.status === 'Concluída' ? 'completed' : '') +
                        (t.sourceMessage ? ' dispatch-event' : '')
                      }
                      onClick={() => open(t)}
                    >
                      <time>{t.due.slice(11)}</time>
                      <div>
                        <span>
                          {t.sourceMessage && <MessageCircle size={12} />} {t.type}
                        </span>
                        <h3>{t.title}</h3>
                        <p>
                          {t.notes ||
                            data.entities.cases.find(c => c.id === t.caseId)?.title ||
                            'Compromisso do escritório'}
                        </p>
                        <Badge tone={t.sourceMessage?.status === 'needs_review' ? 'red' : undefined}>
                          {t.sourceMessage
                            ? t.sourceMessage.status === 'pending'
                              ? 'Agendada'
                              : messageLabels[t.sourceMessage.status]
                            : t.status}
                        </Badge>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={CalendarClock}
                  title="Nenhum compromisso neste dia"
                  description="Adicione um compromisso ou agende um WhatsApp para esta data."
                  action={
                    <Button tone="secondary" icon={MessageCircle} onClick={schedule}>
                      Agendar disparo
                    </Button>
                  }
                />
              )}
            </Panel>
          </div>
          <p className="help-text">
            O programa precisa estar aberto ou na bandeja para processar os disparos. Para calcular prazos processuais
            em dias úteis, com feriados e recesso, use Ferramentas → Prazos e confira o calendário do tribunal.
          </p>
        </>
      )}
    </>
  );
}
