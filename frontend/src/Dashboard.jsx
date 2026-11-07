import { useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  Check,
  CircleCheck,
  Plus,
  Users,
  MessageCircle,
  Database,
  ArrowUpRight,
} from 'lucide-react';
import {
  Button,
  Panel,
  Empty,
  Calendar,
  Badge,
  date,
  dayKey,
  TextLink,
  capitalize,
  relativeDay,
} from './components.jsx';

const LIMIT = 6;
function TaskRow({ task, cases, today, edit, act, save }) {
  const late = task.due < today + 'T00:00';
  const number = task.caseId && (cases.find(c => c.id === task.caseId)?.number || 'Processo vinculado');
  return (
    <div className="task-row">
      <button
        className="task-checkbox"
        aria-label={`Concluir ${task.title}`}
        onClick={() => act(() => save('tasks', { ...task, status: 'Concluída' }), 'Compromisso concluído.')}
      >
        <Check size={13} />
      </button>
      <div className="task-main">
        <button onClick={() => edit('tasks', task)}>{task.title}</button>
        <span>
          {task.type}
          {number && ' · ' + number}
        </span>
      </div>
      <div className="task-due">
        <span className={late ? 'danger-text' : ''}>
          {late ? relativeDay(task.due, today) : task.due.startsWith(today) ? task.due.slice(11) : date(task.due)}
        </span>
        {late ? <Badge tone="red">Atrasado</Badge> : task.priority !== 'Normal' && <Badge>{task.priority}</Badge>}
      </div>
    </div>
  );
}
function Group({ title, tasks, overdue = false, ...rest }) {
  if (!tasks.length) return null;
  return (
    <section className={'deadline-group ' + (overdue ? 'overdue' : '')}>
      <h3>
        {title} · {tasks.length}
      </h3>
      {tasks.slice(0, LIMIT).map(task => (
        <TaskRow key={task.id} task={task} {...rest} />
      ))}
    </section>
  );
}
export default function Dashboard({ data, navigate, navigateSettings, openDetail, create, edit, save, act }) {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const { clients, cases, tasks } = data.entities;
  const today = dayKey(new Date());
  const weekEnd = dayKey(Date.now() + 7 * 86400000);
  const pending = tasks.filter(t => t.status !== 'Concluída').sort((a, b) => a.due.localeCompare(b.due));
  const overdue = pending.filter(t => t.due < today + 'T00:00');
  const todays = pending.filter(t => t.due.startsWith(today));
  const week = pending.filter(t => t.due.slice(0, 10) > today && t.due.slice(0, 10) <= weekEnd);
  const failed = data.messages.filter(m => ['failed', 'uncertain', 'needs_review'].includes(m.status)).length;
  const agenda = tasks.filter(t => t.due.startsWith(selected)).sort((a, b) => a.due.localeCompare(b.due));
  const hour = new Date().getHours();
  const shared = { cases, today, edit, act, save };
  const firstUse = !clients.length || !data.backups.length || data.services.whatsapp.status !== 'connected';
  const steps = [
    {
      done: clients.length > 0,
      title: 'Cadastre seu primeiro cliente',
      detail: 'Ou importe uma planilha em Configurações → Importar dados.',
      icon: Users,
      go: () => create('clients'),
      label: 'Cadastrar primeiro cliente',
    },
    {
      done: data.services.whatsapp.status === 'connected',
      title: 'Conecte o WhatsApp',
      detail: 'Necessário para mensagens e lembretes automáticos.',
      icon: MessageCircle,
      go: () => navigate('messages'),
    },
    {
      done: data.backups.length > 0,
      title: 'Crie uma cópia de segurança',
      detail: 'Proteja os dados do escritório.',
      icon: Database,
      go: () => navigateSettings('backups'),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'}, {data.settings.userName.split(' ')[0]}
          </h1>
          <small style={{ color: 'var(--text-3)' }}>
            {capitalize(
              new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
            )}
          </small>
        </div>
      </div>
      <div className="today-strip">
        <button className={'today-card ' + (overdue.length ? 'danger' : '')} onClick={() => navigate('tasks')}>
          <strong>{overdue.length}</strong>
          <span>{overdue.length === 1 ? 'Atrasado' : 'Atrasados'}</span>
        </button>
        <button className={'today-card ' + (todays.length ? 'warning' : '')} onClick={() => navigate('calendar')}>
          <strong>{todays.length}</strong>
          <span>Hoje</span>
        </button>
        <button className="today-card" onClick={() => navigate('tasks')}>
          <strong>{week.length}</strong>
          <span>Próximos 7 dias</span>
        </button>
        <button className={'today-card ' + (failed ? 'danger' : '')} onClick={() => navigate('messages')}>
          <strong>{failed}</strong>
          <span>{failed === 1 ? 'Envio com problema' : 'Envios com problema'}</span>
        </button>
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <Panel
            title="Prazos"
            icon={CalendarClock}
            aside={<TextLink onClick={() => navigate('tasks')}>Ver todos</TextLink>}
          >
            {overdue.length || todays.length || week.length ? (
              <>
                <Group title="Atrasados" overdue tasks={overdue} {...shared} />
                <Group title="Hoje" tasks={todays} {...shared} />
                <Group title="Esta semana" tasks={week} {...shared} />
              </>
            ) : (
              <Empty
                icon={CircleCheck}
                title="Nenhum prazo nos próximos 7 dias"
                description="Cadastre prazos e compromissos para acompanhá-los aqui."
                action={
                  <Button tone="secondary" icon={Plus} onClick={() => create('tasks')}>
                    Adicionar compromisso
                  </Button>
                }
              />
            )}
          </Panel>
          {firstUse && (
            <Panel title="Comece por aqui">
              <div className="start-list">
                {steps.map(step => (
                  <button key={step.title} aria-label={step.label} onClick={step.go}>
                    {step.done ? <CircleCheck size={18} className="done" /> : <step.icon size={18} />}
                    <div>
                      <strong>{step.title}</strong>
                      <small>{step.done ? 'Concluído' : step.detail}</small>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel
            title="Processos recentes"
            icon={BriefcaseBusiness}
            aside={<TextLink onClick={() => navigate('cases')}>Todos os processos</TextLink>}
          >
            {cases.length ? (
              <div className="recent-cases">
                {cases.slice(0, 5).map(item => (
                  <button key={item.id} onClick={() => openDetail('cases', item.id)}>
                    <div>
                      <strong>{item.title}</strong>
                      <small className="tabular">
                        {item.number || 'Número não informado'} · {item.area}
                      </small>
                    </div>
                    <Badge>{item.status}</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                icon={BriefcaseBusiness}
                title="Nenhum processo cadastrado"
                description="Reúna cada caso com seu cliente, prazos e documentos."
                action={
                  <Button tone="secondary" icon={Plus} aria-label="Cadastrar processo" onClick={() => create('cases')}>
                    Cadastrar processo
                  </Button>
                }
              />
            )}
          </Panel>
        </div>
        <aside className="dashboard-aside">
          <Panel
            title="Agenda"
            icon={CalendarDays}
            aside={
              <button className="icon-button" aria-label="Abrir agenda" onClick={() => navigate('calendar')}>
                <ArrowUpRight size={16} />
              </button>
            }
          >
            <Calendar
              compact
              month={month}
              setMonth={setMonth}
              selected={selected}
              onSelect={setSelected}
              tasks={tasks}
            />
            <div className="day-agenda">
              <div className="day-agenda-title">
                <strong>
                  {selected === today ? 'Hoje' : capitalize(date(selected + 'T12:00', { month: 'long' }))}
                </strong>
                <span>{agenda.length === 1 ? '1 compromisso' : `${agenda.length} compromissos`}</span>
              </div>
              {agenda.length ? (
                agenda.slice(0, 4).map(task => (
                  <button className="mini-event" key={task.id} onClick={() => edit('tasks', task)}>
                    <span>{task.due.slice(11)}</span>
                    <div>
                      <strong>{task.title}</strong>
                      <small>{task.type}</small>
                    </div>
                  </button>
                ))
              ) : (
                <p className="agenda-empty">Nenhum compromisso neste dia.</p>
              )}
              <button className="calendar-add" onClick={() => create('tasks', { due: selected + 'T09:00' })}>
                <Plus size={14} /> Novo compromisso
              </button>
            </div>
          </Panel>
          <Button tone="secondary" icon={Plus} aria-label="Criar anotação" onClick={() => create('notes')}>
            Nova anotação
          </Button>
        </aside>
      </div>
    </>
  );
}
