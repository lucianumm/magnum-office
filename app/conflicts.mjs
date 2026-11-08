// Conflict of interest check: is the person we are about to represent (or oppose) already on the
// other side somewhere in the office? Pure function over the records already loaded in memory.
import { documentKey } from './br-documents.mjs';

// Company suffixes are ignored so "Banco Exemplo S/A" matches "Banco Exemplo S.A.".
const suffixes = /\b(ltda|s ?a|me|epp|eireli|cia|companhia|limitada)\b/g;
export const normalizeName = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(suffixes, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const same = (a, b) => {
  const da = documentKey(a.document),
    db = documentKey(b.document);
  if (da.length >= 11 && db.length >= 11) return da === db;
  const na = normalizeName(a.name),
    nb = normalizeName(b.name);
  return na.length >= 5 && na === nb;
};

// side: 'client' when checking someone we will represent, 'opposing' when checking an adverse party.
// Returns [{ severity: 'conflict' | 'notice', text, kind, id }].
export function findConflicts({ name, document, side, excludeId = '' }, entities) {
  if (!normalizeName(name) && documentKey(document).length < 11) return [];
  const probe = { name, document };
  const found = [];
  const add = (severity, text, kind, id) => found.push({ severity, text, kind, id });
  const caseTitle = id => entities.cases?.find(c => c.id === id)?.title;
  for (const c of entities.clients || [])
    if (c.id !== excludeId && same(probe, c))
      add(
        side === 'opposing' ? 'conflict' : 'notice',
        side === 'opposing' ? `${c.name} é cliente do escritório.` : `${c.name} já está cadastrado como cliente.`,
        'clients',
        c.id,
      );
  for (const c of entities.cases || [])
    if (c.id !== excludeId && c.opposingParty && same(probe, { name: c.opposingParty, document: c.opposingDocument }))
      add(
        side === 'client' ? 'conflict' : 'notice',
        `${c.opposingParty} é parte contrária no processo “${c.title}”.`,
        'cases',
        c.id,
      );
  for (const p of entities.people || []) {
    if (p.id === excludeId || !same(probe, p)) continue;
    const where = caseTitle(p.caseId) ? ` no processo “${caseTitle(p.caseId)}”` : '';
    const adverse = p.role === 'Parte contrária';
    add(
      side === 'client' && adverse ? 'conflict' : 'notice',
      `${p.name} está cadastrado como ${p.role.toLowerCase()}${where}.`,
      adverse ? 'cases' : 'people',
      adverse && p.caseId ? p.caseId : p.id,
    );
  }
  return found.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'conflict' ? -1 : 1));
}
