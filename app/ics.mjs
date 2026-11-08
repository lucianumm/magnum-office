// iCalendar (.ics, RFC 5545) export of the agenda, to import into Google Calendar, Outlook or a phone.
// Deadlines become all-day events; other appointments last one hour in the computer's local time.

const escape = s =>
  String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes continue on the next line starting with a space (RFC 5545, 3.1).
const byteLength = s => new TextEncoder().encode(s).length;
function fold(line) {
  if (byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  for (const ch of line) {
    const limit = parts.length ? 74 : 75;
    if (byteLength(current + ch) > limit) {
      parts.push(current);
      current = '';
    }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compact = (date, time = '') => date.replace(/-/g, '') + (time ? 'T' + time.replace(':', '') + '00' : '');
function addHour(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, h + 1, min));
  return { date: end.toISOString().slice(0, 10), time: end.toISOString().slice(11, 16) };
}

// tasks: agenda entries; names: { clients: Map, cases: Map } used only when includeNames is true.
export function agendaICS(
  tasks,
  { includeNames = false, clients = new Map(), cases = new Map(), now = new Date(), officeName = '' } = {},
) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Magnum Office//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(officeName ? `Agenda — ${officeName}` : 'Agenda do escritório')}`,
  ];
  for (const t of tasks) {
    const [date, time] = String(t.due).split('T');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time || '')) continue;
    const context = includeNames ? [cases.get(t.caseId), clients.get(t.clientId)].filter(Boolean).join(' · ') : '';
    lines.push('BEGIN:VEVENT', `UID:${t.id}@magnum-office`, `DTSTAMP:${stamp}`);
    if (t.type === 'Prazo') {
      // All-day: DTEND is the following day (exclusive).
      const next = new Date(Date.UTC(...date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) + 86400000)
        .toISOString()
        .slice(0, 10);
      lines.push(`DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(next)}`);
    } else {
      const end = addHour(date, time);
      lines.push(`DTSTART:${compact(date, time)}`, `DTEND:${compact(end.date, end.time)}`);
    }
    lines.push(`SUMMARY:${escape(`${t.type}: ${t.title}`)}`);
    const description = [
      context,
      t.type === 'Prazo' ? `Vencimento às ${time}` : '',
      t.priority && t.priority !== 'Normal' ? `Prioridade ${t.priority}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
