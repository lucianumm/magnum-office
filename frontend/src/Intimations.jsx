import { useState } from 'react';
import { Bell, Calculator, Check, ExternalLink, RefreshCw, X, BriefcaseBusiness } from 'lucide-react';
import { Badge, Button, Empty, PageHeading, Panel, date } from './components.jsx';

const statusLabels = { new: 'Nova', done: 'Tratada', dismissed: 'Descartada' };
const tones = { new: 'amber', done: 'green', dismissed: 'neutral' };

// Communications published in the DJEN for the office's lawyers: each one can become a deadline.
export default function Intimations({ data, act, openDetail, navigateSettings, calculateDeadline }) {
  const [filter, setFilter] = useState('new');
  const [open, setOpen] = useState(null);
  const list = (data.intimations || []).filter(i => filter === 'all' || i.status === filter);
  const cases = new Map(data.entities.cases.map(c => [c.id, c]));
  const set = (id, status) => act(() => window.advocacia.setIntimation({ id, status }));
  const enabled = data.settings.djenEnabled;
  return (
    <>
      <PageHeading title="Intimações" count={(data.intimations || []).filter(i => i.status === 'new').length}>
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
              aria-selected={filter === key}
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {data.settings.djenError && (
          <div className="conflict-alert danger" role="alert">
            <X size={16} />
            <small>{data.settings.djenError}</small>
          </div>
        )}
        {list.length ? (
          <ul className="intimation-list">
            {list.map(i => {
              const linked = cases.get(i.caseId);
              return (
                <li key={i.id} className={i.status}>
                  <div className="intimation-head">
                    <time>{date(i.date + 'T12:00', { year: 'numeric' })}</time>
                    <strong>
                      {i.tipo} · {i.tribunal}
                    </strong>
                    <Badge tone={tones[i.status]}>{statusLabels[i.status]}</Badge>
                  </div>
                  <small className="intimation-meta">
                    {[i.processoMascara || i.processo, i.classe, i.orgao].filter(Boolean).join(' · ')}
                    {linked ? ` · ${linked.title}` : ' · processo não cadastrado'}
                  </small>
                  <p className={open === i.id ? 'intimation-text open' : 'intimation-text'}>{i.texto}</p>
                  {i.texto.length > 240 && (
                    <button className="text-link" onClick={() => setOpen(open === i.id ? null : i.id)}>
                      {open === i.id ? 'Mostrar menos' : 'Ler tudo'}
                    </button>
                  )}
                  <div className="row-actions intimation-actions">
                    <Button
                      tone="secondary"
                      icon={Calculator}
                      onClick={() => calculateDeadline(linked?.id || '', { start: i.date, mode: 'disponibilizacao' })}
                    >
                      Calcular prazo
                    </Button>
                    {linked && (
                      <Button tone="secondary" icon={BriefcaseBusiness} onClick={() => openDetail('cases', linked.id)}>
                        Abrir processo
                      </Button>
                    )}
                    {i.link && (
                      <Button
                        tone="ghost"
                        icon={ExternalLink}
                        onClick={() => act(() => window.advocacia.openIntimation(i.id))}
                      >
                        Publicação
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
        ) : (
          <Empty
            icon={Bell}
            title={filter === 'new' ? 'Nenhuma intimação nova' : 'Nada por aqui'}
            description={
              enabled
                ? 'As publicações do Diário de Justiça Eletrônico Nacional em nome dos advogados do escritório aparecem aqui.'
                : 'Ative a consulta ao DJEN em Configurações → Consultas públicas para receber as publicações em nome dos advogados do escritório.'
            }
          />
        )}
        <p className="help-text intimation-help">
          A consulta usa o Diário de Justiça Eletrônico Nacional. Confira sempre a intimação no sistema do tribunal: a
          contagem do prazo considera a data de disponibilização e a publicação no dia útil seguinte.
        </p>
      </Panel>
    </>
  );
}
