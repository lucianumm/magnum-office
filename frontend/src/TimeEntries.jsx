import { useEffect, useState } from 'react';
import { Play, Square, Clock, Receipt } from 'lucide-react';
import { Button, Panel, Empty, dayKey } from './components.jsx';

const hours = minutes => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
const brl = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const timerKey = caseId => `magnum-timer-${caseId}`;
const readTimer = caseId => {
  try {
    return Number(localStorage.getItem(timerKey(caseId))) || 0;
  } catch {
    return 0;
  }
};

// Time worked on a case, with a stopwatch, and the bill for the hours not yet charged.
export default function TimeEntries({ caseItem, data, save, act, remove }) {
  const lawyers = data.settings.lawyers || [];
  const entries = data.entities.time.filter(t => t.caseId === caseItem.id).sort((a, b) => b.date.localeCompare(a.date));
  const [started, setStarted] = useState(() => readTimer(caseItem.id));
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState({
    date: dayKey(new Date()),
    minutes: '',
    description: '',
    lawyer: lawyers[0]?.name || '',
    rate: '',
  });
  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [started]);
  const running = started ? Math.max(1, Math.round((now - started) / 60000)) : 0;
  function toggle() {
    if (started) {
      setForm(f => ({ ...f, minutes: String(running) }));
      setStarted(0);
      try {
        localStorage.removeItem(timerKey(caseItem.id));
      } catch {
        /* The stopwatch only lives in this window. */
      }
    } else {
      const at = Date.now();
      setStarted(at);
      setNow(at);
      try {
        localStorage.setItem(timerKey(caseItem.id), String(at));
      } catch {
        /* The stopwatch only lives in this window. */
      }
    }
  }
  async function add(e) {
    e.preventDefault();
    const saved = await act(() => save('time', { ...form, caseId: caseItem.id }));
    if (saved) setForm(f => ({ ...f, minutes: '', description: '' }));
  }
  const open = entries.filter(t => !t.billed);
  const openMinutes = open.reduce((n, t) => n + Number(t.minutes), 0);
  const openValue = open.reduce((n, t) => n + (Number(t.minutes) / 60) * Number(t.rate || 0), 0);
  return (
    <Panel title="Horas trabalhadas" icon={Clock}>
      <form className="time-form" onSubmit={add}>
        <Button type="button" tone={started ? 'primary' : 'secondary'} icon={started ? Square : Play} onClick={toggle}>
          {started ? `Parar (${hours(running)})` : 'Iniciar cronômetro'}
        </Button>
        <label className="field">
          <span>Data</span>
          <input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="field">
          <span>Minutos</span>
          <input
            required
            inputMode="numeric"
            value={form.minutes}
            maxLength={4}
            onChange={e => setForm({ ...form, minutes: e.target.value.replace(/\D/g, '') })}
          />
        </label>
        <label className="field grow">
          <span>O que foi feito</span>
          <input
            required
            maxLength={300}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Advogado</span>
          <select value={form.lawyer} onChange={e => setForm({ ...form, lawyer: e.target.value })}>
            <option value="">—</option>
            {lawyers.map(l => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Valor da hora</span>
          <input
            inputMode="decimal"
            placeholder="R$ 0,00"
            value={form.rate}
            maxLength={20}
            onChange={e => setForm({ ...form, rate: e.target.value })}
          />
        </label>
        <Button type="submit">Lançar</Button>
      </form>
      {entries.length ? (
        <>
          <table className="time-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Atividade</th>
                <th>Advogado</th>
                <th className="numeric">Tempo</th>
                <th className="numeric">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map(t => (
                <tr key={t.id} className={t.billed ? 'billed' : ''}>
                  <td className="tabular">{t.date.split('-').reverse().join('/')}</td>
                  <td>{t.description}</td>
                  <td>{t.lawyer}</td>
                  <td className="numeric tabular">{hours(Number(t.minutes))}</td>
                  <td className="numeric tabular">
                    {t.rate ? brl((Number(t.minutes) / 60) * Number(t.rate)) : '—'}
                    {t.billed ? ' · cobrado' : ''}
                  </td>
                  <td>
                    {!t.billed && (
                      <button className="text-link" onClick={() => remove('time', t.id)}>
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="heading-actions time-summary">
            <span>
              A cobrar: {hours(openMinutes)} · {brl(openValue)}
            </span>
            <Button
              icon={Receipt}
              disabled={!open.length || !openValue}
              onClick={() =>
                act(
                  () => window.advocacia.billTime({ caseId: caseItem.id }),
                  'Cobrança lançada no Financeiro como receita a receber.',
                )
              }
            >
              Gerar cobrança
            </Button>
          </div>
        </>
      ) : (
        <Empty
          icon={Clock}
          title="Nenhuma hora lançada"
          description="Use o cronômetro ou lance o tempo à mão. As horas com valor viram cobrança no Financeiro."
        />
      )}
    </Panel>
  );
}
