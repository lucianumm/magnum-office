import { useState } from 'react';
import { PenLine, ArrowRight } from 'lucide-react';
import { Button, Panel } from './components.jsx';

// Signs a PDF with the office's ICP-Brasil A1 certificate (PAdES). The certificate file and its
// password are used only for this signature; nothing is kept or sent.
export default function SignPDF({ act }) {
  const [files, setFiles] = useState(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('Assinatura digital');
  const [holder, setHolder] = useState(null);
  const [done, setDone] = useState(null);
  return (
    <Panel title="Assinar PDF com certificado A1" icon={PenLine} className="pdf-action-card">
      <div className="settings-body">
        <p>
          Assinatura digital no padrão PAdES com o certificado ICP-Brasil A1 (.pfx). O certificado e a senha são usados
          só neste computador e não ficam guardados.
        </p>
        {!files ? (
          <Button
            icon={ArrowRight}
            onClick={async () => {
              const chosen = await act(() => window.advocacia.chooseSignFiles());
              if (chosen) {
                setFiles(chosen);
                setHolder(null);
                setDone(null);
              }
            }}
          >
            Escolher PDF e certificado
          </Button>
        ) : (
          <form
            className="sign-form"
            onSubmit={async e => {
              e.preventDefault();
              const result = await act(() => window.advocacia.signPdf({ password, reason }), 'PDF assinado.');
              if (result) {
                setDone(result);
                setFiles(null);
                setPassword('');
              }
            }}
          >
            <div className="pdf-input-note">
              {files.pdf} · certificado {files.cert}
            </div>
            <label className="field">
              <span>Senha do certificado</span>
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onBlur={async () => {
                  if (!password) return;
                  try {
                    setHolder(await window.advocacia.certificateInfo(password));
                  } catch (error) {
                    setHolder({ error: error.message });
                  }
                }}
              />
              {holder && (
                <small className={holder.error ? 'danger-text' : 'muted'}>
                  {holder.error ||
                    `${holder.name} · válido até ${new Date(holder.validTo).toLocaleDateString('pt-BR')} · ${holder.issuer}`}
                </small>
              )}
            </label>
            <label className="field">
              <span>Motivo</span>
              <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} />
            </label>
            <div className="heading-actions">
              <Button type="submit" disabled={!password}>
                Assinar e salvar
              </Button>
              <Button tone="ghost" type="button" onClick={() => setFiles(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {done && (
          <small className="muted">
            Assinado por {done.signer}. Salvo em {done.file}.
          </small>
        )}
      </div>
    </Panel>
  );
}
