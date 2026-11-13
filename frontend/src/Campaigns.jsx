import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Play, Pause, Pencil, Trash2, Eye, Send, CalendarDays, X } from 'lucide-react';
import { Button, Badge, Modal, Toggle, Empty, dateTime } from './components.jsx';
import { calendarDates, recurrenceKinds, triggerTypes } from '../../app/campaign-rules.mjs';
import { messageVariableList } from '../../app/message-vars.mjs';

const statusLabels = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada' };
const statusTone = { draft: 'neutral', active: 'green', paused: 'amber' };
const segmentLabels = {
  all: 'Todos os clientes ativos',
  area: 'Por área do processo',
  phase: 'Por fase do processo',
  tag: 'Por etiqueta do processo',
  cases: 'Clientes de processos escolhidos',
  clients: 'Clientes escolhidos',
};
const eventTypes = ['Audiência', 'Perícia', 'Reunião', 'Diligência', 'Prazo'];
const months = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const blank = () => ({
  name: '',
  body: '',
  templateId: '',
  trigger: { type: 'dates', time: '09:00', dates: [] },
  segment: { mode: 'all', values: [] },
  review: false,
  optOutFooter: true,
});
const todayKey = () => new Date().toISOString().slice(0, 10);

function triggerText(t) {
  const time = t.time ? ` às ${t.time}` : '';
  switch (t.type) {
    case 'client-birthday':
    case 'client-since':
      return `${triggerTypes[t.type]}${time}`;
    case 'yearly':
      return `Todo ano, ${t.day} de ${months[t.month - 1]}${time}`;
    case 'calendar':
      return `${calendarDates[t.key]?.label || t.key}, todo ano${time}`;
    case 'dates':
      return `${t.dates.length} data(s) escolhida(s)${time}`;
    case 'recurring':
      return `${recurrenceKinds[t.every]}, a partir de ${t.start.split('-').reverse().join('/')}${time}`;
    case 'before-event':
      return `${Math.abs(t.days)} dia(s) ${t.days >= 0 ? 'antes' : 'depois'} de ${t.eventType.toLowerCase()}${time}`;
    case 'case-created':
      return `Processo cadastrado${t.delayDays ? `, ${t.delayDays} dia(s) depois` : ''}${time}`;
    case 'case-closed':
      return `Processo concluído${t.delayDays ? `, ${t.delayDays} dia(s) depois` : ''}${time}`;
    case 'finance-overdue':
      return `${t.afterDays} dia(s) após o vencimento, até ${t.max} aviso(s)${time}`;
    default:
      return t.type;
  }
}

// Campaigns: messages sent by date, repetition, event or client, with audience, preview and calendar.
export default function Campaigns({ data, act, reload, onClose }) {
  const [list, setList] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [tab, setTab] = useState('campaigns');
  const [draft, setDraft] = useState(null);
  const load = async () => {
    try {
      setList(await window.advocacia.campaignList());
      setCalendar(await window.advocacia.campaignCalendar());
    } catch {
      /* the screen shows what it has */
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const refresh = async () => {
    await reload();
    await load();
  };
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const m of calendar) {
      const key = String(m.at).slice(0, 10);
      groups.set(key, [...(groups.get(key) || []), m]);
    }
    return [...groups.entries()];
  }, [calendar]);
  return (
    <Modal
      wide
      title="Campanhas de WhatsApp"
      subtitle="Mensagens por data, repetição ou evento, com regras de proteção."
      onClose={onClose}
    >
      <div className="settings-body notice-body">
        <div className="tabs message-view-tabs">
          <button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}>
            Campanhas
          </button>
          <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
            Próximos 30 dias{calendar.length ? ` (${calendar.length})` : ''}
          </button>
        </div>
        {tab === 'campaigns' && (
          <>
            <div className="heading-actions">
              <Button icon={Plus} onClick={() => setDraft(blank())}>
                Nova campanha
              </Button>
            </div>
            {list.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th>Quando</th>
                      <th>Situação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => (
                      <tr key={c.id}>
                        <td>
                          <div className="cell-stack">
                            <strong>{c.name}</strong>
                            <span>{segmentLabels[c.segment.mode]}</span>
                            <small>
                              {c.plannedCount} na fila · {c.sentCount} enviada(s)
                            </small>
                          </div>
                        </td>
                        <td>{triggerText(c.trigger)}</td>
                        <td>
                          <Badge tone={statusTone[c.status]}>{statusLabels[c.status]}</Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              tone="secondary"
                              icon={c.status === 'active' ? Pause : Play}
                              onClick={() =>
                                act(
                                  () =>
                                    window.advocacia.setCampaignStatus({
                                      id: c.id,
                                      status: c.status === 'active' ? 'paused' : 'active',
                                    }),
                                  c.status === 'active' ? 'Campanha pausada.' : 'Campanha ativada.',
                                ).then(refresh)
                              }
                            >
                              {c.status === 'active' ? 'Pausar' : 'Ativar'}
                            </Button>
                            <Button tone="ghost" icon={Pencil} onClick={() => setDraft(c)}>
                              Editar
                            </Button>
                            <Button
                              tone="ghost"
                              icon={Trash2}
                              onClick={() =>
                                act(() => window.advocacia.removeCampaign(c.id), 'Campanha excluída.').then(refresh)
                              }
                            >
                              Excluir
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={Megaphone}
                title="Nenhuma campanha ainda"
                description="Crie uma campanha para datas comemorativas, lembretes antes de audiências, boas-vindas ou cobrança gentil. Nada é enviado até você ativar."
              />
            )}
          </>
        )}
        {tab === 'calendar' &&
          (byDay.length ? (
            byDay.map(([day, items]) => (
              <div key={day} className="campaign-day">
                <h4>
                  <CalendarDays size={16} /> {day.split('-').reverse().join('/')} · {items.length} envio(s)
                </h4>
                <table>
                  <tbody>
                    {items.map(m => (
                      <tr key={m.id}>
                        <td>{dateTime(m.at)}</td>
                        <td>
                          <strong>{m.campaignName}</strong>
                          <br />
                          <small>{m.recipient}</small>
                        </td>
                        <td>{m.body.slice(0, 80)}</td>
                        <td>
                          <Button
                            tone="ghost"
                            icon={X}
                            onClick={() =>
                              act(
                                () => window.advocacia.changeMessage({ id: m.id, action: 'cancel' }),
                                'Envio cancelado.',
                              ).then(refresh)
                            }
                          >
                            Cancelar este envio
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <Empty
              icon={CalendarDays}
              title="Nada programado"
              description="As campanhas ativas aparecem aqui, dia a dia, com 30 dias de antecedência."
            />
          ))}
      </div>
      {draft && (
        <CampaignEditor
          data={data}
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await refresh();
          }}
        />
      )}
    </Modal>
  );
}

function CampaignEditor({ data, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [phone, setPhone] = useState('');
  const [notice, setNotice] = useState('');
  const t = form.trigger;
  const setTrigger = patch => setForm(f => ({ ...f, trigger: { ...f.trigger, ...patch } }));
  const setType = type => {
    const base = { type, time: t.time || '09:00' };
    if (type === 'yearly') Object.assign(base, { month: 1, day: 1 });
    if (type === 'calendar') base.key = 'lawyer';
    if (type === 'dates') base.dates = [];
    if (type === 'recurring') Object.assign(base, { every: 'monthly', start: todayKey(), until: '', count: 6 });
    if (type === 'before-event') Object.assign(base, { eventType: 'Audiência', days: 1 });
    if (type === 'case-created' || type === 'case-closed') base.delayDays = 0;
    if (type === 'finance-overdue') Object.assign(base, { afterDays: 3, max: 2 });
    setForm(f => ({ ...f, trigger: base }));
  };
  const cases = data.entities.cases;
  const options = useMemo(() => {
    const uniq = key => [...new Set(cases.map(c => c[key]).filter(Boolean))].sort();
    return {
      area: uniq('area'),
      phase: uniq('phase'),
      tag: [
        ...new Set(
          cases
            .flatMap(c =>
              String(c.tags || '')
                .split(',')
                .map(x => x.trim()),
            )
            .filter(Boolean),
        ),
      ].sort(),
    };
  }, [cases]);
  const toggleValue = value =>
    setForm(f => ({
      ...f,
      segment: {
        ...f.segment,
        values: f.segment.values.includes(value)
          ? f.segment.values.filter(v => v !== value)
          : [...f.segment.values, value],
      },
    }));
  const templates = data.library.templates.filter(x => x.kind === 'whatsapp' && x.purpose !== 'birthday');
  const payload = () => ({
    ...form,
    trigger: { ...t, ...(t.type === 'recurring' ? { count: t.count ? Number(t.count) : 0 } : {}) },
  });
  async function run(fn, after) {
    setError('');
    setNotice('');
    try {
      after(await fn());
    } catch (e) {
      setError(e.message);
    }
  }
  const valueList =
    form.segment.mode === 'cases'
      ? cases.map(c => [c.id, c.title])
      : form.segment.mode === 'clients'
        ? data.entities.clients.filter(c => c.status === 'Ativo').map(c => [c.id, c.name])
        : (options[form.segment.mode] || []).map(v => [v, v]);
  return (
    <Modal wide title={form.id ? 'Editar campanha' : 'Nova campanha'} onClose={onClose}>
      <form
        onSubmit={e => {
          e.preventDefault();
          void run(
            () => window.advocacia.saveCampaign(payload()),
            () => onSaved(),
          );
        }}
      >
        <div className="form-grid">
          <label className="field full">
            <span>Nome da campanha</span>
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field full">
            <span>Modelo de mensagem</span>
            <select value={form.templateId} onChange={e => setForm({ ...form, templateId: e.target.value })}>
              <option value="">Escrever aqui</option>
              {templates.map(x => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          </label>
          {!form.templateId && (
            <label className="field full">
              <span>Mensagem</span>
              <textarea
                rows={5}
                maxLength={4000}
                value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })}
              />
              <small>
                Variáveis:{' '}
                {messageVariableList
                  .slice(0, 8)
                  .map(([k]) => k)
                  .join(' ')}{' '}
                e outras (a lista completa está em Documentos → Modelos de WhatsApp).
              </small>
            </label>
          )}
          <label className="field">
            <span>Quando enviar</span>
            <select value={t.type} onChange={e => setType(e.target.value)}>
              {Object.entries(triggerTypes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Horário</span>
            <input type="time" required value={t.time} onChange={e => setTrigger({ time: e.target.value })} />
          </label>
          {t.type === 'yearly' && (
            <>
              <label className="field">
                <span>Dia</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={t.day}
                  onChange={e => setTrigger({ day: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Mês</span>
                <select value={t.month} onChange={e => setTrigger({ month: Number(e.target.value) })}>
                  {months.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {t.type === 'calendar' && (
            <label className="field full">
              <span>Data comemorativa</span>
              <select value={t.key} onChange={e => setTrigger({ key: e.target.value })}>
                {Object.entries(calendarDates).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {t.type === 'dates' && (
            <div className="field full">
              <span>Datas</span>
              <div className="chip-row">
                {t.dates.map(d => (
                  <button
                    type="button"
                    className="chip"
                    key={d}
                    onClick={() => setTrigger({ dates: t.dates.filter(x => x !== d) })}
                  >
                    {d.split('-').reverse().join('/')} ×
                  </button>
                ))}
              </div>
              <input
                type="date"
                aria-label="Adicionar data"
                min={todayKey()}
                onChange={e =>
                  e.target.value &&
                  !t.dates.includes(e.target.value) &&
                  setTrigger({ dates: [...t.dates, e.target.value].sort() })
                }
              />
            </div>
          )}
          {t.type === 'recurring' && (
            <>
              <label className="field">
                <span>Frequência</span>
                <select value={t.every} onChange={e => setTrigger({ every: e.target.value })}>
                  {Object.entries(recurrenceKinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Primeira mensagem</span>
                <input type="date" required value={t.start} onChange={e => setTrigger({ start: e.target.value })} />
              </label>
              <label className="field">
                <span>Até a data (opcional)</span>
                <input type="date" value={t.until || ''} onChange={e => setTrigger({ until: e.target.value })} />
              </label>
              <label className="field">
                <span>Ou número de envios</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={t.count || ''}
                  onChange={e => setTrigger({ count: e.target.value })}
                />
              </label>
            </>
          )}
          {t.type === 'before-event' && (
            <>
              <label className="field">
                <span>Compromisso</span>
                <select value={t.eventType} onChange={e => setTrigger({ eventType: e.target.value })}>
                  {eventTypes.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Dias (negativo = depois)</span>
                <input
                  type="number"
                  min={-60}
                  max={60}
                  value={t.days}
                  onChange={e => setTrigger({ days: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          {(t.type === 'case-created' || t.type === 'case-closed') && (
            <label className="field">
              <span>Esperar quantos dias</span>
              <input
                type="number"
                min={0}
                max={30}
                value={t.delayDays}
                onChange={e => setTrigger({ delayDays: Number(e.target.value) })}
              />
            </label>
          )}
          {t.type === 'finance-overdue' && (
            <>
              <label className="field">
                <span>Dias após o vencimento</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={t.afterDays}
                  onChange={e => setTrigger({ afterDays: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Avisos (no máximo 2)</span>
                <select value={t.max} onChange={e => setTrigger({ max: Number(e.target.value) })}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
            </>
          )}
          <label className="field full">
            <span>Quem recebe</span>
            <select
              value={form.segment.mode}
              onChange={e => setForm({ ...form, segment: { mode: e.target.value, values: [] } })}
            >
              {Object.entries(segmentLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {form.segment.mode !== 'all' && (
            <div className="field full segment-values">
              {valueList.length ? (
                valueList.map(([value, label]) => (
                  <label key={value} className="check-row">
                    <input
                      type="checkbox"
                      checked={form.segment.values.includes(value)}
                      onChange={() => toggleValue(value)}
                    />
                    {label}
                  </label>
                ))
              ) : (
                <small className="muted">Não há opções cadastradas para este critério.</small>
              )}
            </div>
          )}
        </div>
        <div className="settings-body notice-body">
          <Toggle
            checked={form.review}
            onChange={v => setForm({ ...form, review: v })}
            title="Revisar antes de enviar"
            description="Cada mensagem fica esperando a sua aprovação em Mensagens."
          />
          <Toggle
            checked={form.optOutFooter}
            onChange={v => setForm({ ...form, optOutFooter: v })}
            title="Avisar como deixar de receber"
            description={
              data.settings.waInboxEnabled
                ? 'Acrescenta “responda SAIR” ao fim. Quem responder SAIR não recebe mais campanhas.'
                : 'Para o SAIR funcionar, ligue “Receber mensagens dos clientes” em Configurações → WhatsApp. Sem isso, o aviso não é acrescentado.'
            }
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="help-text">{notice}</p>}
          {preview && (
            <div className="campaign-preview">
              <p>
                <strong>Vai para {preview.reachable} cliente(s)</strong>
                {preview.optedOut ? `, ${preview.optedOut} não recebe(m) campanhas` : ''}
                {preview.noPhone ? `, ${preview.noPhone} sem WhatsApp válido` : ''}.
              </p>
              {preview.sample && (
                <p>
                  <small>Exemplo ({preview.sampleClient}):</small>
                  <br />
                  {preview.sample}
                </p>
              )}
              {preview.next.length > 0 && (
                <ul>
                  {preview.next.map((n, i) => (
                    <li key={i}>
                      {dateTime(n.at)} — {n.client}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="form-footer">
          <div className="heading-actions">
            <Button
              type="button"
              tone="secondary"
              icon={Eye}
              onClick={() => run(() => window.advocacia.previewCampaign(payload()), setPreview)}
            >
              Ver quem recebe
            </Button>
            <input
              aria-label="Seu WhatsApp para a amostra"
              placeholder="Seu WhatsApp com DDD"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              style={{ width: 170 }}
            />
            <Button
              type="button"
              tone="secondary"
              icon={Send}
              onClick={() =>
                run(
                  () => window.advocacia.sampleCampaign({ campaign: payload(), phone }),
                  () => setNotice('Amostra na fila de Mensagens. Ela segue as regras de envio.'),
                )
              }
            >
              Enviar amostra
            </Button>
          </div>
          <Button type="submit">Salvar campanha</Button>
        </div>
        <small className="field-hint muted">Salva como rascunho: nada é enviado até você ativar.</small>
      </form>
    </Modal>
  );
}
