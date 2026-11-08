import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button, Empty, Modal, dayKey } from './components.jsx';
import { formatDate } from '../../app/deadlines.mjs';

// Creates the standard tasks of a type of case (documents to collect, next steps) in one go.
export default function ApplyWorkflow({ data, act, caseItem, onClose, navigateSettings }) {
  const flows = data.settings.workflows || [];
  const sorted = [...flows].sort((a, b) => (b.area === caseItem.area) - (a.area === caseItem.area));
  const [workflowId, setWorkflowId] = useState(sorted[0]?.id || '');
  const [start, setStart] = useState(dayKey(new Date()));
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!workflowId) return;
    let current = true;
    window.advocacia
      .previewWorkflow({ caseId: caseItem.id, workflowId, start })
      .then(list => current && (setTasks(list), setError('')))
      .catch(e => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [workflowId, start, caseItem.id]);
  async function apply() {
    const done = await act(async () => {
      const result = await window.advocacia.applyWorkflow({ caseId: caseItem.id, workflowId, start });
      return `${result.count} tarefa(s) criada(s) na agenda.`;
    });
    if (done) onClose();
  }
  return (
    <Modal title="Aplicar fluxo" subtitle={caseItem.title} onClose={onClose}>
      {!flows.length ? (
        <Empty
          icon={ListChecks}
          title="Nenhum fluxo cadastrado"
          description="Cadastre listas de tarefas por tipo de ação em Configurações → Prazos e fluxos."
          action={
            <Button
              tone="secondary"
              onClick={() => {
                onClose();
                navigateSettings('deadlines');
              }}
            >
              Abrir configurações
            </Button>
          }
        />
      ) : (
        <>
          <div className="form-grid">
            <label className="field">
              <span>Fluxo</span>
              <select value={workflowId} onChange={e => setWorkflowId(e.target.value)}>
                {sorted.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.area ? ` · ${w.area}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Começar em</span>
              <input
                type="date"
                value={start}
                min="1900-01-01"
                max="9999-12-31"
                onChange={e => setStart(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <ul className="workflow-preview">
            {tasks.map((t, i) => (
              <li key={i}>
                <time className="tabular">{formatDate(t.due.slice(0, 10))}</time>
                <span>{t.title}</span>
                <small>{t.priority !== 'Normal' ? t.priority : ''}</small>
              </li>
            ))}
          </ul>
          <p className="help-text workflow-help">
            Datas em fim de semana ou feriado passam para o próximo dia útil. Documentos pedidos ao cliente viram
            tarefas: conclua cada uma quando ele entregar.
          </p>
          <div className="form-footer">
            <div>
              <Button tone="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button icon={ListChecks} disabled={!tasks.length || !!error} onClick={apply}>
                Criar {tasks.length} tarefa(s)
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
