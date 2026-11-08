import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, Trash2, History, Lock, FileText } from 'lucide-react';
import ClientReport from './ClientReport.jsx';
import { Badge, Button, Empty, Panel, date, dateTime, dayKey } from './components.jsx';

// Movements of one case: imported from the DataJud or typed by the office.
export default function Movements({ data, act, caseItem, navigateSettings, composeMessage }) {
  const [reporting, setReporting] = useState(false);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const load = useCallback(
    () =>
      window.advocacia
        .caseMovements(caseItem.id)
        .then(setState)
        .catch(e => setError(e.message)),
    [caseItem.id],
  );
  useEffect(() => {
    void load();
    // Opening the tab marks the new movements as seen.
    void window.advocacia.seenMovements(caseItem.id).catch(() => {});
  }, [load, caseItem.id]);
  const enabled = data.settings.datajudEnabled;
  async function refresh() {
    const result = await act(async () => {
      const r = await window.advocacia.refreshMovements(caseItem.id);
      setState(r);
      if (!r.found)
        return 'O processo não foi encontrado no DataJud. Pode estar em segredo de justiça, ser recente ou de outro tribunal.';
      return r.added ? `${r.added} andamento(s) novo(s).` : 'Nenhum andamento novo.';
    });
    if (result) void window.advocacia.seenMovements(caseItem.id).catch(() => {});
  }
  async function add(e) {
    e.preventDefault();
    const done = await act(async () => {
      setState(await window.advocacia.addMovement({ caseId: caseItem.id, ...draft }));
      return 'Andamento registrado.';
    });
    if (done) setDraft(null);
  }
  const meta = state?.meta;
  return (
    <Panel
      title="Andamentos"
      icon={History}
      aside={
        <div className="row-actions">
          <Button tone="secondary" icon={FileText} onClick={() => setReporting(true)}>
            Relatório ao cliente
          </Button>
          <Button tone="secondary" icon={Plus} onClick={() => setDraft({ date: dayKey(new Date()), name: '' })}>
            Registrar andamento
          </Button>
          {enabled ? (
            <Button tone="secondary" icon={RefreshCw} onClick={refresh}>
              Atualizar pelo DataJud
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => navigateSettings('integrations')}>
              Ativar DataJud
            </Button>
          )}
        </div>
      }
    >
      {reporting && (
        <ClientReport
          data={data}
          act={act}
          caseItem={caseItem}
          movements={state?.movements || []}
          composeMessage={composeMessage}
          onClose={() => setReporting(false)}
        />
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {meta && (
        <div className="movement-meta">
          {meta.sigilo > 0 && (
            <Badge tone="red">
              <Lock size={12} /> Sigilo nível {meta.sigilo}
            </Badge>
          )}
          {[
            meta.tribunal,
            meta.classe,
            meta.orgao,
            meta.graus?.join(', '),
            meta.filedAt && `ajuizado em ${meta.filedAt.split('-').reverse().join('/')}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          {state.fetchedAt && <small> · consultado em {dateTime(state.fetchedAt)}</small>}
        </div>
      )}
      {draft && (
        <form className="movement-form" onSubmit={add}>
          <input
            type="date"
            aria-label="Data do andamento"
            value={draft.date}
            required
            onChange={e => setDraft({ ...draft, date: e.target.value })}
          />
          <input
            aria-label="Descrição do andamento"
            value={draft.name}
            maxLength={2000}
            required
            placeholder="Ex.: Juntada de petição"
            onChange={e => setDraft({ ...draft, name: e.target.value })}
          />
          <Button type="submit">Salvar</Button>
          <Button type="button" tone="ghost" onClick={() => setDraft(null)}>
            Cancelar
          </Button>
        </form>
      )}
      {state?.movements.length ? (
        <ul className="timeline movement-list">
          {state.movements.map(m => (
            <li key={m.id}>
              <time>{m.source === 'manual' ? date(m.date, { year: 'numeric' }) : dateTime(m.date)}</time>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{m.name}</strong>
                <small>
                  {[
                    m.complements?.join(', '),
                    m.orgao,
                    m.source === 'manual' ? 'registrado pelo escritório' : 'DataJud',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              {m.source === 'manual' && (
                <button
                  className="icon-button danger"
                  aria-label="Excluir andamento"
                  onClick={() =>
                    act(async () => setState(await window.advocacia.removeMovement({ caseId: caseItem.id, id: m.id })))
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        state && (
          <Empty
            icon={History}
            title="Nenhum andamento"
            description={
              enabled
                ? 'Atualize pelo DataJud ou registre um andamento.'
                : 'Registre andamentos ou ative a consulta ao DataJud em Configurações → Consultas públicas.'
            }
          />
        )
      )}
    </Panel>
  );
}
