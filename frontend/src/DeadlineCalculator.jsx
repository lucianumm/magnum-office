import { useMemo, useState } from 'react';
import { CalendarPlus, AlertTriangle, Scale } from 'lucide-react';
import { Button, Modal, PageHeading, Panel, dayKey } from './components.jsx';
import {
  calculateDeadline,
  rules,
  calendarProfiles,
  suggestRule,
  businessDaysBefore,
  formatDate,
} from '../../app/deadlines.mjs';
import { parseCNJ } from '../../app/cnj.mjs';

const kindLabels = {
  start: 'Início',
  publication: 'Publicação',
  counted: '',
  skipped: 'Não conta',
  extended: 'Prorrogação',
};

function CalculatorBody({
  data,
  act,
  initialCaseId = '',
  initialStart = '',
  initialMode = '',
  initialDays = 0,
  onDone,
}) {
  const courts = data.courts.courts;
  const [caseId, setCaseId] = useState(initialCaseId);
  const caseItem = data.entities.cases.find(c => c.id === caseId);
  const suggested = suggestRule(caseItem, caseItem ? parseCNJ(caseItem.number) : null);
  const [form, setForm] = useState(() => ({
    start: initialStart || dayKey(new Date()),
    mode: initialMode || 'publicacao',
    days: initialDays || 15,
    double: false,
    ...suggested,
    recess: rules[suggested.rule].recess,
  }));
  const [title, setTitle] = useState('');
  const [internal, setInternal] = useState(2);
  const [withInternal, setWithInternal] = useState(true);
  const update = patch => setForm(f => ({ ...f, ...patch }));
  const chooseCase = id => {
    setCaseId(id);
    const c = data.entities.cases.find(x => x.id === id);
    const s = suggestRule(c, c ? parseCNJ(c.number) : null);
    update({ ...s, recess: rules[s.rule].recess });
  };
  const calendar = {
    profile: form.profile,
    recess: form.recess,
    custom: data.settings.courtCalendar || [],
    courtId: form.courtId,
  };
  const result = useMemo(() => {
    try {
      return { value: calculateDeadline({ ...form, days: Number(form.days), custom: calendar.custom }) };
    } catch (e) {
      return { error: e.message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calendar is derived from form and settings
  }, [form, data.settings.courtCalendar]);
  const r = result.value;
  const internalDate = r && withInternal && internal > 0 ? businessDaysBefore(r.end, internal, calendar) : '';
  async function createTasks() {
    const name = title.trim() || 'Prazo processual';
    const links = { caseId: caseItem?.id || '', clientId: caseItem?.clientId || '' };
    const memo = `Prazo calculado: ${r.total} dia(s) (${rules[r.rule].label}) a partir de ${formatDate(r.start)}; vence em ${formatDate(r.end)}. Confira o calendário do tribunal.`;
    const done = await act(async () => {
      await window.advocacia.save({
        kind: 'tasks',
        entity: { ...links, title: name, type: 'Prazo', priority: 'Urgente', due: `${r.end}T23:59`, notes: memo },
      });
      if (internalDate)
        await window.advocacia.save({
          kind: 'tasks',
          entity: {
            ...links,
            title: `Prazo interno: ${name}`,
            type: 'Tarefa',
            priority: 'Alta',
            due: `${internalDate}T09:00`,
            notes: `Prazo interno do escritório, ${internal} dia(s) útil(eis) antes do vencimento em ${formatDate(r.end)}.`,
          },
        });
      return internalDate ? 'Prazo e prazo interno criados na agenda.' : 'Prazo criado na agenda.';
    });
    if (done) onDone?.();
  }
  return (
    <div className="deadline-layout">
      <div className="deadline-form">
        <label className="field">
          <span>Processo</span>
          <select value={caseId} onChange={e => chooseCase(e.target.value)}>
            <option value="">Sem processo</option>
            {data.entities.cases.map(c => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            {form.mode === 'disponibilizacao' ? 'Data da disponibilização' : 'Data da intimação / publicação'}
          </span>
          <input
            type="date"
            value={form.start}
            min="1900-01-01"
            max="9999-12-31"
            onChange={e => update({ start: e.target.value })}
          />
        </label>
        <fieldset className="field">
          <legend>A data informada é</legend>
          {[
            ['publicacao', 'Intimação, ciência ou publicação'],
            ['disponibilizacao', 'Disponibilização no Diário eletrônico'],
          ].map(([value, label]) => (
            <label className="check-row" key={value}>
              <input
                type="radio"
                name="deadline-mode"
                checked={form.mode === value}
                onChange={() => update({ mode: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="deadline-row">
          <label className="field">
            <span>Prazo (dias)</span>
            <input type="number" min={1} max={365} value={form.days} onChange={e => update({ days: e.target.value })} />
          </label>
          <label className="field">
            <span>Contagem</span>
            <select
              value={form.rule}
              onChange={e => update({ rule: e.target.value, recess: rules[e.target.value].recess })}
            >
              {Object.entries(rules).map(([key, rule]) => (
                <option key={key} value={key}>
                  {rule.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={form.double} onChange={e => update({ double: e.target.checked })} />
          Prazo em dobro (Fazenda Pública, MP, Defensoria, litisconsortes)
        </label>
        <label className="check-row">
          <input type="checkbox" checked={form.recess} onChange={e => update({ recess: e.target.checked })} />
          Suspender de 20/12 a 20/01
        </label>
        <label className="field">
          <span>Calendário</span>
          <select value={form.profile} onChange={e => update({ profile: e.target.value })}>
            {Object.entries(calendarProfiles).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tribunal</span>
          <select value={form.courtId} onChange={e => update({ courtId: e.target.value })}>
            <option value="">Não informado</option>
            {courts
              .filter(c => c.category !== 'Conselhos e serviços')
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.acronym}
                </option>
              ))}
          </select>
          <small>Usa os feriados locais cadastrados para este tribunal em Configurações → Prazos e fluxos.</small>
        </label>
      </div>
      <div className="deadline-result">
        {result.error && (
          <div className="form-error" role="alert">
            {result.error}
          </div>
        )}
        {r && (
          <>
            <div className="deadline-answer" role="status">
              <span>Vencimento</span>
              <strong>
                {formatDate(r.end)} <small>({r.steps.at(-1).weekday})</small>
              </strong>
              <small>
                {r.total} dia(s) · começa a contar em {formatDate(r.firstDay)}
                {r.publication !== r.start && ` · publicação em ${formatDate(r.publication)}`}
              </small>
            </div>
            {r.warnings.map(w => (
              <div className="conflict-alert info" key={w}>
                <AlertTriangle size={16} />
                <small>{w}</small>
              </div>
            ))}
            <div className="deadline-create">
              <label className="field">
                <span>Descrição do prazo</span>
                <input
                  value={title}
                  maxLength={180}
                  placeholder="Ex.: Contestação"
                  onChange={e => setTitle(e.target.value)}
                />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={withInternal} onChange={e => setWithInternal(e.target.checked)} />
                Prazo interno
                <input
                  className="inline-number"
                  type="number"
                  min={1}
                  max={30}
                  value={internal}
                  aria-label="Dias úteis antes do vencimento"
                  onChange={e => setInternal(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                />
                dia(s) útil(eis) antes{internalDate && `: ${formatDate(internalDate)}`}
              </label>
              <Button icon={CalendarPlus} onClick={createTasks}>
                Criar na agenda
              </Button>
            </div>
            <details className="deadline-basis" open>
              <summary>
                <Scale size={14} /> Fundamentos considerados
              </summary>
              <ul>
                {r.basis.map(b => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </details>
            <details className="deadline-steps">
              <summary>Memória de cálculo dia a dia</summary>
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Dia</th>
                    <th>Contagem</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {r.steps.map((s, i) => (
                    <tr key={i} className={s.kind}>
                      <td className="tabular">{formatDate(s.date)}</td>
                      <td>{s.weekday}</td>
                      <td className="tabular">{s.n ?? kindLabels[s.kind]}</td>
                      <td>{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

export default function DeadlineCalculator({ data, act }) {
  return (
    <>
      <PageHeading title="Calculadora de prazos" />
      <Panel>
        <CalculatorBody data={data} act={act} />
      </Panel>
    </>
  );
}

export function DeadlineModal({ data, act, caseId, start, mode, days, onClose }) {
  return (
    <Modal wide title="Calcular prazo" subtitle="Confira sempre o calendário do tribunal." onClose={onClose}>
      <CalculatorBody
        data={data}
        act={act}
        initialCaseId={caseId}
        initialStart={start}
        initialMode={mode}
        initialDays={days}
        onDone={onClose}
      />
    </Modal>
  );
}
