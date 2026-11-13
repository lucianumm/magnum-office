// Named variables for WhatsApp messages. {cliente}, {data}, {hora}... are filled from the client, the event
// and the case. The old numbered ones ({1} to {6}) keep working, so no existing template breaks.
// Everything here is pure (no database, no clock): the caller passes the data.

export const messageVariableList = [
  ['{cliente}', 'Nome completo do cliente'],
  ['{primeiro_nome}', 'Primeiro nome do cliente'],
  ['{escritorio}', 'Nome do escritório'],
  ['{advogado}', 'Advogado do escritório'],
  ['{evento}', 'Tipo do evento (audiência de instrução, perícia médica...)'],
  ['{data}', 'Data do evento (dd/mm/aaaa)'],
  ['{dia_semana}', 'Dia da semana (quinta-feira)'],
  ['{hora}', 'Horário do evento'],
  ['{modalidade}', 'Presencial ou por videoconferência'],
  ['{local}', 'Local ou endereço'],
  ['{link_sala}', 'Link da sala virtual'],
  ['{detalhes}', 'Local, sala virtual e orientações, só o que foi preenchido'],
  ['{processo}', 'Título do processo'],
  ['{numero_processo}', 'Número do processo'],
  ['{processo_ref}', '"no processo nº ..." (vazio se não houver processo)'],
  ['{vara}', 'Vara ou órgão'],
  ['{comarca}', 'Comarca'],
  ['{ultimo_andamento}', 'Último andamento do processo'],
  ['{data_andamento}', 'Data do último andamento'],
  ['{valor}', 'Valor (cobrança)'],
  ['{vencimento}', 'Vencimento (cobrança)'],
];
const named = new Set(messageVariableList.map(([token]) => token.slice(1, -1)));
// Aliases kept from before.
named.add('titulo');
const legacy = { 1: 'cliente', 2: 'primeiro_nome', 3: 'escritorio', 4: 'data', 5: 'hora', 6: 'titulo' };

const weekdays = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const brDate = iso => iso.split('-').reverse().join('/');
const cleanLine = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

// "2026-11-12T14:30" → { data: '12/11/2026', hora: '14:30', dia_semana: 'quinta-feira' } (local date, no timezone math).
export function whenParts(due) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(due || ''));
  if (!m) return { data: '', hora: '', dia_semana: '' };
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { data: brDate(`${m[1]}-${m[2]}-${m[3]}`), hora: m[4], dia_semana: weekdays[day.getDay()] };
}

// Everything the message can say, from plain objects. Missing data gives an empty value (never "undefined").
export function messageContext({
  client = {},
  settings = {},
  task = {},
  caseItem = null,
  lawyer = '',
  movement = null,
  entry = null,
} = {}) {
  const name = cleanLine(client.name) || 'cliente';
  const when = whenParts(task.due);
  const event = [cleanLine(task.type), cleanLine(task.eventKind)].filter(Boolean).join(' ').toLowerCase();
  const modality =
    task.modality === 'virtual' ? 'por videoconferência' : task.modality === 'presencial' ? 'presencial' : '';
  const place = cleanLine(task.place);
  const link = cleanLine(task.roomLink);
  const notes = cleanLine(task.clientNotes);
  const details = [
    modality && `Modalidade: ${modality}.`,
    place && `Local: ${place}.`,
    link && `Sala virtual: ${link}`,
    notes && `Orientações: ${notes}`,
  ]
    .filter(Boolean)
    .join('\n');
  const number = cleanLine(caseItem?.number);
  return {
    cliente: name,
    primeiro_nome: name.split(' ')[0],
    escritorio: cleanLine(settings.officeName) || 'nosso escritório',
    advogado: cleanLine(lawyer),
    evento: event,
    ...when,
    modalidade: modality,
    local: place,
    link_sala: link,
    detalhes: details,
    processo: cleanLine(caseItem?.title),
    numero_processo: number,
    processo_ref: number ? ` no processo nº ${number}` : '',
    vara: cleanLine(task.court || caseItem?.court),
    comarca: cleanLine(caseItem?.county),
    ultimo_andamento: cleanLine(movement?.name),
    data_andamento: movement?.date ? brDate(String(movement.date).slice(0, 10)) : '',
    valor: entry?.amount ? Number(entry.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
    vencimento: entry?.dueDate ? brDate(entry.dueDate) : '',
    titulo: cleanLine(task.title),
  };
}

// Fills the variables. Unknown {words} are left as written, so literal braces survive.
export function renderMessage(body, context) {
  return String(body ?? '')
    .replace(/\{(\d)\}/g, (all, n) => (legacy[n] ? (context[legacy[n]] ?? '') : all))
    .replace(/\{([a-z_]+)\}/g, (all, key) => (named.has(key) ? (context[key] ?? '') : all))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// {words} in a template that are not variables: used to refuse a typo before it reaches a client.
export function unknownVariables(body) {
  const found = new Set();
  for (const m of String(body ?? '').matchAll(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g))
    if (!named.has(m[1])) found.add(`{${m[1]}}`);
  for (const m of String(body ?? '').matchAll(/\{(\d+)\}/g)) if (!legacy[m[1]]) found.add(`{${m[1]}}`);
  return [...found];
}
