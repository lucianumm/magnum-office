import { Cake, MessageCircle } from 'lucide-react';
import { Toggle, dayKey } from './components.jsx';
import { personalizeMessage, messageVariables } from '../../app/message-variables.mjs';
export default function BirthdayFields({ form, setForm, data }) {
  const models = data.library.templates.filter(t => t.kind === 'whatsapp' && t.purpose === 'birthday');
  const model = models.find(t => t.id === form.birthdayTemplateId);
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  return (
    <section className="birthday-fields full">
      <div className="birthday-heading">
        <Cake size={18} />
        <div>
          <strong>Aniversário do cliente</strong>
          <small>Cadastre a data e escolha se deseja enviar uma felicitação pelo WhatsApp.</small>
        </div>
      </div>
      <label className="field">
        <span>
          Data de nascimento <small>opcional</small>
        </span>
        <input
          aria-label="Data de nascimento"
          type="date"
          value={form.birthDate || ''}
          min="1900-01-01"
          max={dayKey(new Date())}
          required={form.birthdayEnabled}
          onChange={e => set('birthDate', e.target.value)}
        />
      </label>
      <Toggle
        checked={form.birthdayEnabled === true}
        onChange={v =>
          setForm(f => ({ ...f, birthdayEnabled: v, birthdayTemplateId: f.birthdayTemplateId || models[0]?.id || '' }))
        }
        title="Enviar mensagem de aniversário automaticamente"
        description="Ative somente para clientes que podem receber essa comunicação."
      />
      {form.birthdayEnabled && (
        <>
          <div className="form-grid">
            <label className="field">
              <span>Modelo de aniversário</span>
              <select
                aria-label="Modelo de aniversário"
                required
                value={form.birthdayTemplateId || ''}
                onChange={e => set('birthdayTemplateId', e.target.value)}
              >
                <option value="">Selecione um modelo...</option>
                {models.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Horário do envio</span>
              <input
                aria-label="Horário de aniversário"
                type="time"
                required
                value={form.birthdayTime || '09:00'}
                onChange={e => set('birthdayTime', e.target.value)}
              />
            </label>
          </div>
          {!models.length && (
            <p className="notice amber-notice">
              Cadastre um modelo de WhatsApp em Documentos e modelos e escolha a finalidade Mensagem aniversário.
            </p>
          )}
          {model && (
            <div className="birthday-preview">
              <strong>
                <MessageCircle size={15} />
                Prévia da mensagem
              </strong>
              <p>{personalizeMessage(model.body, form, data.settings)}</p>
            </div>
          )}
          <p className="help-text">
            Uma mensagem por cliente e por ano. Se abrir depois do horário, o envio pode ocorrer no mesmo dia;
            aniversários de dias anteriores não são enviados automaticamente. Quem nasceu em 29/02 recebe em 28/02 nos
            anos sem esse dia. Horário deste computador. O sistema precisa ficar aberto ou na bandeja, com WhatsApp
            conectado.
          </p>
        </>
      )}
      {form.birthdayEnabled && (
        <div className="birthday-variable-help">
          {messageVariables.map(([token, label]) => (
            <span key={token}>
              <code>{token}</code> {label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
