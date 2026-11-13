import { useEffect, useState } from 'react';
import { Inbox as InboxIcon, Check, MessageCircle } from 'lucide-react';
import { Button, Panel, Badge, dateTime } from './components.jsx';

// WhatsApp messages from clients: what they wrote, who they are and a way to answer or mark as handled.
export default function InboxPanel({ data, act, reload, composeMessage }) {
  const [items, setItems] = useState([]);
  const [all, setAll] = useState(false);
  const load = () =>
    window.advocacia
      .inboxList()
      .then(setItems)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, [data.messages.length, data.settings.waInboxEnabled]);
  if (!data.settings.waInboxEnabled) return null;
  const clients = new Map(data.entities.clients.map(c => [c.id, c]));
  const shown = items.filter(i => all || i.status === 'new').slice(0, 30);
  const fresh = items.filter(i => i.status === 'new').length;
  return (
    <Panel
      title={`Mensagens recebidas${fresh ? ` · ${fresh} nova(s)` : ''}`}
      icon={InboxIcon}
      aside={
        <Button tone="ghost" onClick={() => setAll(!all)}>
          {all ? 'Só as novas' : 'Mostrar todas'}
        </Button>
      }
    >
      {shown.length ? (
        <div className="table-scroll">
          <table>
            <tbody>
              {shown.map(m => {
                const client = clients.get(m.clientId);
                return (
                  <tr key={m.id}>
                    <td>{dateTime(m.at)}</td>
                    <td>
                      <div className="cell-stack">
                        <strong>{client ? client.name : 'Número desconhecido'}</strong>
                        <span>{m.phone || 'sem número'}</span>
                      </div>
                    </td>
                    <td>{m.text || (m.media ? 'Arquivo ou áudio recebido (não baixado)' : '')}</td>
                    <td>
                      <Badge tone={m.status === 'new' ? 'amber' : 'neutral'}>
                        {m.status === 'new' ? 'Nova' : 'Tratada'}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {m.phone && (
                          <Button
                            tone="secondary"
                            icon={MessageCircle}
                            onClick={() =>
                              composeMessage({ channel: 'whatsapp', recipient: m.phone, clientId: m.clientId })
                            }
                          >
                            Responder
                          </Button>
                        )}
                        {m.status === 'new' && (
                          <Button
                            tone="ghost"
                            icon={Check}
                            onClick={() =>
                              act(() => window.advocacia.setInboxStatus({ id: m.id, status: 'handled' })).then(() => {
                                void load();
                                return reload();
                              })
                            }
                          >
                            Tratada
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="help-text settings-body">Nenhuma mensagem nova.</p>
      )}
    </Panel>
  );
}
