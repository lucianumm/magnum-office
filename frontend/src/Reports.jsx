import { useMemo, useState } from 'react';
import { PageHeading, Panel, dayKey } from './components.jsx';
import { officeReport } from '../../app/reports.mjs';
import { formatBRL } from '../../app/money.mjs';

const periods = [
  ['month', 'Este mês'],
  ['3m', 'Últimos 3 meses'],
  ['12m', 'Últimos 12 meses'],
  ['year', 'Este ano'],
];
function range(period, today) {
  const [y, m] = today.split('-').map(Number);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (period === 'month') return { from: first(y, m), to: lastOfMonth };
  if (period === '3m') return { from: first(y, m - 2), to: lastOfMonth };
  if (period === '12m') return { from: first(y, m - 11), to: lastOfMonth };
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}
const monthLabel = key =>
  new Date(key + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });

// One series, one hue: bars share the accent color and the value is always written next to them.
function Breakdown({ title, rows, total }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <Panel title={title}>
      {rows.length ? (
        <ul className="breakdown">
          {rows.map(([label, n]) => (
            <li key={label} title={`${label}: ${n}${total ? ` (${Math.round((n / total) * 100)}%)` : ''}`}>
              <span className="breakdown-label">{label}</span>
              <span className="breakdown-track" aria-hidden="true">
                <span className="breakdown-bar" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="breakdown-value tabular">{n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="help-text breakdown-empty">Sem dados no período.</p>
      )}
    </Panel>
  );
}

export default function Reports({ data }) {
  const today = dayKey(new Date());
  const [period, setPeriod] = useState('month');
  const r = useMemo(
    () => officeReport({ entities: data.entities, today, ...range(period, today) }),
    [data.entities, today, period],
  );
  const tiles = [
    ['Processos ativos', r.cases.active],
    ['Novos clientes', r.newClients],
    ['Novos processos', r.newCases],
    ['Prazos no período', r.deadlines.inPeriod, `${r.deadlines.concluded} concluídos`],
    [
      'Prazos vencidos sem conclusão',
      r.deadlines.missed,
      r.deadlines.missed ? 'confira se foram cumpridos' : '',
      r.deadlines.missed ? 'danger' : '',
    ],
    ['Atendimentos', r.intakes.total, r.intakes.conversion !== null ? `${r.intakes.conversion}% contratados` : ''],
    ['Recebido', formatBRL(r.money.received)],
    ['Despesas', formatBRL(r.money.expenses)],
    ['Em atraso a receber', formatBRL(r.money.overdue), '', Number(r.money.overdue) ? 'danger' : ''],
  ];
  return (
    <>
      <PageHeading title="Relatórios">
        <label className="field report-period">
          <span>Período</span>
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            {periods.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </PageHeading>
      <div className="finance-tiles report-tiles">
        {tiles.map(([label, value, note, tone]) => (
          <div className={'finance-tile ' + (tone || '')} key={label}>
            <span>{label}</span>
            <strong className="tabular">{value}</strong>
            {note && <small>{note}</small>}
          </div>
        ))}
      </div>
      <div className="report-grid">
        <Breakdown title="Processos ativos por área" rows={r.cases.byArea} total={r.cases.active} />
        <Breakdown title="Processos ativos por fase" rows={r.cases.byPhase} total={r.cases.active} />
        <Breakdown title="Todos os processos por situação" rows={r.cases.byStatus} total={r.cases.total} />
        <Breakdown title="Atendimentos por origem" rows={r.intakes.bySource} total={r.intakes.total} />
      </div>
      <Panel title="Últimos 12 meses">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Novos clientes</th>
                <th>Novos processos</th>
                <th>Recebido</th>
                <th>Despesas</th>
              </tr>
            </thead>
            <tbody>
              {r.months.map(m => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="tabular">{m.newClients}</td>
                  <td className="tabular">{m.newCases}</td>
                  <td className="tabular">{formatBRL(m.received)}</td>
                  <td className="tabular">{formatBRL(m.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="help-text">
        Os números contam o que está registrado no programa. Um prazo “vencido sem conclusão” é um prazo do período que
        não foi marcado como concluído; confira se foi cumprido.
      </p>
    </>
  );
}
