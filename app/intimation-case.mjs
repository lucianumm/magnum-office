// Fills a new case from a publication (intimação): number, title, court, area, parties, the other side's lawyer
// and a note with who is who. Pure: the caller passes the registered clients and the office's lawyers.

const norm = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const digits = s => String(s || '').replace(/\D/g, '');
const names = (parties, polo) => parties.filter(p => p.polo === polo).map(p => p.nome);
// "Ana e Bia", "Ana, Bia e Caio", "Ana e outros (3)".
export const joinNames = list =>
  list.length <= 1
    ? list[0] || ''
    : list.length === 2
      ? `${list[0]} e ${list[1]}`
      : `${list[0]} e outros (${list.length - 1})`;

// Practice area from the class, the court and the body: a first guess the office can change.
export function guessArea({ classe = '', tribunal = '', orgao = '' }) {
  const t = norm(`${classe} ${orgao}`);
  if (/^trt|^tst/.test(norm(tribunal)) || /trabalh/.test(t)) return 'Trabalhista';
  if (/criminal|penal|inquerito|execucao penal|juri/.test(t)) return 'Criminal';
  if (/familia|divorcio|alimentos|guarda|uniao estavel|inventario/.test(t)) return 'Família';
  if (/previdenc|beneficio|inss/.test(t)) return 'Previdenciário';
  if (/fiscal|tributar|execucao fiscal/.test(t)) return 'Tributário';
  if (/consumidor/.test(t)) return 'Consumidor';
  if (/recuperacao judicial|falencia|empresarial/.test(t)) return 'Empresarial';
  if (/fazenda publica|administrativ|mandado de seguranca/.test(t)) return 'Administrativo';
  return 'Cível';
}
const guessInstance = orgao => {
  const o = norm(orgao);
  if (/turma recursal/.test(o)) return 'Turma recursal';
  if (/juizado/.test(o)) return 'Juizado especial';
  if (/camara|turma|desembargador|tribunal pleno|secao/.test(o)) return '2º grau';
  if (/vara|comarca|foro/.test(o)) return '1º grau';
  return '';
};
// A registered client whose name is the same as (or contained in) a party's name.
export function matchClient(parties, clients) {
  const found = [];
  for (const client of clients) {
    const cn = norm(client.name);
    if (cn.length < 4) continue;
    for (const p of parties) {
      const pn = norm(p.nome);
      if (pn && (pn === cn || pn.includes(cn) || cn.includes(pn))) {
        found.push({ client, party: p });
        break;
      }
    }
  }
  return found;
}

// side: 'A' (the client is the active pole), 'P' (passive) or '' (not known yet).
export function caseFromIntimation(item, { side = '', clients = [], officeLawyers = [], clientId = '' } = {}) {
  const parties = item.parties || [];
  const active = names(parties, 'A');
  const passive = names(parties, 'P');
  const others = parties.filter(p => !['A', 'P'].includes(p.polo)).map(p => p.nome);
  const theirs = side === 'A' ? passive : side === 'P' ? active : [];
  const mask = item.processoMascara || item.processo || '';
  const own = new Set(officeLawyers.map(l => `${digits(l.oab)}/${String(l.uf).toUpperCase()}`));
  const other = (item.lawyers || []).find(l => l.oab && !own.has(`${digits(l.oab)}/${String(l.uf).toUpperCase()}`));
  const day = item.date ? item.date.split('-').reverse().join('/') : '';
  const notes = [
    active.length ? `Polo ativo: ${active.join('; ')}` : '',
    passive.length ? `Polo passivo: ${passive.join('; ')}` : '',
    others.length ? `Terceiros: ${others.join('; ')}` : '',
    `Cadastrado a partir da publicação de ${day}${item.tribunal ? ` (${item.tribunal})` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
  const matched =
    clientId ||
    (side
      ? matchClient(
          parties.filter(p => p.polo === side),
          clients,
        )[0]?.client.id
      : '') ||
    '';
  return {
    number: mask,
    title:
      active.length && passive.length
        ? `${joinNames(active)} x ${joinNames(passive)}`
        : item.classe || `Processo ${mask}`,
    court: item.orgao || '',
    area: guessArea(item),
    instance: guessInstance(item.orgao),
    procedure: String(item.classe || '').slice(0, 80),
    status: 'Em andamento',
    clientRole: side === 'A' ? 'Polo ativo' : side === 'P' ? 'Polo passivo' : '',
    opposingParty: joinNames(theirs).slice(0, 300),
    clientId: matched,
    opposingLawyer: other ? String(other.nome).slice(0, 160) : '',
    opposingLawyerOab: other ? `${digits(other.oab)}/${String(other.uf).toUpperCase()}` : '',
    notes,
  };
}
