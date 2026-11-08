import { useState } from 'react';
import { Save, ShieldAlert, Info } from 'lucide-react';
import BirthdayFields from './BirthdayFields.jsx';
import { Modal, Button, Toggle, dayKey } from './components.jsx';
import { parseCNJ, cnjProblem, cnjDigits, cnjStates } from '../../app/cnj.mjs';
import { brDocument } from '../../app/br-documents.mjs';
import {
  caseAreas,
  caseChoices,
  maritalStatuses,
  personRoles,
  financeCategories,
  paymentMethods,
  intakeStatuses,
  intakeSources,
} from '../../app/legal-options.mjs';
import { findConflicts } from '../../app/conflicts.mjs';

// Warns, without blocking, when the person is already on the other side somewhere in the office.
function Conflicts({ list }) {
  if (!list.length) return null;
  const serious = list.some(c => c.severity === 'conflict');
  return (
    <div className={'conflict-alert full ' + (serious ? 'danger' : 'info')} role="status">
      {serious ? <ShieldAlert size={16} /> : <Info size={16} />}
      <div>
        <strong>{serious ? 'Possível conflito de interesses' : 'Já existe no escritório'}</strong>
        <ul>
          {list.slice(0, 5).map(c => (
            <li key={c.kind + c.id + c.text}>{c.text}</li>
          ))}
        </ul>
        {serious && <small>Confira antes de salvar. O cadastro não é bloqueado.</small>}
      </div>
    </div>
  );
}

const moneyInput = value =>
  /^\d+\.\d{2}$/.test(value || '')
    ? Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value || '';
// What the number tells about the case, or why it cannot be saved.
export function cnjHint(number, courts) {
  if (!cnjDigits(number)) return null;
  const problem = cnjProblem(number);
  if (problem) return { tone: 'danger', text: problem };
  const parsed = parseCNJ(number);
  if (!parsed) return { tone: 'muted', text: 'Fora do padrão CNJ de 20 dígitos: será salvo como digitado.' };
  const court = courts.find(c => c.id === parsed.courtId);
  return {
    tone: 'ok',
    text: [court?.acronym, parsed.segmentName, parsed.uf, `ajuizado em ${parsed.year}`].filter(Boolean).join(' · '),
  };
}
function documentHint(value) {
  if (!value) return null;
  const parsed = brDocument(value);
  return parsed.valid && parsed.type ? null : { tone: 'danger', text: 'CPF ou CNPJ inválido. Confira os números.' };
}
// Mirrors backend/hearing-reminders.cjs so the form says when (or why not) the reminder goes out.
function reminderHint(form, data) {
  const caseItem = data.entities.cases.find(c => c.id === form.caseId);
  const client = data.entities.clients.find(c => c.id === (form.clientId || caseItem?.clientId));
  if (!client) return { tone: 'danger', text: 'Vincule um cliente ou um processo com cliente.' };
  if (!/^\d{10,15}$/.test(String(client.phone || '').replace(/\D/g, '')))
    return { tone: 'danger', text: `${client.name} não tem WhatsApp válido no cadastro.` };
  const [date] = String(form.due || '').split('T');
  const [y, m, d] = (date || '').split('-').map(Number);
  const [h, min] = String(form.reminderTime || '09:00')
    .split(':')
    .map(Number);
  const when = new Date(y, m - 1, d - Number(form.reminderLead || 1), h, min);
  if (!Number.isFinite(when.getTime())) return null;
  const label = when.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  if (when.getTime() <= Date.now() + 60000)
    return { tone: 'danger', text: `O aviso seria em ${label}, que já passou. Ele não será enviado.` };
  return {
    tone: 'ok',
    text: `Será enviado para ${client.name} em ${label}. Use {4} data, {5} horário e {6} título no modelo.`,
  };
}
function Hint({ hint }) {
  if (!hint) return null;
  return <small className={'field-hint ' + hint.tone}>{hint.text}</small>;
}

const info = {
  clients: ['cliente', 'clientes'],
  cases: ['processo', 'processos'],
  tasks: ['compromisso', 'compromissos'],
  notes: ['anotação', 'anotações'],
  people: ['pessoa', 'pessoas'],
  finance: ['lançamento', 'lançamentos'],
  intakes: ['atendimento', 'atendimentos'],
};
const initial = kind => ({
  name: '',
  birthDate: '',
  birthdayEnabled: false,
  birthdayTemplateId: '',
  birthdayTime: '09:00',
  title: '',
  email: '',
  phone: '',
  document: '',
  address: '',
  notes: '',
  number: '',
  clientId: '',
  caseId: '',
  court: '',
  area: 'Cível',
  emailPreference: 'Receber',
  status: kind === 'clients' ? 'Ativo' : kind === 'cases' ? 'Em andamento' : kind === 'intakes' ? 'Novo' : 'Pendente',
  due: dayKey(new Date()) + 'T09:00',
  type: 'Prazo',
  priority: 'Normal',
  content: '',
  personType: 'Física',
  state: '',
  clientRole: '',
  instance: '',
  phase: '',
  parentCaseId: '',
  secret: false,
  role: 'Parte contrária',
  oab: '',
  clientReminder: false,
  reminderLead: '1',
  reminderTime: '09:00',
  reminderTemplateId: '',
  direction: 'Receita',
  category: 'Honorário contratual',
  description: '',
  amount: '',
  dueDate: dayKey(new Date()),
  paidDate: '',
  method: '',
  reimbursable: false,
  installments: '1',
  date: dayKey(new Date()),
  subject: '',
  source: '',
  followUp: '',
  ...(kind === 'intakes' ? { area: '' } : {}),
});
function Field({ label, children, full = false, optional = false, hint = null }) {
  return (
    <label className={'field ' + (full ? 'full' : '')}>
      <span>
        {label}
        {optional && <small>opcional</small>}
      </span>
      {children}
      <Hint hint={hint} />
    </label>
  );
}
const Section = ({ children }) => <div className="form-section">{children}</div>;
export default function EntityForm({ kind, item, data, onClose, onSave }) {
  const [form, setForm] = useState(() => {
    const value = { ...initial(kind), ...item };
    return { ...value, claimValue: moneyInput(value.claimValue), amount: moneyInput(value.amount) };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const props = name => ({
    value: form[name] || '',
    onChange: e => setForm(current => ({ ...current, [name]: e.target.value })),
  });
  // Formats a valid CPF/CNPJ when the user leaves the field; invalid values stay as typed.
  const documentProps = name => ({
    ...props(name),
    onBlur: e => {
      const parsed = brDocument(e.target.value);
      if (parsed.valid && parsed.type) setForm(current => ({ ...current, [name]: parsed.formatted }));
    },
  });
  const legal = form.personType === 'Jurídica';
  const probe =
    kind === 'clients' || kind === 'intakes'
      ? { name: form.name, document: form.document, side: 'client' }
      : kind === 'cases'
        ? { name: form.opposingParty, document: form.opposingDocument, side: 'opposing' }
        : kind === 'people'
          ? { name: form.name, document: form.document, side: form.role === 'Parte contrária' ? 'opposing' : 'other' }
          : null;
  const conflicts = probe ? findConflicts({ ...probe, excludeId: item?.id || '' }, data.entities) : [];
  const options = (list, empty = 'Não informado') =>
    list.map(a => (
      <option key={a} value={a}>
        {a || empty}
      </option>
    ));
  const client = (
    <Field label="Cliente vinculado" optional>
      <select {...props('clientId')}>
        <option value="">Sem vínculo</option>
        {data.entities.clients.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const process = (
    <Field label="Processo vinculado" optional>
      <select {...props('caseId')}>
        <option value="">Sem vínculo</option>
        {data.entities.cases.map(c => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </Field>
  );
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(kind, form);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose} title={`${item?.id ? 'Editar' : 'Cadastrar'} ${info[kind][0]}`}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {kind === 'clients' && (
            <>
              <Section>Identificação</Section>
              <Field label="Nome completo ou razão social" full>
                <input {...props('name')} required maxLength={160} autoFocus placeholder="Como o cliente se chama?" />
              </Field>
              <Field label="Tipo de pessoa">
                <select {...props('personType')}>{options(caseChoices.personType)}</select>
              </Field>
              <Field label="Situação">
                <select {...props('status')}>
                  <option>Ativo</option>
                  <option>Inativo</option>
                </select>
              </Field>
              <Field label="CPF / CNPJ" optional hint={documentHint(form.document)}>
                <input
                  {...documentProps('document')}
                  maxLength={32}
                  placeholder={legal ? '00.000.000/0000-00' : '000.000.000-00'}
                />
              </Field>
              {legal ? (
                <>
                  <Field label="Representante legal" optional>
                    <input
                      {...props('legalRepresentative')}
                      maxLength={200}
                      placeholder="Nome de quem assina pela empresa"
                    />
                  </Field>
                  <Field label="CPF do representante" optional hint={documentHint(form.representativeDocument)}>
                    <input {...documentProps('representativeDocument')} maxLength={20} placeholder="000.000.000-00" />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Nacionalidade" optional>
                    <input {...props('nationality')} maxLength={60} placeholder="brasileira" />
                  </Field>
                  <Field label="Estado civil" optional>
                    <input {...props('maritalStatus')} maxLength={40} list="marital-statuses" />
                    <datalist id="marital-statuses">
                      {maritalStatuses.map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Profissão" optional>
                    <input {...props('profession')} maxLength={120} />
                  </Field>
                  <Field label="RG" optional>
                    <input {...props('rg')} maxLength={30} />
                  </Field>
                  <Field label="Órgão emissor do RG" optional>
                    <input {...props('rgIssuer')} maxLength={30} placeholder="SSP/GO" />
                  </Field>
                </>
              )}
              <Conflicts list={conflicts} />
              <Section>Contato</Section>
              <Field label="WhatsApp (com DDD)">
                <input {...props('phone')} type="tel" required maxLength={40} placeholder="64 99999-0000" />
              </Field>
              <Field label="E-mail" optional>
                <input {...props('email')} type="email" maxLength={254} placeholder="nome@exemplo.com" />
              </Field>
              <p className="help-text full">
                Para outros países, use + e o código do país. O sistema não verifica se o número possui conta no
                WhatsApp.
              </p>
              <Section>Endereço</Section>
              <Field label="CEP" optional>
                <input {...props('zip')} maxLength={9} inputMode="numeric" placeholder="00000-000" />
              </Field>
              <Field label="Logradouro" optional>
                <input {...props('street')} maxLength={200} placeholder="Rua, avenida..." />
              </Field>
              <Field label="Número" optional>
                <input {...props('addressNumber')} maxLength={20} />
              </Field>
              <Field label="Complemento" optional>
                <input {...props('complement')} maxLength={120} />
              </Field>
              <Field label="Bairro" optional>
                <input {...props('district')} maxLength={120} />
              </Field>
              <Field label="Cidade" optional>
                <input {...props('city')} maxLength={120} />
              </Field>
              <Field label="UF" optional>
                <select {...props('state')}>{options(['', ...cnjStates], 'Selecione')}</select>
              </Field>
              {item?.address && (
                <Field
                  label="Endereço do cadastro anterior"
                  full
                  optional
                  hint={{
                    tone: 'muted',
                    text: 'Usado na qualificação só enquanto os campos acima estiverem vazios.',
                  }}
                >
                  <input {...props('address')} maxLength={500} />
                </Field>
              )}
              <Section>Preferências</Section>
              <Field label="Recebimento de e-mails">
                <select {...props('emailPreference')}>
                  <option>Receber</option>
                  <option>Não receber</option>
                </select>
              </Field>
            </>
          )}
          {kind === 'clients' && <BirthdayFields form={form} setForm={setForm} data={data} />}
          {kind === 'cases' && (
            <>
              <Field label="Título do processo" full>
                <input
                  {...props('title')}
                  required
                  maxLength={200}
                  autoFocus
                  placeholder="Ex.: Reclamação trabalhista"
                />
              </Field>
              <Field label="Número do processo" optional hint={cnjHint(form.number, data.courts?.courts || [])}>
                <input
                  {...props('number')}
                  maxLength={40}
                  placeholder="0000000-00.0000.0.00.0000"
                  className="tabular"
                  onBlur={e => {
                    const parsed = parseCNJ(e.target.value);
                    if (parsed?.valid) setForm(current => ({ ...current, number: parsed.formatted }));
                  }}
                />
              </Field>
              <Field label="Área de atuação">
                <select {...props('area')}>{options(caseAreas)}</select>
              </Field>
              <Field label="Situação">
                <select {...props('status')}>
                  {options(['Em andamento', 'Aguardando', 'Concluído', 'Arquivado'])}
                </select>
              </Field>
              <Field label="Fase" optional>
                <select {...props('phase')}>{options(caseChoices.phase)}</select>
              </Field>
              <Section>Partes</Section>
              {client}
              <Field label="Polo do cliente" optional>
                <select {...props('clientRole')}>{options(caseChoices.clientRole)}</select>
              </Field>
              <Field label="Parte contrária" optional>
                <input {...props('opposingParty')} maxLength={300} placeholder="Nome ou razão social" />
              </Field>
              <Field label="CPF / CNPJ da parte contrária" optional hint={documentHint(form.opposingDocument)}>
                <input {...documentProps('opposingDocument')} maxLength={32} />
              </Field>
              <Field label="Advogado da parte contrária" optional>
                <input {...props('opposingLawyer')} maxLength={160} />
              </Field>
              <Field label="OAB do advogado contrário" optional>
                <input {...props('opposingLawyerOab')} maxLength={20} placeholder="12345/GO" />
              </Field>
              <Conflicts list={conflicts} />
              <Section>Juízo</Section>
              <Field label="Comarca / seção judiciária" optional>
                <input {...props('county')} maxLength={120} placeholder="Ex.: Goiânia" />
              </Field>
              <Field label="Vara / órgão julgador" optional>
                <input {...props('court')} maxLength={200} placeholder="Ex.: 3ª Vara Cível" />
              </Field>
              <Field label="Instância" optional>
                <select {...props('instance')}>{options(caseChoices.instance)}</select>
              </Field>
              <Field label="Juiz ou relator" optional>
                <input {...props('judge')} maxLength={160} />
              </Field>
              <Section>Causa</Section>
              <Field label="Classe / rito" optional>
                <input {...props('procedure')} maxLength={80} placeholder="Ex.: Procedimento comum" />
              </Field>
              <Field label="Valor da causa" optional>
                <input {...props('claimValue')} maxLength={20} inputMode="decimal" placeholder="R$ 0,00" />
              </Field>
              <Field label="Data de distribuição" optional>
                <input {...props('filedAt')} type="date" min="1900-01-01" max="9999-12-31" />
              </Field>
              <Field label="Processo relacionado" optional>
                <select {...props('parentCaseId')}>
                  <option value="">Nenhum</option>
                  {data.entities.cases
                    .filter(c => c.id !== item?.id)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                        {c.number ? ` · ${c.number}` : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Etiquetas" full optional hint={{ tone: 'muted', text: 'Separe por vírgula.' }}>
                <input {...props('tags')} maxLength={300} placeholder="Ex.: liminar, prioridade idoso" />
              </Field>
              <div className="full">
                <Toggle
                  checked={form.secret === true}
                  onChange={v => setForm(current => ({ ...current, secret: v }))}
                  title="Segredo de justiça"
                  description="Destaca o processo para lembrar o cuidado com cópias e mensagens."
                />
              </div>
            </>
          )}
          {kind === 'tasks' && (
            <>
              <Field label="Título do compromisso" full>
                <input
                  {...props('title')}
                  required
                  maxLength={200}
                  autoFocus
                  placeholder="Ex.: Apresentar contestação"
                />
              </Field>
              <Field label="Data e horário">
                <input {...props('due')} type="datetime-local" required min="1900-01-01T00:00" max="9999-12-31T23:59" />
              </Field>
              <Field label="Tipo">
                <select {...props('type')}>
                  {['Prazo', 'Audiência', 'Reunião', 'Tarefa'].map(a => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Prioridade">
                <select {...props('priority')}>
                  {['Normal', 'Alta', 'Urgente'].map(a => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Situação">
                <select {...props('status')}>
                  <option>Pendente</option>
                  <option>Concluída</option>
                </select>
              </Field>
              {process}
              {client}
              {['Audiência', 'Reunião'].includes(form.type) && (
                <>
                  <Section>Aviso ao cliente</Section>
                  <div className="full">
                    <Toggle
                      checked={form.clientReminder === true}
                      onChange={v => setForm(current => ({ ...current, clientReminder: v }))}
                      title="Avisar o cliente por WhatsApp"
                      description="Envia um lembrete com data e horário. Se o compromisso mudar ou for concluído, o aviso é refeito ou cancelado."
                    />
                  </div>
                  {form.clientReminder && (
                    <>
                      <Field label="Antecedência">
                        <select {...props('reminderLead')}>
                          {[
                            ['1', '1 dia antes'],
                            ['2', '2 dias antes'],
                            ['3', '3 dias antes'],
                            ['7', '1 semana antes'],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Horário do aviso">
                        <input {...props('reminderTime')} type="time" required />
                      </Field>
                      <Field label="Modelo de mensagem" full optional hint={reminderHint(form, data)}>
                        <select {...props('reminderTemplateId')}>
                          <option value="">Mensagem padrão</option>
                          {data.library.templates
                            .filter(t => t.kind === 'whatsapp' && t.purpose !== 'birthday')
                            .map(t => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                        </select>
                      </Field>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {kind === 'notes' && (
            <>
              <Field label="Título" full>
                <input {...props('title')} required maxLength={200} autoFocus placeholder="Dê um título à anotação" />
              </Field>
              {process}
              <Field label="Anotação" full>
                <textarea
                  aria-label="Anotação"
                  {...props('content')}
                  required
                  rows={9}
                  maxLength={60000}
                  placeholder="Registre informações, ideias e detalhes do atendimento..."
                />
              </Field>
            </>
          )}
          {kind === 'people' && (
            <>
              <Field label="Nome completo ou razão social" full>
                <input {...props('name')} required maxLength={160} autoFocus />
              </Field>
              <Field label="Papel">
                <select {...props('role')}>{options(personRoles)}</select>
              </Field>
              <Field label="CPF / CNPJ" optional hint={documentHint(form.document)}>
                <input {...documentProps('document')} maxLength={32} />
              </Field>
              <Conflicts list={conflicts} />
              {process}
              <Field label="OAB" optional>
                <input {...props('oab')} maxLength={20} placeholder="12345/GO" />
              </Field>
              <Field label="Telefone" optional>
                <input {...props('phone')} type="tel" maxLength={40} />
              </Field>
              <Field label="E-mail" optional>
                <input {...props('email')} type="email" maxLength={254} />
              </Field>
            </>
          )}
          {kind === 'intakes' && (
            <>
              <Field label="Nome" full>
                <input
                  {...props('name')}
                  required
                  maxLength={160}
                  autoFocus
                  placeholder="Quem procurou o escritório?"
                />
              </Field>
              <Field label="Telefone / WhatsApp" optional>
                <input {...props('phone')} type="tel" maxLength={40} placeholder="64 99999-0000" />
              </Field>
              <Field label="E-mail" optional>
                <input {...props('email')} type="email" maxLength={254} />
              </Field>
              <Field label="CPF / CNPJ" optional hint={documentHint(form.document)}>
                <input {...documentProps('document')} maxLength={32} />
              </Field>
              <Conflicts list={conflicts} />
              <Field label="Data do atendimento">
                <input {...props('date')} type="date" required min="1900-01-01" max="9999-12-31" />
              </Field>
              <Field label="Assunto" full>
                <textarea
                  aria-label="Assunto"
                  {...props('subject')}
                  rows={3}
                  maxLength={4000}
                  placeholder="O que a pessoa relatou e o que precisa"
                />
              </Field>
              <Field label="Área" optional>
                <select {...props('area')}>{options(['', ...caseAreas], 'Não definida')}</select>
              </Field>
              <Field label="Como chegou" optional>
                <select {...props('source')}>{options(intakeSources, 'Não informado')}</select>
              </Field>
              <Field label="Situação">
                <select {...props('status')}>{options(intakeStatuses)}</select>
              </Field>
              <Field label="Retornar em" optional>
                <input {...props('followUp')} type="date" min="1900-01-01" max="9999-12-31" />
              </Field>
            </>
          )}
          {kind === 'finance' && (
            <>
              <Field label="Tipo">
                <select
                  value={form.direction}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      direction: e.target.value,
                      category: financeCategories[e.target.value][0],
                      reimbursable: false,
                    }))
                  }
                >
                  {options(Object.keys(financeCategories))}
                </select>
              </Field>
              <Field label="Categoria">
                <select {...props('category')}>{options(financeCategories[form.direction])}</select>
              </Field>
              <Field label="Descrição" full>
                <input
                  {...props('description')}
                  required
                  maxLength={180}
                  autoFocus
                  placeholder={form.direction === 'Receita' ? 'Ex.: Honorários iniciais' : 'Ex.: Custas iniciais'}
                />
              </Field>
              <Field
                label={Number(form.installments) > 1 ? 'Valor total' : 'Valor'}
                optional={form.category === 'Honorário de êxito'}
                hint={
                  form.category === 'Honorário de êxito'
                    ? { tone: 'muted', text: 'Pode ficar em branco até o resultado; aparece como “A apurar”.' }
                    : null
                }
              >
                <input {...props('amount')} inputMode="decimal" maxLength={20} placeholder="R$ 0,00" />
              </Field>
              <Field label={Number(form.installments) > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}>
                <input {...props('dueDate')} type="date" required min="1900-01-01" max="9999-12-31" />
              </Field>
              {!item?.id && (
                <Field
                  label="Parcelas"
                  hint={
                    Number(form.installments) > 1
                      ? { tone: 'muted', text: 'Uma por mês, no mesmo dia. A última ajusta os centavos.' }
                      : null
                  }
                >
                  <input {...props('installments')} type="number" min={1} max={120} />
                </Field>
              )}
              {Number(form.installments) <= 1 && (
                <Field label="Pago em" optional>
                  <input {...props('paidDate')} type="date" min="1900-01-01" max="9999-12-31" />
                </Field>
              )}
              <Field label="Forma de pagamento" optional>
                <select {...props('method')}>{options(paymentMethods, 'Não informada')}</select>
              </Field>
              {form.direction === 'Despesa' && (
                <div className="full">
                  <Toggle
                    checked={form.reimbursable === true}
                    onChange={v => setForm(f => ({ ...f, reimbursable: v }))}
                    title="Reembolsável pelo cliente"
                    description="Soma no total de despesas a cobrar. O reembolso recebido é um lançamento de receita."
                  />
                </div>
              )}
              {client}
              {process}
            </>
          )}
          {kind !== 'notes' && (
            <Field label="Observações" full optional>
              <textarea
                aria-label="Observações"
                {...props('notes')}
                rows={3}
                maxLength={['people', 'finance'].includes(kind) ? 4000 : 12000}
                placeholder="Informações adicionais para o escritório"
              />
            </Field>
          )}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-footer">
          <div>
            <Button type="button" tone="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" icon={Save} busy={busy}>
              Salvar {info[kind][0]}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
