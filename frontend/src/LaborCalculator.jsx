import { useMemo, useState } from 'react';
import { FileDown, AlertTriangle, Scale } from 'lucide-react';
import { Button, PageHeading, Panel } from './components.jsx';
import { calculateSeverance, centsBRL, noticeOptions, terminationKinds } from '../../app/labor.mjs';

const br = value => value.split('-').reverse().join('/');

// Simple severance (verbas rescisórias). The PDF is recalculated by the main process from the same inputs.
export default function LaborCalculator({ data, act, initialCaseId = '' }) {
  const [form, setForm] = useState({
    kind: 'sem-justa-causa',
    notice: 'indenizado',
    admission: '',
    termination: '',
    salary: '',
    extras: '',
    salaryDays: '',
    vestedPeriods: '0',
    doubledPeriods: '0',
    fgtsBalance: '',
    art477: false,
    thirteenthAdvance: '',
    caseId: initialCaseId,
  });
  const update = patch => setForm(f => ({ ...f, ...patch }));
  const notices = noticeOptions[form.kind];
  const result = useMemo(() => {
    if (!form.admission || !form.termination || !form.salary) return null;
    try {
      return { value: calculateSeverance(form) };
    } catch (e) {
      return { error: e.message };
    }
  }, [form]);
  const r = result?.value;
  const finePossible = ['sem-justa-causa', 'acordo'].includes(form.kind);
  return (
    <>
      <PageHeading title="Verbas rescisórias" />
      <Panel>
        <div className="deadline-layout">
          <div className="deadline-form">
            <label className="field">
              <span>Modalidade</span>
              <select
                value={form.kind}
                onChange={e =>
                  update({ kind: e.target.value, notice: Object.keys(noticeOptions[e.target.value])[0] || '' })
                }
              >
                {Object.entries(terminationKinds).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {Object.keys(notices).length > 0 && (
              <label className="field">
                <span>Aviso prévio</span>
                <select value={form.notice} onChange={e => update({ notice: e.target.value })}>
                  {Object.entries(notices).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="deadline-row two">
              <label className="field">
                <span>Admissão</span>
                <input type="date" value={form.admission} onChange={e => update({ admission: e.target.value })} />
              </label>
              <label className="field">
                <span>Último dia trabalhado</span>
                <input type="date" value={form.termination} onChange={e => update({ termination: e.target.value })} />
              </label>
            </div>
            <div className="deadline-row two">
              <label className="field">
                <span>Salário mensal</span>
                <input
                  value={form.salary}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  onChange={e => update({ salary: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Médias de variáveis</span>
                <input
                  value={form.extras}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  onChange={e => update({ extras: e.target.value })}
                />
              </label>
            </div>
            <small className="field-hint muted">
              Médias: horas extras, comissões e adicionais habituais que integram a remuneração.
            </small>
            <label className="field">
              <span>Dias trabalhados no mês do desligamento</span>
              <input
                value={form.salaryDays}
                inputMode="numeric"
                maxLength={2}
                placeholder={form.termination ? String(Number(form.termination.slice(8, 10))) : 'dia do desligamento'}
                onChange={e => update({ salaryDays: e.target.value.replace(/\D/g, '') })}
              />
              <small>Em branco, conta do dia 1º até o último dia trabalhado.</small>
            </label>
            <div className="deadline-row two">
              <label className="field">
                <span>Férias vencidas não gozadas</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={form.vestedPeriods}
                  onChange={e => update({ vestedPeriods: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Delas, em dobro</span>
                <input
                  type="number"
                  min="0"
                  max={form.vestedPeriods || 0}
                  value={form.doubledPeriods}
                  onChange={e => update({ doubledPeriods: e.target.value })}
                />
              </label>
            </div>
            <small className="field-hint muted">
              Conte os períodos de 12 meses completos sem férias, inclusive o que se completou no desligamento. Em dobro
              quando passou o prazo de concessão (art. 137 da CLT).
            </small>
            {finePossible && (
              <label className="field">
                <span>Saldo do FGTS para a multa</span>
                <input
                  value={form.fgtsBalance}
                  inputMode="decimal"
                  placeholder="Opcional — em branco, é estimado"
                  onChange={e => update({ fgtsBalance: e.target.value })}
                />
                <small>Use o saldo do extrato da Caixa, somando os saques feitos durante o contrato.</small>
              </label>
            )}
            <label className="field">
              <span>Adiantamento do 13º já pago</span>
              <input
                value={form.thirteenthAdvance}
                inputMode="decimal"
                placeholder="R$ 0,00"
                onChange={e => update({ thirteenthAdvance: e.target.value })}
              />
              <small>A 1ª parcela paga no ano é abatida do 13º proporcional.</small>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.art477} onChange={e => update({ art477: e.target.checked })} />
              Incluir multa do art. 477, § 8º (pagamento em atraso)
            </label>
          </div>
          <div className="deadline-result">
            {result?.error && (
              <div className="form-error" role="alert">
                {result.error}
              </div>
            )}
            {!result && <p className="help-text">Informe admissão, último dia trabalhado e salário para calcular.</p>}
            {r && (
              <>
                <div className="deadline-answer" role="status">
                  <span>Total estimado da rescisão</span>
                  <strong>{centsBRL(r.totals.total)}</strong>
                  <small>
                    Verbas {centsBRL(r.totals.net)}
                    {r.fgts.deposit ? ` · FGTS do mês ${centsBRL(r.fgts.deposit)}` : ''}
                    {r.fgts.fine ? ` · multa de ${r.fgts.finePercent}% ${centsBRL(r.fgts.fine)}` : ''}
                    {' · '}
                    {r.years} ano(s) de casa
                    {r.projected !== r.termination ? ` · projeção do aviso até ${br(r.projected)}` : ''}
                  </small>
                </div>
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
                      {r.items.map(item => (
                        <tr key={item.key}>
                          <td>{item.label}</td>
                          <td className="tabular">{item.reference}</td>
                          <td className={'tabular numeric' + (item.debit ? ' danger-text' : '')}>
                            {item.debit ? '− ' : ''}
                            {centsBRL(item.value)}
                          </td>
                        </tr>
                      ))}
                      <tr className="labor-total">
                        <td colSpan={2}>Total das verbas</td>
                        <td className="tabular numeric">{centsBRL(r.totals.net)}</td>
                      </tr>
                      <tr>
                        <td>FGTS do mês da rescisão (8%)</td>
                        <td />
                        <td className="tabular numeric">{centsBRL(r.fgts.deposit)}</td>
                      </tr>
                      {r.fgts.finePercent > 0 && (
                        <tr>
                          <td>Multa de {r.fgts.finePercent}% do FGTS</td>
                          <td className="tabular">
                            saldo {centsBRL(r.fgts.accountBalance)}
                            {r.fgts.estimated ? ' (estimado)' : ''}
                          </td>
                          <td className="tabular numeric">{centsBRL(r.fgts.fine)}</td>
                        </tr>
                      )}
                      <tr className="labor-total">
                        <td colSpan={2}>Total geral</td>
                        <td className="tabular numeric">{centsBRL(r.totals.total)}</td>
                      </tr>
                    </tbody>
                  </table>
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
                        () => window.advocacia.saveLaborReport(form),
                        'Memória de cálculo da rescisão salva em PDF nos documentos.',
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
              </>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
