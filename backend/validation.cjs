const kinds = ['clients', 'cases', 'tasks', 'notes', 'documents'];
const fields = {
  clients: { name: 160, email: 254, phone: 40, document: 32, address: 500, notes: 12000, status: 30, emailPreference: 30, birthDate:10, birthdayTemplateId:36, birthdayTime:5 },
  cases: { title: 200, number: 40, clientId: 36, court: 200, area: 60, status: 40, notes: 16000 },
  tasks: { title: 200, caseId: 36, clientId: 36, due: 30, type: 40, priority: 20, status: 30, notes: 12000 },
  notes: { title: 200, content: 60000, caseId: 36 },
  documents: { name: 255, caseId: 36, clientId: 36, notes: 4000 }
};
function text(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('Campo inválido ou maior que o permitido.');
  return value.trim();
}
function entity(kind, data, {allowLegacyContact=false}={}) {
  if (!kinds.includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Registro inválido.');
  const result = {};
  for (const [key, max] of Object.entries(fields[kind])) result[key] = text(data[key] ?? '', max);
  if (!(result.name || result.title)) throw new Error('Informe o nome ou título do registro.');
  if (kind === 'clients') {
    if(data.birthdayEnabled!==undefined&&typeof data.birthdayEnabled!=='boolean')throw new Error('Opção de aniversário inválida.');result.birthdayEnabled=data.birthdayEnabled===true;result.birthdayTime=result.birthdayTime||'09:00';
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.birthdayTime))throw new Error('Horário de aniversário inválido.');
    if(result.birthDate){const d=new Date(result.birthDate+'T12:00:00Z');const now=new Date();const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;if(!/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==result.birthDate||result.birthDate<'1900-01-01'||result.birthDate>today)throw new Error('Informe uma data de nascimento válida, sem data futura.');}
    if(result.birthdayTemplateId)uuid(result.birthdayTemplateId);
    if(result.birthdayEnabled&&(!result.birthDate||!result.birthdayTemplateId))throw new Error('Informe o nascimento e escolha um modelo de mensagem aniversário.');
    if(!allowLegacyContact)result.phone=require('./phone.cjs').whatsappNumber(result.phone);
    if(!['Receber','Não receber'].includes(result.emailPreference))result.emailPreference='Receber';
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('E-mail inválido.');
    if (!['Ativo', 'Inativo'].includes(result.status)) result.status = 'Ativo';
  }
  if (kind === 'cases') {
    if (!['Em andamento', 'Aguardando', 'Concluído', 'Arquivado'].includes(result.status)) throw new Error('Situação do processo inválida.');
    if (!['Cível', 'Trabalhista', 'Família', 'Previdenciário', 'Tributário', 'Criminal', 'Outros'].includes(result.area)) result.area = 'Outros';
  }
  if (kind === 'tasks') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(result.due) || !Number.isFinite(new Date(result.due).getTime()) || new Date(result.due).getFullYear() < 1900) throw new Error('Informe uma data e horário válidos.');
    const [date, time] = result.due.split('T');
    const check = new Date(result.due);
    if (check.getDate() !== Number(date.slice(-2)) || check.getHours() !== Number(time.slice(0, 2)) || Number(time.slice(3)) > 59) throw new Error('Data ou horário inválido.');
    if (!['Pendente', 'Concluída'].includes(result.status)) result.status = 'Pendente';
    if (!['Normal', 'Alta', 'Urgente'].includes(result.priority)) result.priority = 'Normal';
    if (!['Prazo', 'Audiência', 'Reunião', 'Tarefa'].includes(result.type)) result.type = 'Tarefa';
  }
  return result;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Identificador inválido.');
  return value;
}
module.exports = { kinds, entity, text, uuid };
