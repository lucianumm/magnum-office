// Turns the hours of a case not yet charged into one receivable in Finance, and marks them as billed.
const { uuid } = require('./validation.cjs');

const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const label = minutes => `${Math.floor(minutes / 60)}h${pad(minutes % 60)}`;

function billTime(store, caseId) {
  const caseItem = store.get('cases', uuid(caseId));
  const open = store.list('time').filter(t => t.caseId === caseItem.id && !t.billed && Number(t.rate) > 0);
  if (!open.length) throw new Error('Não há horas com valor da hora a cobrar neste processo.');
  const minutes = open.reduce((n, t) => n + Number(t.minutes), 0);
  const cents = open.reduce((n, t) => n + Math.round((Number(t.minutes) / 60) * Number(t.rate) * 100), 0);
  const entry = store.save('finance', {
    description: `Honorários por hora — ${label(minutes)} — ${caseItem.title}`.slice(0, 200),
    direction: 'Receita',
    category: 'Honorário contratual',
    amount: (cents / 100).toFixed(2),
    dueDate: today(),
    paidDate: '',
    method: '',
    clientId: caseItem.clientId || '',
    caseId: caseItem.id,
  });
  for (const t of open) store.save('time', { ...t, id: t.id, billed: entry.id });
  store.audit('time.billed', { id: entry.id });
  return entry;
}

module.exports = { billTime };
