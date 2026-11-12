import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, FileDown, AlertTriangle, Scale } from 'lucide-react';
import { Button, PageHeading, Panel, dateTime, dayKey } from './components.jsx';
import { calculateOvertime } from '../../app/overtime.mjs';
import { updateLaborDebt, laborSeriesNeeded } from '../../app/labor-update.mjs';
import { parseMoney } from '../../app/money.mjs';

const brl = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const centsBRL = value => brl(value / 100);

// Labour claim: overtime with reflexes plus other amounts, updated by the ADC 58 phases.
export default function LiquidationCalculator({ data, act }) {
  const [form, setForm] = useState({
    salary: '',
    divisor: '220',
    hours: '',
    percent: '50',
    months: '12',
    noticeDays: '0',
    finePercent: '40',
    dsrInBase: true,
    others: '',
    start: '',
    filing: '',
    end: dayKey(new Date()),
    caseId: '',
  });
  const [series, setSeries] = useState({});
  const update = patch => setForm(f => ({ ...f, ...patch }));
  const overtime = useMemo(() => {
    if (!form.salary || !form.hours) return null;
    try {
      return { value: calculateOvertime(form) };
    } catch (e) {
      return { error: e.message };
    }
  }, [form]);
  const others = parseMoney(form.others);
  const principal = (overtime?.value?.total || 0) / 100 + (others ? Number(others) : 0);
  const needed = useMemo(() => {
    try {
      return form.start ? laborSeriesNeeded(form).join(',') : '';
    } catch {
      return '';
    }
  }, [form]);
  const indicesAt = data.indices?.updatedAt;
  useEffect(() => {
    if (!needed) return;
    let current = true;
    window.advocacia
      .debtSeries({ keys: needed.split(',') })
      .then(v => current && setSeries(v))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [needed, indicesAt]);
  const updated = useMemo(() => {
    if (!principal || !form.start) return null;
    try {
      return { value: updateLaborDebt({ ...form, principal: principal.toFixed(2), series }) };
    } catch (e) {
      return { error: e.message };
    }
  }, [form, principal, series]);
  const u = updated?.value;
  const field = (label, key, extra = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key]} onChange={e => update({ [key]: e.target.value })} {...extra} />
    </label>
  );
  return (
    <>
      <PageHeading title="Liquidação trabalhista">
        <Button
          tone="secondary"
          icon={RefreshCw}
          onClick={() => act(() => window.advocacia.updateIndices({}), 'Índices atualizados.')}
        >
          Atualizar índices
        </Button>
      </PageHeading>
      <Panel>
        <div className="deadline-layout">
          <div className="deadline-form">
            <h3 className="form-section">Horas extras</h3>
            <div className="deadline-row two">
              {field('Salário mensal', 'salary', { inputMode: 'decimal', placeholder: 'R$ 0,00' })}
              <label className="field">
                <span>Divisor de horas</span>
                <select value={form.divisor} onChange={e => update({ divisor: e.target.value })}>
                  {['220', '200', '180', '150'].map(d => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="deadline-row two">
              {field('Horas extras por mês (média)', 'hours', { inputMode: 'decimal' })}
              {field('Adicional (%)', 'percent', { inputMode: 'decimal' })}
            </div>
            <div className="deadline-row two">
              {field('Meses do período', 'months', { inputMode: 'numeric' })}
              {field('Dias de aviso indenizado', 'noticeDays', { inputMode: 'numeric' })}
            </div>
            <label className="field">
              <span>Multa do FGTS</span>
              <select value={form.finePercent} onChange={e => update({ finePercent: e.target.value })}>
                <option value="40">40% (dispensa sem justa causa)</option>
                <option value="20">20% (acordo)</option>
                <option value="0">Sem multa</option>
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.dsrInBase} onChange={e => update({ dsrInBase: e.target.checked })} />
              DSR reflete nas demais parcelas (horas a partir de 20/03/2023)
            </label>
            <h3 className="form-section">Outras verbas e atualização</h3>
            {field('Outras verbas devidas (ex.: total da rescisão)', 'others', {
              inputMode: 'decimal',
              placeholder: 'R$ 0,00',
            })}
            <div className="deadline-row two">
              <label className="field">
                <span>Vencimento</span>
                <input type="date" value={form.start} onChange={e => update({ start: e.target.value })} />
              </label>
              <label className="field">
                <span>Ajuizamento</span>
                <input type="date" value={form.filing} onChange={e => update({ filing: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Atualizar até</span>
              <input type="date" value={form.end} onChange={e => update({ end: e.target.value })} />
            </label>
            <small className="field-hint muted">
              Índices do Banco Central{' '}
              {data.indices?.updatedAt ? `atualizados em ${dateTime(data.indices.updatedAt)}` : 'ainda não baixados'}.
            </small>
          </div>
          <div className="deadline-result">
            {overtime?.error && (
              <div className="form-error" role="alert">
                {overtime.error}
              </div>
            )}
            {updated?.error && (
              <div className="form-error" role="alert">
                {updated.error}
              </div>
            )}
            {!overtime && !others && (
              <p className="help-text">Informe as horas extras ou outras verbas e as datas para calcular.</p>
            )}
            {(overtime?.value || others) && (
              <div className="deadline-answer" role="status">
                <span>
                  {u ? `Total atualizado até ${form.end.split('-').reverse().join('/')}` : 'Total sem atualização'}
                </span>
                <strong>{brl(u ? u.total : principal)}</strong>
                <small>
                  Principal {brl(principal)}
                  {u ? ` · ${u.steps.map(s => s.label.split(':')[0]).join(' → ')}` : ''}
                </small>
              </div>
            )}
            {overtime?.value && (
              <div className="deadline-steps">
                <table>
                  <thead>
                    <tr>
                      <th>Verba</th>
                      <th>Referência</th>
                      <th className="numeric">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overtime.value.items.map(i => (
                      <tr key={i.key}>
                        <td>{i.label}</td>
                        <td className="tabular">{i.reference}</td>
                        <td className="tabular numeric">{centsBRL(i.value)}</td>
                      </tr>
                    ))}
                    <tr className="labor-total">
                      <td colSpan={2}>Horas extras e reflexos</td>
                      <td className="tabular numeric">{centsBRL(overtime.value.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {u && (
              <div className="deadline-steps">
                <table>
                  <thead>
                    <tr>
                      <th>Fase</th>
                      <th>Período</th>
                      <th className="numeric">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.steps.map(s => (
                      <tr key={s.label}>
                        <td>{s.label}</td>
                        <td className="tabular">
                          {s.start.split('-').reverse().join('/')} a {s.end.split('-').reverse().join('/')}
                        </td>
                        <td className="tabular numeric">{brl(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {[...(overtime?.value?.warnings || []), ...(u?.warnings || [])].map(w => (
              <div className="conflict-alert info" key={w}>
                <AlertTriangle size={16} />
                <small>{w}</small>
              </div>
            ))}
            {(overtime?.value || others) && (
              <div className="deadline-create">
                <label className="field">
                  <span>Salvar memória no processo</span>
                  <select value={form.caseId} onChange={e => update({ caseId: e.target.value })}>
                    <option value="">Sem processo (fica em Documentos)</option>
                    {data.entities.cases.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  icon={FileDown}
                  onClick={() =>
                    act(
                      () => window.advocacia.saveLiquidationReport(form),
                      'Memória da liquidação salva em PDF nos documentos.',
                    )
                  }
                >
                  Salvar PDF
                </Button>
              </div>
            )}
            {overtime?.value && (
              <details className="deadline-basis">
                <summary>
                  <Scale size={14} /> Critérios
                </summary>
                <ul>
                  {overtime.value.basis.map(b => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
