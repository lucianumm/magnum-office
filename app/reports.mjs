// Office reports for a period: cases, deadlines, new clients, intakes and money. Pure functions over
// the records already loaded; "concluded" means marked as concluded in the program.
import { cents, fromCents } from './finance.mjs';

const count = (list, key) => {
  const map = new Map();
  for (const item of list) {
    const k = key(item) || 'Não informado';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};
const within = (date, from, to) => !!date && date >= from && date <= to;
export function monthKeys(to, n) {
  const [y, m] = to.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export function officeReport({ entities, today, from, to }) {
  const cases = entities.cases || [];
  const clients = entities.clients || [];
  const tasks = entities.tasks || [];
  const finance = entities.finance || [];
  const intakes = entities.intakes || [];
  const active = cases.filter(c => ['Em andamento', 'Aguardando'].includes(c.status));
  const deadlines = tasks.filter(t => t.type === 'Prazo');
  const inPeriod = deadlines.filter(t => within(t.due.slice(0, 10), from, to));
  const pendingNow = tasks.filter(t => t.status !== 'Concluída');
  const periodIntakes = intakes.filter(i => within(i.date, from, to));
  const converted = periodIntakes.filter(i => i.status === 'Contratado').length;
  const closed = periodIntakes.filter(i => ['Contratado', 'Não contratado'].includes(i.status)).length;
  const money = { received: 0, expenses: 0, overdue: 0 };
  for (const e of finance) {
    if (e.direction === 'Receita' && e.paidDate && within(e.paidDate, from, to)) money.received += cents(e.amount);
    if (e.direction === 'Despesa' && within(e.paidDate || e.dueDate, from, to)) money.expenses += cents(e.amount);
    if (e.direction === 'Receita' && !e.paidDate && e.amount && e.dueDate < today) money.overdue += cents(e.amount);
  }
  const months = monthKeys(to.slice(0, 7), 12).map(month => {
    const inMonth = date => !!date && date.slice(0, 7) === month;
    return {
      month,
      newClients: clients.filter(c => inMonth(c.createdAt)).length,
      newCases: cases.filter(c => inMonth(c.createdAt)).length,
      received: fromCents(
        finance.filter(e => e.direction === 'Receita' && inMonth(e.paidDate)).reduce((n, e) => n + cents(e.amount), 0),
      ),
      expenses: fromCents(
        finance
          .filter(e => e.direction === 'Despesa' && inMonth(e.paidDate || e.dueDate))
          .reduce((n, e) => n + cents(e.amount), 0),
      ),
    };
  });
  return {
    from,
    to,
    cases: {
      active: active.length,
      total: cases.length,
      byArea: count(active, c => c.area),
      byPhase: count(active, c => c.phase),
      byStatus: count(cases, c => c.status),
    },
    newClients: clients.filter(c => within((c.createdAt || '').slice(0, 10), from, to)).length,
    newCases: cases.filter(c => within((c.createdAt || '').slice(0, 10), from, to)).length,
    deadlines: {
      inPeriod: inPeriod.length,
      concluded: inPeriod.filter(t => t.status === 'Concluída').length,
      // Deadlines of the period that passed without being marked as concluded.
      missed: inPeriod.filter(t => t.status !== 'Concluída' && t.due.slice(0, 10) < today).length,
      overdueNow: pendingNow.filter(t => t.due.slice(0, 10) < today).length,
      next7: pendingNow.filter(t => t.due.slice(0, 10) >= today && t.due.slice(0, 10) <= addDays(today, 7)).length,
    },
    intakes: {
      total: periodIntakes.length,
      converted,
      conversion: closed ? Math.round((converted / closed) * 100) : null,
      byStatus: count(periodIntakes, i => i.status),
      bySource: count(periodIntakes, i => i.source),
    },
    money: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, fromCents(v)])),
    months,
  };
}
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
