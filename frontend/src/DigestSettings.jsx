import { useEffect, useState } from 'react';
import { Sunrise } from 'lucide-react';
import { Button, Panel, Toggle } from './components.jsx';

// Morning summary sent to the office's own WhatsApp or e-mail.
export default function DigestSettings({ act }) {
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    window.advocacia
      .digestConfig()
      .then(setForm)
      .catch(() => {});
  }, []);
  if (!form) return null;
  const set = patch => setForm(f => ({ ...f, ...patch }));
  return (
    <Panel title="Resumo diário" icon={Sunrise}>
      <div className="settings-body">
        <p className="help-text">
          Uma mensagem por dia, no horário escolhido, com os prazos e compromissos do dia, os atrasados, as intimações
          novas e os honorários vencidos. Vai para o número ou e-mail do próprio escritório, pela fila de envio.
        </p>
        <Toggle
          checked={form.enabled}
          onChange={v => set({ enabled: v })}
          title="Enviar o resumo diário"
          description="Desligado por padrão. O programa precisa estar aberto ou na bandeja no horário."
        />
        <div className="form-grid">
          <label className="field">
            <span>Canal</span>
            <select value={form.channel} onChange={e => set({ channel: e.target.value })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </label>
          <label className="field">
            <span>{form.channel === 'email' ? 'E-mail do escritório' : 'WhatsApp (só números, com 55 e DDD)'}</span>
            <input
              value={form.recipient}
              maxLength={254}
              placeholder={form.channel === 'email' ? 'escritorio@exemplo.com' : '5564999990000'}
              onChange={e => set({ recipient: e.target.value.trim() })}
            />
          </label>
          <label className="field">
            <span>Horário</span>
            <input type="time" value={form.time} onChange={e => set({ time: e.target.value })} />
          </label>
        </div>
        <div className="heading-actions">
          <Button
            onClick={async () => {
              const saved = await act(() => window.advocacia.configureDigest(form), 'Resumo diário salvo.');
              if (saved) setForm(saved);
            }}
          >
            Salvar
          </Button>
          <Button
            tone="secondary"
            onClick={async () => {
              const text = await act(() => window.advocacia.previewDigest());
              if (typeof text === 'string') setPreview(text);
            }}
          >
            Ver o resumo de hoje
          </Button>
        </div>
        {preview && <pre className="digest-preview">{preview}</pre>}
      </div>
    </Panel>
  );
}
