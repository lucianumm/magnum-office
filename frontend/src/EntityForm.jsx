import { useEffect, useRef, useState } from 'react';
import { Save, ShieldAlert, Info, Search, CheckCircle2 } from 'lucide-react';
import BirthdayFields from './BirthdayFields.jsx';
import { Modal, Button, Toggle, dayKey } from './components.jsx';
import { parseCNJ, cnjProblem, cnjDigits, cnjStates } from '../../app/cnj.mjs';
import { brDocument, documentKey } from '../../app/br-documents.mjs';
import { caseFill, companyFill } from '../../app/lookup-fill.mjs';
import { repeatOptions } from '../../app/task-series.mjs';
import { eventKinds } from '../../app/message-defaults.mjs';
import { limitationRules, suggestedRule, caseLimitation } from '../../app/prescription.mjs';
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

// Result of a DataJud or CNPJ lookup, under the field that started it.
function LookupNote({ note, onClose }) {
  if (!note) return null;
  const tone = note.error || note.warn ? 'danger' : 'info';
  return (
    <div className={'conflict-alert full lookup-note ' + tone} role="status">
      {note.busy ? <Search size={16} /> : note.error ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
      <div>
        <strong>{note.title}</strong>
        {note.lines?.length > 0 && (
          <ul>
            {note.lines.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {note.hint && <small>{note.hint}</small>}
      </div>
      {!note.busy && (
        <button type="button" className="text-link" onClick={onClose}>
          Fechar
        </button>
      )}
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
const eventTypes = ['Audiência', 'Perícia', 'Reunião', 'Diligência'];
const confirmationLabels = {
  awaiting: 'Aguardando resposta',
  confirmed: 'Presença confirmada',
  declined: 'Cliente pediu contato',
};
// Says whether the client can be reached before the notices are offered.
function noticeHint(form, data) {
  const caseItem = data.entities.cases.find(c => c.id === form.caseId);
  const client = data.entities.clients.find(c => c.id === (form.clientId || caseItem?.clientId));
  if (!client) return { tone: 'danger', text: 'Vincule um cliente ou um processo com cliente.' };
  if (!/^\d{10,15}$/.test(String(client.phone || '').replace(/\D/g, '')))
    return { tone: 'danger', text: `${client.name} não tem WhatsApp válido no cadastro.` };
  return { tone: 'ok', text: `Os avisos vão para ${client.name}.` };
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
  // Lookups by number: automatic on leaving the field when turned on in Consultas públicas, or by the
  // button. Only empty fields are filled; what the person typed is never replaced.
  const [notes, setNotes] = useState({});
  // Number found in the DataJud in this form, to bring its movements once the case is saved.
  const foundNumber = useRef('');
  const [addPerson, setAddPerson] = useState(false);
  const looked = useRef({});
  const note = (slot, value) => setNotes(current => ({ ...current, [slot]: value }));
  const settings = data.settings || {};
  // The latest form and whether the dialog is still open, read when a lookup answers.
  const latest = useRef(form);
  latest.current = form;
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );
  async function lookupCase(number, manual = false) {
    const parsed = parseCNJ(number);
    if (!parsed?.valid || (!manual && looked.current.case === parsed.formatted)) return;
    looked.current.case = parsed.formatted;
    note('case', { busy: true, title: 'Buscando o processo no DataJud…' });
    try {
      const result = await window.advocacia.lookupCase(parsed.formatted);
      // The number was changed or the form closed while waiting: this answer is about something else.
      if (!open.current || cnjDigits(latest.current.number) !== cnjDigits(parsed.formatted)) return;
      if (!result.found) {
        note('case', {
          title: 'Processo não encontrado no DataJud',
          hint: 'Pode estar em segredo de justiça, ser muito recente ou ainda não ter sido enviado pelo tribunal. Preencha à mão.',
        });
        return;
      }
      foundNumber.current = parsed.formatted;
      const { lines } = caseFill(latest.current, result, { savedArea: item?.area });
      setForm(current => ({ ...current, ...caseFill(current, result, { savedArea: item?.area }).changes }));
      note('case', {
        title: `Encontrado no DataJud${result.tribunal ? ` (${result.tribunal})` : ''}`,
        lines: [...lines, ...(result.subjects.length ? [`Assuntos: ${result.subjects.join('; ')}`] : [])],
        hint: lines.length
          ? 'Preenchido só onde estava vazio. As partes não vêm do DataJud: informe-as abaixo.'
          : 'Os campos já estavam preenchidos e não foram alterados.',
      });
    } catch (failure) {
      if (open.current)
        note('case', { error: true, title: 'Não foi possível buscar no DataJud', hint: failure.message });
    }
  }
  async function lookupCNPJ(slot, value, manual = false) {
    const parsed = brDocument(value);
    if (parsed.type !== 'CNPJ' || !parsed.valid || (!manual && looked.current[slot] === parsed.formatted)) return;
    looked.current[slot] = parsed.formatted;
    const field = slot === 'opposing' ? 'opposingDocument' : 'document';
    // People and intakes only take the company name.
    const fill = (current, found) =>
      slot === 'person'
        ? current.name?.trim()
          ? {}
          : { name: found.name }
        : companyFill(current, found, slot).changes;
    note(slot, { busy: true, title: 'Buscando os dados do CNPJ…' });
    try {
      const result = await window.advocacia.lookupCNPJ(parsed.formatted);
      if (!open.current || documentKey(latest.current[field]) !== documentKey(parsed.formatted)) return;
      if (!result.found) {
        note(slot, { error: true, title: 'CNPJ não encontrado', hint: 'Confira o número ou preencha os dados à mão.' });
        return;
      }
      const lines =
        slot === 'person'
          ? Object.values(fill(latest.current, result)).map(v => `Nome: ${v}`)
          : companyFill(latest.current, result, slot).lines;
      setForm(current => ({ ...current, ...fill(current, result) }));
      note(slot, {
        warn: !result.active,
        title: result.active ? `Empresa encontrada: ${result.name}` : `Atenção: CNPJ com situação ${result.situation}`,
        lines: [...(result.tradeName ? [`Nome fantasia: ${result.tradeName}`] : []), ...lines],
        hint: lines.length
          ? 'Dados públicos da Receita Federal, preenchidos só onde estava vazio. Confira antes de salvar.'
          : 'Os campos já estavam preenchidos e não foram alterados.',
      });
    } catch (failure) {
      if (open.current) note(slot, { error: true, title: 'Não foi possível buscar o CNPJ', hint: failure.message });
    }
  }
  async function lookupCEP(value, manual = false) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 8 || (!manual && looked.current.cep === digits)) return;
    looked.current.cep = digits;
    note('cep', { busy: true, title: 'Buscando o endereço…' });
    try {
      const result = await window.advocacia.lookupCEP(digits);
      if (!open.current || String(latest.current.zip || '').replace(/\D/g, '') !== digits) return;
      if (!result.found) {
        note('cep', {
          error: true,
          title: 'CEP não encontrado',
          hint: 'Confira o número ou preencha o endereço à mão.',
        });
        return;
      }
      const keys = { street: 'Logradouro', district: 'Bairro', city: 'Cidade', state: 'UF' };
      const pick = current =>
        Object.fromEntries(
          Object.keys(keys)
            .filter(k => result[k] && !String(current[k] || '').trim())
            .map(k => [k, result[k]]),
        );
      const filled = pick(latest.current);
      setForm(current => ({ ...current, zip: result.zip, ...pick(current) }));
      note('cep', {
        title: 'Endereço encontrado',
        lines: Object.entries(filled).map(([k, v]) => `${keys[k]}: ${v}`),
        hint: Object.keys(filled).length
          ? 'Preenchido só onde estava vazio. Informe o número e o complemento.'
          : 'Os campos já estavam preenchidos e não foram alterados.',
      });
    } catch (failure) {
      if (open.current) note('cep', { error: true, title: 'Não foi possível buscar o CEP', hint: failure.message });
    }
  }
  const lookupButton = (label, onClick) => (
    <button type="button" className="text-link lookup-button" onClick={onClick}>
      <Search size={12} /> {label}
    </button>
  );
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
      const saved = await onSave(kind, form);
      if (kind === 'cases' && saved?.id && !item?.id) {
        if (foundNumber.current && foundNumber.current === parseCNJ(form.number)?.formatted)
          void window.advocacia.importMovementsAfterLookup(saved.id).catch(() => {});
        if (addPerson && form.opposingParty.trim()) {
          const key = documentKey(form.opposingDocument);
          const known = data.entities.people.some(
            p =>
              (key && documentKey(p.document) === key) ||
              p.name.trim().toLowerCase() === form.opposingParty.trim().toLowerCase(),
          );
          if (!known)
            await onSave('people', {
              name: form.opposingParty.trim(),
              role: 'Parte contrária',
              document: form.opposingDocument,
              caseId: saved.id,
            }).catch(() => {});
        }
      }
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
                  onBlur={e => {
                    documentProps('document').onBlur(e);
                    if (settings.cnpjLookupEnabled) void lookupCNPJ('client', e.target.value);
                  }}
                  maxLength={32}
                  placeholder={legal ? '00.000.000/0000-00' : '000.000.000-00'}
                />
                {brDocument(form.document).type === 'CNPJ' &&
                  brDocument(form.document).valid &&
                  lookupButton('Buscar dados da empresa', () => lookupCNPJ('client', form.document, true))}
              </Field>
              <LookupNote note={notes.client} onClose={() => note('client', null)} />
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
                <input
                  {...props('zip')}
                  maxLength={9}
                  inputMode="numeric"
                  placeholder="00000-000"
                  onBlur={e => {
                    if (settings.cepLookupEnabled) void lookupCEP(e.target.value);
                  }}
                />
                {String(form.zip || '').replace(/\D/g, '').length === 8 &&
                  lookupButton('Buscar endereço', () => lookupCEP(form.zip, true))}
              </Field>
              <LookupNote note={notes.cep} onClose={() => note('cep', null)} />
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
              <div className="full">
                <Toggle
                  checked={form.whatsappProgressConsent === true}
                  onChange={v => setForm(current => ({ ...current, whatsappProgressConsent: v }))}
                  title="Autoriza consultar o andamento pelo WhatsApp"
                  description="O cliente poderá pedir o andamento do processo por mensagem, depois de informar o CPF. Só vale para o número cadastrado."
                />
              </div>
              <div className="full">
                <Toggle
                  checked={form.campaignOptOut === true}
                  onChange={v => setForm(current => ({ ...current, campaignOptOut: v }))}
                  title="Não receber campanhas por WhatsApp"
                  description="Marcado quando o cliente responde SAIR. Avisos sobre o processo, como audiências, continuam."
                />
              </div>
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
                    if (parsed?.valid && settings.caseLookupEnabled) void lookupCase(parsed.formatted);
                  }}
                />
                {parseCNJ(form.number)?.valid && lookupButton('Buscar no DataJud', () => lookupCase(form.number, true))}
              </Field>
              <LookupNote note={notes.case} onClose={() => note('case', null)} />
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
                <input
                  {...documentProps('opposingDocument')}
                  onBlur={e => {
                    documentProps('opposingDocument').onBlur(e);
                    if (settings.cnpjLookupEnabled) void lookupCNPJ('opposing', e.target.value);
                  }}
                  maxLength={32}
                />
                {brDocument(form.opposingDocument).type === 'CNPJ' &&
                  brDocument(form.opposingDocument).valid &&
                  lookupButton('Buscar dados da empresa', () => lookupCNPJ('opposing', form.opposingDocument, true))}
              </Field>
              <LookupNote note={notes.opposing} onClose={() => note('opposing', null)} />
              {!item?.id && form.opposingParty?.trim() && (
                <label className="check-row full">
                  <input type="checkbox" checked={addPerson} onChange={e => setAddPerson(e.target.checked)} />
                  Cadastrar também a parte contrária em Pessoas, vinculada a este processo
                </label>
              )}
              <Field label="Advogado da parte contrária" optional>
                <input {...props('opposingLawyer')} maxLength={160} />
              </Field>
              <Field label="OAB do advogado contrário" optional>
                <input {...props('opposingLawyerOab')} maxLength={20} placeholder="12345/GO" />
              </Field>
              <Conflicts list={conflicts} />
              <Section>Prescrição</Section>
              <Field label="Data do fato ou fim do contrato" optional>
                <input {...props('factDate')} type="date" min="1900-01-01" max="9999-12-31" />
              </Field>
              <Field
                label="Regra de prescrição"
                optional
                hint={(() => {
                  const l = caseLimitation(form, new Date().toISOString().slice(0, 10));
                  if (l)
                    return {
                      tone: l.days <= 90 ? 'danger' : 'muted',
                      text: `${l.days < 0 ? 'Prescreveu em' : 'Prescreve em'} ${l.deadline.split('-').reverse().join('/')}${l.days >= 0 ? ` (faltam ${l.days} dias)` : ''}. O aviso aparece no início a 90 dias, enquanto o processo não tiver número.`,
                    };
                  return suggestedRule(form.area) && !form.limitationRule
                    ? {
                        tone: 'muted',
                        text:
                          'Sugestão para a área: ' + limitationRules.find(r => r.id === suggestedRule(form.area)).label,
                      }
                    : null;
                })()}
              >
                <select {...props('limitationRule')}>
                  <option value="">Não controlar</option>
                  {limitationRules.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
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
                  {['Prazo', 'Audiência', 'Perícia', 'Reunião', 'Diligência', 'Tarefa'].map(a => (
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
              {!item?.id ? (
                <>
                  <Field label="Repetir" optional>
                    <select {...props('repeat')}>
                      <option value="">Não repete</option>
                      {Object.entries(repeatOptions).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {form.repeat && (
                    <Field label="Repetir até" hint={{ tone: 'muted', text: 'Até 60 compromissos por série.' }}>
                      <input {...props('repeatUntil')} type="date" required min={String(form.due).slice(0, 10)} />
                    </Field>
                  )}
                </>
              ) : (
                item.seriesId && (
                  <label className="check-row full">
                    <input
                      type="checkbox"
                      checked={form.applyToSeries === true}
                      onChange={e => setForm(current => ({ ...current, applyToSeries: e.target.checked }))}
                    />
                    Aplicar também aos próximos compromissos desta série (as datas de cada um são mantidas)
                  </label>
                )
              )}
              {process}
              {client}
              {eventTypes.includes(form.type) && (
                <>
                  <Section>Detalhes do compromisso</Section>
                  <Field label="Espécie" optional>
                    <select {...props('eventKind')}>
                      <option value="">Não informar</option>
                      {(eventKinds[form.type] || []).map(k => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Modalidade" optional>
                    <select {...props('modality')}>
                      <option value="">Não informar</option>
                      <option value="presencial">Presencial</option>
                      <option value="virtual">Videoconferência</option>
                    </select>
                  </Field>
                  <Field label="Local ou endereço" full optional>
                    <input {...props('place')} maxLength={200} placeholder="Fórum, sala, endereço da perícia..." />
                  </Field>
                  {form.modality === 'virtual' && (
                    <Field label="Link da sala virtual" full optional>
                      <input {...props('roomLink')} type="url" maxLength={300} placeholder="https://..." />
                    </Field>
                  )}
                  <Field
                    label="Orientações ao cliente"
                    full
                    optional
                    hint={{ tone: 'muted', text: 'Vão na mensagem: o que levar, chegar mais cedo, vestimenta...' }}
                  >
                    <input {...props('clientNotes')} maxLength={500} />
                  </Field>
                  <Section>Aviso ao cliente</Section>
                  <div className="full">
                    <Toggle
                      checked={form.clientReminder === true}
                      onChange={v => setForm(current => ({ ...current, clientReminder: v }))}
                      title="Avisar o cliente por WhatsApp"
                      description="Ao salvar, o programa mostra a confirmação e os lembretes para você conferir antes de agendar. Se o compromisso mudar ou for excluído, os avisos são refeitos ou cancelados."
                    />
                  </div>
                  {form.clientReminder && (
                    <>
                      <Field label="Horário dos lembretes de dias antes" hint={noticeHint(form, data)}>
                        <input {...props('reminderTime')} type="time" required />
                      </Field>
                      {item?.confirmationStatus && (
                        <div className="field">
                          <span>Confirmação do cliente</span>
                          <strong>{confirmationLabels[item.confirmationStatus]}</strong>
                        </div>
                      )}
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
                <input
                  {...documentProps('document')}
                  onBlur={e => {
                    documentProps('document').onBlur(e);
                    if (settings.cnpjLookupEnabled) void lookupCNPJ('person', e.target.value);
                  }}
                  maxLength={32}
                />
                {brDocument(form.document).type === 'CNPJ' &&
                  brDocument(form.document).valid &&
                  lookupButton('Buscar dados da empresa', () => lookupCNPJ('person', form.document, true))}
              </Field>
              <LookupNote note={notes.person} onClose={() => note('person', null)} />
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
                <input
                  {...documentProps('document')}
                  onBlur={e => {
                    documentProps('document').onBlur(e);
                    if (settings.cnpjLookupEnabled) void lookupCNPJ('person', e.target.value);
                  }}
                  maxLength={32}
                />
                {brDocument(form.document).type === 'CNPJ' &&
                  brDocument(form.document).valid &&
                  lookupButton('Buscar dados da empresa', () => lookupCNPJ('person', form.document, true))}
              </Field>
              <LookupNote note={notes.person} onClose={() => note('person', null)} />
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
