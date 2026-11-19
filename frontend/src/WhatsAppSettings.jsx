import { useEffect, useState } from 'react';
import { MessageCircle, Eraser, Clock, Bot, History } from 'lucide-react';
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
  const ai = status?.ai;
  const [aiForm, setAiForm] = useState({
    aiEnabled: s.aiEnabled === true,
    aiProvider: s.aiProvider || 'anthropic',
    aiModel: s.aiModel || '',
    aiBaseUrl: s.aiBaseUrl || '',
    aiGuidelines: s.aiGuidelines || '',
    aiMode: s.aiMode || 'review',
  });
  const [aiKey, setAiKey] = useState('');
  const [aiTest, setAiTest] = useState({ text: '', answer: '', busy: false });
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
            description="Desligado por padrão. Ligado, o programa lê só texto de conversas individuais (nunca grupos, status ou canais), não baixa fotos, áudios nem documentos e guarda cada mensagem cifrada pelo prazo escolhido mais abaixo (30 dias, se você não mudar). É a base para a confirmação de presença e para as respostas automáticas."
          />
          {status?.inbox.enabled && (
            <small className="field-hint muted">Mensagens novas na caixa: {status.inbox.newCount}.</small>
          )}
          <label className="field">
            <span>Respostas automáticas</span>
            <select
              value={s.waFlowMode}
              disabled={s.waInboxEnabled !== true}
              onChange={async e => {
                await act(() => window.advocacia.saveSettings({ waFlowMode: e.target.value }), 'Modo salvo.');
                await reload();
              }}
            >
              <option value="review">Revisar antes de enviar (recomendado)</option>
              <option value="auto">Responder sozinho</option>
              <option value="off">Desligadas</option>
            </select>
            <small>
              O cliente cadastrado pode escrever 1 (andamento), 2 (próxima audiência) ou 3 (falar com a equipe), e
              CONFIRMO depois de um aviso de audiência. Para o andamento, o número tem de ser o do cadastro, o cliente
              informa o CPF e o cadastro precisa ter a consulta de andamento pelo WhatsApp ligada. Respostas com dados
              do processo esperam o seu clique em WhatsApp, a menos que você escolha Responder sozinho. Processos em
              segredo de justiça nunca são respondidos. O CPF digitado não fica guardado.
            </small>
          </label>
        </div>
      </Panel>
      <Panel title="Assistente de IA" icon={Bot}>
        <div className="settings-body">
          <p className="help-text">
            Opcional e desligado por padrão. Com uma chave de API de um serviço de IA (Anthropic ou qualquer serviço
            compatível com a OpenAI, inclusive um modelo no seu computador), o programa redige a resposta quando um
            cliente cadastrado escreve algo livre.{' '}
            <strong>
              Ao responder, o texto escrito pelo cliente, o primeiro nome e o nome do escritório são enviados ao serviço
              de IA que você escolheu
            </strong>
            , junto com as diretrizes abaixo. CPF, processo, valores e demais dados do cadastro nunca são enviados.
            Número desconhecido e as respostas de menu (1, 2, 3, CONFIRMO, SAIR) não usam a IA. A chave fica guardada
            cifrada e não é mostrada de novo.
          </p>
          <Toggle
            checked={aiForm.aiEnabled}
            onChange={v => setAiForm(f => ({ ...f, aiEnabled: v }))}
            title="Responder aos clientes com IA"
            description="Precisa de caixa de entrada ligada, modelo e chave. Limite: 3 respostas por cliente por hora e 100 por dia."
          />
          <div className="form-grid">
            <label className="field">
              <span>Serviço</span>
              <select value={aiForm.aiProvider} onChange={e => setAiForm(f => ({ ...f, aiProvider: e.target.value }))}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">Compatível com a OpenAI</option>
              </select>
            </label>
            <label className="field">
              <span>Modelo</span>
              <input
                value={aiForm.aiModel}
                maxLength={80}
                placeholder={aiForm.aiProvider === 'anthropic' ? 'Ex.: claude-haiku-5-5' : 'Ex.: gpt-4o-mini'}
                onChange={e => setAiForm(f => ({ ...f, aiModel: e.target.value }))}
              />
            </label>
            <label className="field full">
              <span>Endereço do serviço (opcional)</span>
              <input
                value={aiForm.aiBaseUrl}
                maxLength={200}
                placeholder={
                  aiForm.aiProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
                }
                onChange={e => setAiForm(f => ({ ...f, aiBaseUrl: e.target.value }))}
              />
              <small>Deixe em branco para o endereço padrão. Para um modelo local: http://localhost:11434/v1</small>
            </label>
            <label className="field full">
              <span>Chave de API</span>
              <input
                type="password"
                autoComplete="off"
                value={aiKey}
                placeholder={ai?.hasKey ? 'Chave cadastrada (digite outra para trocar)' : 'Cole a chave aqui'}
                onChange={e => setAiKey(e.target.value)}
              />
            </label>
            <label className="field full">
              <span>Diretrizes da IA</span>
              <textarea
                rows={6}
                maxLength={8000}
                value={aiForm.aiGuidelines}
                placeholder="Ex.: Fale de forma simples e acolhedora. Atendemos de segunda a sexta, das 9h às 18h. Nunca prometa resultado. Para urgências, peça que o cliente ligue para (62) 3000-0000."
                onChange={e => setAiForm(f => ({ ...f, aiGuidelines: e.target.value }))}
              />
              <small>
                O que o escritório quer que a IA saiba e respeite. Valem junto com regras fixas do programa: não dar
                aconselhamento jurídico, não informar prazo, valor nem andamento, e encaminhar à equipe.
              </small>
            </label>
            <label className="field">
              <span>O que fazer com a resposta</span>
              <select value={aiForm.aiMode} onChange={e => setAiForm(f => ({ ...f, aiMode: e.target.value }))}>
                <option value="review">Revisar antes de enviar (recomendado)</option>
                <option value="auto">Responder sozinho</option>
              </select>
            </label>
          </div>
          <div className="heading-actions">
            <Button
              icon={Bot}
              onClick={async () => {
                const saved = await act(async () => {
                  await window.advocacia.saveSettings(aiForm);
                  if (aiKey.trim()) await window.advocacia.setAiKey(aiKey.trim());
                  return true;
                }, 'Assistente de IA salvo.');
                if (saved) {
                  setAiKey('');
                  await reload();
                  await load();
                }
              }}
            >
              Salvar assistente
            </Button>
            {ai?.hasKey && (
              <Button
                tone="ghost"
                onClick={async () => {
                  await act(() => window.advocacia.setAiKey(null), 'Chave removida.');
                  await load();
                }}
              >
                Remover chave
              </Button>
            )}
          </div>
          <label className="field">
            <span>Testar com uma mensagem de exemplo</span>
            <input
              value={aiTest.text}
              maxLength={500}
              placeholder="Ex.: Boa tarde, vocês atendem aos sábados?"
              onChange={e => setAiTest(t => ({ ...t, text: e.target.value }))}
            />
            <small>O teste envia esta frase (e só ela) ao serviço de IA, com as diretrizes salvas.</small>
          </label>
          <div className="heading-actions">
            <Button
              tone="secondary"
              busy={aiTest.busy}
              disabled={!ai?.hasKey || !s.aiModel}
              onClick={async () => {
                setAiTest(t => ({ ...t, busy: true, answer: '' }));
                const result = await act(() => window.advocacia.testAi({ text: aiTest.text }));
                setAiTest(t => ({ ...t, busy: false, answer: result?.answer || '' }));
              }}
            >
              Testar resposta
            </Button>
          </div>
          {aiTest.answer && <p className="help-text ai-answer">{aiTest.answer}</p>}
        </div>
      </Panel>
      <Panel title="Reenvio e diário de 24 horas" icon={History}>
        <div className="settings-body">
          <p className="help-text">
            Para o WhatsApp funcionar bem, o programa guarda dois registros curtos, cifrados no seu computador:{' '}
            <strong>o texto das mensagens enviadas por 24 horas</strong>, para reenviar quando o celular do cliente
            mostrar “Aguardando mensagem” (funciona também depois de reiniciar), e{' '}
            <strong>um diário das mensagens recebidas por 24 horas</strong>: a mesma mensagem entregue duas vezes é
            tratada uma vez só, e um atendimento interrompido por uma queda é retomado se tiver menos de 10 minutos. O
            texto do diário é apagado assim que o atendimento termina.
          </p>
          {status && (
            <small className="field-hint muted">
              Agora: {status.retry.stored} mensagem(ns) enviada(s) guardada(s) para reenvio ·{' '}
              {status.retry.journal.processing || 0} atendimento(s) em andamento · {status.retry.journal.done || 0}{' '}
              tratada(s) nas últimas 24 h.
            </small>
          )}
          <label className="field">
            <span>Guardar as mensagens recebidas (caixa de entrada) por</span>
            <select
              value={s.waInboxKeepDays || 30}
              onChange={async e => {
                await act(
                  () => window.advocacia.saveSettings({ waInboxKeepDays: Number(e.target.value) }),
                  'Prazo salvo.',
                );
                await reload();
              }}
            >
              <option value={1}>1 dia</option>
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
            </select>
            <small>
              A caixa de entrada é a lista que você vê em WhatsApp. O diário acima é outro registro e sempre some em 24
              h.
            </small>
          </label>
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
