// Fees and expenses: status of each entry, installments and totals. Amounts are strings in reais
// ("1234.56") and all sums are done in cents to avoid floating point errors.
import { isDateKey } from './deadlines.mjs';

export const cents = value => (value === '' || value == null ? 0 : Math.round(Number(value) * 100));
export const fromCents = n => (n / 100).toFixed(2);

// 'paid' | 'overdue' | 'open' | 'pending-amount' (success fee not yet known)
export function entryStatus(entry, today) {
  if (entry.paidDate) return 'paid';
  if (!entry.amount) return 'pending-amount';
  return entry.dueDate < today ? 'overdue' : 'open';
}
export const statusLabels = { paid: 'Pago', overdue: 'Atrasado', open: 'Em aberto', 'pending-amount': 'A apurar' };

// Same day in the following months, clamped to the last day (31/01 → 28/02).
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// Splits a total into monthly installments; the last one absorbs the rounding difference.
export function buildInstallments({ total, count, firstDue, ...base }) {
  const totalCents = cents(total);
  if (!Number.isInteger(count) || count < 2 || count > 120) throw new Error('Use de 2 a 120 parcelas.');
  if (!totalCents || totalCents < count) throw new Error('Informe o valor total a parcelar.');
  if (!isDateKey(firstDue)) throw new Error('Informe o vencimento da primeira parcela.');
  const part = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    amount: fromCents(i === count - 1 ? totalCents - part * (count - 1) : part),
    dueDate: addMonths(firstDue, i),
    description: `${base.description} (${i + 1}/${count})`,
    seriesIndex: String(i + 1),
    seriesCount: String(count),
  }));
}

// Totals for a list of entries, for the period between from and to (inclusive) when given.
export function summarize(entries, today, { from = '', to = '' } = {}) {
  const within = date => (!from || date >= from) && (!to || date <= to);
  const sum = { toReceive: 0, overdue: 0, received: 0, expenses: 0, reimbursable: 0 };
  for (const e of entries) {
    const status = entryStatus(e, today);
    const value = cents(e.amount);
    if (e.direction === 'Receita') {
      if (status === 'paid' && within(e.paidDate)) sum.received += value;
      if (status === 'overdue') sum.overdue += value;
      if (status === 'open' && within(e.dueDate)) sum.toReceive += value;
    } else if (within(e.paidDate || e.dueDate)) {
      sum.expenses += value;
      // Expenses the client must repay; the repayment itself is a "Reembolso de despesa" income entry.
      if (e.reimbursable) sum.reimbursable += value;
    }
  }
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, fromCents(v)]));
}

// Rows for a spreadsheet export, in a stable column order.
export const exportColumns = [
  ['dueDate', 'Vencimento'],
  ['direction', 'Tipo'],
  ['category', 'Categoria'],
  ['description', 'Descrição'],
  ['client', 'Cliente'],
  ['case', 'Processo'],
  ['amount', 'Valor (R$)'],
  ['status', 'Situação'],
  ['paidDate', 'Pago em'],
  ['method', 'Forma'],
  ['reimbursable', 'Reembolsável'],
];
