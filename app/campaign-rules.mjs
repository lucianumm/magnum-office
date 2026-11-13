// Dates and audiences of WhatsApp campaigns. Pure functions: they receive "now" and the data, so every rule
// can be tested without a clock. All times are the office's local time (the computer's), as everywhere else.

export const calendarDates = {
  'new-year': { label: 'Ano-Novo', fixed: [1, 1] },
  'women-day': { label: 'Dia Internacional da Mulher', fixed: [3, 8] },
  easter: { label: 'Páscoa', easter: true },
  mothers: { label: 'Dia das Mães', nth: [4, 0, 2] }, // 2nd Sunday of May
  fathers: { label: 'Dia dos Pais', nth: [7, 0, 2] }, // 2nd Sunday of August
  lawyer: { label: 'Dia do Advogado', fixed: [8, 11] },
  justice: { label: 'Dia da Justiça', fixed: [12, 8] },
  christmas: { label: 'Natal', fixed: [12, 25] },
};
export const recurrenceKinds = {
  weekdays: 'Todos os dias úteis',
  weekly: 'Toda semana',
  biweekly: 'A cada 15 dias',
  monthly: 'Todo mês',
  quarterly: 'A cada 3 meses',
  semiannual: 'A cada 6 meses',
  yearly: 'Todo ano',
};
export const triggerTypes = {
  'client-birthday': 'Aniversário do cliente',
  'client-since': 'Aniversário de cliente do escritório',
  yearly: 'Data fixa todo ano',
  calendar: 'Data comemorativa',
  dates: 'Datas específicas',
  recurring: 'Repetir',
  'before-event': 'Antes ou depois de um compromisso',
  'case-created': 'Processo cadastrado (boas-vindas)',
  'case-closed': 'Processo concluído (satisfação)',
  'finance-overdue': 'Honorário vencido (cobrança gentil)',
};
export const dateTriggers = ['yearly', 'calendar', 'dates', 'recurring'];

const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastDay = (year, month) => new Date(year, month + 1, 0).getDate();
// 29/02 in a year without it, 31/04 and the like: the last day of that month.
export const clampedDay = (year, month, day) => Math.min(day, lastDay(year, month));
export function at(year, month, day, time = '09:00') {
  const [h, m] = String(time).split(':').map(Number);
  return new Date(year, month, clampedDay(year, month, day), h || 0, m || 0);
}
// Easter Sunday (Meeus/Jones/Butcher): month is 0-based.
export function easter(year) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31) - 1,
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}
// The n-th given weekday (0 = Sunday) of a month (0-based).
export function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
}
function calendarDay(key, year) {
  const rule = calendarDates[key];
  if (!rule) return null;
  if (rule.easter) return easter(year);
  if (rule.nth) return { month: rule.nth[0], day: nthWeekday(year, ...rule.nth) };
  return { month: rule.fixed[0] - 1, day: rule.fixed[1] };
}
const monthStep = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

// Every date a date-based trigger falls on between from and to (inclusive), oldest first.
export function occurrences(trigger, from, to) {
  const time = trigger.time || '09:00';
  const result = [];
  const inRange = d => d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
  if (trigger.type === 'yearly' || trigger.type === 'calendar') {
    for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
      const day =
        trigger.type === 'yearly'
          ? { month: Number(trigger.month) - 1, day: Number(trigger.day) }
          : calendarDay(trigger.key, year);
      if (!day) continue;
      const d = at(year, day.month, day.day, time);
      if (inRange(d)) result.push(d);
    }
  } else if (trigger.type === 'dates') {
    for (const key of [...(trigger.dates || [])].sort()) {
      const [y, m, d] = key.split('-').map(Number);
      const date = at(y, m - 1, d, time);
      if (inRange(date)) result.push(date);
    }
  } else if (trigger.type === 'recurring') {
    const [y, m, d] = String(trigger.start).split('-').map(Number);
    let until = null;
    if (trigger.until) {
      const [uy, um, ud] = trigger.until.split('-').map(Number);
      until = new Date(uy, um - 1, ud, 23, 59);
    }
    const max = Number(trigger.count) > 0 ? Number(trigger.count) : Infinity;
    // For weekdays the cursor walks day by day, skipping Saturdays and Sundays (a weekend start begins on Monday).
    const cursor = new Date(y, m - 1, d);
    for (let i = 0; i < max && i < 5000; i++) {
      let date;
      if (trigger.every === 'weekdays') {
        while (cursor.getDay() === 0 || cursor.getDay() === 6) cursor.setDate(cursor.getDate() + 1);
        date = at(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), time);
        cursor.setDate(cursor.getDate() + 1);
      } else if (trigger.every === 'weekly' || trigger.every === 'biweekly') {
        const real = new Date(y, m - 1, d + (trigger.every === 'weekly' ? 7 : 14) * i);
        date = at(real.getFullYear(), real.getMonth(), real.getDate(), time);
      } else if (monthStep[trigger.every]) {
        const total = m - 1 + monthStep[trigger.every] * i;
        date = at(y + Math.floor(total / 12), total % 12, d, time);
      } else break;
      if ((until && date.getTime() > until.getTime()) || date.getTime() > to.getTime()) break;
      if (inRange(date)) result.push(date);
    }
  }
  return result;
}

// Next anniversary-style date of a client: birthday ('birthDate') or since the register began ('createdAt').
export function clientOccurrences(trigger, client, from, to) {
  const source = trigger.type === 'client-birthday' ? client.birthDate : String(client.createdAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source || '')) return [];
  const [y, m, d] = source.split('-').map(Number);
  const result = [];
  for (let year = from.getFullYear(); year <= to.getFullYear(); year++) {
    // The anniversary of the register only starts the year after it.
    if (trigger.type === 'client-since' && year <= y) continue;
    const date = at(year, m - 1, d, trigger.time || '09:00');
    if (date.getTime() >= from.getTime() && date.getTime() <= to.getTime()) result.push(date);
  }
  return result;
}

// Who a campaign is for. cases: all cases; segment: { mode: 'all' | 'area' | 'tag' | 'phase' | 'cases' | 'clients', values }.
export function inSegment(client, cases, segment = { mode: 'all' }) {
  if (client.status !== 'Ativo') return false;
  const values = segment.values || [];
  const mine = cases.filter(c => c.clientId === client.id);
  switch (segment.mode) {
    case 'area':
      return mine.some(c => values.includes(c.area));
    case 'phase':
      return mine.some(c => values.includes(c.phase));
    case 'tag':
      return mine.some(c =>
        String(c.tags || '')
          .split(',')
          .map(t => t.trim().toLowerCase())
          .some(t => t && values.map(v => v.toLowerCase()).includes(t)),
      );
    case 'cases':
      return mine.some(c => values.includes(c.id));
    case 'clients':
      return values.includes(client.id);
    default:
      return true;
  }
}

// Words that mean "stop writing to me" (without accents or case).
const stopWords = new Set(['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover']);
export const normalizeReply = text =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const isStopReply = text => stopWords.has(normalizeReply(text));
