// Ready-made WhatsApp messages for hearings: initial and instruction, in person or by video. Offered once (like the
// legal templates); the office can edit or delete them. The notice window picks the one that fits the hearing.
const presencial =
  'Chegue com 30 minutos de antecedência e leve um documento oficial com foto. Em caso de atraso ou imprevisto, avise a equipe do {escritorio} o quanto antes.';
const video =
  'Entre na sala 10 minutos antes, num lugar silencioso, com boa internet, câmera e microfone funcionando, e tenha à mão um documento oficial com foto. Se tiver qualquer dificuldade para entrar, avise a equipe do {escritorio} imediatamente.';

const kinds = [
  {
    key: 'inicial',
    kind: 'inicial',
    title: 'Audiência inicial',
    what: 'audiência inicial',
    purpose: 'Nesta audiência o juiz ouve as partes e tenta um acordo antes de o processo seguir.',
  },
  {
    key: 'instrucao',
    kind: 'de instrução e julgamento',
    title: 'Audiência de instrução',
    what: 'audiência de instrução',
    purpose:
      'Nesta audiência são ouvidas as partes e as testemunhas. Combine com a equipe quem vai comparecer e o que precisa levar.',
  },
];

const templates = [];
for (const k of kinds)
  for (const modality of ['presencial', 'virtual']) {
    const where = modality === 'presencial' ? 'Local: {local}.' : 'Sala virtual: {link_sala}';
    const advice = modality === 'presencial' ? presencial : video;
    const how = modality === 'presencial' ? 'presencial' : 'por videoconferência';
    templates.push({
      title: `${k.title} — ${modality === 'presencial' ? 'presencial' : 'por vídeo'}`,
      purpose: 'event-confirmation',
      match: { eventType: 'Audiência', eventKind: k.kind, modality },
      body: `Olá, {primeiro_nome}! Aqui é da equipe do {escritorio}. Confirmamos a sua ${k.what}{processo_ref}, ${how}: {dia_semana}, {data}, às {hora}.\n${where}\n${k.purpose}\n${advice}\nResponda *CONFIRMO* para confirmar a sua presença ou *EQUIPE* para falar com a equipe.`,
    });
    templates.push({
      title: `${k.title} — ${modality === 'presencial' ? 'presencial' : 'por vídeo'} (lembrete)`,
      purpose: 'event-reminder',
      match: { eventType: 'Audiência', eventKind: k.kind, modality },
      body: `Olá, {primeiro_nome}! Lembrando da sua ${k.what}{processo_ref}, ${how}: {dia_semana}, {data}, às {hora}.\n${where}\n${advice}`,
    });
  }
module.exports = { eventTemplates: templates };
