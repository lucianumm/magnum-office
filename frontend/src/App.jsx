import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  House,
  Users,
  BriefcaseBusiness,
  CalendarDays,
  FileText,
  FileCog,
  NotebookPen,
  MessageCircle,
  Landmark,
  Settings2,
  Search,
  Plus,
  Bell,
  ArrowRight,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  LoaderCircle,
  Minus,
  Square,
  ShieldCheck,
  Contact,
  Calculator,
  Wallet,
  Inbox,
  TrendingUp,
  HandCoins,
  Scale,
  Handshake,
  ChartBar,
  FileSearch,
} from 'lucide-react';
import Reports from './Reports.jsx';
import Finance from './Finance.jsx';
import Intimations from './Intimations.jsx';
import DebtCalculator from './DebtCalculator.jsx';
import LaborCalculator from './LaborCalculator.jsx';
import LiquidationCalculator from './LiquidationCalculator.jsx';
import LockScreen from './LockScreen.jsx';
import { limitationAlerts } from '../../app/prescription.mjs';
import DeadlineCalculator, { DeadlineModal } from './DeadlineCalculator.jsx';
import ApplyWorkflow from './ApplyWorkflow.jsx';
import TermsPrompt from './TermsPrompt.jsx';
import SetupWizard from './SetupWizard.jsx';
import { DailyBackupNotice } from './BackupPreferences.jsx';
import SupportPrompt from './SupportPrompt.jsx';
import PDFTools from './PDFTools.jsx';
import DocumentWorkspace from './DocumentWorkspace.jsx';
import { Logo, Button, SearchBox, PageHeading, Panel, Empty, Modal, initials, dayKey, plural } from './components.jsx';
import Dashboard from './Dashboard.jsx';
import Records, { Agenda } from './Records.jsx';
import Detail from './Detail.jsx';
import EntityForm from './EntityForm.jsx';
import EventNotice from './EventNotice.jsx';
import Messages from './Messages.jsx';
import Settings from './Settings.jsx';
import Courts from './Courts.jsx';
import EmailCampaign from './EmailCampaign.jsx';
import MessageComposer, { localDateTime } from './MessageComposer.jsx';
import GenerateDocument from './GenerateDocument.jsx';

const navGroups = [
  [
    'Trabalho',
    [
      ['dashboard', 'Início', House],
      ['calendar', 'Agenda', CalendarDays],
      ['intakes', 'Atendimentos', Handshake],
      ['clients', 'Clientes', Users],
      ['cases', 'Processos', BriefcaseBusiness],
      ['people', 'Pessoas', Contact],
      ['finance', 'Financeiro', Wallet],
      ['intimations', 'Intimações', Inbox],
      ['documents', 'Documentos', FileText],
      ['notes', 'Anotações', NotebookPen],
      ['messages', 'Mensagens', MessageCircle],
    ],
  ],
  [
    'Ferramentas',
    [
      ['deadlines', 'Prazos', Calculator],
      ['debts', 'Débitos', TrendingUp],
      ['labor', 'Rescisão', HandCoins],
      ['liquidation', 'Liquidação', Scale],
      ['reports', 'Relatórios', ChartBar],
      ['courts', 'Tribunais', Landmark],
      ['pdf', 'PDF', FileCog],
    ],
  ],
];
const kindLabels = {
  clients: 'Clientes',
  cases: 'Processos',
  tasks: 'Compromissos',
  documents: 'Documentos',
  notes: 'Anotações',
  people: 'Pessoas',
  finance: 'Financeiro',
  intakes: 'Atendimentos',
};
const kindIcons = {
  clients: Users,
  cases: BriefcaseBusiness,
  tasks: CalendarDays,
  documents: FileText,
  notes: NotebookPen,
  people: Contact,
  finance: Wallet,
  intakes: Handshake,
};
const searchFields = [
  'name',
  'title',
  'number',
  'email',
  'phone',
  'document',
  'court',
  'area',
  'content',
  'notes',
  'address',
  'type',
  'opposingParty',
  'role',
  'description',
];
const recoveryText = recovery => {
  if (recovery.reason === 'interrupted')
    return `A atualização para a versão ${recovery.failedVersion} não terminou. O sistema continua na versão atual e seus dados estão preservados. A versão não será tentada de novo automaticamente. Para instalar, em Configurações → Atualizações, use Forçar atualização agora e depois Instalar manualmente.`;
  const why = {
    installing: 'o instalador não terminou corretamente',
    verifying:
      'o instalador não substituiu o programa nesta pasta (permissão do Windows recusada ou antivírus). Em Configurações → Atualizações, use Forçar atualização agora e depois Instalar manualmente',
    starting: 'a nova versão não confirmou a inicialização',
  }[recovery.reason];
  return `Voltamos à versão ${recovery.restoredVersion}${recovery.failedVersion ? ` porque a atualização para a ${recovery.failedVersion} falhou` : ''}${why ? `: ${why}` : ''}. Seus dados foram restaurados da cópia criada antes da atualização.`;
};
function buildNotices(data, today) {
  const list = [];
  const open = data.entities.tasks.filter(t => t.status !== 'Concluída');
  const overdue = open.filter(t => t.due < today + 'T00:00').sort((a, b) => a.due.localeCompare(b.due));
  const todays = open.filter(t => t.due.startsWith(today)).sort((a, b) => a.due.localeCompare(b.due));
  const failed = data.messages.filter(m => ['failed', 'uncertain', 'needs_review'].includes(m.status));
  const waiting = data.messages.filter(m => m.status === 'pending' && m.channel === 'whatsapp');
  const update = data.updates;
  if (overdue.length)
    list.push({
      id: 'overdue',
      tone: 'danger',
      icon: AlertCircle,
      title: plural(overdue.length, 'prazo atrasado', 'prazos atrasados'),
      detail: overdue[0].title,
      go: ['agenda-list'],
    });
  const lateFees = (data.entities.finance || []).filter(
    e => e.direction === 'Receita' && !e.paidDate && e.amount && e.dueDate < today,
  );
  const followUps = (data.entities.intakes || []).filter(
    i => i.followUp && i.followUp <= today && !['Contratado', 'Não contratado'].includes(i.status),
  );
  if (followUps.length)
    list.push({
      id: 'follow-ups',
      tone: 'warning',
      icon: AlertTriangle,
      title: plural(followUps.length, 'retorno de atendimento pendente', 'retornos de atendimento pendentes'),
      detail: followUps[0].name,
      go: ['intakes'],
    });
  const limits = limitationAlerts({ cases: data.entities.cases, documents: data.entities.documents, today });
  if (limits.length) {
    const first = limits[0];
    list.push({
      id: 'limitation',
      tone: first.days <= 30 ? 'danger' : 'warning',
      icon: AlertTriangle,
      title:
        first.kind === 'case'
          ? plural(limits.length, 'prazo de prescrição próximo', 'prazos de prescrição próximos')
          : plural(limits.length, 'documento perto do vencimento', 'documentos perto do vencimento'),
      detail: `${first.title} · ${first.days < 0 ? 'venceu em' : 'vence em'} ${first.deadline.split('-').reverse().join('/')}`,
      go: first.kind === 'case' ? ['cases', first.id] : ['documents'],
    });
  }
  const intimations = (data.intimations || []).filter(i => i.status === 'new');
  if (intimations.length)
    list.push({
      id: 'intimations',
      tone: 'danger',
      icon: AlertCircle,
      title: plural(intimations.length, 'intimação nova', 'intimações novas'),
      detail: `${intimations[0].tipo} · ${intimations[0].tribunal} · ${intimations[0].processoMascara || intimations[0].processo}`,
      go: ['intimations'],
    });
  const moved = Object.keys(data.movementsNew || {});
  if (moved.length)
    list.push({
      id: 'movements',
      tone: 'info',
      icon: Info,
      title: plural(moved.length, 'processo com andamento novo', 'processos com andamentos novos'),
      detail: data.entities.cases.find(c => c.id === moved[0])?.title || '',
      go: ['cases', moved[0]],
    });
  if (lateFees.length)
    list.push({
      id: 'late-fees',
      tone: 'warning',
      icon: AlertTriangle,
      title: plural(lateFees.length, 'recebimento atrasado', 'recebimentos atrasados'),
      detail: lateFees.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].description,
      go: ['finance'],
    });
  if (failed.length)
    list.push({
      id: 'failed',
      tone: 'danger',
      icon: AlertCircle,
      title: plural(failed.length, 'envio precisa', 'envios precisam') + ' de atenção',
      detail: 'Falhou, ficou incerto ou perdeu o horário.',
      go: ['messages'],
    });
  if (update.available?.mandatory)
    list.push({
      id: 'mandatory',
      tone: 'danger',
      icon: AlertTriangle,
      title: `Atualização importante: versão ${update.available.version}`,
      detail: update.available.reason,
      go: ['settings', 'updates'],
    });
  if (waiting.length && data.services.whatsapp.status !== 'connected')
    list.push({
      id: 'whatsapp',
      tone: 'warning',
      icon: AlertTriangle,
      title: 'WhatsApp desconectado',
      detail: `${plural(waiting.length, 'envio aguarda', 'envios aguardam')} a conexão.`,
      go: ['messages'],
    });
  if (data.settings.queuePaused)
    list.push({
      id: 'paused',
      tone: 'warning',
      icon: AlertTriangle,
      title: 'Fila de envios pausada',
      detail: 'Nenhum novo envio será iniciado até você retomar.',
      go: ['messages'],
    });
  if (!data.backups.length)
    list.push({
      id: 'backup',
      tone: 'warning',
      icon: AlertTriangle,
      title: 'Nenhum backup criado',
      detail: 'Crie uma cópia de segurança dos seus dados.',
      go: ['settings', 'backups'],
    });
  if (update.status === 'downloaded' && !update.available?.mandatory)
    list.push({
      id: 'update',
      tone: 'info',
      icon: Info,
      title: `Atualização pronta: versão ${update.available?.version}`,
      detail: 'Instale agora ou ao sair do programa.',
      go: ['settings', 'updates'],
    });
  else if (update.status === 'available' && !update.available?.mandatory)
    list.push({
      id: 'update',
      tone: 'info',
      icon: Info,
      title: `Nova versão disponível: ${update.available?.version}`,
      detail: 'Abra para baixar.',
      go: ['settings', 'updates'],
    });
  if (todays.length)
    list.push({
      id: 'today',
      tone: 'info',
      icon: CalendarDays,
      title: plural(todays.length, 'compromisso hoje', 'compromissos hoje'),
      detail: todays[0].title,
      go: ['calendar'],
      quiet: true,
    });
  return list;
}
export default function App() {
  const [data, setData] = useState(null);
  const [route, setRoute] = useState({ page: 'dashboard' });
  const routeHistory = useRef([]);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [messageDraft, setMessageDraft] = useState(null);
  const [modal, setModal] = useState(null);
  const [noticeFor, setNoticeFor] = useState(null);
  const [generateFor, setGenerateFor] = useState(null);
  const [deadlineFor, setDeadlineFor] = useState(null);
  const [workflowFor, setWorkflowFor] = useState(null);
  const [query, setQuery] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const toastTimer = useRef(null);
  const menuArea = useRef(null);
  const searchInput = useRef(null);
  const mounted = useRef(true);
  const loading = useRef(false);
  const again = useRef(false);
  const reload = useCallback(async () => {
    // A change announced during a reload is not lost: one more reload runs right after.
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        again.current = false;
        const value = await window.advocacia.state();
        if (mounted.current) {
          setData(value);
          setFatal('');
        }
      } while (again.current && mounted.current);
    } finally {
      loading.current = false;
    }
  }, []);
  const notify = useCallback((message, error = false, action = null) => {
    clearTimeout(toastTimer.current);
    if (!message) return;
    setToast({ message, error, action });
    toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : action ? 10000 : 4000);
  }, []);
  const act = useCallback(
    async (fn, success) => {
      setBusy(v => v + 1);
      try {
        const result = await fn();
        await reload();
        if (result !== false) notify(success || (typeof result === 'string' ? result : ''));
        return result;
      } catch (e) {
        notify(e.message, true);
        return false;
      } finally {
        setBusy(v => v - 1);
      }
    },
    [reload, notify],
  );
  useEffect(() => {
    mounted.current = true;
    if (!window.advocacia) {
      setFatal('Abra este sistema pelo aplicativo desktop. Os serviços locais não estão disponíveis no navegador.');
      return;
    }
    void reload().catch(e => setFatal(e.message));
    // The main process announces changes. A hidden window only remembers that something changed and
    // reloads when shown, so nothing is decrypted while it sits in the tray.
    let stale = false;
    const refresh = () => {
      if (document.hidden) stale = true;
      else void reload().catch(() => {});
    };
    const unsubscribe = window.advocacia.onChanged?.(refresh) || (() => {});
    // Safety net in case an announcement is missed.
    const timer = setInterval(refresh, 60000);
    const connection = () => setOnline(navigator.onLine);
    const visible = () => {
      if (!document.hidden && stale) {
        stale = false;
        void reload().catch(() => {});
      }
    };
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      unsubscribe();
      clearInterval(timer);
      clearTimeout(toastTimer.current);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);
  useEffect(() => {
    if (!openMenu) return;
    const close = event => {
      if (!menuArea.current?.contains(event.target)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);
  useEffect(() => {
    if (data?.version) {
      const frame = requestAnimationFrame(() => {
        void window.advocacia.ready().catch(() => {});
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [data?.version]);
  const go = useCallback(next => {
    routeHistory.current = [...routeHistory.current.slice(-30), currentRoute.current];
    setRoute(next);
    setQuery('');
    setOpenMenu(null);
  }, []);
  const back = useCallback(() => {
    const previous = routeHistory.current.pop();
    if (previous) setRoute(previous);
  }, []);
  useEffect(() => {
    const keys = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [back]);
  const navigate = useCallback(
    value => {
      if (value === 'tasks') go({ page: 'calendar', view: 'list' });
      else if (value === 'settings') {
        setSettingsVisit(v => v + 1);
        go({ page: 'settings', tab: 'office' });
      } else if (value === 'about') {
        setSettingsVisit(v => v + 1);
        go({ page: 'settings', tab: 'about' });
      } else go({ page: value });
    },
    [go],
  );
  const navigateSettings = useCallback(
    tab => {
      setSettingsVisit(v => v + 1);
      go({ page: 'settings', tab });
    },
    [go],
  );
  const openDetail = useCallback((kind, id) => go({ page: kind, id }), [go]);
  const composeMessage = useCallback((initial = {}, scheduled = false) => {
    setMessageDraft({
      ...initial,
      ...(scheduled && !initial.scheduleDate && !initial.scheduledFor
        ? { scheduleDate: localDateTime(Date.now() + 3600000) }
        : {}),
    });
    setOpenMenu(null);
  }, []);
  const closeMessage = useCallback(() => setMessageDraft(null), []);
  const create = useCallback((kind, item = {}) => {
    setModal({ kind, item });
    setOpenMenu(null);
  }, []);
  const edit = useCallback((kind, item) => setModal({ kind, item }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const save = useCallback(
    async (kind, entity) => {
      // A new entry with installments becomes one entry per month.
      if (kind === 'finance' && !entity.id && Number(entity.installments) > 1) {
        const saved = await window.advocacia.createInstallments({
          ...entity,
          installments: Number(entity.installments),
        });
        await reload();
        notify(`${saved.length} parcelas criadas.`);
        return saved[0];
      }
      const item = await window.advocacia.save({ kind, entity, applyToSeries: entity.applyToSeries === true });
      await reload();
      notify(
        item?.reminderStatus === 'pending'
          ? 'Registro salvo. O aviso ao cliente foi agendado.'
          : item?.reminderProblem
            ? `Registro salvo. Aviso ao cliente não agendado: ${item.reminderProblem}`
            : item?.seriesCount
              ? `${item.seriesCount} compromissos criados.`
              : item?.seriesUpdated
                ? `Compromisso e ${item.seriesUpdated} seguinte(s) da série atualizados.`
                : 'Registro salvo.',
        !!item?.reminderProblem,
      );
      // A new event for a client: show what will be sent before anything is queued.
      if (item?.noticeNeeded) setNoticeFor(item.id);
      return item;
    },
    [reload, notify],
  );
  const remove = useCallback(
    async (kind, id) => {
      const result = await window.advocacia.remove({ kind, id });
      await reload();
      if (result)
        notify('Registro movido para a lixeira.', false, {
          label: 'Desfazer',
          run: async () => {
            try {
              await window.advocacia.restoreTrash(id);
              await reload();
              notify('Registro restaurado.');
            } catch (e) {
              notify(e.message, true);
            }
          },
        });
      return result;
    },
    [reload, notify],
  );
  const theme = data?.settings.theme;
  const appearance = data?.settings.appearance;
  const density = data?.settings.density;
  const visibleName = data?.settings.appName;
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      root.dataset.appearance = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance;
    };
    apply();
    media.addEventListener('change', apply);
    document.title = visibleName || 'Magnum Office';
    return () => media.removeEventListener('change', apply);
  }, [theme, appearance, density, visibleName]);
  // Ctrl+L locks the program when a password is set.
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void window.advocacia
          .lockApp()
          .then(() => reload())
          .catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reload]);
  const today = dayKey(new Date());
  const notices = useMemo(() => (data && !data.locked ? buildNotices(data, today) : []), [data, today]);
  const searchActive = query.trim().length > 0;
  const groupedResults = useMemo(() => {
    if (!data || data.locked || !searchActive) return [];
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return Object.entries(data.entities)
      .map(([kind, items]) => [
        kind,
        items.filter(item =>
          searchFields.some(field => item[field] && String(item[field]).toLocaleLowerCase('pt-BR').includes(needle)),
        ),
      ])
      .filter(([, items]) => items.length);
  }, [data, query, searchActive]);
  // Text inside documents is searched in the main process (it is encrypted there), after a short pause.
  const [docHits, setDocHits] = useState([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || !window.advocacia?.searchDocuments) {
      setDocHits([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      window.advocacia
        .searchDocuments(q)
        .then(hits => current && setDocHits(hits))
        .catch(() => current && setDocHits([]));
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  if (!data) {
    return (
      <div className="loading-screen">
        <Logo />
        <div>
          {fatal ? <AlertCircle size={28} /> : <LoaderCircle size={28} className="spin" />}
          <h2>{fatal ? 'Precisamos da conexão com o aplicativo' : 'Abrindo o sistema'}</h2>
          <p>{fatal || 'Carregando os serviços e o cofre local...'}</p>
          {fatal && (
            <Button
              onClick={() => {
                void reload().catch(e => setFatal(e.message));
              }}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (data.locked) return <LockScreen appName={data.settings.appName} onUnlocked={reload} />;
  const shared = {
    data,
    navigate,
    navigateSettings,
    openDetail,
    composeMessage,
    create,
    edit,
    act,
    save,
    remove,
    reload,
    back,
    generateDocument: setGenerateFor,
    calculateDeadline: (caseId, initial = {}) => setDeadlineFor({ caseId, ...initial }),
    applyWorkflow: setWorkflowFor,
    calculateSeverance: caseId => go({ page: 'labor', caseId }),
  };
  const page = route.page;
  const attention = notices.filter(n => !n.quiet);
  const overdueCount = data.entities.tasks.filter(t => t.status !== 'Concluída' && t.due < today + 'T00:00').length;
  const newIntimations = (data.intimations || []).filter(i => i.status === 'new').length;
  const followNotice = notice => {
    const [target, tab] = notice.go;
    if (target === 'agenda-list') go({ page: 'calendar', view: 'list' });
    else if (target === 'settings') navigateSettings(tab);
    else if (target === 'cases' && tab) go({ page: 'cases', id: tab });
    else go({ page: target });
  };
  const totalResults = groupedResults.reduce((sum, [, items]) => sum + items.length, 0) + docHits.length;
  const openResult = (kind, item) => {
    if (kind === 'documents') act(() => window.advocacia.openDocument(item.id));
    else if (kind === 'clients' || kind === 'cases') openDetail(kind, item.id);
    else edit(kind, item);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo
            description={data.settings.appDescription}
            name={data.settings.appName}
            logo={data.settings.brandLogo}
          />
        </div>
        <nav aria-label="Navegação principal">
          {navGroups.map(([group, items]) => (
            <div key={group}>
              <div className="nav-label">{group}</div>
              {items.map(([key, label, Icon]) => {
                const active = page === key && !searchActive;
                return (
                  <button
                    aria-label={label}
                    key={key}
                    className={active ? 'active' : ''}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => navigate(key)}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    <span>{label}</span>
                    {key === 'messages' && data.services.pending > 0 && <small>{data.services.pending}</small>}
                    {key === 'calendar' && overdueCount > 0 && <small className="urgent">{overdueCount}</small>}
                    {key === 'intimations' && newIntimations > 0 && <small className="urgent">{newIntimations}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={page === 'settings' ? 'active' : ''}
            onClick={() => {
              navigate('settings');
              if (data.termsAccepted) setSupportOpen(true);
            }}
          >
            <Settings2 size={16} strokeWidth={1.8} />
            <span>Configurações</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="global-search">
            <SearchBox
              inputRef={searchInput}
              value={query}
              onChange={setQuery}
              label="Buscar em todo o escritório"
              placeholder="Buscar no escritório..."
              hint="Ctrl K"
            />
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions" ref={menuArea}>
            <div className="menu-anchor">
              <Button
                icon={Plus}
                aria-label="Novo cadastro"
                aria-expanded={openMenu === 'new'}
                onClick={() => setOpenMenu(v => (v === 'new' ? null : 'new'))}
              >
                Novo
              </Button>
              {openMenu === 'new' && (
                <div className="dropdown" style={{ top: 38, right: 0 }}>
                  {[
                    ['clients', 'Cliente', Users],
                    ['cases', 'Processo', BriefcaseBusiness],
                    ['tasks', 'Compromisso', CalendarDays],
                    ['notes', 'Anotação', NotebookPen],
                    ['people', 'Pessoa', Contact],
                    ['finance', 'Lançamento', Wallet],
                    ['intakes', 'Atendimento', Handshake],
                  ].map(([key, label, Icon]) => (
                    <button key={key} onClick={() => create(key)}>
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="icon-button notification-button"
                aria-label={attention.length ? `Avisos: ${attention.length}` : 'Avisos'}
                aria-expanded={openMenu === 'notices'}
                onClick={() => setOpenMenu(v => (v === 'notices' ? null : 'notices'))}
              >
                <Bell size={18} />
                {attention.length > 0 && <b>{attention.length}</b>}
              </button>
              {openMenu === 'notices' && (
                <div className="notice-center">
                  <header>Avisos</header>
                  {notices.length ? (
                    notices.map(n => (
                      <button
                        className={'notice-item ' + n.tone}
                        key={n.id}
                        onClick={() => {
                          setOpenMenu(null);
                          followNotice(n);
                        }}
                      >
                        <n.icon size={16} />
                        <div>
                          <strong>{n.title}</strong>
                          <small>{n.detail}</small>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p>Nada precisa da sua atenção.</p>
                  )}
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button
                className="topbar-avatar"
                title={data.settings.userName}
                aria-label="Menu do usuário"
                aria-expanded={openMenu === 'user'}
                onClick={() => setOpenMenu(v => (v === 'user' ? null : 'user'))}
              >
                {initials(data.settings.userName)}
              </button>
              {openMenu === 'user' && (
                <div className="dropdown" style={{ top: 38, right: 0 }}>
                  <button onClick={() => navigateSettings('office')}>{data.settings.officeName}</button>
                  <button onClick={() => navigateSettings('appearance')}>Personalizar</button>
                  <button onClick={() => navigateSettings('about')}>Sobre o sistema</button>
                </div>
              )}
            </div>
          </div>
          <div className="window-controls">
            <button aria-label="Minimizar janela" onClick={() => window.advocacia.window('minimize')}>
              <Minus size={14} />
            </button>
            <button aria-label="Maximizar janela" onClick={() => window.advocacia.window('maximize')}>
              <Square size={11} />
            </button>
            <button
              className="window-close"
              aria-label="Fechar janela"
              onClick={() => window.advocacia.window('close')}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <main>
          {!online && (
            <div className="notice amber-notice">
              <AlertTriangle size={16} />
              Você está sem internet. Cadastros, documentos e agenda continuam disponíveis. Mensagens aguardam a
              conexão.
            </div>
          )}
          {data.recovery && (
            <div className="notice recovery-notice">
              <ShieldCheck size={16} />
              <span>{recoveryText(data.recovery)}</span>
              <Button tone="secondary" onClick={() => act(() => window.advocacia.dismissRecoveryNotice())}>
                Entendi
              </Button>
            </div>
          )}
          {data.updates.available?.mandatory && page !== 'settings' && (
            <div className="notice danger-notice">
              <AlertTriangle size={16} />
              <span>
                Atualização importante disponível: versão {data.updates.available.version}.{' '}
                {data.updates.available.reason}
              </span>
              <Button tone="secondary" onClick={() => navigateSettings('updates')}>
                Ver atualização
              </Button>
            </div>
          )}
          {searchActive ? (
            <>
              <PageHeading title={`Resultados para “${query}”`} count={plural(totalResults, 'registro')} />
              <Panel>
                {totalResults ? (
                  [...groupedResults, ...(docHits.length ? [['__documents', docHits]] : [])].map(([kind, items]) => {
                    if (kind === '__documents')
                      return (
                        <div className="search-group search-results" key={kind}>
                          <h3>Dentro dos documentos · {items.length}</h3>
                          {items.map(hit => (
                            <button key={hit.id} onClick={() => act(() => window.advocacia.openDocument(hit.id))}>
                              <span className="case-symbol">
                                <FileSearch size={16} />
                              </span>
                              <div>
                                <strong>{hit.name}</strong>
                                <small className="search-snippet">{hit.snippet}</small>
                              </div>
                              <ArrowRight size={16} />
                            </button>
                          ))}
                        </div>
                      );
                    const Icon = kindIcons[kind] || FileText;
                    return (
                      <div className="search-group search-results" key={kind}>
                        <h3>
                          {kindLabels[kind] || kind} · {items.length}
                        </h3>
                        {items.slice(0, 50).map(item => (
                          <button key={item.id} onClick={() => openResult(kind, item)}>
                            <span className="case-symbol">
                              <Icon size={16} />
                            </span>
                            <div>
                              <strong>{item.name || item.title || item.description}</strong>
                              <small>{item.number || item.role || item.email || item.type || kindLabels[kind]}</small>
                            </div>
                            <ArrowRight size={16} />
                          </button>
                        ))}
                      </div>
                    );
                  })
                ) : (
                  <Empty
                    icon={Search}
                    title="Nenhum registro encontrado"
                    description="Busque por nome, número do processo, e-mail, telefone ou outra informação do cadastro."
                  />
                )}
              </Panel>
            </>
          ) : route.id && (page === 'clients' || page === 'cases') ? (
            <Detail key={page + route.id} kind={page} id={route.id} {...shared} />
          ) : page === 'dashboard' ? (
            <Dashboard {...shared} />
          ) : page === 'calendar' ? (
            <Agenda key={route.view || 'calendar'} initialView={route.view} {...shared} />
          ) : page === 'messages' ? (
            <Messages {...shared} />
          ) : page === 'pdf' ? (
            <PDFTools {...shared} />
          ) : page === 'documents' ? (
            <DocumentWorkspace {...shared} />
          ) : page === 'finance' ? (
            <Finance {...shared} />
          ) : page === 'intimations' ? (
            <Intimations {...shared} />
          ) : page === 'debts' ? (
            <DebtCalculator {...shared} />
          ) : page === 'liquidation' ? (
            <LiquidationCalculator {...shared} />
          ) : page === 'labor' ? (
            <LaborCalculator key={route.caseId || 'labor'} initialCaseId={route.caseId || ''} {...shared} />
          ) : page === 'reports' ? (
            <Reports {...shared} />
          ) : page === 'deadlines' ? (
            <DeadlineCalculator {...shared} />
          ) : page === 'courts' ? (
            <Courts {...shared} />
          ) : page === 'settings' ? (
            <Settings key={(route.tab || 'office') + settingsVisit} {...shared} initialTab={route.tab || 'office'} />
          ) : (
            <Records key={page} kind={page} {...shared} />
          )}
        </main>
      </div>
      {busy > 0 && (
        <div className="operation-indicator" role="status">
          <LoaderCircle size={14} className="spin" />
          Processando...
        </div>
      )}
      {toast && (
        <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                const run = toast.action.run;
                setToast(null);
                void run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button aria-label="Fechar aviso" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {!data.termsAccepted && <TermsPrompt data={data} act={act} reload={reload} />}
      {data.termsAccepted && data.setupRequired && <SetupWizard data={data} act={act} />}
      {data.termsAccepted &&
        !data.setupRequired &&
        page === 'dashboard' &&
        !modal &&
        !messageDraft &&
        data.backupSchedule.dailyNotice && (
          <DailyBackupNotice data={data} act={act} onSettings={() => navigateSettings('backups')} />
        )}
      {supportOpen && (
        <SupportPrompt
          data={data}
          act={act}
          onClose={() => setSupportOpen(false)}
          onSupport={() => {
            setSupportOpen(false);
            navigateSettings('support');
          }}
        />
      )}
      {data.whatsNew && !data.setupRequired && !modal && !messageDraft && (
        <Modal
          title={`Novidades da versão ${data.whatsNew.version}`}
          subtitle="O sistema foi atualizado com sucesso."
          onClose={() => act(() => window.advocacia.dismissWhatsNew())}
        >
          <pre className="legal-document">{data.whatsNew.notes}</pre>
          <div className="form-footer">
            <div>
              <Button onClick={() => act(() => window.advocacia.dismissWhatsNew())}>Entendi</Button>
            </div>
          </div>
        </Modal>
      )}
      {messageDraft?.bulk ? (
        <EmailCampaign data={data} initial={messageDraft} onClose={closeMessage} reload={reload} notify={notify} />
      ) : (
        messageDraft && (
          <MessageComposer data={data} initial={messageDraft} onClose={closeMessage} reload={reload} notify={notify} />
        )
      )}
      {deadlineFor && (
        <DeadlineModal
          data={data}
          act={act}
          caseId={deadlineFor.caseId}
          start={deadlineFor.start}
          mode={deadlineFor.mode}
          onClose={() => setDeadlineFor(null)}
        />
      )}
      {workflowFor && (
        <ApplyWorkflow
          data={data}
          act={act}
          caseItem={workflowFor}
          navigateSettings={navigateSettings}
          onClose={() => setWorkflowFor(null)}
        />
      )}
      {generateFor && (
        <GenerateDocument
          data={data}
          initial={generateFor}
          act={act}
          navigateSettings={navigateSettings}
          onClose={() => setGenerateFor(null)}
        />
      )}
      {noticeFor && (
        <EventNotice
          id={noticeFor}
          onClose={() => setNoticeFor(null)}
          onDone={async result => {
            setNoticeFor(null);
            await reload();
            notify(
              `Avisos agendados: ${result.confirmation ? 'confirmação' : 'sem confirmação'}${result.reminders.length ? ` e ${result.reminders.length} lembrete(s)` : ''}.`,
            );
          }}
        />
      )}
      {modal && (
        <EntityForm
          key={modal.kind + (modal.item?.id || '')}
          kind={modal.kind}
          item={modal.item}
          data={data}
          onClose={closeModal}
          onSave={save}
        />
      )}
    </div>
  );
}
