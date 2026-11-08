const { cnjProblem, formatCNJ, cnjDigits, cnjStates } = require('../app/cnj.mjs');
const { brDocument } = require('../app/br-documents.mjs');
const { parseMoney } = require('../app/money.mjs');
const { caseAreas: areas, caseChoices: choices, personRoles, financeCategories, paymentMethods, intakeStatuses, intakeSources } = require('../app/legal-options.mjs');
const kinds = ['clients', 'cases', 'tasks', 'notes', 'documents', 'people', 'finance', 'intakes'];
const fields = {
  clients: { name: 160, email: 254, phone: 40, document: 32, address: 500, notes: 12000, status: 30, emailPreference: 30, birthDate:10, birthdayTemplateId:36, birthdayTime:5,
    personType: 20, nationality: 60, maritalStatus: 40, profession: 120, rg: 30, rgIssuer: 30, legalRepresentative: 200, representativeDocument: 20,
    zip: 9, street: 200, addressNumber: 20, complement: 120, district: 120, city: 120, state: 2 },
  cases: { title: 200, number: 40, clientId: 36, court: 200, area: 60, status: 40, notes: 16000,
    clientRole: 30, opposingParty: 300, opposingDocument: 32, opposingLawyer: 160, opposingLawyerOab: 20, county: 120, instance: 30, judge: 160,
    phase: 40, procedure: 80, claimValue: 20, filedAt: 10, tags: 300, parentCaseId: 36 },
  tasks: { title: 200, caseId: 36, clientId: 36, due: 30, type: 40, priority: 20, status: 30, notes: 12000,
    reminderLead: 2, reminderTime: 5, reminderTemplateId: 36, reminderMessageId: 36, reminderKey: 64 },
  notes: { title: 200, content: 60000, caseId: 36 },
  documents: { name: 255, caseId: 36, clientId: 36, notes: 4000 },
  people: { name: 160, role: 40, document: 32, email: 254, phone: 40, oab: 20, caseId: 36, notes: 4000 },
  intakes: { name: 160, phone: 40, email: 254, document: 32, subject: 4000, area: 60, source: 30, date: 10, status: 30, followUp: 10, notes: 8000,
    convertedClientId: 36, convertedCaseId: 36 },
  finance: { description: 200, direction: 10, category: 40, amount: 20, dueDate: 10, paidDate: 10, method: 20, clientId: 36, caseId: 36,
    seriesId: 36, seriesIndex: 3, seriesCount: 3, notes: 4000 },
};
function text(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('Campo inválido ou maior que o permitido.');
  return value.trim();
}
function entity(kind, data, {allowLegacyContact=false}={}) {
  if (!kinds.includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Registro inválido.');
  const result = {};
  for (const [key, max] of Object.entries(fields[kind])) result[key] = text(data[key] ?? '', max);
  if (!(result.name || result.title || result.description)) throw new Error('Informe o nome ou título do registro.');
  if (kind === 'intakes') {
    const { isDateKey } = require('../app/deadlines.mjs');
    if (!intakeStatuses.includes(result.status)) result.status = 'Novo';
    if (!intakeSources.includes(result.source)) result.source = '';
    if (result.area && !areas.includes(result.area)) result.area = 'Outros';
    if (!result.date) throw new Error('Informe a data do atendimento.');
    for (const [key, label] of [['date', 'atendimento'], ['followUp', 'retorno']])
      if (result[key] && !isDateKey(result[key])) throw new Error(`Informe uma data de ${label} válida.`);
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('E-mail inválido.');
    result.document = documentNumber(result.document, allowLegacyContact, 'CPF ou CNPJ');
    for (const key of ['convertedClientId', 'convertedCaseId']) if (result[key]) uuid(result[key]);
  }
  if (kind === 'finance') {
    if (!financeCategories[result.direction]) result.direction = 'Receita';
    if (!financeCategories[result.direction].includes(result.category)) result.category = result.direction === 'Receita' ? 'Outra receita' : 'Outra despesa';
    result.amount = money(result.amount, 'o valor do lançamento');
    // A success fee can wait for the outcome; every other entry needs its amount.
    if (!result.amount && result.category !== 'Honorário de êxito') throw new Error('Informe o valor do lançamento.');
    for (const [key, label] of [['dueDate', 'vencimento'], ['paidDate', 'pagamento']])
      if (result[key] && !require('../app/deadlines.mjs').isDateKey(result[key])) throw new Error(`Informe uma data de ${label} válida.`);
    if (!result.dueDate) throw new Error('Informe a data de vencimento.');
    if (result.paidDate && !result.amount) throw new Error('Informe o valor antes de marcar como pago.');
    if (!paymentMethods.includes(result.method)) result.method = '';
    if (data.reimbursable !== undefined && typeof data.reimbursable !== 'boolean') throw new Error('Opção de reembolso inválida.');
    result.reimbursable = result.direction === 'Despesa' && data.reimbursable === true;
    if (result.seriesId) uuid(result.seriesId);
    for (const key of ['seriesIndex', 'seriesCount']) if (result[key] && !/^\d{1,3}$/.test(result[key])) throw new Error('Parcela inválida.');
  }
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
    if (!choices.personType.includes(result.personType)) result.personType = 'Física';
    result.document = documentNumber(result.document, allowLegacyContact, result.personType === 'Jurídica' ? 'CNPJ' : 'CPF');
    result.representativeDocument = documentNumber(result.representativeDocument, allowLegacyContact, 'CPF', 'do representante');
    result.state = result.state.toUpperCase();
    if (result.state && !cnjStates.includes(result.state)) throw new Error('Informe a UF com duas letras, por exemplo GO.');
    const zip = result.zip.replace(/\D/g, '');
    if (zip && zip.length !== 8) throw new Error('O CEP tem 8 dígitos.');
    result.zip = zip && zip.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  }
  if (kind === 'cases') {
    if (!['Em andamento', 'Aguardando', 'Concluído', 'Arquivado'].includes(result.status)) throw new Error('Situação do processo inválida.');
    if (!areas.includes(result.area)) result.area = 'Outros';
    for (const key of ['clientRole', 'instance', 'phase']) if (!choices[key].includes(result[key])) throw new Error('Opção inválida no processo.');
    // Old, administrative or extrajudicial numbers keep their own format; only 20-digit CNJ numbers are checked.
    const problem = allowLegacyContact ? '' : cnjProblem(result.number);
    if (problem) throw new Error(problem);
    if (cnjDigits(result.number).length === 20) result.number = formatCNJ(result.number);
    result.opposingDocument = documentNumber(result.opposingDocument, allowLegacyContact, 'CPF ou CNPJ', 'da parte contrária');
    result.opposingLawyerOab = oab(result.opposingLawyerOab, 'do advogado contrário');
    result.claimValue = money(result.claimValue);
    if (result.filedAt && (!/^\d{4}-\d{2}-\d{2}$/.test(result.filedAt) || new Date(result.filedAt + 'T12:00:00Z').toISOString().slice(0, 10) !== result.filedAt || result.filedAt < '1900-01-01'))
      throw new Error('Informe uma data de distribuição válida.');
    if (data.secret !== undefined && typeof data.secret !== 'boolean') throw new Error('Opção de segredo de justiça inválida.');
    result.secret = data.secret === true;
    if (result.parentCaseId) uuid(result.parentCaseId);
    result.tags = [...new Set(result.tags.split(',').map(t => t.trim()).filter(Boolean))].join(', ');
  }
  if (kind === 'people') {
    if (!personRoles.includes(result.role)) result.role = 'Outro';
    result.document = documentNumber(result.document, allowLegacyContact, 'CPF ou CNPJ');
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('E-mail inválido.');
    result.oab = oab(result.oab);
  }
  if (kind === 'tasks') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(result.due) || !Number.isFinite(new Date(result.due).getTime()) || new Date(result.due).getFullYear() < 1900) throw new Error('Informe uma data e horário válidos.');
    const [date, time] = result.due.split('T');
    const check = new Date(result.due);
    if (check.getDate() !== Number(date.slice(-2)) || check.getHours() !== Number(time.slice(0, 2)) || Number(time.slice(3)) > 59) throw new Error('Data ou horário inválido.');
    if (!['Pendente', 'Concluída'].includes(result.status)) result.status = 'Pendente';
    if (!['Normal', 'Alta', 'Urgente'].includes(result.priority)) result.priority = 'Normal';
    if (!['Prazo', 'Audiência', 'Reunião', 'Tarefa'].includes(result.type)) result.type = 'Tarefa';
    // WhatsApp reminder to the client before a hearing or meeting (see hearing-reminders.cjs).
    if (data.clientReminder !== undefined && typeof data.clientReminder !== 'boolean') throw new Error('Opção de aviso ao cliente inválida.');
    result.clientReminder = data.clientReminder === true && ['Audiência', 'Reunião'].includes(result.type);
    if (!['1', '2', '3', '7'].includes(result.reminderLead)) result.reminderLead = '1';
    result.reminderTime = result.reminderTime || '09:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.reminderTime)) throw new Error('Horário do aviso inválido.');
    for (const key of ['reminderTemplateId', 'reminderMessageId']) if (result[key]) uuid(result[key]);
    if (result.reminderKey && !/^[a-f0-9]{64}$/.test(result.reminderKey)) result.reminderKey = '';
  }
  return result;
}
// OAB as "number/UF" or "UF number", e.g. 12345/GO.
function oab(value, owner = '') {
  const upper = value.toUpperCase();
  if (upper && !/^[A-Z]{2}\s?\d{1,6}[A-Z]?$|^\d{1,6}[A-Z]?\/?[A-Z]{2}$/.test(upper.replace(/[.\s-]/g, '')))
    throw new Error(`Informe a OAB ${owner ? owner + ' ' : ''}como número e UF, por exemplo 12345/GO.`);
  return upper;
}
function documentNumber(value, legacy, expected, owner = '') {
  if (!value) return '';
  const parsed = brDocument(value);
  if (parsed.valid && parsed.type) return parsed.formatted;
  if (legacy) return value;
  throw new Error(`O ${expected} ${owner ? owner + ' ' : ''}não é válido. Confira os números digitados.`.replace(/\s+/g, ' '));
}
// Accepts "R$ 1.234,56", "1234,56" or "1234.56" and stores "1234.56".
function money(value, what = 'o valor da causa') {
  const parsed = parseMoney(value);
  if (parsed === null) throw new Error(`Informe ${what} em reais, por exemplo 15.000,00.`);
  return parsed;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Identificador inválido.');
  return value;
}
module.exports = { kinds, areas, choices, entity, text, uuid, money };
