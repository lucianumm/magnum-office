// Document templates: the rich text written in the template editor becomes paragraphs with
// formatting, the {variables} are replaced with data from the records, and {?questions} are asked
// when generating. The same blocks feed the preview, the DOCX and the PDF.
import { qualification, clientAddress } from './qualification.mjs';
import { parseCNJ } from './cnj.mjs';
import { formatBRL, moneyWithWords, parseMoney } from './money.mjs';

export const documentVariables = [
  ['cliente.nome', 'Nome do cliente'],
  ['cliente.qualificacao', 'Qualificação completa do cliente'],
  ['cliente.cpf_cnpj', 'CPF ou CNPJ do cliente'],
  ['cliente.endereco', 'Endereço do cliente'],
  ['cliente.email', 'E-mail do cliente'],
  ['cliente.telefone', 'Telefone do cliente'],
  ['cliente.representante', 'Representante legal (empresa)'],
  ['processo.titulo', 'Título do processo'],
  ['processo.numero', 'Número do processo'],
  ['processo.juizo', 'Vara e comarca'],
  ['processo.vara', 'Vara / órgão julgador'],
  ['processo.comarca', 'Comarca'],
  ['processo.tribunal', 'Tribunal (pelo número CNJ)'],
  ['processo.classe', 'Classe / rito'],
  ['processo.area', 'Área'],
  ['processo.valor_causa', 'Valor da causa com extenso'],
  ['processo.parte_contraria', 'Parte contrária'],
  ['processo.parte_contraria_documento', 'CPF/CNPJ da parte contrária'],
  ['advogado.nome', 'Primeiro advogado escolhido'],
  ['advogado.oab', 'OAB do primeiro advogado'],
  ['advogado.email', 'E-mail do primeiro advogado'],
  ['advogados.nomes', 'Nomes dos advogados escolhidos'],
  ['advogados.qualificacao', 'Advogados com OAB'],
  ['escritorio.nome', 'Nome do escritório'],
  ['escritorio.endereco', 'Endereço do escritório'],
  ['escritorio.cidade', 'Cidade do escritório'],
  ['data.hoje', 'Data de hoje (dd/mm/aaaa)'],
  ['data.extenso', 'Data de hoje por extenso'],
  ['data.ano', 'Ano atual'],
];
const labels = Object.fromEntries(documentVariables);
export const blankLine = '__________';

const months = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const oabNumber = n => String(n || '').replace(/^(\d+)(\d{3})([A-Z]?)$/, '$1.$2$3');
export const lawyerOAB = l => `OAB/${l.uf} nº ${oabNumber(l.oab)}`;
const listJoin = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`);

export function documentContext({ client, caseItem, lawyers = [], settings = {}, courts = [], now = new Date() }) {
  const c = client || {},
    p = caseItem || {};
  const cnj = parseCNJ(p.number);
  const court = cnj?.valid ? courts.find(x => x.id === cnj.courtId) : null;
  const first = lawyers[0] || {};
  const pad = n => String(n).padStart(2, '0');
  return {
    'cliente.nome': c.name,
    'cliente.qualificacao': client ? qualification(c).text.replace(/\.$/, '') : '',
    'cliente.cpf_cnpj': c.document,
    'cliente.endereco': client ? clientAddress(c) : '',
    'cliente.email': c.email,
    'cliente.telefone': c.phone,
    'cliente.representante': c.legalRepresentative,
    'processo.titulo': p.title,
    'processo.numero': p.number,
    'processo.juizo': p.court && p.county ? `${p.court} da Comarca de ${p.county}` : p.court || p.county,
    'processo.vara': p.court,
    'processo.comarca': p.county,
    'processo.tribunal': court?.name || '',
    'processo.classe': p.procedure,
    'processo.area': p.area,
    'processo.valor_causa': p.claimValue ? moneyWithWords(p.claimValue) : '',
    'processo.parte_contraria': p.opposingParty,
    'processo.parte_contraria_documento': p.opposingDocument,
    'advogado.nome': first.name,
    'advogado.oab': first.oab ? lawyerOAB(first) : '',
    'advogado.email': first.email,
    'advogados.nomes': listJoin(lawyers.map(l => l.name)),
    'advogados.qualificacao': listJoin(
      lawyers.map(l => `${String(l.name).toLocaleUpperCase('pt-BR')}, advogado(a) inscrito(a) na ${lawyerOAB(l)}`),
    ),
    'escritorio.nome': settings.officeName,
    'escritorio.endereco': settings.officeAddress,
    'escritorio.cidade': settings.officeCity,
    'data.hoje': `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    'data.extenso': `${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}`,
    'data.ano': String(now.getFullYear()),
  };
}

// ---- Template text → blocks -------------------------------------------------------------------
// Block: { align: 'left'|'center'|'right'|'justify', heading: bool, runs: [{ text, bold, italic, underline }] }

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (entities[e.toLowerCase()] ?? m),
  );

// The HTML was already sanitized (only simple formatting tags), so a small tokenizer is enough.
export function htmlBlocks(html) {
  const blocks = [];
  const stack = [];
  let current = null;
  const style = () => ({
    bold: stack.some(
      t => ['strong', 'b', 'h1', 'h2', 'h3'].includes(t.name) || /font-weight:\s*(bold|[6-9]00)/.test(t.attrs),
    ),
    italic: stack.some(t => ['em', 'i'].includes(t.name)),
    underline: stack.some(t => t.name === 'u' || /text-decoration:\s*underline/.test(t.attrs)),
  });
  const alignOf = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const m = /text-align:\s*(left|right|center|justify)/.exec(stack[i].attrs);
      if (m) return m[1];
      if (['h1', 'h2'].includes(stack[i].name)) return 'center';
    }
    return 'justify';
  };
  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const open = () => {
    if (!current) current = { align: alignOf(), heading: stack.some(t => /^h[1-3]$/.test(t.name)), runs: [] };
  };
  const blockTags = ['p', 'div', 'h1', 'h2', 'h3', 'li', 'blockquote'];
  for (const [token, slash, name, attrs] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|[^<]+/gi)) {
    if (!name) {
      const text = decode(token).replace(/\s+/g, ' ');
      if (!text.trim() && !current) continue;
      open();
      current.runs.push({ text, ...style() });
      continue;
    }
    const tag = name.toLowerCase();
    if (tag === 'br') {
      open();
      close();
      continue;
    }
    if (tag === 'hr') {
      close();
      blocks.push({ align: 'center', heading: false, runs: [{ text: '' }] });
      continue;
    }
    if (blockTags.includes(tag)) close();
    if (slash) {
      const index = stack.map(t => t.name).lastIndexOf(tag);
      if (index >= 0) stack.splice(index);
    } else if (!/\/\s*$/.test(attrs)) stack.push({ name: tag, attrs: attrs.toLowerCase() });
  }
  close();
  for (const b of blocks) {
    // Trim the paragraph edges left by the HTML indentation.
    if (b.runs.length) {
      b.runs[0].text = b.runs[0].text.replace(/^\s+/, '');
      b.runs.at(-1).text = b.runs.at(-1).text.replace(/\s+$/, '');
    }
  }
  return blocks;
}

export function textBlocks(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => ({ align: 'justify', heading: false, runs: [{ text: line.trimEnd() }] }));
}

export const templateBlocks = template =>
  template?.html?.trim() ? htmlBlocks(template.html) : textBlocks(template?.body);

// ---- Filling --------------------------------------------------------------------------------

const tokenPattern = /\{(\?[^{}]{1,120}|[a-z_]+\.[a-z_]+)\}/g;
// "{?Valor recebido:moeda}" → { key, label, type: 'money' }
function question(raw) {
  const [label, type] = raw
    .slice(1)
    .split(':')
    .map(s => s.trim());
  return { key: raw.slice(1).trim(), label, type: type === 'moeda' ? 'money' : 'text' };
}

export function templateQuestions(blocks) {
  const seen = new Map();
  for (const b of blocks)
    for (const [, raw] of b.runs
      .map(r => r.text)
      .join('')
      .matchAll(tokenPattern))
      if (raw.startsWith('?') && !seen.has(raw.slice(1).trim())) seen.set(raw.slice(1).trim(), question(raw));
  return [...seen.values()];
}

// Adjacent runs with the same formatting are merged first, so a variable is not split by the editor.
function merge(runs) {
  const out = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function fillBlocks(blocks, values, answers = {}) {
  const missing = new Set();
  const invalid = new Set();
  const filled = blocks.map(block => ({
    ...block,
    runs: merge(block.runs).flatMap(run => {
      const parts = [];
      let last = 0;
      for (const m of run.text.matchAll(tokenPattern)) {
        const raw = m[1];
        let value, label;
        if (raw.startsWith('?')) {
          const q = question(raw);
          label = q.label;
          const answer = String(answers[q.key] ?? '').trim();
          if (q.type === 'money' && answer) {
            const parsed = parseMoney(answer);
            if (parsed === null) invalid.add(label);
            value = parsed ? moneyWithWords(parsed) : '';
          } else value = answer;
        } else if (raw in values) {
          label = labels[raw];
          value = String(values[raw] ?? '').trim();
        } else continue; // Unknown tokens stay as written.
        if (m.index > last) parts.push({ ...run, text: run.text.slice(last, m.index) });
        if (value) parts.push({ ...run, text: value });
        else {
          missing.add(label);
          parts.push({ ...run, text: blankLine, missing: label });
        }
        last = m.index + m[0].length;
      }
      if (last < run.text.length || !parts.length) parts.push({ ...run, text: run.text.slice(last) });
      return parts;
    }),
  }));
  return { blocks: filled, missing: [...missing], invalid: [...invalid] };
}

export const blocksText = blocks => blocks.map(b => b.runs.map(r => r.text).join('')).join('\n');
export { formatBRL };
