import { useState } from 'react';
import {
  MessageCircle,
  Mail,
  Send,
  Plus,
  RefreshCw,
  X,
  Link2,
  Unplug,
  Settings2,
  CalendarClock,
  Pencil,
  Pause,
  Play,
  CalendarX2,
} from 'lucide-react';
import { PageHeading, Button, Panel, Empty, Badge, Modal, dateTime, plural } from './components.jsx';

export const messageLabels = {
  pending: 'Pendente',
  sending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falha',
  uncertain: 'Verificar envio',
  cancelled: 'Cancelada',
  needs_review: 'Revisão necessária',
};
const waLabels = {
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando leitura',
  connected: 'Conectado',
  error: 'Erro na conexão',
  'logged-out': 'Sessão encerrada',
};
export default function Messages({ data, act, reload, composeMessage, navigateSettings }) {
  const [filter, setFilter] = useState('all');
  const [showQR, setShowQR] = useState(false);
  const [view, setView] = useState('all');
  const messages = data.messages.filter(
    m =>
      (filter === 'all' || m.channel === filter) &&
      (view === 'all' ||
        (view === 'scheduled'
          ? m.scheduledFor && m.status === 'pending'
          : ['uncertain', 'failed', 'needs_review'].includes(m.status))),
  );
  const wa = data.services.whatsapp;
  const queued = data.messages.filter(m => m.status === 'pending').length;
  const attention = data.messages.filter(m => ['uncertain', 'failed', 'needs_review'].includes(m.status)).length;
  const connected = wa.status === 'connected';
  return (
    <>
      <PageHeading title="Mensagens">
        <Button tone="secondary" icon={CalendarClock} onClick={() => composeMessage({ scheduleDate: '' }, true)}>
          Agendar WhatsApp
        </Button>
        <Button tone="secondary" icon={Mail} onClick={() => composeMessage({ bulk: true, channel: 'email' })}>
          Campanha de e-mail
        </Button>
        <Button icon={Plus} onClick={() => composeMessage()}>
          Nova mensagem
        </Button>
      </PageHeading>
      <div className="connection-strip">
        <div className="connection-item">
          <MessageCircle size={18} />
          <div>
            <strong>WhatsApp</strong> <Badge tone={connected ? 'green' : 'neutral'}>{waLabels[wa.status]}</Badge>
            <small>{data.settings.whatsappAutoConnect ? 'Reconexão automática ativada' : 'Reconexão manual'}</small>
          </div>
          <Button
            tone="secondary"
            icon={connected ? Unplug : Link2}
            onClick={() =>
              connected
                ? act(() => window.advocacia.disconnectWhatsApp(), 'WhatsApp desconectado.')
                : act(async () => {
                    await window.advocacia.connectWhatsApp();
                    setShowQR(true);
                    await reload();
                  })
            }
          >
            {connected ? 'Desconectar' : 'Conectar WhatsApp'}
          </Button>
        </div>
        <div className="connection-item">
          <Mail size={18} />
          <div>
            <strong>E-mail</strong>{' '}
            <Badge tone={data.services.email === 'configured' ? 'green' : 'amber'}>
              {data.services.email === 'configured' ? 'Configurado' : 'Pendente'}
            </Badge>
            <small>{data.settings.emailFrom || 'Informe domínio, endereço e API Key'}</small>
          </div>
          <Button tone="secondary" icon={Settings2} onClick={() => navigateSettings('email')}>
            Configurar e-mail
          </Button>
        </div>
      </div>
      {!connected && (
        <div className="whatsapp-guide">
          <h2>WhatsApp automático em 3 passos</h2>
          <ol>
            <li>
              <strong>Conecte seu celular.</strong> Clique em Conectar WhatsApp e leia o QR Code em Dispositivos
              conectados.
            </li>
            <li>
              <strong>Agende a mensagem.</strong> Escolha um cliente, escreva ou aplique um modelo e selecione data e
              hora.
            </li>
            <li>
              <strong>Deixe o programa funcionando.</strong> Mantenha o computador ligado, conectado e o programa aberto
              ou na bandeja.
            </li>
          </ol>
          <small>
            Cada instalação tem sua própria conexão Baileys e dados locais. Nenhuma sessão é compartilhada com outros
            usuários.
          </small>
        </div>
      )}
      {data.settings.queuePaused && (
        <div className="notice amber-notice">
          <Pause size={16} />A fila está pausada. Nenhum novo envio será iniciado até você retomá-la. Um envio já em
          andamento será concluído.
        </div>
      )}
      {data.messages.some(m => m.status === 'uncertain' || m.status === 'needs_review') && (
        <div className="notice amber-notice">
          Revise envios com resultado incerto e disparos que perderam o horário. Reagende para evitar mensagens antigas
          ou duplicadas.
        </div>
      )}
      <Panel
        title={`Fila de mensagens · ${plural(queued, 'pendente')}`}
        aside={
          <Button
            tone="secondary"
            icon={data.settings.queuePaused ? Play : Pause}
            onClick={() =>
              act(
                () => window.advocacia.saveSettings({ queuePaused: !data.settings.queuePaused }),
                data.settings.queuePaused ? 'Fila de envios retomada.' : 'Novos envios pausados.',
              )
            }
          >
            {data.settings.queuePaused ? 'Retomar envios' : 'Pausar envios'}
          </Button>
        }
      >
        <div className="queue-filters">
          <div className="tabs message-view-tabs">
            {[
              ['all', 'Todos os envios'],
              ['scheduled', 'Agendados'],
              ['review', `Precisam de atenção${attention ? ` (${attention})` : ''}`],
            ].map(([id, name]) => (
              <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                {name}
              </button>
            ))}
          </div>
          <div className="segmented">
            {[
              ['all', 'Todas'],
              ['whatsapp', 'WhatsApp'],
              ['email', 'E-mail'],
            ].map(([id, name]) => (
              <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        {messages.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mensagem / destinatário</th>
                  <th>Canal</th>
                  <th>Quando enviar</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="cell-stack">
                        <strong>{m.subject || m.body.slice(0, 65)}</strong>
                        <span>{m.recipient}</span>
                        {m.autoBirthday && <small>🎂 Mensagem aniversário · {m.birthdayYear}</small>}
                        {m.seriesId && (
                          <small>
                            Recorrência · {m.seriesIndex}/{m.seriesCount}
                          </small>
                        )}
                        {m.clientId && (
                          <small>
                            {data.entities.clients.find(c => c.id === m.clientId)?.name || 'Cliente vinculado'}
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="channel-label">
                        {m.channel === 'email' ? <Mail size={14} /> : <MessageCircle size={14} />}
                        {m.channel === 'email' ? 'E-mail' : 'WhatsApp'}
                      </span>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <span>{m.scheduledFor ? dateTime(m.scheduledFor) : 'Assim que o canal conectar'}</span>
                        <small>
                          {m.sentAt ? 'Enviada: ' + dateTime(m.sentAt) : 'Criada: ' + dateTime(m.createdAt)}
                        </small>
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          m.status === 'sent'
                            ? 'green'
                            : ['failed', 'uncertain', 'needs_review'].includes(m.status)
                              ? 'red'
                              : m.scheduledFor
                                ? 'amber'
                                : 'neutral'
                        }
                      >
                        {m.status === 'pending' && m.scheduledFor ? 'Agendada' : messageLabels[m.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {m.seriesId && ['pending', 'failed', 'needs_review', 'uncertain'].includes(m.status) && (
                          <button
                            className="icon-button danger"
                            aria-label={`Cancelar recorrência para ${m.recipient}`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Cancelar os envios ainda não iniciados desta recorrência? Envios concluídos ou em andamento serão preservados.',
                                )
                              )
                                act(() => window.advocacia.cancelMessageSeries(m.id), 'Recorrência cancelada.');
                            }}
                          >
                            <CalendarX2 size={15} />
                          </button>
                        )}
                        {['pending', 'failed', 'needs_review', 'cancelled'].includes(m.status) && (
                          <button
                            className="icon-button"
                            aria-label={`Editar disparo para ${m.recipient}`}
                            onClick={() => composeMessage(m)}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        {['failed', 'uncertain', 'cancelled'].includes(m.status) && !m.scheduledFor && (
                          <button
                            className="icon-button"
                            aria-label="Reenviar mensagem"
                            onClick={() => {
                              if (
                                m.status === 'uncertain' &&
                                !window.confirm(
                                  'O envio pode ter sido concluído. Você já conferiu no serviço e deseja tentar novamente?',
                                )
                              )
                                return;
                              act(
                                () => window.advocacia.changeMessage({ id: m.id, action: 'retry' }),
                                'Mensagem recolocada na fila.',
                              );
                            }}
                          >
                            <RefreshCw size={15} />
                          </button>
                        )}
                        {['pending', 'failed', 'uncertain', 'needs_review'].includes(m.status) && (
                          <button
                            className="icon-button danger"
                            aria-label={`Cancelar mensagem para ${m.recipient}`}
                            onClick={() =>
                              act(
                                () => window.advocacia.changeMessage({ id: m.id, action: 'cancel' }),
                                'Mensagem cancelada.',
                              )
                            }
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Send}
            title="Nenhuma mensagem nesta visualização"
            description="Crie uma mensagem ou agende um disparo de WhatsApp para seus clientes."
            action={
              <Button tone="secondary" icon={CalendarClock} onClick={() => composeMessage({}, true)}>
                Agendar disparo
              </Button>
            }
          />
        )}
        <div className="table-footer">
          <span>{messages.length === 1 ? '1 mensagem' : `${messages.length} mensagens`} nesta visualização</span>
          <button className="text-link" onClick={() => navigateSettings('office')}>
            Ajustar tolerância e reconexão
          </button>
        </div>
      </Panel>
      {showQR && (
        <Modal
          title="Conectar WhatsApp"
          subtitle="No celular: Configurações → Dispositivos conectados → Conectar dispositivo."
          onClose={() => setShowQR(false)}
        >
          <div className="qr-content">
            {wa.qr ? (
              <img src={wa.qr} alt="QR Code para vincular o WhatsApp" />
            ) : (
              <>
                <MessageCircle size={40} strokeWidth={1.4} />
                <h3>{waLabels[wa.status]}</h3>
                <p>
                  {connected
                    ? 'O WhatsApp está pronto para os envios da fila.'
                    : 'Aguarde o QR Code. Se a conexão falhar, tente novamente.'}
                </p>
              </>
            )}
          </div>
          <div className="form-footer">
            <span>Baileys é uma integração não oficial do WhatsApp.</span>
            <div>
              <Button tone="secondary" onClick={() => setShowQR(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
