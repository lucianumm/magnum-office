import { useState } from 'react';
import { Copy, MessageCircle, FileDown } from 'lucide-react';
import { Button, Modal } from './components.jsx';
import { clientReport } from '../../app/client-report.mjs';

// Draft of a case summary for the client. The lawyer edits it before copying, sending or saving.
export default function ClientReport({ data, act, caseItem, movements, composeMessage, onClose }) {
  const client = data.entities.clients.find(c => c.id === caseItem.clientId);
  const [text, setText] = useState(() =>
    clientReport({
      caseItem,
      client,
      movements,
      tasks: data.entities.tasks.filter(t => t.caseId === caseItem.id),
      settings: data.settings,
    }),
  );
  const phone = String(client?.phone || '').replace(/\D/g, '');
  return (
    <Modal wide title="Relatório ao cliente" subtitle="Revise e ajuste o texto antes de enviar." onClose={onClose}>
      <div className="settings-body">
        <textarea
          className="report-text"
          aria-label="Texto do relatório"
          value={text}
          maxLength={20000}
          onChange={e => setText(e.target.value)}
        />
        <p className="help-text">
          Entram as últimas movimentações explicadas em linguagem simples e as próximas audiências e reuniões. Prazos
          internos do escritório não aparecem.
        </p>
      </div>
      <div className="form-footer">
        <span>{client ? client.name : 'Processo sem cliente vinculado'}</span>
        <div>
          <Button
            tone="secondary"
            icon={Copy}
            onClick={() =>
              act(async () => {
                await navigator.clipboard.writeText(text);
                return 'Relatório copiado.';
              })
            }
          >
            Copiar
          </Button>
          <Button
            tone="secondary"
            icon={FileDown}
            onClick={() =>
              act(
                () => window.advocacia.saveTextReport({ caseId: caseItem.id, text }),
                'Relatório salvo em PDF nos documentos do processo.',
              )
            }
          >
            Salvar PDF
          </Button>
          {phone && (
            <Button
              icon={MessageCircle}
              onClick={() => {
                onClose();
                composeMessage({
                  channel: 'whatsapp',
                  clientId: client.id,
                  caseId: caseItem.id,
                  recipient: phone,
                  body: text,
                });
              }}
            >
              Enviar por WhatsApp
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
