import { useState } from 'react';
import { Save } from 'lucide-react';
import BirthdayFields from './BirthdayFields.jsx';
import { Modal, Button, dayKey } from './components.jsx';

const info = {
  clients: ['cliente', 'clientes'],
  cases: ['processo', 'processos'],
  tasks: ['compromisso', 'compromissos'],
  notes: ['anotação', 'anotações'],
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
  status: kind === 'clients' ? 'Ativo' : kind === 'cases' ? 'Em andamento' : 'Pendente',
  due: dayKey(new Date()) + 'T09:00',
  type: 'Prazo',
  priority: 'Normal',
  content: '',
});
function Field({ label, children, full = false, optional = false }) {
  return (
    <label className={'field ' + (full ? 'full' : '')}>
      <span>
        {label}
        {optional && <small>opcional</small>}
      </span>
      {children}
    </label>
  );
}
const Section = ({ children }) => <div className="form-section">{children}</div>;
export default function EntityForm({ kind, item, data, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...initial(kind), ...item }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const props = name => ({
    value: form[name] || '',
    onChange: e => setForm(current => ({ ...current, [name]: e.target.value })),
  });
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
              <Field label="CPF / CNPJ" optional>
                <input {...props('document')} maxLength={32} placeholder="Documento do cliente" />
              </Field>
              <Field label="Situação">
                <select {...props('status')}>
                  <option>Ativo</option>
                  <option>Inativo</option>
                </select>
              </Field>
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
              <Field label="Endereço" full optional>
                <input {...props('address')} maxLength={500} placeholder="Rua, número, cidade e estado" />
              </Field>
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
              <Field label="Número do processo" optional>
                <input {...props('number')} maxLength={40} placeholder="0000000-00.0000.0.00.0000" />
              </Field>
              {client}
              <Field label="Área de atuação">
                <select {...props('area')}>
                  {['Cível', 'Trabalhista', 'Família', 'Previdenciário', 'Tributário', 'Criminal', 'Outros'].map(a => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Situação">
                <select {...props('status')}>
                  {['Em andamento', 'Aguardando', 'Concluído', 'Arquivado'].map(a => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
              <Field label="Vara / Tribunal" full optional>
                <input {...props('court')} maxLength={200} placeholder="Órgão em que o processo tramita" />
              </Field>
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
          {kind !== 'notes' && (
            <Field label="Observações" full optional>
              <textarea
                aria-label="Observações"
                {...props('notes')}
                rows={3}
                maxLength={12000}
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
