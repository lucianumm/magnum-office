import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button, Panel, Toggle } from './components.jsx';

// Optional password for the program, with automatic locking.
export default function LockSettings({ act }) {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const load = () =>
    window.advocacia
      .lockConfig()
      .then(setConfig)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  if (!config) return null;
  const set = patch => setForm(f => ({ ...f, ...patch }));
  async function savePassword(e) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      await act(() => Promise.reject(new Error('A confirmação não confere com a nova senha.')));
      return;
    }
    const result = await act(
      () => window.advocacia.setLockPassword({ current: form.current, password: form.password }),
      config.enabled ? 'Senha alterada.' : 'Senha do programa ativada.',
    );
    if (result) {
      setForm({ current: '', password: '', confirm: '' });
      setConfig(result);
    }
  }
  return (
    <Panel title="Senha do programa" icon={Lock}>
      <form className="settings-body" onSubmit={savePassword}>
        <p className="help-text">
          Opcional. Com a senha, o programa pede a senha ao abrir e depois do tempo sem uso escolhido. Os envios
          agendados continuam funcionando enquanto ele está bloqueado; a API de agentes fica parada.{' '}
          <strong>Se esquecer a senha, os dados só voltam por um backup portátil e a senha dele.</strong>
        </p>
        <div className="form-grid">
          {config.enabled && (
            <label className="field">
              <span>Senha atual</span>
              <input
                type="password"
                autoComplete="current-password"
                value={form.current}
                onChange={e => set({ current: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>{config.enabled ? 'Nova senha' : 'Senha'}</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              maxLength={200}
              value={form.password}
              onChange={e => set({ password: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Confirme a senha</span>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={e => set({ confirm: e.target.value })}
            />
          </label>
        </div>
        <div className="heading-actions">
          <Button type="submit" disabled={!form.password}>
            {config.enabled ? 'Trocar senha' : 'Ativar senha'}
          </Button>
          {config.enabled && (
            <>
              <Button
                tone="secondary"
                type="button"
                onClick={() => act(() => window.advocacia.lockApp(), 'Programa bloqueado.')}
              >
                Bloquear agora
              </Button>
              <Button
                tone="ghost"
                type="button"
                disabled={!form.current}
                onClick={async () => {
                  const result = await act(
                    () => window.advocacia.disableLock({ current: form.current }),
                    'Senha do programa desativada.',
                  );
                  if (result) setConfig(result);
                }}
              >
                Desativar senha
              </Button>
            </>
          )}
        </div>
        {config.enabled && (
          <>
            <label className="field">
              <span>Bloquear depois de</span>
              <select
                value={config.idleMinutes}
                onChange={async e => {
                  const result = await act(() =>
                    window.advocacia.configureLock({ idleMinutes: Number(e.target.value), onHide: config.onHide }),
                  );
                  if (result) setConfig(result);
                }}
              >
                <option value={0}>Só ao abrir o programa</option>
                {[5, 10, 15, 30, 60].map(m => (
                  <option key={m} value={m}>
                    {m} minutos sem uso do computador
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              checked={config.onHide}
              onChange={async value => {
                const result = await act(() =>
                  window.advocacia.configureLock({ idleMinutes: config.idleMinutes, onHide: value }),
                );
                if (result) setConfig(result);
              }}
              title="Bloquear ao fechar para a bandeja"
              description="Também bloqueia quando o Windows bloqueia a sessão."
            />
          </>
        )}
      </form>
    </Panel>
  );
}
