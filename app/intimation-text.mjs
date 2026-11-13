// Reading the text of a publication (intimação): where the deadline is, which date is a hearing, which values
// appear, and how urgent it looks. Pure and offline. These are aids to reading, never a legal calculation:
// the deadline itself is always calculated in "Calcular prazo".

const words = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  quinze: 15,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  sessenta: 60,
};
const NUM = `(\\d{1,3}|${Object.keys(words).join('|')})`;
const EXT = '(?:\\s*\\([^)]{1,40}\\))?';
const UNIT = '(?:\\s+(úteis|uteis|corridos))?';
const deadlinePatterns = [
  new RegExp(`prazo\\s+(?:legal\\s+|comum\\s+|sucessivo\\s+)?(?:de\\s+)?${NUM}${EXT}\\s+dias?${UNIT}`, 'gi'),
  new RegExp(`\\b(?:em|dentro\\s+de|no\\s+prazo\\s+de)\\s+${NUM}${EXT}\\s+dias?${UNIT}`, 'gi'),
  new RegExp(`\\b${NUM}${EXT}\\s+dias?\\s+(úteis|uteis|corridos)`, 'gi'),
  new RegExp(`\\b${NUM}${EXT}\\s+dias?()\\s+para\\b`, 'gi'),
];
const datePattern = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const longDatePattern =
  /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/gi;
const moneyPattern = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/g;
const months = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
const pad = n => String(n).padStart(2, '0');
const toNumber = raw => (/^\d+$/.test(raw) ? Number(raw) : words[raw.toLowerCase()]);
const validDay = (y, m, d) => {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

// Deadlines mentioned in the text: [{ start, end, days, unit: 'uteis' | 'corridos' | '' }], in reading order.
export function findDeadlines(text) {
  const found = [];
  for (const pattern of deadlinePatterns) {
    pattern.lastIndex = 0;
    for (const m of String(text).matchAll(pattern)) {
      const days = toNumber(m[1]);
      if (!days || days > 365) continue;
      const unit = /^[uú]teis$/i.test(m[2] || '') ? 'uteis' : /^corridos$/i.test(m[2] || '') ? 'corridos' : '';
      found.push({ start: m.index, end: m.index + m[0].length, days, unit });
    }
  }
  // A phrase caught by two patterns counts once (the longest wins).
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  for (const f of found) if (!result.length || f.start >= result.at(-1).end) result.push(f);
  return result;
}

// Every date written in the text, as { start, end, date: 'YYYY-MM-DD' }.
export function findDates(text) {
  const found = [];
  for (const m of String(text).matchAll(datePattern)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validDay(y, mo, d))
      found.push({ start: m.index, end: m.index + m[0].length, date: `${y}-${pad(mo)}-${pad(d)}` });
  }
  for (const m of String(text).matchAll(longDatePattern)) {
    const [d, mo, y] = [Number(m[1]), months[m[2].toLowerCase()], Number(m[3])];
    if (validDay(y, mo, d))
      found.push({ start: m.index, end: m.index + m[0].length, date: `${y}-${pad(mo)}-${pad(d)}` });
  }
  return found.sort((a, b) => a.start - b.start);
}

const eventWords = /audi[eê]ncia|per[ií]cia|sess[ãa]o|julgamento|designad[ao]/i;
const timePattern = /(?:[àa]s\s*|,\s*|-\s*|\s)(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?/i;
// A hearing, expert exam or session with a date (and time, if given): { date, time, kind } or null.
export function findEvent(text) {
  const source = String(text);
  for (const d of findDates(source)) {
    const before = source.slice(Math.max(0, d.start - 160), d.start);
    if (!eventWords.test(before)) continue;
    const kindMatch = /per[ií]cia/i.test(before) ? 'Perícia' : 'Audiência';
    const after = source.slice(d.end, d.end + 40);
    const t = timePattern.exec(after);
    let time = '';
    if (t && Number(t[1]) <= 23) time = `${pad(Number(t[1]))}:${t[2] || '00'}`;
    return { date: d.date, time, kind: kindMatch };
  }
  return null;
}

// The text cut in marked and plain pieces for display: [{ text, kind: '' | 'deadline' | 'date' | 'money' }].
export function segments(text) {
  const source = String(text);
  const marks = [
    ...findDeadlines(source).map(m => ({ ...m, kind: 'deadline' })),
    ...findDates(source).map(m => ({ ...m, kind: 'date' })),
    ...[...source.matchAll(moneyPattern)].map(m => ({ start: m.index, end: m.index + m[0].length, kind: 'money' })),
  ].sort((a, b) => a.start - b.start || (a.kind === 'deadline' ? -1 : 1));
  const result = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) result.push({ text: source.slice(at, m.start), kind: '' });
    result.push({ text: source.slice(m.start, m.end), kind: m.kind });
    at = m.end;
  }
  if (at < source.length) result.push({ text: source.slice(at), kind: '' });
  return result;
}

// Paragraphs for reading: line breaks first, then long blocks at the end of a sentence.
export function paragraphs(text) {
  const out = [];
  for (const block of String(text || '')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)) {
    if (block.length <= 600) out.push(block);
    else {
      let current = '';
      for (const sentence of block.split(/(?<=[.;:])\s+/)) {
        if (current && current.length + sentence.length > 500) {
          out.push(current);
          current = sentence;
        } else current = current ? `${current} ${sentence}` : sentence;
      }
      if (current) out.push(current);
    }
  }
  return out;
}

// Kinds of publication, with the label's color for the screen.
export function kindOf(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.includes('cita')) return { key: 'citation', label: 'Citação', tone: 'red' };
  if (t.includes('intima')) return { key: 'intimation', label: 'Intimação', tone: 'amber' };
  if (t.includes('pauta')) return { key: 'agenda', label: 'Pauta de julgamento', tone: 'blue' };
  if (t.includes('edital')) return { key: 'edict', label: 'Edital', tone: 'purple' };
  if (t.includes('distribui')) return { key: 'distribution', label: 'Distribuição', tone: 'neutral' };
  if (t.includes('ata')) return { key: 'minutes', label: 'Ata', tone: 'neutral' };
  return { key: 'other', label: tipo || 'Comunicação', tone: 'neutral' };
}

const dayNumber = key => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const keyOf = n => new Date(n * 86400000).toISOString().slice(0, 10);
// A rough end date from the publication date (count starts the next working day): only to order by urgency.
export function approximateEnd(published, deadline) {
  let n = dayNumber(published) + 1; // available on the date; published the next working day, counting from the one after
  const weekend = k => [0, 6].includes(new Date(k * 86400000).getUTCDay());
  while (weekend(n)) n++;
  let left = deadline.days;
  if (deadline.unit === 'corridos') return keyOf(n + left);
  while (left > 0) {
    n++;
    if (!weekend(n)) left--;
  }
  return keyOf(n);
}

// How pressing a publication looks today: { level: 'high' | 'medium' | 'normal', daysLeft, approxEnd, deadline }.
export function urgency(item, today) {
  const status = item.status || 'new';
  if (status !== 'new') return { level: 'normal', daysLeft: null, approxEnd: '', deadline: null };
  const deadline = findDeadlines(item.texto || '')[0] || null;
  const kind = kindOf(item.tipo).key;
  if (deadline) {
    const approxEnd = approximateEnd(item.date, deadline);
    const daysLeft = dayNumber(approxEnd) - dayNumber(today);
    return { level: daysLeft <= 3 ? 'high' : daysLeft <= 10 ? 'medium' : 'normal', daysLeft, approxEnd, deadline };
  }
  return {
    level: kind === 'citation' ? 'high' : kind === 'intimation' ? 'medium' : 'normal',
    daysLeft: null,
    approxEnd: '',
    deadline: null,
  };
}

// Publications grouped by process, newest process activity first. Items without a number stay together at the end.
export function groupByProcess(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.processo || 'sem-numero';
    if (!groups.has(key)) groups.set(key, { key, processo: item.processo, mask: item.processoMascara, items: [] });
    groups.get(key).items.push(item);
  }
  const list = [...groups.values()];
  for (const g of list) g.items.sort((a, b) => b.date.localeCompare(a.date));
  return list.sort(
    (a, b) => (a.key === 'sem-numero') - (b.key === 'sem-numero') || b.items[0].date.localeCompare(a.items[0].date),
  );
}
