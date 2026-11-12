import { useEffect, useState } from 'react';
import { Copy, History } from 'lucide-react';
import { Button, dateTime } from './components.jsx';

const outcomes = {
  success: ['Concluída', 'green'],
  failed: ['Falhou e voltou à versão anterior', 'red'],
  aborted: ['Cancelada antes de instalar', 'amber'],
  running: ['Em andamento ou interrompida', 'amber'],
};

// The last attempt recorded by the update guardian (logs/recovery.jsonl), read on demand.
export default function UpdateAttempt({ act, refreshKey }) {
  const [attempt, setAttempt] = useState(undefined);
  useEffect(() => {
    let current = true;
    window.advocacia
      .updateAttempt()
      .then(value => current && setAttempt(value))
      .catch(() => current && setAttempt(null));
    return () => {
      current = false;
    };
  }, [refreshKey]);
  if (!attempt) return null;
  const [label, tone] = outcomes[attempt.outcome] || outcomes.running;
  return (
    <section className="notice subtle-notice update-attempt" aria-label="Última tentativa de atualização">
      <History size={18} />
      <div>
        <strong>
          Última tentativa: versão {attempt.version} · <span className={`attempt-${tone}`}>{label}</span>
        </strong>
        <ul>
          <li>Início: {dateTime(attempt.at)}</li>
          {attempt.step && (
            <li>
              Parou na {attempt.stepLabel}
              {attempt.foundVersion ? ` (a pasta continuou com a versão ${attempt.foundVersion})` : ''}
            </li>
          )}
          {attempt.folder && (
            <li>
              Pasta: <code>{attempt.folder}</code>
              {attempt.mode && attempt.mode !== 'registro'
                ? ` · ${attempt.mode === '/allusers' ? 'todos os usuários' : 'só para este usuário'}`
                : ''}
            </li>
          )}
          {attempt.installerCode !== null && <li>Código de saída do instalador: {attempt.installerCode}</li>}
        </ul>
        {attempt.outcome === 'failed' && (
          <small>
            Use Forçar atualização agora e depois Instalar manualmente. Se precisar de ajuda, copie o diagnóstico e
            envie ao suporte.
          </small>
        )}
        <div className="heading-actions">
          <Button
            tone="ghost"
            icon={Copy}
            onClick={() => act(() => window.advocacia.copyUpdateDiagnostic(), 'Diagnóstico copiado.')}
          >
            Copiar diagnóstico
          </Button>
        </div>
      </div>
    </section>
  );
}
