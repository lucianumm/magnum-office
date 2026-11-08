// Procedural deadline calculator. It is an assistant: every result shows the day-by-day reasoning and
// the legal basis, and the lawyer confirms it against the court's own calendar.
// Dates are 'YYYY-MM-DD' strings; arithmetic is done in UTC so the local time zone never shifts a day.

const pad = n => String(n).padStart(2, '0');
const toDate = s => new Date(s + 'T00:00:00Z');
const keyOf = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return keyOf(d);
};
const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const weekdayName = s => weekdayNames[toDate(s).getUTCDay()];
export const isDateKey = s =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(toDate(s).getTime()) &&
  keyOf(toDate(s)) === s;

// Easter Sunday (Meeus/Jones/Butcher, Gregorian calendar).
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
    month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export const calendarProfiles = {
  padrao: 'Feriados nacionais e dias sem expediente comuns no Judiciário',
  federal: 'Justiça Federal (Lei nº 5.010/1966, art. 62)',
};

// { 'YYYY-MM-DD': { type: 'holiday' | 'reduced', reason } } for one year.
function yearCalendar(year, profile) {
  const days = {};
  const set = (date, type, reason) => {
    if (!days[date] || days[date].type === 'reduced') days[date] = { type, reason };
  };
  // Lei nº 662/1949, Lei nº 6.802/1980 (12/10) e Lei nº 14.759/2023 (20/11).
  for (const [md, name] of [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
    ['12-25', 'Natal'],
  ])
    set(`${year}-${md}`, 'holiday', `Feriado nacional: ${name}`);
  const e = easter(year);
  set(addDays(e, -2), 'holiday', 'Sexta-feira da Paixão');
  set(addDays(e, -48), 'holiday', 'Carnaval (segunda-feira)');
  set(addDays(e, -47), 'holiday', 'Carnaval (terça-feira)');
  set(addDays(e, -46), 'reduced', 'Quarta-feira de Cinzas (expediente reduzido)');
  set(addDays(e, 60), 'holiday', 'Corpus Christi (ponto facultativo na maioria dos tribunais)');
  set(`${year}-12-08`, 'holiday', 'Dia da Justiça');
  if (profile === 'federal') {
    set(addDays(e, -4), 'holiday', 'Semana Santa (Lei nº 5.010/1966, art. 62, II)');
    set(addDays(e, -3), 'holiday', 'Semana Santa (Lei nº 5.010/1966, art. 62, II)');
    set(`${year}-08-11`, 'holiday', 'Dia dos Cursos Jurídicos (Lei nº 5.010/1966, art. 62, IV)');
    set(`${year}-11-01`, 'holiday', 'Todos os Santos (Lei nº 5.010/1966, art. 62, V)');
    for (let d = `${year}-12-20`; d <= `${year}-12-31`; d = addDays(d, 1))
      set(d, 'holiday', 'Feriado forense federal de 20/12 a 06/01 (Lei nº 5.010/1966, art. 62, I)');
    for (let d = `${year}-01-01`; d <= `${year}-01-06`; d = addDays(d, 1))
      set(d, 'holiday', 'Feriado forense federal de 20/12 a 06/01 (Lei nº 5.010/1966, art. 62, I)');
  }
  return days;
}

export const rules = {
  cpc: { label: 'Cível (CPC) — dias úteis', business: true, recess: true },
  clt: { label: 'Trabalhista (CLT) — dias úteis', business: true, recess: true },
  jec: { label: 'Juizado Especial (Lei 9.099) — dias úteis', business: true, recess: true },
  cpp: { label: 'Penal (CPP) — dias corridos', business: false, recess: false },
};

// Suggests rule and calendar from what the case already says.
export function suggestRule(caseItem = {}, parsedNumber = null) {
  const rule =
    caseItem.area === 'Trabalhista' || parsedNumber?.segment === 5
      ? 'clt'
      : caseItem.area === 'Criminal'
        ? 'cpp'
        : ['Juizado especial', 'Turma recursal'].includes(caseItem.instance)
          ? 'jec'
          : 'cpc';
  return { rule, profile: parsedNumber?.segment === 4 ? 'federal' : 'padrao', courtId: parsedNumber?.courtId || '' };
}

export function createCalendar({ profile = 'padrao', recess = true, custom = [], courtId = '' } = {}) {
  const years = new Map();
  const own = new Map();
  for (const entry of custom) if (!entry.courtId || entry.courtId === courtId) own.set(entry.date, entry);
  // type: business | reduced | weekend | holiday | recess
  const info = date => {
    const day = toDate(date).getUTCDay();
    if (day === 0 || day === 6) return { type: 'weekend', reason: day === 0 ? 'Domingo' : 'Sábado' };
    const md = date.slice(5);
    if (recess && (md >= '12-20' || md <= '01-20'))
      return { type: 'recess', reason: 'Suspensão de prazos de 20/12 a 20/01' };
    const entry = own.get(date);
    if (entry)
      return entry.type === 'workday'
        ? { type: 'business', reason: `Expediente normal: ${entry.description || 'cadastro do escritório'}` }
        : { type: entry.type, reason: `${entry.description || 'Dia sem expediente'} (cadastro do escritório)` };
    const year = Number(date.slice(0, 4));
    if (!years.has(year)) years.set(year, yearCalendar(year, profile));
    return years.get(year)[date] || { type: 'business', reason: '' };
  };
  return {
    info,
    working: date => ['business', 'reduced'].includes(info(date).type), // there is court activity
    full: date => info(date).type === 'business', // can start or end a deadline
    nextFull(date) {
      let d = addDays(date, 1);
      while (info(d).type !== 'business') d = addDays(d, 1);
      return d;
    },
  };
}

const basisFor = ({ rule, mode, recess, double }) => {
  const list = [];
  if (mode === 'disponibilizacao')
    list.push(
      'Publicação no primeiro dia útil seguinte à disponibilização no Diário eletrônico (Lei nº 11.419/2006, art. 4º, § 3º).',
    );
  if (rule === 'cpp') {
    list.push('Prazos penais correm em dias corridos (CPP, art. 798).');
    list.push(
      'Não se conta o dia do começo; vencimento em dia sem expediente é prorrogado para o dia útil seguinte (CPP, art. 798, §§ 1º e 3º).',
    );
    list.push(
      'Intimação na sexta-feira ou em véspera de dia sem expediente: o prazo começa no primeiro dia útil seguinte (Súmula 310 do STF).',
    );
  } else {
    list.push(
      rule === 'clt'
        ? 'Prazos contados em dias úteis (CLT, art. 775).'
        : rule === 'jec'
          ? 'Prazos contados em dias úteis (Lei nº 9.099/1995, art. 12-A).'
          : 'Prazos contados em dias úteis (CPC, art. 219).',
    );
    list.push(
      'Exclui-se o dia do começo e inclui-se o do vencimento; a contagem começa no primeiro dia útil após a publicação (CPC, art. 224, caput e § 3º).',
    );
    list.push('Dias de expediente reduzido não podem ser o primeiro nem o último dia do prazo (CPC, art. 224, § 1º).');
  }
  if (recess)
    list.push(
      rule === 'clt'
        ? 'Prazos suspensos de 20 de dezembro a 20 de janeiro (CLT, art. 775-A).'
        : 'Prazos suspensos de 20 de dezembro a 20 de janeiro (CPC, art. 220).',
    );
  if (double) list.push('Prazo contado em dobro (por exemplo, CPC, arts. 180, 183, 186 e 229, quando aplicáveis).');
  return list;
};

export function calculateDeadline({
  start,
  days,
  rule = 'cpc',
  mode = 'publicacao',
  double = false,
  recess,
  profile = 'padrao',
  custom = [],
  courtId = '',
}) {
  if (!isDateKey(start)) throw new Error('Informe a data da intimação ou da disponibilização.');
  if (!rules[rule]) throw new Error('Escolha o tipo de contagem.');
  if (!['publicacao', 'disponibilizacao'].includes(mode)) throw new Error('Tipo de data inválido.');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Informe um prazo entre 1 e 365 dias.');
  if (!calendarProfiles[profile]) throw new Error('Calendário inválido.');
  const useRecess = recess ?? rules[rule].recess;
  const total = double ? days * 2 : days;
  const cal = createCalendar({ profile, recess: useRecess, custom, courtId });
  const steps = [];
  const step = (date, kind, note, n = null) => steps.push({ date, weekday: weekdayName(date), kind, note, n });
  step(
    start,
    'start',
    mode === 'disponibilizacao' ? 'Disponibilização no Diário eletrônico' : 'Intimação / publicação',
  );
  let publication = start;
  if (mode === 'disponibilizacao') {
    let d = addDays(start, 1);
    while (!cal.working(d)) {
      step(d, 'skipped', cal.info(d).reason);
      d = addDays(d, 1);
    }
    publication = d;
    step(d, 'publication', 'Considerada a data da publicação');
  }
  // The first day counted must have full court hours (CPC, art. 224, §§ 1º e 3º; Súmula 310/STF).
  let d = addDays(publication, 1);
  while (!cal.full(d)) {
    step(d, 'skipped', cal.info(d).reason);
    d = addDays(d, 1);
  }
  const firstDay = d;
  let count = 0;
  for (;;) {
    const info = cal.info(d);
    const counts = rules[rule].business ? cal.working(d) : info.type !== 'recess';
    if (counts) {
      count++;
      step(d, 'counted', info.type === 'reduced' ? info.reason : info.type === 'business' ? '' : info.reason, count);
      if (count === total) break;
    } else step(d, 'skipped', info.reason);
    d = addDays(d, 1);
  }
  let end = d;
  // A deadline cannot end on a day without full court hours: it moves to the next one.
  while (!cal.full(end)) {
    const reason = cal.info(end).reason;
    end = addDays(end, 1);
    while (!cal.full(end)) {
      step(end, 'skipped', cal.info(end).reason);
      end = addDays(end, 1);
    }
    step(end, 'extended', `Vencimento prorrogado: ${reason.charAt(0).toLowerCase() + reason.slice(1)}`);
  }
  const ownDays = custom.filter(e => !e.courtId || e.courtId === courtId).length;
  const warnings = [
    'Confira sempre o calendário e as portarias do tribunal. O cálculo não substitui a conferência do advogado.',
  ];
  if (!ownDays)
    warnings.push(
      'Nenhum feriado estadual, municipal ou suspensão do tribunal está cadastrado para este cálculo. Cadastre em Configurações → Prazos e fluxos.',
    );
  return {
    start,
    publication,
    firstDay,
    end,
    total,
    rule,
    profile,
    recess: useRecess,
    steps,
    basis: basisFor({ rule, mode, recess: useRecess, double }),
    warnings,
  };
}

// The office's own deadline: N working days before the real one.
export function businessDaysBefore(end, n, calendarOptions) {
  const cal = createCalendar(calendarOptions);
  let d = end;
  for (let i = 0; i < n;) {
    d = addDays(d, -1);
    if (cal.full(d)) i++;
  }
  return d;
}

export const formatDate = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
