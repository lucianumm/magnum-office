// Limitation periods (prescrição) for cases not yet filed, and documents with an expiry date. The
// office chooses the rule; the program only counts the date and warns ahead. Common rules:
export const limitationRules = [
  {
    id: 'trabalhista',
    years: 2,
    label: 'Trabalhista: 2 anos do fim do contrato (art. 7º, XXIX, da CF)',
    area: 'Trabalhista',
  },
  { id: 'reparacao', years: 3, label: 'Reparação civil: 3 anos (art. 206, § 3º, V, do Código Civil)', area: 'Cível' },
  {
    id: 'consumidor',
    years: 5,
    label: 'Consumidor, fato do produto ou serviço: 5 anos (art. 27 do CDC)',
    area: 'Consumidor',
  },
  {
    id: 'cobranca',
    years: 5,
    label: 'Cobrança de dívida em instrumento: 5 anos (art. 206, § 5º, I, do CC)',
    area: 'Cível',
  },
  { id: 'tributario', years: 5, label: 'Cobrança de tributo: 5 anos (art. 174 do CTN)', area: 'Tributário' },
  {
    id: 'previdenciario',
    years: 10,
    label: 'Revisão de benefício: 10 anos de decadência (art. 103 da Lei 8.213/1991)',
    area: 'Previdenciário',
  },
  { id: 'geral', years: 10, label: 'Regra geral: 10 anos (art. 205 do Código Civil)', area: '' },
];
export const ruleById = id => limitationRules.find(r => r.id === id) || null;
export const suggestedRule = area => limitationRules.find(r => r.area === area)?.id || '';

const DAY = 86400000;
const parse = value => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(value + 'T00:00:00Z') : null);
const iso = d => d.toISOString().slice(0, 10);

// Same day N years later; 29/02 falls on 28/02 in common years.
export function addYears(date, years) {
  const d = parse(date);
  if (!d) return '';
  const target = new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return iso(target);
}
export const daysUntil = (date, today) => Math.round((parse(date) - parse(today)) / DAY);

// { deadline, days } for a case with fact date and rule, or null.
export function caseLimitation(caseItem, today) {
  const rule = ruleById(caseItem?.limitationRule);
  if (!rule || !parse(caseItem.factDate)) return null;
  const deadline = addYears(caseItem.factDate, rule.years);
  return { deadline, days: daysUntil(deadline, today), rule };
}

// Cases still to be filed (no number, not concluded) whose limitation ends within `within` days, and
// documents expiring within 30 days. Sorted by urgency.
export function limitationAlerts({ cases = [], documents = [], today, within = 90 }) {
  const alerts = [];
  for (const c of cases) {
    if (c.number || ['Concluído', 'Arquivado'].includes(c.status)) continue;
    const l = caseLimitation(c, today);
    if (l && l.days <= within)
      alerts.push({ kind: 'case', id: c.id, title: c.title, deadline: l.deadline, days: l.days });
  }
  for (const d of documents) {
    if (!parse(d.validUntil)) continue;
    const days = daysUntil(d.validUntil, today);
    if (days <= 30) alerts.push({ kind: 'document', id: d.id, title: d.name, deadline: d.validUntil, days });
  }
  return alerts.sort((a, b) => a.days - b.days);
}
