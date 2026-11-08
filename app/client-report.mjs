// Case summary for the client, in plain language. It is a draft: the lawyer reviews and edits it
// before copying, sending or saving.

const normalize = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Common CNJ movement names and what they mean for someone outside the legal world. First match wins.
const explanations = [
  ['transito em julgado', 'a decisão ficou definitiva e não cabe mais recurso'],
  ['sentenca', 'o juiz decidiu o processo nesta instância'],
  ['julgamento', 'o processo foi julgado'],
  ['acordao', 'o tribunal julgou o recurso'],
  ['conclus', 'o processo foi enviado ao juiz para decidir'],
  ['despacho', 'o juiz deu uma orientação para o andamento do processo'],
  ['decisao', 'o juiz tomou uma decisão no processo'],
  ['audiencia', 'audiência no processo'],
  ['juntada', 'um documento foi anexado ao processo'],
  ['peticao', 'um pedido ou manifestação foi apresentado no processo'],
  ['expedicao', 'o cartório emitiu um documento, como intimação ou ofício'],
  ['publicacao', 'houve publicação no Diário da Justiça'],
  ['intimacao', 'uma das partes foi comunicada de um ato do processo'],
  ['citacao', 'a outra parte foi chamada oficialmente para o processo'],
  ['distribu', 'o processo foi registrado e encaminhado a uma vara'],
  ['remessa', 'o processo foi enviado a outro setor ou tribunal'],
  ['recebimento', 'o processo foi recebido pelo setor responsável'],
  ['arquivamento', 'o processo foi arquivado'],
  ['baixa definitiva', 'o processo foi encerrado no sistema do tribunal'],
  ['suspens', 'o andamento do processo foi suspenso por um período'],
  ['pericia', 'etapa de perícia'],
];
export function explainMovement(name) {
  const n = normalize(name);
  return explanations.find(([key]) => n.includes(normalize(key)))?.[1] || '';
}

const br = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function clientReport({
  caseItem,
  client,
  movements = [],
  tasks = [],
  settings = {},
  now = new Date(),
  limit = 5,
}) {
  const first = (client?.name || '').trim().split(/\s+/)[0];
  const lines = [
    `Olá${first ? `, ${first}` : ''}! Segue um resumo do seu processo${caseItem.title ? ` “${caseItem.title}”` : ''}${caseItem.number ? ` (nº ${caseItem.number})` : ''}.`,
    '',
  ];
  lines.push(`Situação: ${caseItem.status}${caseItem.phase ? `, fase de ${caseItem.phase.toLowerCase()}` : ''}.`);
  lines.push('');
  const recent = [...movements].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
  if (recent.length) {
    lines.push('Últimas movimentações:');
    for (const m of recent) {
      const meaning = explainMovement(m.name);
      lines.push(
        `• ${br(m.date)}: ${m.name}${meaning && normalize(meaning) !== normalize(m.name) ? ` (${meaning})` : ''}.`,
      );
    }
  } else lines.push('Ainda não há movimentações novas registradas.');
  // Only appointments the client takes part in; internal deadlines stay with the office.
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00`;
  const upcoming = tasks
    .filter(t => ['Audiência', 'Reunião'].includes(t.type) && t.status !== 'Concluída' && t.due >= nowKey)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 3);
  if (upcoming.length) {
    lines.push('', 'Próximos compromissos:');
    for (const t of upcoming) lines.push(`• ${br(t.due)} às ${t.due.slice(11, 16)}: ${t.title}.`);
  }
  lines.push('', 'Qualquer dúvida, estamos à disposição.');
  if (settings.officeName) lines.push(settings.officeName);
  return lines.join('\n');
}
