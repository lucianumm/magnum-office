// What each kind of WhatsApp message says when the office has not written its own template, and the
// purposes a template can have. Written to be polite and short; every text can be replaced.

export const purposes = {
  general: 'Mensagem geral',
  birthday: 'Aniversário',
  'event-confirmation': 'Confirmação de audiência, perícia ou reunião',
  'event-reminder': 'Lembrete de audiência, perícia ou reunião',
  'event-reschedule': 'Reagendamento',
  'event-cancel': 'Cancelamento',
  'case-update': 'Andamento do processo',
  billing: 'Cobrança',
  welcome: 'Boas-vindas ao cliente',
  'auto-reply': 'Resposta automática',
};
// The purposes a template can be chosen for (birthday has its own screen and rules).
export const purposeKeys = Object.keys(purposes);

export const defaultBodies = {
  'event-confirmation':
    'Olá, {primeiro_nome}! Aqui é da equipe do {escritorio}. Confirmamos a sua {evento}{processo_ref}: {dia_semana}, {data}, às {hora}.\n{detalhes}\nResponda *CONFIRMO* para confirmar a sua presença ou *EQUIPE* para falar com a equipe.',
  'event-reminder':
    'Olá, {primeiro_nome}! Lembrando da sua {evento}: {dia_semana}, {data}, às {hora}.\n{detalhes}\nQualquer dúvida, fale com a equipe do {escritorio}.',
  'event-reschedule':
    'Olá, {primeiro_nome}! A sua {evento} foi remarcada para {dia_semana}, {data}, às {hora}.\n{detalhes}\nResponda *CONFIRMO* para confirmar a sua presença ou *EQUIPE* para falar com a equipe.',
  'event-cancel':
    'Olá, {primeiro_nome}! A sua {evento} marcada para {data}, às {hora}, foi cancelada. A equipe do {escritorio} entrará em contato para combinar uma nova data.',
  'case-update':
    'Olá, {primeiro_nome}! Sobre o seu processo{processo_ref}: o último andamento, em {data_andamento}, foi "{ultimo_andamento}". Qualquer dúvida, fale com a equipe do {escritorio}.',
  billing:
    'Olá, {primeiro_nome}! Aqui é do {escritorio}. Identificamos em aberto o valor de {valor}, com vencimento em {vencimento}. Se já pagou, desconsidere esta mensagem. Para combinar a forma de pagamento, é só responder aqui.',
  welcome:
    'Olá, {primeiro_nome}! Seja bem-vindo(a) ao {escritorio}. A partir de agora vamos manter você informado(a) por aqui sobre o seu caso. Se preferir não receber mensagens, responda SAIR.',
  'auto-reply':
    'Olá, {primeiro_nome}! Aqui é o atendimento automático do {escritorio}. Responda *1* para saber o andamento do seu processo, *2* para a sua próxima audiência ou *3* para falar com a equipe.',
  general: 'Olá, {primeiro_nome}! Aqui é do {escritorio}.',
};

// Reminders a hearing can have: "7d" = seven days before (at the chosen hour), "2h" = two hours before.
export const reminderOffsets = {
  '7d': { label: '7 dias antes', days: 7 },
  '3d': { label: '3 dias antes', days: 3 },
  '1d': { label: '1 dia antes', days: 1 },
  '6h': { label: '6 horas antes', hours: 6 },
  '2h': { label: '2 horas antes', hours: 2 },
  '1h': { label: '1 hora antes', hours: 1 },
};
export const defaultOffsets = ['7d', '1d', '2h'];
export const eventTypes = ['Audiência', 'Perícia', 'Reunião', 'Diligência'];
// Kinds read after the type: "audiência de conciliação", "perícia médica", "diligência no cartório".
export const eventKinds = {
  Audiência: ['de conciliação', 'de instrução e julgamento', 'una', 'inicial', 'trabalhista', 'de custódia', 'de júri'],
  Perícia: ['médica', 'contábil', 'de engenharia', 'grafotécnica', 'psicológica'],
  Reunião: ['com o cliente', 'com a parte contrária', 'com o perito'],
  Diligência: ['no cartório', 'no fórum', 'na delegacia'],
};
