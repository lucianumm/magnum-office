import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button, Modal, Toggle, dateTime } from './components.jsx';

// Shown after saving a hearing, expert exam, meeting or errand with "avisar o cliente": what will be sent
// (confirmation now, reminders before) with the texts ready to edit, before anything is queued.
export default function EventNotice({ id, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [choice, setChoice] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    window.advocacia
      .previewEventNotice(id)
      .then(p => {
        if (!live) return;
        setPreview(p);
        if (p.eligible)
          setChoice({
            confirmation: !p.confirmationSent,
            confirmationBody: p.confirmationBody,
            reminderBody: p.reminderBody,
            offsets: p.reminders.filter(r => r.selected).map(r => r.key),
          });
      })
      .catch(e => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);
  const toggleOffset = key =>
    setChoice(c => ({
      ...c,
      offsets: c.offsets.includes(key) ? c.offsets.filter(k => k !== key) : [...c.offsets, key],
    }));
  async function apply() {
    setBusy(true);
    setError('');
    try {
      const result = await window.advocacia.applyEventNotice({ id, choice });
      onDone(result);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Avisar o cliente"
      subtitle={preview ? `${preview.type}: ${preview.title}` : 'Carregando...'}
      onClose={onClose}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && !preview.eligible && (
        <>
          <p className="help-text settings-body">{preview.reason}</p>
          <div className="form-footer">
            <span />
            <Button onClick={onClose}>Entendi</Button>
          </div>
        </>
      )}
      {preview?.eligible && choice && (
        <>
          <div className="settings-body notice-body">
            <p className="help-text">
              Mensagens para <strong>{preview.client.name}</strong> ({preview.client.phone}). Elas entram na fila de
              Mensagens e seguem as regras de envio: só saem no horário e nos limites definidos em WhatsApp.
            </p>
            <Toggle
              checked={choice.confirmation}
              onChange={v => setChoice(c => ({ ...c, confirmation: v }))}
              title={preview.confirmationSent ? 'Enviar a confirmação de novo' : 'Enviar a confirmação agora'}
              description={
                preview.confirmationSent
                  ? 'A confirmação já foi enviada antes.'
                  : 'O cliente recebe a data, o horário e o local e pode responder para confirmar a presença.'
              }
            />
            {choice.confirmation && (
              <label className="field full">
                <span>Texto da confirmação</span>
                <textarea
                  rows={6}
                  maxLength={4000}
                  value={choice.confirmationBody}
                  onChange={e => setChoice(c => ({ ...c, confirmationBody: e.target.value }))}
                />
              </label>
            )}
            <fieldset className="notice-reminders">
              <legend>Lembretes antes do compromisso</legend>
              {preview.reminders.map(r => (
                <label key={r.key} className={'check-row' + (r.past ? ' muted' : '')}>
                  <input
                    type="checkbox"
                    checked={choice.offsets.includes(r.key)}
                    disabled={r.past}
                    onChange={() => toggleOffset(r.key)}
                  />
                  {r.label}
                  {r.past ? ' (já passou)' : ` — ${dateTime(r.scheduledFor)}`}
                </label>
              ))}
            </fieldset>
            {choice.offsets.length > 0 && (
              <label className="field full">
                <span>Texto dos lembretes</span>
                <textarea
                  rows={5}
                  maxLength={4000}
                  value={choice.reminderBody}
                  onChange={e => setChoice(c => ({ ...c, reminderBody: e.target.value }))}
                />
              </label>
            )}
            <small className="field-hint muted">
              Se o compromisso for remarcado ou excluído, os lembretes são refeitos ou cancelados e o aviso ao cliente
              fica esperando a sua aprovação em Mensagens.
            </small>
          </div>
          <div className="form-footer">
            <Button tone="ghost" onClick={onClose}>
              Agora não
            </Button>
            <Button
              icon={MessageCircle}
              disabled={busy || (!choice.confirmation && !choice.offsets.length)}
              onClick={apply}
            >
              {busy ? 'Agendando...' : 'Agendar avisos'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
