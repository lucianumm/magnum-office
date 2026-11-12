import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from './components.jsx';

// Shown instead of the program while it is locked. Nothing of the office is loaded behind it.
export default function LockScreen({ appName, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await window.advocacia.unlockApp(password);
      setPassword('');
      await onUnlocked();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <Lock size={28} />
        <h1>{appName || 'Magnum Office'} está bloqueado</h1>
        <p>Digite a senha do programa para continuar.</p>
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            maxLength={200}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy} disabled={!password}>
          Desbloquear
        </Button>
        <small>
          Esqueceu a senha? Os dados só podem ser recuperados por um backup portátil e a senha dele, em outra
          instalação.
        </small>
      </form>
    </main>
  );
}
