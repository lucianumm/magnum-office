// What a client's reply means, and the fixed texts of the automatic answers. Pure: no database, no clock.
import { normalizeReply } from './campaign-rules.mjs';

export const flowTexts = {
  unknown: office =>
    `Aqui é o ${office}. Para atendimento, fale com a nossa equipe no horário de expediente. Esta mensagem é automática.`,
  menu: (first, office) =>
    `Olá, ${first}! Aqui é o atendimento automático do ${office}. Responda *1* para saber o andamento do seu processo, *2* para a sua próxima audiência ou perícia, ou *3* para falar com a equipe.`,
  askCpf: 'Para a sua segurança, informe o seu CPF (somente os números).',
  cpfWrong: left => `O CPF não confere com o cadastro. Você ainda tem ${left} tentativa(s).`,
  cpfBlocked: 'Por segurança, esta consulta ficou bloqueada por 24 horas. Fale com a nossa equipe.',
  noConsent: 'Esta consulta pelo WhatsApp não está ativada no seu cadastro. Fale com a nossa equipe.',
  noDocument: 'Não encontramos um CPF no seu cadastro para confirmar a consulta. Fale com a nossa equipe.',
  noCases: 'Não encontramos um processo para consulta por aqui. Fale com a nossa equipe.',
  secret: 'Este processo exige atendimento da nossa equipe. Fale com o escritório.',
  limit: 'Você já fez o máximo de consultas de hoje. Tente amanhã ou fale com a nossa equipe.',
  human: open =>
    open
      ? 'Avisamos a nossa equipe. Retornaremos assim que possível.'
      : 'Avisamos a nossa equipe. Retornaremos no próximo dia útil.',
  noEvent: 'Não encontramos audiência, perícia ou reunião marcada para você. Fale com a nossa equipe se precisar.',
  badPick: 'Não entendi. Responda só com o número do processo da lista.',
};

// Digits of a CPF-looking message (11 digits, with or without punctuation), or ''.
export function extractCpf(text) {
  const digits = String(text || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : '';
}

const has = (t, words) => words.some(w => t === w || t.split(' ').includes(w));
// state.step: '' | 'cpf' | 'pick'. awaiting: the client has an event waiting for confirmation.
export function classify(text, { step = '', awaiting = false } = {}) {
  const t = normalizeReply(text);
  if (step === 'cpf') {
    const cpf = extractCpf(text);
    if (cpf) return { intent: 'cpf', cpf };
  }
  if (step === 'pick' && /^\d{1,2}$/.test(t)) return { intent: 'pick', n: Number(t) };
  if (awaiting && has(t, ['confirmo', 'confirmado', 'confirmar', 'sim'])) return { intent: 'confirm' };
  if (has(t, ['equipe', 'atendente', 'humano']) || t === '3' || t.includes('falar com')) return { intent: 'human' };
  if (t === '1' || has(t, ['andamento', 'processo'])) return { intent: 'progress' };
  if (t === '2' || has(t, ['audiencia', 'pericia'])) return { intent: 'event' };
  return { intent: 'other' };
}

// The movement as a short sentence for the client.
export function progressText({ first, office, number, date, name, fetchedAt }) {
  const when = date ? String(date).slice(0, 10).split('-').reverse().join('/') : '';
  const ref = number ? ` nº ${number}` : '';
  const checked = fetchedAt ? ` (consultado em ${String(fetchedAt).slice(0, 10).split('-').reverse().join('/')})` : '';
  return `Olá, ${first}! Sobre o seu processo${ref}: o último andamento registrado${when ? `, em ${when},` : ''} foi “${String(name).slice(0, 300)}”${checked}. Para detalhes, fale com a equipe do ${office}.`;
}
