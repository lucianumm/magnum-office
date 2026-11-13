import { useEffect, useState } from 'react';
import { MessageCircle, Eraser, Clock } from 'lucide-react';
import { Button, Panel, Toggle, bytes, dateTime } from './components.jsx';

const typeLabels = {
  session: 'Conversas (sessões)',
  'sender-key': 'Chaves de grupos',
  'sender-key-memory': 'Memória de grupos',
  'device-list': 'Lista de aparelhos',
  'pre-key': 'Chaves de segurança',
  'identity-key': 'Identidades',
  'app-state-sync-key': 'Sincronização',
  'app-state-sync-version': 'Versão da sincronização',
  'lid-mapping': 'Mapa de identificadores',
  tctoken: 'Tokens',
  creds: 'Credenciais',
  other: 'Outros',
};
const reasons = {
  window: 'fora do horário de envio',
  hourly: 'limite por hora atingido',
  daily: 'limite do dia atingido',
  delay: 'pausa entre mensagens',
  paused: 'envio pausado depois de falhas seguidas',
};
const hours = Array.from({ length: 24 }, (_, i) => i);

// WhatsApp: how much and when the program sends, what it keeps of the session and the inbox.
export default function WhatsAppSettings({ data, act, reload }) {
  const s = data.settings;
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    sendWindowStart: s.sendWindowStart,
    sendWindowEnd: s.sendWindowEnd,
    sendOnSaturday: s.sendOnSaturday,
    sendOnSunday: s.sendOnSunday,
    hourlyLimit: s.hourlyLimit,
    dailyLimit: s.dailyLimit,
    minDelaySec: s.minDelaySec,
    maxDelaySec: s.maxDelaySec,
  });
  const load = () =>
    window.advocacia
      .waStatus()
      .then(setStatus)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const num = key => ({
    type: 'number',
    value: form[key],
    onChange: e => setForm(f => ({ ...f, [key]: Number(e.target.value) })),
  });
  return (
    <>
      <Panel title="Quando e quanto enviar" icon={Clock}>
        <div className="settings-body">
          <p className="help-text">
            O WhatsApp pode bloquear um número que envia muita coisa de uma vez ou fora de hora. Estas regras valem para
            todas as mensagens automáticas: lembretes, aniversários, campanhas e respostas. O que sobrar espera a
            próxima janela. Use, de preferência, um número só do escritório.
          </p>
          {status && (
            <small className={'field-hint ' + (status.rules.allowed ? 'muted' : 'danger-text')}>
              {status.rules.allowed
                ? 'Agora o programa pode enviar.'
                : `Agora o envio espera: ${reasons[status.rules.reason] || status.rules.reason}${status.rules.retryAt ? `. Próxima chance: ${dateTime(status.rules.retryAt)}` : ''}.`}
            </small>
          )}
          <div className="form-grid">
            <label className="field">
              <span>Janela abre às</span>
              <select
                value={form.sendWindowStart}
                onChange={e => setForm(f => ({ ...f, sendWindowStart: Number(e.target.value) }))}
              >
                {hours.map(h => (
                  <option key={h} value={h}>{`${String(h).padStart(2, '0')}h`}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Janela fecha às</span>
              <select
                value={form.sendWindowEnd}
                onChange={e => setForm(f => ({ ...f, sendWindowEnd: Number(e.target.value) }))}
              >
                {hours
                  .slice(1)
                  .concat(24)
                  .map(h => (
                    <option key={h} value={h}>{`${String(h).padStart(2, '0')}h`}</option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Máximo por hora</span>
              <input {...num('hourlyLimit')} min={1} max={120} />
            </label>
            <label className="field">
              <span>Máximo por dia</span>
              <input {...num('dailyLimit')} min={1} max={1000} />
            </label>
            <label className="field">
              <span>Pausa mínima entre mensagens (s)</span>
              <input {...num('minDelaySec')} min={3} max={120} />
            </label>
            <label className="field">
              <span>Pausa máxima (s)</span>
              <input {...num('maxDelaySec')} min={3} max={300} />
            </label>
          </div>
          <Toggle
            checked={form.sendOnSaturday}
            onChange={v => setForm(f => ({ ...f, sendOnSaturday: v }))}
            title="Enviar aos sábados"
          />
          <Toggle
            checked={form.sendOnSunday}
            onChange={v => setForm(f => ({ ...f, sendOnSunday: v }))}
            title="Enviar aos domingos"
          />
          <div className="heading-actions">
            <Button
              icon={MessageCircle}
              onClick={async () => {
                const saved = await act(() => window.advocacia.saveSettings(form), 'Regras de envio salvas.');
                if (saved) await load();
              }}
            >
              Salvar regras
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="Mensagens recebidas" icon={MessageCircle}>
        <div className="settings-body">
          <Toggle
            checked={s.waInboxEnabled === true}
            onChange={async v => {
              await act(
                () => window.advocacia.saveSettings({ waInboxEnabled: v }),
                v ? 'Recebimento ligado.' : 'Recebimento desligado.',
              );
              await reload();
              await load();
            }}
            title="Receber mensagens dos clientes"
            description="Desligado por padrão. Ligado, o programa lê só texto de conversas individuais (nunca grupos, status ou canais), não baixa fotos, áudios nem documentos e guarda cada mensagem cifrada por 30 dias. É a base para a confirmação de presença e para as respostas automáticas."
          />
          {status?.inbox.enabled && (
            <small className="field-hint muted">Mensagens novas na caixa: {status.inbox.newCount}.</small>
          )}
        </div>
      </Panel>
      <Panel title="Limpeza da sessão" icon={Eraser}>
        <div className="settings-body">
          <p className="help-text">
            A sessão do WhatsApp só cresce com o tempo. A limpeza semanal remove o que o WhatsApp refaz sozinho (chaves
            de grupos, listas de aparelhos e conversas de números que não são clientes nem receberam mensagem há 90
            dias) e nunca mexe nas credenciais que mantêm o número conectado.
          </p>
          {status && (
            <>
              <table className="deadline-steps wa-hygiene">
                <tbody>
                  {Object.entries(status.hygiene.byType)
                    .sort((a, b) => b[1].bytes - a[1].bytes)
                    .map(([type, v]) => (
                      <tr key={type}>
                        <td>{typeLabels[type] || type}</td>
                        <td className="tabular numeric">{v.count}</td>
                        <td className="tabular numeric">{bytes(v.bytes)}</td>
                      </tr>
                    ))}
                  <tr className="labor-total">
                    <td>Total</td>
                    <td className="tabular numeric">{status.hygiene.total.count}</td>
                    <td className="tabular numeric">{bytes(status.hygiene.total.bytes)}</td>
                  </tr>
                </tbody>
              </table>
              <small className="field-hint muted">
                Última limpeza:{' '}
                {status.lastCleanup
                  ? `${dateTime(status.lastCleanup)} (${status.lastCleanupRemoved} removidos)`
                  : 'ainda não feita'}
                .
              </small>
            </>
          )}
          <div className="heading-actions">
            <Button
              tone="secondary"
              icon={Eraser}
              onClick={async () => {
                const result = await act(() => window.advocacia.cleanWhatsApp(), 'Limpeza concluída.');
                if (result) await load();
              }}
            >
              Limpar agora
            </Button>
          </div>
          <label className="field">
            <span>Guardar registros técnicos por</span>
            <select
              value={s.logRetentionDays}
              onChange={async e => {
                await act(
                  () => window.advocacia.saveSettings({ logRetentionDays: Number(e.target.value) }),
                  'Prazo salvo.',
                );
                await reload();
              }}
            >
              {[90, 180, 365, 730].map(d => (
                <option key={d} value={d}>{`${d} dias`}</option>
              ))}
            </select>
            <small>Vale para a auditoria e os arquivos de log; os mais antigos são apagados todo dia.</small>
          </label>
        </div>
      </Panel>
    </>
  );
}
