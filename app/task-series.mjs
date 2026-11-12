// Repeating appointments: the dates of a series in local time ("2026-11-12T09:00"). Monthly keeps
// the day, falling back to the last day of shorter months (31 → 30 → 28/29).
export const repeatOptions = {
  daily: 'Todo dia útil',
  weekly: 'Toda semana',
  biweekly: 'A cada duas semanas',
  monthly: 'Todo mês',
};
const MAX = 60;

const pad = n => String(n).padStart(2, '0');
const format = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function seriesDates(due, repeat, until) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(due || '');
  if (!m) throw new Error('Informe a data e o horário do primeiro compromisso.');
  if (!repeatOptions[repeat]) throw new Error('Escolha como o compromisso se repete.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until || '') || until < m[1]) throw new Error('Informe até quando ele se repete.');
  const [y, mo, d] = m[1].split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, d));
  const dates = [];
  for (let i = 0; dates.length < MAX + 1; i++) {
    let next;
    if (repeat === 'monthly') {
      const target = new Date(Date.UTC(y, mo - 1 + i, 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      next = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
    } else next = new Date(first.getTime() + i * 86400000 * (repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 1));
    if (format(next) > until) break;
    // "Todo dia útil" skips Saturdays and Sundays.
    if (repeat === 'daily' && [0, 6].includes(next.getUTCDay())) continue;
    dates.push(`${format(next)}T${m[2]}`);
  }
  if (dates.length > MAX)
    throw new Error(`Uma série pode ter até ${MAX} compromissos. Escolha uma data final mais próxima.`);
  if (dates.length < 2) throw new Error('A data final deve permitir pelo menos duas ocorrências.');
  return dates;
}
