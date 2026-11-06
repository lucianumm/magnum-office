import TermsPrompt from './TermsPrompt.jsx';
import {DailyBackupNotice} from './BackupPreferences.jsx';
import PDFTools from './PDFTools.jsx';
import DocumentWorkspace from './DocumentWorkspace.jsx';
import Services from './Services.jsx';
import Imports from './Imports.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Users, BriefcaseBusiness, CalendarDays, CalendarClock, FileText, NotebookPen, MessageCircle, Settings2, CircleHelp, Search, Plus, ChevronDown, Bell, ShieldCheck, ArrowRight, X, CheckCircle2, AlertCircle, LoaderCircle, Minus, Square, HardDrive } from 'lucide-react';
import { Logo, Button, SearchBox, PageHeading, Panel, Empty, initials } from './components.jsx';
import Dashboard from './Dashboard.jsx';
import Records, { Agenda } from './Records.jsx';
import EntityForm from './EntityForm.jsx';
import Messages from './Messages.jsx';
import Settings from './Settings.jsx';
import Courts from './Courts.jsx';
import EmailCampaign from './EmailCampaign.jsx';
import MessageComposer, { localDateTime } from './MessageComposer.jsx';
import { Landmark } from 'lucide-react';
const nav = [['dashboard', 'Visão geral', LayoutDashboard], ['clients', 'Clientes', Users], ['cases', 'Processos', BriefcaseBusiness], ['calendar', 'Agenda', CalendarDays], ['tasks', 'Prazos e tarefas', CalendarClock], ['documents', 'Documentos e modelos', FileText], ['pdf','Ferramentas PDF',FileText], ['imports','Importar dados',HardDrive], ['notes', 'Anotações', NotebookPen], ['messages', 'Mensagens', MessageCircle], ['courts','Tribunais e sistemas',Landmark],['services','Lucianum Magnum',BriefcaseBusiness]];
export default function App() {
  const [settingsVisit,setSettingsVisit]=useState(0);
  const [messageDraft, setMessageDraft] = useState(null), [settingsTab,setSettingsTab] = useState('office');
  const [data, setData] = useState(null), [page, setPage] = useState('dashboard'), [modal, setModal] = useState(null), [query, setQuery] = useState(''), [menu, setMenu] = useState(false), [toast, setToast] = useState(null), [fatal, setFatal] = useState(''), [busy, setBusy] = useState(0), [online, setOnline] = useState(navigator.onLine);
  const toastTimer = useRef(null); const quickMenu = useRef(null); const mounted = useRef(true); const loading = useRef(false);
  const reload = useCallback(async () => { if (loading.current) return; loading.current = true; try { const value = await window.advocacia.state(); if (mounted.current) { setData(value); setFatal(''); } } finally { loading.current = false; } }, []);
  const notify = useCallback((message, error = false) => { clearTimeout(toastTimer.current); if (!message) return; setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : 4000); }, []);
  const act = useCallback(async (fn, success) => { setBusy(v => v + 1); try { const result = await fn(); await reload(); if (result !== false) notify(success || (typeof result === 'string' ? result : '')); return result; } catch (e) { notify(e.message, true); return false; } finally { setBusy(v => v - 1); } }, [reload, notify]);
  useEffect(() => {
    mounted.current = true;
    if (!window.advocacia) { setFatal('Abra este sistema pelo aplicativo desktop. Os serviços locais não estão disponíveis no navegador.'); return; }
    void reload().catch(e => setFatal(e.message));
    const timer = setInterval(() => { void reload().catch(() => {}); }, 4000);
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { mounted.current = false; clearInterval(timer); clearTimeout(toastTimer.current); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [reload]);
  useEffect(() => { if (!menu) return; const close = event => { if (!quickMenu.current?.contains(event.target)) setMenu(false); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, [menu]);
  useEffect(() => { if (data?.version) { const frame = requestAnimationFrame(() => { void window.advocacia.ready().catch(() => {}); }); return () => cancelAnimationFrame(frame); } }, [data?.version]);
  const navigate = useCallback(value => { setPage(value); setQuery(''); setMenu(false); if(value==='settings'){setSettingsTab('office');setSettingsVisit(v=>v+1);} }, []);
  const navigateSettings = useCallback(tab => { setPage('settings'); setSettingsTab(tab);setSettingsVisit(v=>v+1); setQuery(''); setMenu(false); }, []);
  const composeMessage = useCallback((initial = {}, scheduled = false) => { setMessageDraft({ ...initial, ...(scheduled && !initial.scheduleDate && !initial.scheduledFor ? { scheduleDate: localDateTime(Date.now()+3600000) } : {}) }); setMenu(false); }, []);
  const closeMessage = useCallback(() => setMessageDraft(null), []);
  const create = useCallback((kind, item = {}) => { setModal({ kind, item }); setMenu(false); }, []);
  const edit = useCallback((kind, item) => setModal({ kind, item }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const save = useCallback(async (kind, entity) => { const item = await window.advocacia.save({ kind, entity }); await reload(); notify('Registro salvo.'); return item; }, [reload, notify]);
  const remove = useCallback(async (kind, id) => { const result = await window.advocacia.remove({ kind, id }); await reload(); if (result) notify('Registro excluído.'); return result; }, [reload, notify]);
  const theme = data?.settings.theme, appearance = data?.settings.appearance, density = data?.settings.density, visibleName = data?.settings.appName;
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { root.dataset.appearance = appearance === 'system' ? media.matches ? 'dark' : 'light' : appearance; };
    apply(); media.addEventListener('change',apply);
    document.title = visibleName || 'Advocacia — Gestão';
    return () => media.removeEventListener('change',apply);
  },[theme,appearance,density,visibleName]);
  if (!data) return <div className="loading-screen"><Logo /><div>{fatal ? <AlertCircle size={28} /> : <LoaderCircle size={28} className="spin" />}<h2>{fatal ? 'Precisamos da conexão com o aplicativo' : 'Preparando seu escritório'}</h2><p>{fatal || 'Abrindo os serviços e o cofre local...'}</p>{fatal && <Button onClick={() => { void reload().catch(e => setFatal(e.message)); }}>Tentar novamente</Button>}</div></div>;
  const shared = { data, navigate, navigateSettings, composeMessage, create, edit, act, save, remove, reload };
  const appName = data.settings.appName || 'Advocacia — Gestão';
  const current = nav.find(n => n[0] === page);
  const searchResults = query.trim() ? Object.entries(data.entities).flatMap(([kind, items]) => items.filter(item => Object.values(item).some(value => String(value).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))).map(item => ({ kind, item }))).slice(0, 100) : [];
  const searchActive = query.trim().length > 0;
  return <div className="app-shell"><div className="titlebar"><span>{appName}</span><div><button aria-label="Minimizar janela" onClick={() => window.advocacia.window('minimize')}><Minus size={14} /></button><button aria-label="Maximizar janela" onClick={() => window.advocacia.window('maximize')}><Square size={11} /></button><button className="window-close" aria-label="Fechar janela" onClick={() => window.advocacia.window('close')}><X size={16} /></button></div></div><aside className="sidebar"><div className="sidebar-brand"><Logo description={data.settings.appDescription} name={data.settings.appName} logo={data.settings.brandLogo} /></div><div className="office-label"><span className="office-mark"><BriefcaseBusiness size={15} /></span><span>{data.settings.officeName}</span><ShieldCheck size={13} /></div><div className="nav-label">ESCRITÓRIO</div><nav aria-label="Navegação principal">{nav.map(([key, label, Icon]) => <button aria-label={label} key={key} className={page === key && !searchActive ? 'active' : ''} aria-current={page === key && !searchActive ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={18} strokeWidth={1.75} /><span>{label}</span>{key === 'messages' && data.services.pending > 0 && <small>{data.services.pending}</small>}{key === 'tasks' && data.entities.tasks.some(t => t.status !== 'Concluída') && <i className="nav-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-local"><span className="local-symbol"><HardDrive size={18} /></span><div><strong>Seu espaço seguro</strong><small>Dados salvos neste computador</small></div><span className="status-dot" /></div><button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings2 size={18} /><span>Configurações</span></button><button className={page === 'about' ? 'active' : ''} onClick={() => navigate('about')}><CircleHelp size={18} /><span>Sobre o sistema</span></button><div className="sidebar-version"><span title={appName}>{appName}</span><span>v{data.version}</span></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Escritório <span>/</span><strong>{searchActive ? 'Busca' : current?.[1] || (page === 'settings' ? 'Configurações' : 'Sobre o sistema')}</strong></div><div className="topbar-actions"><div className="global-search"><SearchBox value={query} onChange={setQuery} label="Buscar em todo o escritório" placeholder="Buscar no escritório..." /></div><span className={'connection-state ' + (!online ? 'offline' : '')}><i />{online ? 'Local conectado' : 'Modo offline'}</span><button className="notification-button" aria-label="Ver prazos pendentes" onClick={() => navigate('tasks')}><Bell size={19} />{data.entities.tasks.some(t => t.status !== 'Concluída') && <i />}</button><span className="topbar-divider" /><div className="topbar-avatar" title={data.settings.userName}>{initials(data.settings.userName)}</div></div></header>
    <main><div className="runtime-reminder"><span className="status-dot"/><span>Mensagens, disparos, lembretes e backups automáticos funcionam com o sistema aberto ou na bandeja e o computador ligado.</span></div>{!online && <div className="notice amber-notice">Você está offline. Cadastros, documentos e agenda continuam disponíveis. Mensagens aguardam a conexão.</div>}{data.recovery && <div className="notice recovery-notice"><ShieldCheck size={18} /><span>Dados recuperados de um backup da versão {data.recovery.restoredVersion}.{data.recovery.failedVersion && ` A versão ${data.recovery.failedVersion} foi bloqueada para novas tentativas automáticas.`}</span></div>}
      {!searchActive && !['settings', 'about'].includes(page) && <div className="quick-create" ref={quickMenu}><button className="quick-create-button" onClick={() => setMenu(v => !v)} aria-expanded={menu}><Plus size={15} />Novo cadastro<ChevronDown size={13} /></button>{menu && <div className="dropdown">{[['clients', 'Cliente', Users], ['cases', 'Processo', BriefcaseBusiness], ['tasks', 'Compromisso', CalendarClock], ['notes', 'Anotação', NotebookPen]].map(([key, label, Icon]) => <button key={key} onClick={() => create(key)}><Icon size={16} />{label}<Plus size={13} /></button>)}</div>}</div>}
      {searchActive ? <><PageHeading eyebrow="BUSCA NO ESCRITÓRIO" title={`Resultados para “${query}”`} description={`${searchResults.length} registro(s) encontrado(s) nos dados locais.`} /><Panel>{searchResults.length ? <div className="search-results">{searchResults.map(({ kind, item }) => <button key={item.id} onClick={() => kind === 'documents' ? act(() => window.advocacia.openDocument(item.id)) : edit(kind, item)}><span className="case-symbol">{kind === 'clients' ? <Users size={20} /> : <FileText size={20} />}</span><div><strong>{item.name || item.title}</strong><small>{nav.find(n => n[0] === kind)?.[1]}</small></div><ArrowRight size={17} /></button>)}</div> : <Empty icon={Search} title="Nenhum registro encontrado" description="Experimente buscar por nome, número do processo ou informação do cadastro." />}</Panel></> : page === 'dashboard' ? <Dashboard {...shared} /> : page === 'calendar' ? <Agenda {...shared} /> : page === 'messages' ? <Messages {...shared} /> : page === 'pdf' ? <PDFTools {...shared}/> : page === 'documents' ? <DocumentWorkspace {...shared}/> : page === 'services' ? <Services {...shared}/> : page === 'imports' ? <Imports {...shared}/> : page === 'courts' ? <Courts {...shared} /> : ['settings', 'about'].includes(page) ? <Settings supportPrompt={page==='settings'&&data.termsAccepted} key={page + settingsTab + settingsVisit} {...shared} initialTab={page === 'about' ? 'about' : settingsTab} /> : <Records key={page} kind={page} {...shared} />}
      <footer className="main-footer"><span><ShieldCheck size={13} />Seu trabalho, protegido e organizado.</span><button className="developer-credit" onClick={() => act(() => window.advocacia.openLink('developer'))}>Desenvolvido por Lucianum</button><span>{appName} <i />{data.settings.channel} · v{data.version}</span></footer>
    </main></div>{busy > 0 && <div className="operation-indicator" role="status"><LoaderCircle size={15} className="spin" />Processando operação...</div>}{toast && <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}<span>{toast.message}</span><button aria-label="Fechar aviso" onClick={() => setToast(null)}><X size={16} /></button></div>}{!data.termsAccepted&&<TermsPrompt data={data} act={act} reload={reload}/>} {data.termsAccepted&&page==='dashboard'&&!modal&&!messageDraft&&data.backupSchedule.dailyNotice&&<DailyBackupNotice data={data} act={act} onSettings={()=>navigateSettings('backups')}/>} {messageDraft?.bulk ? <EmailCampaign data={data} initial={messageDraft} onClose={closeMessage} reload={reload} notify={notify}/> : messageDraft && <MessageComposer data={data} initial={messageDraft} onClose={closeMessage} reload={reload} notify={notify} />}{modal && <EntityForm key={modal.kind + (modal.item?.id || '')} kind={modal.kind} item={modal.item} data={data} onClose={closeModal} onSave={save} />}</div>;
}
