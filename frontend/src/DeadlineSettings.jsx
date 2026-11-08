import { useState } from 'react';
import { CalendarX2, ListChecks, Plus, Save, Trash2, RotateCcw } from 'lucide-react';
import { Button, Panel } from './components.jsx';
import { caseAreas } from '../../app/legal-options.mjs';
import { defaultWorkflows } from '../../app/workflows.mjs';
import { isDateKey } from '../../app/deadlines.mjs';

const dayTypes = [
  ['holiday', 'Sem expediente'],
  ['reduced', 'Expediente reduzido / indisponibilidade'],
  ['workday', 'Expediente normal (reabre o dia)'],
];
const taskTypes = ['Tarefa', 'Prazo', 'Audiência', 'Reunião'];
const priorities = ['Normal', 'Alta', 'Urgente'];
const slug = name =>
  (name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'fluxo') +
  '-' +
  Date.now().toString(36);

// "dd/mm/aaaa;descrição;tipo" per line; tipo is optional (feriado, reduzido, normal).
export function parseCalendarText(text, courtId = '') {
  const types = { feriado: 'holiday', reduzido: 'reduced', normal: 'workday' };
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [rawDate, description = '', rawType = 'feriado'] = line.split(/[;\t]/).map(s => s.trim());
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawDate);
      const date = m ? `${m[3]}-${m[2]}-${m[1]}` : rawDate;
      const type = types[rawType.toLowerCase()];
      if (!isDateKey(date) || !type)
        throw new Error(`Linha ${i + 1}: use dd/mm/aaaa;descrição;feriado|reduzido|normal.`);
      return { date, description: description.slice(0, 120), type, courtId };
    });
}

export default function DeadlineSettings({ data, act }) {
  const courts = data.courts.courts.filter(c => c.category !== 'Conselhos e serviços');
  const [calendar, setCalendar] = useState(() => data.settings.courtCalendar || []);
  const [flows, setFlows] = useState(() => data.settings.workflows || []);
  const [paste, setPaste] = useState('');
  const [pasteCourt, setPasteCourt] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const setDay = (i, patch) => setCalendar(list => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setFlow = (i, patch) => setFlows(list => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setItem = (fi, ii, patch) =>
    setFlow(fi, { items: flows[fi].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const saveAll = () =>
    act(async () => {
      await window.advocacia.saveSettings({ courtCalendar: calendar, workflows: flows });
      return 'Calendário e fluxos salvos.';
    }, 'Calendário e fluxos salvos.');
  function importPaste() {
    try {
      const added = parseCalendarText(paste, pasteCourt);
      setCalendar(list => [...list, ...added].sort((a, b) => a.date.localeCompare(b.date)));
      setPaste('');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  const missingDefaults = defaultWorkflows.filter(d => !flows.some(f => f.id === d.id));
  return (
    <>
      <Panel title="Feriados e suspensões do tribunal" icon={CalendarX2}>
        <div className="settings-body">
          <p className="help-text">
            Feriados nacionais, Carnaval, Quarta-feira de Cinzas (expediente reduzido), Sexta-feira da Paixão, Corpus
            Christi, 8/12 e o recesso de 20/12 a 20/01 já são considerados; no calendário da Justiça Federal, também a
            Semana Santa, 11/08, 01/11 e o feriado de 20/12 a 06/01. Cadastre aqui feriados estaduais e municipais,
            portarias de suspensão e dias de indisponibilidade do sistema. Para reabrir um dia (por exemplo, quando o
            tribunal tem expediente em Corpus Christi), use “Expediente normal”.
          </p>
          {calendar.length > 0 && (
            <table className="calendar-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Descrição</th>
                  <th>Tribunal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {calendar.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="date"
                        aria-label="Data"
                        value={d.date}
                        onChange={e => setDay(i, { date: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Tipo de dia"
                        value={d.type}
                        onChange={e => setDay(i, { type: e.target.value })}
                      >
                        {dayTypes.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Descrição"
                        maxLength={120}
                        value={d.description}
                        onChange={e => setDay(i, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Tribunal"
                        value={d.courtId}
                        onChange={e => setDay(i, { courtId: e.target.value })}
                      >
                        <option value="">Todos</option>
                        {courts.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.acronym}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="icon-button danger"
                        aria-label="Remover dia"
                        onClick={() => setCalendar(list => list.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Button
            tone="secondary"
            icon={Plus}
            onClick={() => setCalendar(list => [...list, { date: '', type: 'holiday', description: '', courtId: '' }])}
          >
            Adicionar dia
          </Button>
          <details className="calendar-paste">
            <summary>Colar vários dias de uma vez</summary>
            <textarea
              rows={4}
              value={paste}
              aria-label="Dias para importar"
              placeholder={'24/10/2026;Aniversário de Goiânia\n30/10/2026;Indisponibilidade do PJe;reduzido'}
              onChange={e => setPaste(e.target.value)}
            />
            <div className="calendar-paste-actions">
              <select
                aria-label="Tribunal dos dias colados"
                value={pasteCourt}
                onChange={e => setPasteCourt(e.target.value)}
              >
                <option value="">Todos os tribunais</option>
                {courts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.acronym}
                  </option>
                ))}
              </select>
              <Button tone="secondary" onClick={importPaste} disabled={!paste.trim()}>
                Incluir na lista
              </Button>
            </div>
          </details>
        </div>
      </Panel>
      <Panel title="Fluxos por tipo de ação" icon={ListChecks}>
        <div className="settings-body">
          <p className="help-text">
            Cada fluxo vira uma lista de tarefas no processo, com os dias contados a partir da data escolhida. Use
            “Documento: ...” para o que o cliente precisa entregar.
          </p>
          {flows.map((flow, fi) => (
            <div className="workflow-editor" key={flow.id}>
              <button
                className="workflow-toggle"
                onClick={() => setOpen(open === flow.id ? null : flow.id)}
                aria-expanded={open === flow.id}
              >
                <strong>{flow.name || 'Novo fluxo'}</strong>
                <small>
                  {flow.area || 'Qualquer área'} · {flow.items.length} tarefa(s)
                </small>
              </button>
              {open === flow.id && (
                <div className="workflow-body">
                  <div className="form-grid">
                    <label className="field">
                      <span>Nome do fluxo</span>
                      <input value={flow.name} maxLength={100} onChange={e => setFlow(fi, { name: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Área</span>
                      <select value={flow.area} onChange={e => setFlow(fi, { area: e.target.value })}>
                        <option value="">Qualquer área</option>
                        {caseAreas.map(a => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <table className="calendar-table">
                    <thead>
                      <tr>
                        <th>Tarefa</th>
                        <th>Dias</th>
                        <th>Tipo</th>
                        <th>Prioridade</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {flow.items.map((item, ii) => (
                        <tr key={ii}>
                          <td>
                            <input
                              aria-label="Título da tarefa"
                              maxLength={200}
                              value={item.title}
                              onChange={e => setItem(fi, ii, { title: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label="Dias após o início"
                              type="number"
                              min={0}
                              max={365}
                              className="inline-number"
                              value={item.offset}
                              onChange={e =>
                                setItem(fi, ii, { offset: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })
                              }
                            />
                          </td>
                          <td>
                            <select
                              aria-label="Tipo"
                              value={item.type}
                              onChange={e => setItem(fi, ii, { type: e.target.value })}
                            >
                              {taskTypes.map(t => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label="Prioridade"
                              value={item.priority}
                              onChange={e => setItem(fi, ii, { priority: e.target.value })}
                            >
                              {priorities.map(t => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              className="icon-button danger"
                              aria-label="Remover tarefa"
                              onClick={() => setFlow(fi, { items: flow.items.filter((_, j) => j !== ii) })}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="workflow-actions">
                    <Button
                      tone="secondary"
                      icon={Plus}
                      onClick={() =>
                        setFlow(fi, {
                          items: [...flow.items, { title: '', offset: 0, type: 'Tarefa', priority: 'Normal' }],
                        })
                      }
                    >
                      Adicionar tarefa
                    </Button>
                    <Button
                      tone="ghost"
                      icon={Trash2}
                      onClick={() => setFlows(list => list.filter((_, j) => j !== fi))}
                    >
                      Excluir fluxo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="workflow-actions">
            <Button
              tone="secondary"
              icon={Plus}
              onClick={() => {
                const id = slug('fluxo');
                setFlows(list => [
                  ...list,
                  { id, name: '', area: '', items: [{ title: '', offset: 0, type: 'Tarefa', priority: 'Normal' }] },
                ]);
                setOpen(id);
              }}
            >
              Novo fluxo
            </Button>
            {missingDefaults.length > 0 && (
              <Button tone="ghost" icon={RotateCcw} onClick={() => setFlows(list => [...list, ...missingDefaults])}>
                Restaurar fluxos padrão ({missingDefaults.length})
              </Button>
            )}
          </div>
        </div>
      </Panel>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-save">
        <Button icon={Save} onClick={saveAll}>
          Salvar prazos e fluxos
        </Button>
      </div>
    </>
  );
}
