import { useMemo, useState } from 'react';
import {
  Bell,
  Calculator,
  CalendarPlus,
  Check,
  ExternalLink,
  FileDown,
  FilePlus2,
  MessageCircle,
  RefreshCw,
  Search,
  X,
  BriefcaseBusiness,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Button, Empty, PageHeading, Panel, dateTime } from './components.jsx';
import { groupByProcess, kindOf, paragraphs, findDeadlines, findEvent, urgency } from '../../app/intimation-text.mjs';
import PublicationText from './PublicationText.jsx';
import IntimationSearch from './IntimationSearch.jsx';

const statusLabels = { new: 'Nova', done: 'Tratada', dismissed: 'Descartada' };
const statusTone = { new: 'amber', done: 'green', dismissed: 'neutral' };
const poloLabels = { A: 'Polo ativo', P: 'Polo passivo', T: 'Terceiro', D: 'Destinatário' };
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const br = key => (key ? key.split('-').reverse().join('/') : '');
// The next working day (weekends only; the calculator knows the court holidays).
function nextWorkingDay(key) {
  const d = new Date(key + 'T12:00:00');
  do d.setDate(d.getDate() + 1);
  while ([0, 6].includes(d.getDay()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const norm = s => String(s || '').toLowerCase();

// Communications published in the DJEN for the office's lawyers, grouped by process, with the actions that follow.
export default function Intimations({
  data,
  act,
  openDetail,
  navigateSettings,
  calculateDeadline,
  create,
  composeMessage,
}) {
  const [status, setStatus] = useState('new');
  const [type, setType] = useState('');
  const [court, setCourt] = useState('');
  const [lawyer, setLawyer] = useState('');
  const [linked, setLinked] = useState('');
  const [period, setPeriod] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('urgency');
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState(false);
  const all = useMemo(() => data.intimations || [], [data.intimations]);
  const cases = useMemo(() => new Map(data.entities.cases.map(c => [c.id, c])), [data.entities.cases]);
  const clients = useMemo(() => new Map(data.entities.clients.map(c => [c.id, c])), [data.entities.clients]);
  const enabled = data.settings.djenEnabled;
  const health = data.djenHealth;
  const today = todayKey();
  const counts = { new: 0, done: 0, dismissed: 0, all: all.length };
  for (const i of all) counts[i.status]++;
  const courts = [...new Set(all.map(i => i.tribunal).filter(Boolean))].sort();
  const lawyers = [...new Set(all.flatMap(i => (i.lawyers || []).map(l => `${l.oab}/${l.uf}`)))].sort();
  const cutoff = period ? new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10) : '';
  const filtered = all.filter(i => {
    if (status !== 'all' && i.status !== status) return false;
    if (type && kindOf(i.tipo).key !== type) return false;
    if (court && i.tribunal !== court) return false;
    if (lawyer && !(i.lawyers || []).some(l => `${l.oab}/${l.uf}` === lawyer)) return false;
    if (linked === 'yes' && !i.caseId) return false;
    if (linked === 'no' && i.caseId) return false;
    if (cutoff && i.date < cutoff) return false;
    if (query) {
      const q = norm(query).replace(/[.\-/]/g, '');
      const hay = norm(
        [i.processo, i.processoMascara, i.texto, i.classe, i.orgao, ...(i.parties || []).map(p => p.nome)].join(' '),
      ).replace(/[.\-/]/g, '');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const groups = groupByProcess(filtered).map(g => {
    const levels = g.items.map(i => urgency(i, today));
    const rank = { high: 0, medium: 1, normal: 2 };
    const level = levels.map(l => l.level).sort((a, b) => rank[a] - rank[b])[0] || 'normal';
    return { ...g, level, caseItem: cases.get(g.items.find(i => i.caseId)?.caseId) };
  });
  if (sort === 'urgency') {
    const rank = { high: 0, medium: 1, normal: 2 };
    groups.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  const set = (id, next) => act(() => window.advocacia.setIntimation({ id, status: next }));
  const failing = health?.failingDays >= 3;
  return (
    <>
      <PageHeading title="Intimações" count={counts.new}>
        <Button tone="secondary" icon={Search} onClick={() => setSearch(true)}>
          Buscar publicações
        </Button>
        {enabled ? (
          <Button
            icon={RefreshCw}
            onClick={() =>
              act(async () => {
                const r = await window.advocacia.checkIntimations();
                return r.added ? `${r.added} publicação(ões) nova(s).` : 'Nenhuma publicação nova.';
              })
            }
          >
            Verificar agora
          </Button>
        ) : (
          <Button onClick={() => navigateSettings('integrations')}>Ativar consulta ao DJEN</Button>
        )}
      </PageHeading>
      {enabled && health && (
        <div className={'conflict-alert ' + (failing ? 'danger' : 'muted')} role={failing ? 'alert' : undefined}>
          {failing ? <TriangleAlert size={16} /> : <Bell size={16} />}
          <small>
            {failing
              ? `A consulta ao DJEN falha há ${health.failingDays} dias. Confira a internet e a OAB dos advogados: uma intimação pode estar passando sem aviso.`
              : health.lastCheck
                ? `Última consulta em ${dateTime(health.lastCheck)}${health.lastResult ? `: ${health.lastResult.found} encontrada(s), ${health.lastResult.added} nova(s)` : ''}.`
                : 'Ainda não houve consulta.'}
            {health.remaining !== null && health.remaining <= 5
              ? ` Restam ${health.remaining} consultas neste minuto.`
              : ''}
            {health.retryAt ? ` Aguardando o limite do DJEN até ${dateTime(health.retryAt)}.` : ''}
            {health.error && !failing ? ` ${health.error}` : ''}
          </small>
        </div>
      )}
      <Panel>
        <div className="workspace-tabs intimation-tabs" role="tablist" aria-label="Situação">
          {[
            ['new', 'Novas'],
            ['done', 'Tratadas'],
            ['dismissed', 'Descartadas'],
            ['all', 'Todas'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={status === key}
              className={status === key ? 'active' : ''}
              onClick={() => setStatus(key)}
            >
              {label} <small>{counts[key]}</small>
            </button>
          ))}
        </div>
        <div className="intimation-filters">
          <input
            aria-label="Buscar nas intimações"
            placeholder="Número, parte ou texto"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select aria-label="Tipo" value={type} onChange={e => setType(e.target.value)}>
            <option value="">Todos os tipos</option>
            {['citation', 'intimation', 'agenda', 'edict', 'distribution', 'minutes'].map(k => (
              <option key={k} value={k}>
                {
                  {
                    citation: 'Citação',
                    intimation: 'Intimação',
                    agenda: 'Pauta de julgamento',
                    edict: 'Edital',
                    distribution: 'Distribuição',
                    minutes: 'Ata',
                  }[k]
                }
              </option>
            ))}
          </select>
          <select aria-label="Tribunal" value={court} onChange={e => setCourt(e.target.value)}>
            <option value="">Todos os tribunais</option>
            {courts.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {lawyers.length > 1 && (
            <select aria-label="Advogado (OAB)" value={lawyer} onChange={e => setLawyer(e.target.value)}>
              <option value="">Todos os advogados</option>
              {lawyers.map(l => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          <select aria-label="Processo cadastrado" value={linked} onChange={e => setLinked(e.target.value)}>
            <option value="">Com ou sem processo</option>
            <option value="yes">Com processo cadastrado</option>
            <option value="no">Sem processo cadastrado</option>
          </select>
          <select aria-label="Período" value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="">Qualquer data</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </select>
          <select aria-label="Ordenar" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="urgency">Mais urgentes primeiro</option>
            <option value="date">Mais recentes primeiro</option>
          </select>
        </div>
        {groups.length ? (
          <div className="intimation-groups">
            {groups.map(g => {
              const caseItem = g.caseItem;
              const client = caseItem ? clients.get(caseItem.clientId) : null;
              const first = g.items[0];
              const party = client
                ? (first.parties || []).find(
                    p => norm(p.nome).includes(norm(client.name)) || norm(client.name).includes(norm(p.nome)),
                  )
                : null;
              return (
                <section key={g.key} className={'intimation-card urgency-' + g.level}>
                  <header>
                    <div>
                      <h3>{g.mask || g.processo || 'Sem número de processo'}</h3>
                      <small>
                        {[client?.name, first.classe, first.orgao, first.tribunal, party && poloLabels[party.polo]]
                          .filter(Boolean)
                          .join(' · ')}
                        {!caseItem && ' · processo não cadastrado'}
                      </small>
                    </div>
                    <div className="row-actions">
                      {caseItem ? (
                        <Button
                          tone="secondary"
                          icon={BriefcaseBusiness}
                          onClick={() => openDetail('cases', caseItem.id)}
                        >
                          Abrir processo
                        </Button>
                      ) : (
                        g.processo && (
                          <Button
                            tone="secondary"
                            icon={FilePlus2}
                            onClick={() => {
                              const active = (first.parties || []).find(p => p.polo === 'A')?.nome;
                              const passive = (first.parties || []).find(p => p.polo === 'P')?.nome;
                              create('cases', {
                                number: g.mask || g.processo,
                                title:
                                  active && passive ? `${active} x ${passive}` : first.classe || `Processo ${g.mask}`,
                                court: first.orgao,
                                status: 'Em andamento',
                              });
                            }}
                          >
                            Cadastrar processo
                          </Button>
                        )
                      )}
                    </div>
                  </header>
                  <ul className="intimation-list">
                    {g.items.map(i => {
                      const kind = kindOf(i.tipo);
                      const u = urgency(i, today);
                      const deadline = findDeadlines(i.texto)[0];
                      const event = findEvent(i.texto);
                      const open = expanded[i.id];
                      const published = nextWorkingDay(i.date);
                      return (
                        <li key={i.id} className={i.status}>
                          <div className="intimation-head">
                            <time>{br(i.date)}</time>
                            <span className={'kind-tag kind-' + kind.tone}>{kind.label}</span>
                            <Badge tone={statusTone[i.status]}>{statusLabels[i.status]}</Badge>
                            {u.level !== 'normal' && u.daysLeft !== null && (
                              <span className={'urgency-tag urgency-' + u.level}>
                                {u.daysLeft < 0 ? 'Prazo aproximado vencido' : `Prazo aproximado: ${u.daysLeft} dia(s)`}
                              </span>
                            )}
                          </div>
                          <small className="intimation-meta">
                            Disponibilizada em {br(i.date)}; considera-se publicada em {br(published)} (dia útil
                            seguinte).
                            {deadline &&
                              ` O texto cita prazo de ${deadline.days} dia(s)${deadline.unit === 'uteis' ? ' úteis' : deadline.unit === 'corridos' ? ' corridos' : ''}.`}
                          </small>
                          <PublicationText text={i.texto} open={open} />
                          {paragraphs(i.texto).length > 2 || i.texto.length > 600 ? (
                            <button className="text-link" onClick={() => setExpanded({ ...expanded, [i.id]: !open })}>
                              {open ? 'Mostrar menos' : 'Ler tudo'}
                            </button>
                          ) : null}
                          <div className="row-actions intimation-actions">
                            <Button
                              tone="secondary"
                              icon={Calculator}
                              onClick={() =>
                                calculateDeadline(caseItem?.id || '', {
                                  start: i.date,
                                  mode: 'disponibilizacao',
                                  ...(deadline ? { days: deadline.days } : {}),
                                })
                              }
                            >
                              Calcular prazo{deadline ? ` (${deadline.days} dias)` : ''}
                            </Button>
                            {event && (
                              <Button
                                tone="secondary"
                                icon={CalendarPlus}
                                onClick={() =>
                                  create('tasks', {
                                    title: `${event.kind} — ${i.processoMascara || i.processo}`,
                                    type: event.kind,
                                    due: `${event.date}T${event.time || '09:00'}`,
                                    caseId: caseItem?.id || '',
                                    clientId: caseItem?.clientId || '',
                                    clientReminder: Boolean(client),
                                  })
                                }
                              >
                                Criar {event.kind.toLowerCase()} na agenda
                              </Button>
                            )}
                            {client && (
                              <Button
                                tone="ghost"
                                icon={MessageCircle}
                                onClick={() =>
                                  composeMessage({
                                    channel: 'whatsapp',
                                    recipient: client.phone,
                                    clientId: client.id,
                                    caseId: caseItem.id,
                                    body: `Olá, {primeiro_nome}! Houve uma publicação no seu processo${caseItem.number ? ` nº ${caseItem.number}` : ''} (${kind.label.toLowerCase()}, em ${br(i.date)}). A equipe do {escritorio} vai orientar os próximos passos.`,
                                  })
                                }
                              >
                                Avisar o cliente
                              </Button>
                            )}
                            {(i.hash || /\/certidao$/.test(i.link || '')) && (
                              <Button
                                tone="ghost"
                                icon={FileDown}
                                onClick={() => act(() => window.advocacia.downloadCertificate(i.id), 'Certidão salva.')}
                              >
                                Baixar certidão
                              </Button>
                            )}
                            {i.link && (
                              <Button
                                tone="ghost"
                                icon={ExternalLink}
                                onClick={() => act(() => window.advocacia.openIntimation(i.id))}
                              >
                                Abrir publicação
                              </Button>
                            )}
                            {i.status === 'new' ? (
                              <>
                                <Button tone="ghost" icon={Check} onClick={() => set(i.id, 'done')}>
                                  Marcar como tratada
                                </Button>
                                <Button tone="ghost" icon={X} onClick={() => set(i.id, 'dismissed')}>
                                  Descartar
                                </Button>
                              </>
                            ) : (
                              <Button tone="ghost" onClick={() => set(i.id, 'new')}>
                                Voltar para novas
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={Bell}
            title={status === 'new' && !query ? 'Nenhuma intimação nova' : 'Nada por aqui'}
            description={
              enabled
                ? 'As publicações do Diário de Justiça Eletrônico Nacional em nome dos advogados do escritório aparecem aqui, agrupadas por processo.'
                : 'Ative a consulta ao DJEN em Configurações → Consultas públicas para receber as publicações em nome dos advogados do escritório.'
            }
          />
        )}
        <p className="help-text intimation-help">
          A consulta usa o Diário de Justiça Eletrônico Nacional. Os destaques e o prazo aproximado são só uma ajuda de
          leitura: confira sempre a intimação no sistema do tribunal e calcule o prazo em Calcular prazo, que considera
          a data de disponibilização, a publicação no dia útil seguinte, os feriados e o recesso.
        </p>
      </Panel>
      {search && <IntimationSearch data={data} act={act} onClose={() => setSearch(false)} />}
    </>
  );
}
