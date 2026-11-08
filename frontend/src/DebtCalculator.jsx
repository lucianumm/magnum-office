import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, FileDown, AlertTriangle, Scale } from 'lucide-react';
import { Button, PageHeading, Panel, dateTime, dayKey } from './components.jsx';
import { calculateDebt, debtPresets, indexSeries, seriesNeeded } from '../../app/debt.mjs';
import { formatBRL } from '../../app/money.mjs';

const interestLabels = {
  none: 'Sem juros',
  simple: 'Juros simples ao mês',
  cc: 'Código Civil: taxa informada até 29/08/2024 e Taxa Legal depois',
  legal: 'Somente Taxa Legal (desde 30/08/2024)',
  selic: 'Selic (já inclui correção)',
};
const pct = (n, places = 4) =>
  `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: places })}%`;

// Debt update with BCB indices, cached on this computer. The PDF report is recalculated by the main process.
export default function DebtCalculator({ data, act }) {
  const [form, setForm] = useState({
    preset: 'civil',
    principal: '',
    start: '',
    end: dayKey(new Date()),
    correction: 'IPCA',
    interest: 'cc',
    rate: '1',
    interestFrom: '',
    selicMode: 'composta',
    fine: '0',
    fees: '0',
    caseId: '',
  });
  const [series, setSeries] = useState({});
  const update = patch => setForm(f => ({ ...f, ...patch }));
  const needed = seriesNeeded(form).join(',');
  const indicesAt = data.indices?.updatedAt;
  useEffect(() => {
    let current = true;
    window.advocacia
      .debtSeries({ keys: needed.split(',').filter(Boolean) })
      .then(v => current && setSeries(v))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [needed, indicesAt]);
  const result = useMemo(() => {
    if (!form.principal || !form.start) return null;
    try {
      return { value: calculateDebt({ ...form, series }) };
    } catch (e) {
      return { error: e.message };
    }
  }, [form, series]);
  const r = result?.value;
  const choosePreset = key =>
    update({
      preset: key,
      ...(key === 'custom' ? {} : { correction: debtPresets[key].correction, interest: debtPresets[key].interest }),
    });
  return (
    <>
      <PageHeading title="Atualização de débitos">
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
            <small className="field-hint muted">
              Índices do Banco Central{' '}
              {data.indices?.updatedAt
                ? `atualizados em ${dateTime(data.indices.updatedAt)}`
                : 'ainda não baixados — clique em Atualizar índices'}
              .
            </small>
            <label className="field">
              <span>Critério</span>
              <select value={form.preset} onChange={e => choosePreset(e.target.value)}>
                {Object.entries(debtPresets).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Valor original</span>
              <input
                value={form.principal}
                inputMode="decimal"
                placeholder="R$ 0,00"
                onChange={e => update({ principal: e.target.value })}
              />
            </label>
            <div className="deadline-row two">
              <label className="field">
                <span>Desde</span>
                <input type="date" value={form.start} onChange={e => update({ start: e.target.value })} />
              </label>
              <label className="field">
                <span>Até</span>
                <input type="date" value={form.end} onChange={e => update({ end: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Correção monetária</span>
              <select
                value={form.correction}
                disabled={form.interest === 'selic'}
                onChange={e => update({ correction: e.target.value, preset: 'custom' })}
              >
                <option value="none">Sem correção</option>
                {['IPCA', 'INPC', 'IGP-M', 'IPCA-E'].map(k => (
                  <option key={k} value={k}>
                    {indexSeries[k].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Juros</span>
              <select value={form.interest} onChange={e => update({ interest: e.target.value, preset: 'custom' })}>
                {Object.entries(interestLabels).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {['simple', 'cc'].includes(form.interest) && (
              <label className="field">
                <span>{form.interest === 'cc' ? 'Taxa ao mês até 29/08/2024 (%)' : 'Taxa ao mês (%)'}</span>
                <input value={form.rate} inputMode="decimal" onChange={e => update({ rate: e.target.value })} />
                {form.interest === 'cc' && (
                  <small>Use o critério da decisão ou do contrato para o período anterior à Lei 14.905/2024.</small>
                )}
              </label>
            )}
            {form.interest === 'selic' && (
              <label className="field">
                <span>Acumulação da Selic</span>
                <select value={form.selicMode} onChange={e => update({ selicMode: e.target.value })}>
                  <option value="composta">Composta (Calculadora do Cidadão)</option>
                  <option value="simples">Soma simples das taxas mensais</option>
                </select>
              </label>
            )}
            {form.interest !== 'none' && (
              <label className="field">
                <span>Juros a partir de</span>
                <input type="date" value={form.interestFrom} onChange={e => update({ interestFrom: e.target.value })} />
                <small>Em branco, desde a data inicial (por exemplo, citação ou vencimento).</small>
              </label>
            )}
            <div className="deadline-row two">
              <label className="field">
                <span>Multa (%)</span>
                <input value={form.fine} inputMode="decimal" onChange={e => update({ fine: e.target.value })} />
              </label>
              <label className="field">
                <span>Honorários (%)</span>
                <input value={form.fees} inputMode="decimal" onChange={e => update({ fees: e.target.value })} />
              </label>
            </div>
          </div>
          <div className="deadline-result">
            {result?.error && (
              <div className="form-error" role="alert">
                {result.error}
              </div>
            )}
            {!result && <p className="help-text">Informe o valor e as datas para calcular.</p>}
            {r && (
              <>
                <div className="deadline-answer" role="status">
                  <span>Total atualizado em {r.end.split('-').reverse().join('/')}</span>
                  <strong>{formatBRL(r.total)}</strong>
                  <small>
                    Corrigido {formatBRL(r.corrected)} (fator{' '}
                    {r.factor.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}) · juros {pct(r.interestRate)} ={' '}
                    {formatBRL(r.interestAmount)}
                    {r.fine ? ` · multa ${formatBRL(r.fine)}` : ''}
                    {r.fees ? ` · honorários ${formatBRL(r.fees)}` : ''}
                  </small>
                </div>
                {r.warnings.map(w => (
                  <div className="conflict-alert info" key={w}>
                    <AlertTriangle size={16} />
                    <small>{w}</small>
                  </div>
                ))}
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
                        () => window.advocacia.saveDebtReport(form),
                        'Memória de cálculo salva em PDF nos documentos.',
                      )
                    }
                  >
                    Salvar PDF
                  </Button>
                </div>
                <details className="deadline-basis" open>
                  <summary>
                    <Scale size={14} /> Critérios
                  </summary>
                  <ul>
                    {r.basis.map(b => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </details>
                <details className="deadline-steps">
                  <summary>Mês a mês</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Mês</th>
                        <th>Índice</th>
                        <th>Fator acumulado</th>
                        <th>Juros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map(row => (
                        <tr key={row.month} className="counted">
                          <td className="tabular">{row.month.split('-').reverse().join('/')}</td>
                          <td className="tabular">{row.index !== null ? pct(row.index, 2) : '—'}</td>
                          <td className="tabular">
                            {row.factor !== null
                              ? row.factor.toLocaleString('pt-BR', { maximumFractionDigits: 8 })
                              : '—'}
                          </td>
                          <td className="tabular">
                            {row.interestRate !== null ? pct(row.interestRate, 6) : '—'}
                            {row.interestDays ? ` (${row.interestDays} d)` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
