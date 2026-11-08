import { useState } from 'react';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  Copy,
  FileText,
  FilePenLine,
  Contact,
  Calculator,
  ListChecks,
  Landmark,
  Lock,
  Mail,
  ScrollText,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  Upload,
  Trash2,
} from 'lucide-react';
import { Badge, Button, DataTable, Empty, Panel, bytes, date, dateTime, formatPhone, dayKey } from './components.jsx';
import { messageLabels } from './Messages.jsx';
import { parseCNJ } from '../../app/cnj.mjs';
import Finance from './Finance.jsx';
import Movements from './Movements.jsx';
import { qualification, clientAddress } from '../../app/qualification.mjs';

const currency = value => (value ? Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
const caseLabel = c => (c ? c.title + (c.number ? ` · ${c.number}` : '') : '');

const statusTone = status =>
  status === 'sent'
    ? 'green'
    : ['failed', 'uncertain', 'needs_review'].includes(status)
      ? 'red'
      : status === 'pending'
        ? 'amber'
        : 'neutral';
function Facts({ items }) {
  const shown = items.filter(([, value]) => value);
  return (
    <dl className="fact-list">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
// Everything about one client or case in a single place, built from the existing links.
export default function Detail({
  kind,
  id,
  data,
  back,
  navigate,
  openDetail,
  edit,
  create,
  composeMessage,
  act,
  save,
  remove,
  reload,
  generateDocument,
  calculateDeadline,
  applyWorkflow,
  navigateSettings,
}) {
  const [tab, setTab] = useState('summary');
  const isClient = kind === 'clients';
  const item = data.entities[kind].find(entry => entry.id === id);
  const today = dayKey(new Date());
  const BackLink = (
    <button className="back-link" onClick={back}>
      <ArrowLeft size={14} />
      Voltar
    </button>
  );
  if (!item)
    return (
      <>
        {BackLink}
        <Panel>
          <Empty
            title="Registro não encontrado"
            description="Ele pode ter sido excluído."
            action={
              <Button tone="secondary" onClick={() => navigate(kind)}>
                Ver lista
              </Button>
            }
          />
        </Panel>
      </>
    );
  const client = isClient ? item : data.entities.clients.find(c => c.id === item.clientId);
  const linked = entry => (isClient ? entry.clientId === id : entry.caseId === id);
  const cases = isClient ? data.entities.cases.filter(c => c.clientId === id) : [];
  const tasks = data.entities.tasks.filter(linked).sort((a, b) => a.due.localeCompare(b.due));
  const documents = data.entities.documents.filter(linked);
  const notes = data.entities.notes.filter(entry =>
    isClient ? cases.some(c => c.id === entry.caseId) || entry.clientId === id : entry.caseId === id,
  );
  const messages = data.messages.filter(linked);
  const pendingTasks = tasks.filter(t => t.status !== 'Concluída');
  const cnj = isClient ? null : parseCNJ(item.number);
  const court = cnj?.valid ? data.courts?.courts.find(c => c.id === cnj.courtId) : null;
  const parentCase = isClient ? null : data.entities.cases.find(c => c.id === item.parentCaseId);
  const childCases = isClient ? [] : data.entities.cases.filter(c => c.parentCaseId === id);
  const people = isClient ? [] : (data.entities.people || []).filter(p => p.caseId === id);
  const qualified = isClient ? qualification(item) : null;
  const tabs = [
    ['summary', 'Resumo'],
    ...(isClient ? [['cases', 'Processos', cases.length]] : []),
    ['tasks', 'Prazos', tasks.length],
    ['documents', 'Documentos', documents.length],
    ['messages', 'Mensagens', messages.length],
    ['notes', 'Anotações', notes.length],
    ...(isClient ? [] : [['people', 'Pessoas', people.length]]),
    ...(isClient ? [] : [['movements', 'Andamentos', data.movementsNew?.[id] || undefined]]),
    [
      'finance',
      'Financeiro',
      (data.entities.finance || []).filter(e => (isClient ? e.clientId === id : e.caseId === id)).length,
    ],
  ];
  const links = isClient ? { clientId: id } : { caseId: id, clientId: item.clientId };
  const copy = text =>
    act(async () => {
      await navigator.clipboard.writeText(text);
      return 'Copiado.';
    });
  const taskTable = (
    <DataTable
      label="Prazos"
      rowKey={t => t.id}
      rows={tasks}
      columns={[
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
                    () => save('tasks', { ...t, status: t.status === 'Concluída' ? 'Pendente' : 'Concluída' }),
                    'Compromisso atualizado.',
                  )
                }
              >
                <Check size={13} />
              </button>
              <button
                className={'cell-open ' + (t.status === 'Concluída' ? 'completed' : '')}
                onClick={() => edit('tasks', t)}
              >
                <strong>{t.title}</strong>
                <small>{t.type}</small>
              </button>
            </div>
          ),
        },
        {
          key: 'due',
          label: 'Data',
          value: t => t.due,
          render: t => (
            <span className={t.status !== 'Concluída' && t.due < today + 'T00:00' ? 'danger-text' : ''}>
              {date(t.due, { year: 'numeric' })} {t.due.slice(11)}
            </span>
          ),
        },
        { key: 'priority', label: 'Prioridade', value: t => t.priority, render: t => <Badge>{t.priority}</Badge> },
      ]}
    />
  );
  return (
    <>
      {BackLink}
      <div className="detail-header">
        <div>
          <h1>
            {item.name || item.title} <Badge>{item.status}</Badge>
            {item.secret && (
              <Badge tone="red">
                <Lock size={12} /> Segredo de justiça
              </Badge>
            )}
          </h1>
          <div className="detail-meta">
            {isClient ? (
              <>
                {item.phone && (
                  <span>
                    <Phone size={13} />
                    {formatPhone(item.phone)}
                  </span>
                )}
                {item.email && (
                  <span>
                    <Mail size={13} />
                    {item.email}
                  </span>
                )}
                {item.document && <span className="tabular">{item.document}</span>}
              </>
            ) : (
              <>
                {item.number && (
                  <span className="tabular">
                    {item.number}
                    <button aria-label="Copiar número do processo" onClick={() => copy(item.number)}>
                      <Copy size={13} />
                    </button>
                  </span>
                )}
                {court && <span>{court.acronym}</span>}
                {item.area && <span>{item.area}</span>}
                {item.court && <span>{item.court}</span>}
                {item.opposingParty && <span>× {item.opposingParty}</span>}
                {client && (
                  <span>
                    <button className="text-link" onClick={() => openDetail('clients', client.id)}>
                      {client.name}
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="heading-actions">
          {client?.phone && (
            <Button
              tone="secondary"
              icon={MessageCircle}
              onClick={() =>
                composeMessage({
                  channel: 'whatsapp',
                  clientId: client.id,
                  recipient: client.phone.replace(/\D/g, ''),
                  ...(isClient ? {} : { caseId: id }),
                })
              }
            >
              WhatsApp
            </Button>
          )}
          {court && (
            <Button
              tone="secondary"
              icon={Landmark}
              onClick={() => act(() => window.advocacia.courtLink({ id: court.id }))}
            >
              Abrir {court.acronym}
            </Button>
          )}
          <Button tone="secondary" icon={FilePenLine} onClick={() => generateDocument(links)}>
            Gerar documento
          </Button>
          {isClient ? (
            <Button tone="secondary" icon={Plus} onClick={() => create('tasks', links)}>
              Novo prazo
            </Button>
          ) : (
            <Button tone="secondary" icon={Calculator} onClick={() => calculateDeadline(id)}>
              Calcular prazo
            </Button>
          )}
          <Button tone="secondary" icon={Pencil} onClick={() => edit(kind, item)}>
            Editar
          </Button>
          <button
            className="icon-button danger"
            aria-label={`Excluir ${item.name || item.title}`}
            onClick={async () => {
              const done = await act(() => remove(kind, id));
              if (done) back();
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Seções">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== undefined && <small>{count}</small>}
          </button>
        ))}
      </div>
      {tab === 'summary' && (
        <div className="detail-grid">
          <Panel title="Dados">
            <Facts
              items={
                isClient
                  ? [
                      ['Pessoa', item.personType === 'Jurídica' ? 'Jurídica' : 'Física'],
                      ['Telefone', formatPhone(item.phone)],
                      ['E-mail', item.email],
                      ['CPF / CNPJ', item.document],
                      ['Representante legal', item.legalRepresentative],
                      ['Endereço', clientAddress(item)],
                      ['Recebe e-mails', item.emailPreference],
                      ['Nascimento', item.birthDate && date(item.birthDate + 'T12:00', { year: 'numeric' })],
                      ['Observações', item.notes],
                    ]
                  : [
                      ['Número', item.number],
                      ['Tribunal', court && `${court.acronym} · ${cnj.segmentName}`],
                      ['Cliente', client && [client.name, item.clientRole].filter(Boolean).join(' · ')],
                      ['Parte contrária', [item.opposingParty, item.opposingDocument].filter(Boolean).join(' · ')],
                      [
                        'Advogado contrário',
                        [item.opposingLawyer, item.opposingLawyerOab && `OAB ${item.opposingLawyerOab}`]
                          .filter(Boolean)
                          .join(' · '),
                      ],
                      ['Área', item.area],
                      ['Fase', item.phase],
                      ['Instância', item.instance],
                      ['Comarca', item.county],
                      ['Vara / órgão', item.court],
                      ['Juiz ou relator', item.judge],
                      ['Classe / rito', item.procedure],
                      ['Valor da causa', currency(item.claimValue)],
                      ['Distribuição', item.filedAt && date(item.filedAt + 'T12:00', { year: 'numeric' })],
                      ['Etiquetas', item.tags],
                      ['Observações', item.notes],
                    ]
              }
            />
          </Panel>
          {isClient && (
            <Panel
              title="Qualificação"
              icon={ScrollText}
              aside={
                <Button tone="secondary" icon={Copy} onClick={() => copy(qualified.text)}>
                  Copiar
                </Button>
              }
            >
              <div className="qualification">
                <p>{qualified.text}</p>
                {qualified.missing.length > 0 && (
                  <small className="field-hint muted">
                    Faltam no cadastro: {qualified.missing.join(', ')}.{' '}
                    <button className="text-link" onClick={() => edit(kind, item)}>
                      Completar
                    </button>
                  </small>
                )}
              </div>
            </Panel>
          )}
          {(parentCase || childCases.length > 0) && (
            <Panel title="Processos relacionados" icon={BriefcaseBusiness}>
              <ul className="timeline">
                {[...(parentCase ? [[parentCase, 'Principal']] : []), ...childCases.map(c => [c, 'Dependente'])].map(
                  ([c, role]) => (
                    <li key={c.id}>
                      <time>{role}</time>
                      <div>
                        <button className="text-link" onClick={() => openDetail('cases', c.id)}>
                          {caseLabel(c)}
                        </button>
                        <small>{c.phase || c.status}</small>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </Panel>
          )}
          <Panel title="Próximos prazos" icon={CalendarClock}>
            {pendingTasks.length ? (
              <ul className="timeline">
                {pendingTasks.slice(0, 6).map(t => (
                  <li key={t.id}>
                    <time className={t.due < today + 'T00:00' ? 'danger-text' : ''}>
                      {date(t.due)} {t.due.slice(11)}
                    </time>
                    <div>
                      <button className="text-link" onClick={() => edit('tasks', t)}>
                        {t.title}
                      </button>
                      <small>{t.type}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty
                icon={CalendarClock}
                title="Nenhum prazo pendente"
                description="Cadastre o próximo compromisso."
                action={
                  <Button tone="secondary" icon={Plus} onClick={() => create('tasks', links)}>
                    Novo prazo
                  </Button>
                }
              />
            )}
          </Panel>
        </div>
      )}
      {tab === 'cases' && (
        <Panel>
          {cases.length ? (
            <DataTable
              label="Processos"
              rowKey={c => c.id}
              rows={cases}
              onRowClick={c => openDetail('cases', c.id)}
              columns={[
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
                  key: 'area',
                  label: 'Área',
                  value: c => c.area,
                  render: c => <span className="area-tag">{c.area}</span>,
                },
                { key: 'status', label: 'Situação', value: c => c.status, render: c => <Badge>{c.status}</Badge> },
              ]}
            />
          ) : (
            <Empty
              icon={BriefcaseBusiness}
              title="Nenhum processo deste cliente"
              description="Cadastre o primeiro processo."
              action={
                <Button tone="secondary" icon={Plus} onClick={() => create('cases', { clientId: id })}>
                  Novo processo
                </Button>
              }
            />
          )}
        </Panel>
      )}
      {tab === 'tasks' && (
        <Panel
          title="Prazos e tarefas"
          aside={
            !isClient && (
              <div className="row-actions">
                <Button tone="secondary" icon={ListChecks} onClick={() => applyWorkflow(item)}>
                  Aplicar fluxo
                </Button>
                <Button tone="secondary" icon={Plus} onClick={() => create('tasks', links)}>
                  Novo compromisso
                </Button>
              </div>
            )
          }
        >
          {tasks.length ? (
            taskTable
          ) : (
            <Empty
              icon={CalendarClock}
              title="Nenhum prazo"
              description={
                isClient
                  ? 'Cadastre o primeiro compromisso.'
                  : 'Calcule um prazo, aplique o fluxo do tipo de ação ou cadastre o primeiro compromisso.'
              }
              action={
                <Button tone="secondary" icon={Plus} onClick={() => create('tasks', links)}>
                  Novo prazo
                </Button>
              }
            />
          )}
        </Panel>
      )}
      {tab === 'documents' && (
        <Panel
          title="Documentos"
          aside={
            <Button
              tone="secondary"
              icon={Upload}
              onClick={() =>
                act(async () => {
                  const result = await window.advocacia.importDocument(links);
                  await reload();
                  return result.length ? `${result.length} documento(s) importado(s).` : false;
                })
              }
            >
              Importar
            </Button>
          }
        >
          {documents.length ? (
            <DataTable
              label="Documentos"
              rowKey={d => d.id}
              rows={documents}
              columns={[
                {
                  key: 'name',
                  label: 'Documento',
                  value: d => d.name,
                  render: d => (
                    <button className="document-cell" onClick={() => act(() => window.advocacia.openDocument(d.id))}>
                      <span className="file-icon">
                        <FileText size={18} />
                      </span>
                      <div>
                        <strong>{d.name}</strong>
                      </div>
                    </button>
                  ),
                },
                {
                  key: 'size',
                  label: 'Tamanho',
                  value: d => String(d.size).padStart(14, '0'),
                  render: d => bytes(d.size),
                },
                {
                  key: 'createdAt',
                  label: 'Importado em',
                  value: d => d.createdAt,
                  render: d => date(d.createdAt, { year: 'numeric' }),
                },
              ]}
            />
          ) : (
            <Empty
              icon={FileText}
              title="Nenhum documento vinculado"
              description="Importe arquivos para este cadastro. Eles ficam criptografados no cofre local."
            />
          )}
        </Panel>
      )}
      {tab === 'messages' && (
        <Panel>
          {messages.length ? (
            <ul className="timeline">
              {messages.map(m => (
                <li key={m.id}>
                  <time>{date(m.scheduledFor || m.createdAt)}</time>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{m.subject || m.body.slice(0, 80)}</strong>
                    <small>
                      {m.channel === 'email' ? 'E-mail' : 'WhatsApp'} ·{' '}
                      {m.scheduledFor ? dateTime(m.scheduledFor) : 'Sem agendamento'}
                    </small>
                  </div>
                  <Badge tone={statusTone(m.status)}>
                    {m.status === 'pending' && m.scheduledFor ? 'Agendada' : messageLabels[m.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={MessageCircle}
              title="Nenhuma mensagem"
              description="Mensagens enviadas ou agendadas para este cadastro aparecem aqui."
            />
          )}
        </Panel>
      )}
      {tab === 'movements' && !isClient && (
        <Movements
          data={data}
          act={act}
          caseItem={item}
          navigateSettings={navigateSettings}
          composeMessage={composeMessage}
        />
      )}
      {tab === 'finance' && (
        <Finance
          {...{ data, act, create, edit, remove, save, composeMessage, generateDocument }}
          filter={isClient ? { clientId: id } : { caseId: id }}
        />
      )}
      {tab === 'people' && (
        <Panel
          title="Pessoas do processo"
          aside={
            <Button tone="secondary" icon={Plus} onClick={() => create('people', { caseId: id })}>
              Nova pessoa
            </Button>
          }
        >
          {people.length ? (
            <DataTable
              label="Pessoas"
              rowKey={p => p.id}
              rows={people}
              columns={[
                {
                  key: 'name',
                  label: 'Pessoa',
                  value: p => p.name,
                  render: p => (
                    <button className="cell-open" onClick={() => edit('people', p)}>
                      <strong>{p.name}</strong>
                      <small>{[p.document, p.oab && `OAB ${p.oab}`].filter(Boolean).join(' · ')}</small>
                    </button>
                  ),
                },
                {
                  key: 'role',
                  label: 'Papel',
                  value: p => p.role,
                  render: p => <Badge tone="neutral">{p.role}</Badge>,
                },
                {
                  key: 'contact',
                  label: 'Contato',
                  value: p => p.email || p.phone,
                  render: p => p.email || p.phone || '—',
                },
              ]}
            />
          ) : (
            <Empty
              icon={Contact}
              title="Nenhuma pessoa vinculada"
              description="Cadastre testemunhas, peritos, correspondentes e outras partes deste processo."
            />
          )}
        </Panel>
      )}
      {tab === 'notes' && (
        <Panel
          title="Anotações"
          aside={
            <Button tone="secondary" icon={Plus} onClick={() => create('notes', isClient ? {} : { caseId: id })}>
              Nova anotação
            </Button>
          }
        >
          {notes.length ? (
            <div className="notes-grid">
              {notes.map(note => (
                <article className="note-card" key={note.id}>
                  <div>
                    <NotebookPen size={16} />
                  </div>
                  <button className="note-open" onClick={() => edit('notes', note)}>
                    <h3>{note.title}</h3>
                    <p>{note.content}</p>
                  </button>
                  <footer>Atualizada em {date(note.updatedAt, { year: 'numeric' })}</footer>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={NotebookPen}
              title="Nenhuma anotação"
              description={
                isClient
                  ? 'Anotações dos processos deste cliente aparecem aqui.'
                  : 'Registre informações deste processo.'
              }
            />
          )}
        </Panel>
      )}
    </>
  );
}
