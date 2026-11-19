import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calculator,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
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
import { Badge, Button, Empty, Modal, PageHeading, Panel, dateTime } from './components.jsx';
import { kindOf } from '../../app/intimation-text.mjs';
import { caseFromIntimation, matchClient, joinNames } from '../../app/intimation-case.mjs';
import PublicationText from './PublicationText.jsx';
import IntimationSearch from './IntimationSearch.jsx';

const statusLabels = { new: 'Nova', done: 'Tratada', dismissed: 'Descartada' };
const statusTone = { new: 'amber', done: 'green', dismissed: 'neutral' };
const poloLabels = { A: 'Polo ativo', P: 'Polo passivo', T: 'Terceiro', D: 'Destinatário' };
const groupLabels = { process: 'Por processo', court: 'Por tribunal', type: 'Por tipo', day: 'Por dia' };
const typeLabels = {
  citation: 'Citação',
  intimation: 'Intimação',
  agenda: 'Pauta de julgamento',
  edict: 'Edital',
  distribution: 'Distribuição',
  minutes: 'Ata',
};
const PAGE = 15;
const br = key => (key ? key.split('-').reverse().join('/') : '');
// The next working day (weekends only; the calculator knows the court holidays).
function nextWorkingDay(key) {
  const d = new Date(key + 'T12:00:00');
  do d.setDate(d.getDate() + 1);
  while ([0, 6].includes(d.getDay()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const norm = s => String(s || '').toLowerCase();

// Communications published in the DJEN. The list comes a page at a time from the program, grouped as chosen
// (process, court, type or day), so opening the screen stays light however many publications there are.
export default function Intimations({
  data,
  act,
  openDetail,
  navigateSettings,
  calculateDeadline,
  create,
  composeMessage,
}) {
  const [filters, setFilters] = useState({
    status: 'new',
    type: '',
    court: '',
    lawyer: '',
    linked: '',
    days: '',
    query: '',
    group: 'process',
    sort: 'urgency',
  });
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({
    groups: [],
    total: 0,
    totalItems: 0,
    facets: { types: {}, courts: {}, lawyers: {} },
  });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState({});
  const [fullText, setFullText] = useState({});
  const [search, setSearch] = useState(false);
  const [askSide, setAskSide] = useState(null);
  const shown = useRef(PAGE);
  const counts = data.intimationSummary?.counts || { new: 0, done: 0, dismissed: 0 };
  const total = counts.new + counts.done + counts.dismissed;
  const cases = useMemo(() => new Map(data.entities.cases.map(c => [c.id, c])), [data.entities.cases]);
  const clients = useMemo(() => new Map(data.entities.clients.map(c => [c.id, c])), [data.entities.clients]);
  const enabled = data.settings.djenEnabled;
  const health = data.djenHealth;
  // The text box waits for a pause in typing before asking the program.
  useEffect(() => {
    const timer = setTimeout(() => setFilters(f => (f.query === typed ? f : { ...f, query: typed })), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const load = useCallback(
    async (offset, keep = false) => {
      setLoading(true);
      try {
        const limit = keep ? Math.min(200, Math.max(PAGE, shown.current)) : PAGE;
        const result = await window.advocacia.intimationsPage({ ...filters, offset: keep ? 0 : offset, limit });
        setPage(current =>
          offset > 0 && !keep ? { ...result, groups: [...current.groups, ...result.groups], offset: 0 } : result,
        );
        shown.current =
          offset > 0 && !keep ? shown.current + result.groups.length : Math.max(PAGE, result.groups.length);
      } catch {
        /* the screen keeps what it had */
      }
      setLoading(false);
    },
    [filters],
  );
  // A new filter starts from the first page; a change in the counts (something was handled) keeps what is loaded.
  useEffect(() => {
    shown.current = PAGE;
    void load(0);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps -- load depends on filters only
  useEffect(() => {
    void load(0, true);
  }, [counts.new, counts.done, counts.dismissed, total]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh in place
  const set = (ids, next, message) => act(() => window.advocacia.setIntimations({ ids, status: next }), message);
  const readAll = async id => {
    if (fullText[id]) return;
    try {
      const text = await window.advocacia.intimationText(id);
      setFullText(current => ({ ...current, [id]: text }));
    } catch {
      /* keep the beginning */
    }
  };
  const failing = health?.failingDays >= 3;
  const update = patch => setFilters(f => ({ ...f, ...patch }));

  // Register the case with what the publication says; ask which side the client is when it cannot tell.
  function registerCase(item) {
    const parties = item.parties || [];
    const known = matchClient(
      parties.filter(p => ['A', 'P'].includes(p.polo)),
      data.entities.clients,
    );
    const sides = [...new Set(known.map(k => k.party.polo))];
    if (sides.length === 1 || !parties.length) return finishCase(item, sides[0] || '');
    setAskSide(item);
  }
  function finishCase(item, side) {
    setAskSide(null);
    create(
      'cases',
      caseFromIntimation(item, { side, clients: data.entities.clients, officeLawyers: data.settings.lawyers || [] }),
    );
  }
  const filtering = filters.type || filters.court || filters.lawyer || filters.linked || filters.days || filters.query;
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
            ['new', 'Novas', counts.new],
            ['done', 'Tratadas', counts.done],
            ['dismissed', 'Descartadas', counts.dismissed],
            ['all', 'Todas', total],
          ].map(([key, label, n]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filters.status === key}
              className={filters.status === key ? 'active' : ''}
              onClick={() => update({ status: key })}
            >
              {label} <small>{n}</small>
            </button>
          ))}
        </div>
        <div className="intimation-filters">
          <input
            aria-label="Buscar nas intimações"
            placeholder="Número, parte ou texto"
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
          <select aria-label="Organizar" value={filters.group} onChange={e => update({ group: e.target.value })}>
            {Object.entries(groupLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select aria-label="Tipo" value={filters.type} onChange={e => update({ type: e.target.value })}>
            <option value="">Todos os tipos</option>
            {Object.entries(typeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
                {page.facets.types[k] ? ` (${page.facets.types[k]})` : ''}
              </option>
            ))}
          </select>
          <select aria-label="Tribunal" value={filters.court} onChange={e => update({ court: e.target.value })}>
            <option value="">Todos os tribunais</option>
            {Object.entries(page.facets.courts)
              .sort()
              .map(([c, n]) => (
                <option key={c} value={c}>
                  {c} ({n})
                </option>
              ))}
          </select>
          {Object.keys(page.facets.lawyers).length > 1 && (
            <select
              aria-label="Advogado (OAB)"
              value={filters.lawyer}
              onChange={e => update({ lawyer: e.target.value })}
            >
              <option value="">Todos os advogados</option>
              {Object.keys(page.facets.lawyers)
                .sort()
                .map(l => (
                  <option key={l}>{l}</option>
                ))}
            </select>
          )}
          <select
            aria-label="Processo cadastrado"
            value={filters.linked}
            onChange={e => update({ linked: e.target.value })}
          >
            <option value="">Com ou sem processo</option>
            <option value="yes">Com processo cadastrado</option>
            <option value="no">Sem processo cadastrado</option>
          </select>
          <select aria-label="Período" value={filters.days} onChange={e => update({ days: e.target.value })}>
            <option value="">Qualquer data</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </select>
          {filters.group === 'process' && (
            <select aria-label="Ordenar" value={filters.sort} onChange={e => update({ sort: e.target.value })}>
              <option value="urgency">Mais urgentes primeiro</option>
              <option value="date">Mais recentes primeiro</option>
            </select>
          )}
        </div>
        {page.groups.length > 0 && (
          <div className="intimation-summary">
            <small>
              {page.totalItems} publicação(ões) em {page.total} grupo(s){filtering ? ' com os filtros escolhidos' : ''}.
            </small>
            <span>
              <button
                className="text-link"
                onClick={() => setOpen(Object.fromEntries(page.groups.map(g => [g.key, true])))}
              >
                Expandir todos
              </button>{' '}
              <button className="text-link" onClick={() => setOpen({})}>
                Recolher todos
              </button>
            </span>
          </div>
        )}
        {page.groups.length ? (
          <div className="intimation-groups">
            {page.groups.map(g => {
              const caseItem = cases.get(g.caseId);
              const client = caseItem ? clients.get(caseItem.clientId) : null;
              const first = g.items[0];
              const party = client
                ? (first.parties || []).find(
                    p => norm(p.nome).includes(norm(client.name)) || norm(client.name).includes(norm(p.nome)),
                  )
                : null;
              const isOpen = open[g.key] === true;
              const byProcess = filters.group === 'process';
              const ids = g.items.filter(i => i.status === 'new').map(i => i.id);
              return (
                <section key={g.key} className={'intimation-card urgency-' + g.level}>
                  <header>
                    <button
                      className="group-toggle"
                      aria-expanded={isOpen}
                      onClick={() => setOpen({ ...open, [g.key]: !isOpen })}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="group-title">
                      <h3>{filters.group === 'day' ? br(g.label) : g.label}</h3>
                      <small>
                        {byProcess
                          ? [client?.name, first.classe, first.orgao, first.tribunal, party && poloLabels[party.polo]]
                              .filter(Boolean)
                              .join(' · ')
                          : `${g.count} publicação(ões)`}
                        {byProcess && !caseItem && g.processo && ' · processo não cadastrado'}
                      </small>
                    </div>
                    <span className="group-count">
                      {g.count}
                      {g.newCount ? <Badge tone="amber">{g.newCount} nova(s)</Badge> : null}
                    </span>
                    <div className="row-actions">
                      {byProcess &&
                        (caseItem ? (
                          <Button
                            tone="secondary"
                            icon={BriefcaseBusiness}
                            onClick={() => openDetail('cases', caseItem.id)}
                          >
                            Abrir processo
                          </Button>
                        ) : (
                          g.processo && (
                            <Button tone="secondary" icon={FilePlus2} onClick={() => registerCase(first)}>
                              Cadastrar processo
                            </Button>
                          )
                        ))}
                      {ids.length > 0 && (
                        <Button
                          tone="ghost"
                          icon={Check}
                          onClick={() => set(ids, 'done', `${ids.length} marcada(s) como tratada(s).`)}
                        >
                          Tratar {ids.length > 1 ? 'todas' : 'esta'}
                        </Button>
                      )}
                    </div>
                  </header>
                  {!isOpen && (
                    <p className="group-preview">
                      <span className={'kind-tag kind-' + kindOf(first.tipo).tone}>{kindOf(first.tipo).label}</span>{' '}
                      {br(first.date)} · {first.texto.slice(0, 160)}
                      {first.texto.length > 160 ? '…' : ''}
                    </p>
                  )}
                  {isOpen && (
                    <ul className="intimation-list">
                      {g.items.map(i => {
                        const kind = kindOf(i.tipo);
                        const text = fullText[i.id] ?? i.texto;
                        const u = i.urgency;
                        const event = i.event;
                        const deadline = i.deadline;
                        const itemCase = cases.get(i.caseId);
                        const itemClient = itemCase ? clients.get(itemCase.clientId) : null;
                        return (
                          <li key={i.id} className={i.status}>
                            <div className="intimation-head">
                              <time>{br(i.date)}</time>
                              <span className={'kind-tag kind-' + kind.tone}>{kind.label}</span>
                              <Badge tone={statusTone[i.status]}>{statusLabels[i.status]}</Badge>
                              {!byProcess && <small>{i.processoMascara || i.processo}</small>}
                              {u.level !== 'normal' && u.daysLeft !== null && (
                                <span className={'urgency-tag urgency-' + u.level}>
                                  {u.daysLeft < 0
                                    ? 'Prazo aproximado vencido'
                                    : `Prazo aproximado: ${u.daysLeft} dia(s)`}
                                </span>
                              )}
                            </div>
                            <small className="intimation-meta">
                              Disponibilizada em {br(i.date)}; considera-se publicada em {br(nextWorkingDay(i.date))}{' '}
                              (dia útil seguinte).
                              {deadline &&
                                ` O texto cita prazo de ${deadline.days} dia(s)${deadline.unit === 'uteis' ? ' úteis' : deadline.unit === 'corridos' ? ' corridos' : ''}.`}
                            </small>
                            <PublicationText text={text} open={!!fullText[i.id] || !i.longText} />
                            {i.longText && !fullText[i.id] && (
                              <button className="text-link" onClick={() => readAll(i.id)}>
                                Ler tudo
                              </button>
                            )}
                            <div className="row-actions intimation-actions">
                              <Button
                                tone="secondary"
                                icon={Calculator}
                                onClick={() =>
                                  calculateDeadline(itemCase?.id || '', {
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
                                      caseId: itemCase?.id || '',
                                      clientId: itemCase?.clientId || '',
                                      clientReminder: Boolean(itemClient),
                                    })
                                  }
                                >
                                  Criar {event.kind.toLowerCase()} na agenda
                                </Button>
                              )}
                              {itemClient && (
                                <Button
                                  tone="ghost"
                                  icon={MessageCircle}
                                  onClick={() =>
                                    composeMessage({
                                      channel: 'whatsapp',
                                      recipient: itemClient.phone,
                                      clientId: itemClient.id,
                                      caseId: itemCase.id,
                                      body: `Olá, {primeiro_nome}! Houve uma publicação no seu processo${itemCase.number ? ` nº ${itemCase.number}` : ''} (${kind.label.toLowerCase()}, em ${br(i.date)}). A equipe do {escritorio} vai orientar os próximos passos.`,
                                    })
                                  }
                                >
                                  Avisar o cliente
                                </Button>
                              )}
                              {(i.hash || i.link) && (
                                <Button
                                  tone="ghost"
                                  icon={FileDown}
                                  onClick={() =>
                                    act(() => window.advocacia.downloadCertificate(i.id), 'Certidão salva.')
                                  }
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
                                  <Button tone="ghost" icon={Check} onClick={() => set([i.id], 'done')}>
                                    Marcar como tratada
                                  </Button>
                                  <Button tone="ghost" icon={X} onClick={() => set([i.id], 'dismissed')}>
                                    Descartar
                                  </Button>
                                </>
                              ) : (
                                <Button tone="ghost" onClick={() => set([i.id], 'new')}>
                                  Voltar para novas
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                      {g.hidden > 0 && (
                        <li className="muted">
                          Mais {g.hidden} publicação(ões) antiga(s) neste grupo. Use os filtros para vê-las.
                        </li>
                      )}
                    </ul>
                  )}
                </section>
              );
            })}
            {page.groups.length < page.total && (
              <div className="intimation-more">
                <Button tone="secondary" busy={loading} onClick={() => load(page.groups.length)}>
                  Carregar mais ({page.total - page.groups.length} grupo(s) restante(s))
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Empty
            icon={Bell}
            title={
              loading
                ? 'Carregando...'
                : filters.status === 'new' && !filtering
                  ? 'Nenhuma intimação nova'
                  : 'Nada por aqui'
            }
            description={
              enabled
                ? 'As publicações do Diário de Justiça Eletrônico Nacional em nome dos advogados do escritório aparecem aqui, organizadas como você escolher.'
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
      {askSide && (
        <Modal
          title="Cadastrar processo"
          subtitle="Quem é o seu cliente neste processo?"
          onClose={() => setAskSide(null)}
        >
          <div className="settings-body notice-body">
            <p className="help-text">
              A publicação traz as partes, mas não diz quem o escritório representa. Escolha para o programa preencher o
              polo e a parte contrária.
            </p>
            {['A', 'P'].map(side => {
              const list = (askSide.parties || []).filter(p => p.polo === side).map(p => p.nome);
              return (
                list.length > 0 && (
                  <Button key={side} tone="secondary" onClick={() => finishCase(askSide, side)}>
                    {side === 'A' ? 'Autor' : 'Réu'}: {joinNames(list)}
                  </Button>
                )
              );
            })}
            <Button tone="ghost" onClick={() => finishCase(askSide, '')}>
              Ainda não sei: preencher só o que a publicação informa
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
