import { useState } from 'react';
import {
  Palette,
  Coffee,
  Mail,
  Settings2,
  RefreshCw,
  Download,
  HardDriveDownload,
  ShieldCheck,
  Database,
  FolderOpen,
  RotateCcw,
  ArrowUpRight,
  Save,
  Github,
  FileDown,
  CheckCircle2,
  Info,
  Activity,
  LoaderCircle,
  Monitor,
  LockKeyhole,
  CloudOff,
  AlertTriangle,
  Trash2,
  FileSpreadsheet,
  Plug,
  BriefcaseBusiness,
  Clock,
  Globe,
} from 'lucide-react';
import BackupPreferences from './BackupPreferences.jsx';
import PrivacySettings from './PrivacySettings.jsx';
import AgentSettings from './AgentSettings.jsx';
import Imports from './Imports.jsx';
import Services from './Services.jsx';
import LawyersSettings from './LawyersSettings.jsx';
import DeadlineSettings from './DeadlineSettings.jsx';
import PublicSettings from './PublicSettings.jsx';
import { AppearanceSettings, EmailSettings, SupportSettings } from './Personalization.jsx';
import { PageHeading, Button, Panel, Badge, Toggle, dateTime, bytes, Logo, Modal } from './components.jsx';

const groups = [
  [
    'Geral',
    [
      ['office', 'Escritório', Settings2],
      ['deadlines', 'Prazos e fluxos', Clock],
      ['appearance', 'Personalizar', Palette],
    ],
  ],
  [
    'Comunicação',
    [
      ['email', 'E-mail', Mail],
      ['integrations', 'Consultas públicas', Globe],
    ],
  ],
  [
    'Dados',
    [
      ['backups', 'Backups e recuperação', Database],
      ['imports', 'Importar dados', FileSpreadsheet],
      ['privacy', 'Privacidade e LGPD', ShieldCheck],
    ],
  ],
  [
    'Sistema',
    [
      ['updates', 'Atualizações', RefreshCw],
      ['agents', 'API / MCP', Plug],
      ['audit', 'Auditoria', Activity],
    ],
  ],
  [
    'Sobre',
    [
      ['about', 'Sobre o sistema', Info],
      ['services', 'Lucianum Magnum', BriefcaseBusiness],
      ['support', 'Apoie o projeto', Coffee],
    ],
  ],
];
const reasons = {
  manual: 'Manual',
  weekly: 'Semanal',
  'pre-update': 'Antes da atualização',
  'pre-restore': 'Antes da restauração',
  'pre-rollback': 'Antes do retorno',
};
function updateTitle(u) {
  if (u.status === 'checking') return 'Consultando novas versões...';
  if (u.status === 'downloading') return `Baixando atualização · ${u.progress}%`;
  if (u.status === 'preparing') return 'Preparando cópia de segurança e instalação...';
  if (u.status === 'downloaded') return 'Atualização conferida e pronta para instalar';
  if (u.status === 'current') return 'Você está na versão mais recente deste canal';
  if (u.status === 'error') return 'A atualização não pôde continuar';
  return u.available ? 'Uma nova versão está disponível' : 'Verifique se há novas versões';
}
export default function Settings({ data, act, reload, initialTab = 'office' }) {
  const [legal, setLegal] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [form, setForm] = useState(() => ({ ...data.settings }));
  const [saving, setSaving] = useState(false);
  const update = (name, value) => setForm(f => ({ ...f, [name]: value }));
  const change = name => ({ value: form[name], onChange: e => update(name, e.target.value) });
  const u = data.updates;
  const changing = ['checking', 'downloading', 'preparing'].includes(u.status);
  async function persist(e) {
    e?.preventDefault();
    setSaving(true);
    try {
      await act(async () => {
        const keys =
          tab === 'office'
            ? [
                'officeName',
                'officeCity',
                'officeAddress',
                'userName',
                'lawyers',
                'background',
                'openAtLogin',
                'notifications',
                'whatsappAutoConnect',
                'scheduleGraceMinutes',
                'notificationLeadMinutes',
              ]
            : [
                'channel',
                'checkFrequency',
                'automatic',
                'autoDownload',
                'installOutsideHours',
                'businessStart',
                'businessEnd',
              ];
        const result = await window.advocacia.saveSettings(Object.fromEntries(keys.map(key => [key, form[key]])));
        setForm(result);
        await reload();
      }, 'Configurações salvas.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading title="Configurações" />
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="Configurações" aria-orientation="vertical">
          {groups.map(([group, items]) => [
            <div className="settings-group" key={group}>
              {group}
            </div>,
            ...items.map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            )),
          ])}
        </div>
        <div>
          {tab === 'office' && (
            <form onSubmit={persist}>
              <Panel title="Informações do escritório" icon={Settings2}>
                <div className="settings-body">
                  <div className="form-grid">
                    <label className="field">
                      <span>Nome do escritório</span>
                      <input {...change('officeName')} required maxLength={160} />
                    </label>
                    <label className="field">
                      <span>Seu nome</span>
                      <input {...change('userName')} required maxLength={160} />
                    </label>
                    <label className="field">
                      <span>Cidade do escritório</span>
                      <input {...change('officeCity')} maxLength={120} placeholder="Ex.: Goiânia/GO" />
                      <small>Usada no local e data dos documentos e no foro do contrato.</small>
                    </label>
                    <label className="field">
                      <span>Endereço do escritório</span>
                      <input
                        {...change('officeAddress')}
                        maxLength={254}
                        placeholder="Rua, número, bairro, cidade/UF"
                      />
                      <small>Entra nas procurações e contratos, onde se recebem intimações.</small>
                    </label>
                  </div>
                  <div className="section-divider" />
                  <LawyersSettings value={form.lawyers || []} onChange={v => update('lawyers', v)} />
                  <div className="section-divider" />
                  <Toggle
                    checked={form.openAtLogin === true}
                    onChange={v => update('openAtLogin', v)}
                    title="Iniciar com o Windows"
                    description="Abre na bandeja ao ligar o computador, para que lembretes, envios agendados e backups continuem funcionando sem precisar abrir o programa."
                  />
                  <Toggle
                    checked={form.background}
                    onChange={v => update('background', v)}
                    title="Ao fechar (X), continuar funcionando em segundo plano"
                    description="Ativado por padrão. Clicar no X oculta a janela e mantém mensagens, aniversários e backups ativos. Clique no ícone da bandeja para reabrir; no menu desse ícone, use Sair do sistema para encerrar."
                  />
                  <Toggle
                    checked={form.notifications}
                    onChange={v => update('notifications', v)}
                    title="Notificações de compromissos"
                    description="Receba um lembrete antes de um compromisso enquanto o programa estiver aberto ou na bandeja."
                  />
                  <Toggle
                    checked={form.whatsappAutoConnect}
                    onChange={v => update('whatsappAutoConnect', v)}
                    title="Reconectar o WhatsApp automaticamente"
                    description="Ao abrir o programa ou recuperar a conexão, tenta retomar uma sessão já vinculada."
                  />
                  <div className="section-divider" />
                  <div className="form-grid">
                    <label className="field">
                      <span>Tolerância para disparos atrasados</span>
                      <select
                        value={form.scheduleGraceMinutes}
                        onChange={e => update('scheduleGraceMinutes', Number(e.target.value))}
                      >
                        <option value={15}>15 minutos</option>
                        <option value={60}>1 hora</option>
                        <option value={240}>4 horas</option>
                        <option value={1440}>24 horas</option>
                      </select>
                      <small>Após esse período, o envio agendado fica para revisão e precisa ser reagendado.</small>
                    </label>
                    <label className="field">
                      <span>Antecedência das notificações no PC</span>
                      <select
                        aria-label="Antecedência das notificações"
                        value={form.notificationLeadMinutes}
                        onChange={e => update('notificationLeadMinutes', Number(e.target.value))}
                      >
                        {[
                          [0, 'No horário'],
                          [5, '5 minutos'],
                          [15, '15 minutos'],
                          [30, '30 minutos'],
                          [60, '1 hora'],
                          [1440, '1 dia'],
                        ].map(([n, label]) => (
                          <option key={n} value={n}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <small>A exibição depende das permissões e do modo Não incomodar do Windows.</small>
                    </label>
                  </div>
                  <Button
                    type="button"
                    tone="secondary"
                    disabled={!data.notificationsSupported}
                    onClick={() =>
                      act(() => window.advocacia.testNotification(), 'Notificação de teste solicitada ao Windows.')
                    }
                  >
                    Testar notificação no PC
                  </Button>
                  <div className="help-inline">
                    <LockKeyhole size={16} />
                    <span>
                      Dados criptografados com AES-256-GCM. A chave é protegida pelo cofre do sistema operacional.
                    </span>
                  </div>
                </div>
                <div className="settings-footer">
                  <span>As alterações valem para este computador.</span>
                  <Button type="submit" icon={Save} busy={saving}>
                    Salvar configurações
                  </Button>
                </div>
              </Panel>
            </form>
          )}
          {tab === 'appearance' && <AppearanceSettings data={data} act={act} reload={reload} />}
          {tab === 'privacy' && <PrivacySettings data={data} act={act} setLegal={setLegal} />}
          {tab === 'agents' && <AgentSettings data={data} act={act} />}
          {tab === 'email' && <EmailSettings data={data} act={act} />}
          {tab === 'support' && <SupportSettings data={data} act={act} />}
          {tab === 'imports' && <Imports act={act} reload={reload} />}
          {tab === 'deadlines' && <DeadlineSettings data={data} act={act} />}
          {tab === 'integrations' && <PublicSettings data={data} act={act} />}
          {tab === 'services' && <Services act={act} />}
          {tab === 'updates' && (
            <div className="settings-stack">
              <Panel
                title="Atualizações do sistema"
                icon={RefreshCw}
                aside={<Badge tone="green">v{data.version}</Badge>}
              >
                <div className="settings-body">
                  <div className="update-status">
                    <span className={'update-symbol ' + (u.status === 'error' ? 'error' : '')}>
                      {changing ? (
                        <LoaderCircle className="spin" size={22} />
                      ) : u.status === 'error' ? (
                        <AlertTriangle size={22} />
                      ) : u.available ? (
                        <Download size={22} />
                      ) : (
                        <ShieldCheck size={22} />
                      )}
                    </span>
                    <div>
                      <h2>{updateTitle(u)}</h2>
                      <p>{u.error || 'Cada versão é conferida por assinatura digital antes da instalação.'}</p>
                      <small>Última verificação: {dateTime(data.settings.lastCheck)}</small>
                    </div>
                    {!changing && (
                      <Button
                        tone="secondary"
                        icon={RefreshCw}
                        onClick={() => act(() => window.advocacia.checkUpdate())}
                      >
                        Verificar atualizações
                      </Button>
                    )}
                  </div>
                  {u.status === 'downloading' && (
                    <progress max="100" value={u.progress} aria-label="Progresso do download" />
                  )}
                  {u.available && (
                    <div className="release-card">
                      <div>
                        <strong>Versão {u.available.version}</strong>
                        <Badge tone={u.available.mandatory ? 'red' : 'green'}>
                          {u.available.mandatory ? 'Importante' : 'Disponível'}
                        </Badge>
                      </div>
                      <p>
                        {dateTime(u.available.publishedAt)} · {bytes(u.available.bytes)}
                      </p>
                      {u.available.mandatory && <div className="notice amber-notice">{u.available.reason}</div>}
                      <pre>{u.available.notes}</pre>
                      <div className="release-hash">
                        SHA-256 <code>{u.available.sha256}</code>
                      </div>
                      <div className="release-actions">
                        {u.status === 'downloaded' ? (
                          <>
                            <Button
                              tone="secondary"
                              icon={Clock}
                              onClick={() =>
                                act(
                                  () => window.advocacia.installUpdateOnQuit(!u.installOnQuit),
                                  u.installOnQuit
                                    ? 'Instalação ao sair cancelada.'
                                    : 'A atualização será instalada quando você sair do programa.',
                                )
                              }
                            >
                              {u.installOnQuit ? 'Cancelar instalação ao sair' : 'Instalar ao sair'}
                            </Button>
                            <Button
                              icon={HardDriveDownload}
                              onClick={() => act(() => window.advocacia.installUpdate())}
                            >
                              Instalar atualização
                            </Button>
                            {data.platform === 'win32' && data.packaged && (
                              <Button tone="ghost" onClick={() => act(() => window.advocacia.installUpdateManually())}>
                                Instalar manualmente
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            icon={Download}
                            busy={changing}
                            onClick={() => act(() => window.advocacia.downloadUpdate())}
                          >
                            Baixar atualização
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <section className="notice subtle-notice manual-update" aria-label="Atualização manual">
                    <RefreshCw size={18} />
                    <div>
                      <strong>Atualização manual</strong>
                      <p>
                        Faz uma nova consulta e um novo download, mesmo com as atualizações automáticas desativadas ou
                        depois de uma tentativa com falha.
                      </p>
                      <div className="heading-actions">
                        <Button
                          tone="secondary"
                          icon={RefreshCw}
                          disabled={changing}
                          onClick={() => act(() => window.advocacia.forceUpdate())}
                        >
                          Forçar atualização agora
                        </Button>
                        <Button
                          tone="ghost"
                          icon={ArrowUpRight}
                          onClick={() => act(() => window.advocacia.openLink('changelog'))}
                        >
                          Baixar instalador pelo GitHub
                        </Button>
                      </div>
                      <small>
                        Para reinstalar, use o instalador oficial na mesma pasta. Seus cadastros ficam preservados.
                      </small>
                    </div>
                  </section>
                  {!u.trusted && (
                    <div className="notice subtle-notice">
                      <Info size={16} />
                      <span>
                        Esta versão não contém a chave pública de publicação. Downloads e instalações de atualizações
                        ficam bloqueados.
                      </span>
                    </div>
                  )}
                  <div className="update-facts">
                    <span>
                      <Monitor size={14} />
                      Versão instalada: {data.version}
                    </span>
                    <span>
                      <ShieldCheck size={14} />
                      Canal: {data.settings.channel}
                    </span>
                    <span>
                      <RefreshCw size={14} />
                      Última atualização: {dateTime(data.settings.lastUpdate)}
                    </span>
                  </div>
                </div>
              </Panel>
              <form onSubmit={persist}>
                <Panel title="Preferências de atualização" icon={Settings2}>
                  <div className="settings-body">
                    <div className="form-grid">
                      <label className="field full">
                        <span>Repositório do GitHub</span>
                        <div className="input-with-icon">
                          <Github size={16} />
                          <input readOnly value="lucianumm/magnum-office" maxLength={254} />
                        </div>
                        <small>
                          Repositório oficial. As atualizações são consultadas diretamente nas Releases; o GitHub recebe
                          apenas o endereço IP desta conexão.
                        </small>
                      </label>
                      <label className="field">
                        <span>Canal de atualização</span>
                        <select {...change('channel')}>
                          <option value="stable">Stable — versões estáveis</option>
                          <option value="beta">Beta — versões de teste e estáveis</option>
                          <option value="development">Development — experimental</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Quando verificar</span>
                        <select {...change('checkFrequency')}>
                          <option value="startup">Ao iniciar e a cada 24 horas</option>
                          <option value="daily">Diariamente</option>
                          <option value="weekly">Semanalmente</option>
                        </select>
                      </label>
                    </div>
                    <div className="section-divider" />
                    <Toggle
                      checked={form.automatic}
                      onChange={v => update('automatic', v)}
                      title="Verificar atualizações automaticamente"
                      description="Avisa quando houver uma nova versão. A instalação sempre depende da sua confirmação, salvo a opção abaixo."
                    />
                    <Toggle
                      checked={form.autoDownload}
                      disabled={!form.automatic}
                      onChange={v => update('autoDownload', v)}
                      title="Baixar automaticamente"
                      description="O instalador é conferido antes de ficar disponível para instalação."
                    />
                    <Toggle
                      checked={form.installOutsideHours}
                      disabled={!form.automatic || !form.autoDownload || data.platform !== 'win32'}
                      onChange={v => update('installOutsideHours', v)}
                      title="Autorizar instalação automática fora do expediente"
                      description="Instala e reinicia sem nova confirmação à noite e nos fins de semana, somente se a janela do programa não estiver em uso e não houver operações em andamento."
                    />
                    <div className="form-grid business-hours">
                      <label className="field">
                        <span>Início do expediente</span>
                        <select
                          value={form.businessStart}
                          onChange={e => update('businessStart', Number(e.target.value))}
                        >
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>
                              {String(i).padStart(2, '0')}:00
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Fim do expediente</span>
                        <select value={form.businessEnd} onChange={e => update('businessEnd', Number(e.target.value))}>
                          {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>
                              {String(i).padStart(2, '0')}:00
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="help-inline">
                      <ShieldCheck size={16} />
                      <span>
                        Antes de instalar: operações concluídas, filas pausadas, cópia de segurança criada e assinatura
                        verificada. Se a nova versão não abrir, o sistema volta sozinho à anterior.
                      </span>
                    </div>
                  </div>
                  <div className="settings-footer">
                    <span>Instalação manual sempre pede confirmação.</span>
                    <Button type="submit" busy={saving} icon={Save}>
                      Salvar preferências
                    </Button>
                  </div>
                </Panel>
              </form>
            </div>
          )}
          {tab === 'backups' && (
            <>
              <BackupPreferences data={data} act={act} />
              <Panel
                title="Cópias de segurança"
                icon={Database}
                aside={
                  <div className="heading-actions">
                    <Button
                      tone="secondary"
                      icon={FolderOpen}
                      onClick={() => act(() => window.advocacia.openBackups())}
                    >
                      Abrir pasta
                    </Button>
                    <Button
                      icon={Database}
                      onClick={() => act(() => window.advocacia.createBackup(), 'Backup criado e verificado.')}
                    >
                      Criar backup agora
                    </Button>
                  </div>
                }
              >
                <div className="notice backup-notice">
                  <ShieldCheck size={16} />
                  <span>
                    Os backups preservam dados, documentos criptografados e configurações. A recuperação usa a mesma
                    conta e o cofre deste computador. Antes de trocar de computador, exporte seus dados. Cópias criadas
                    por atualizações são limpas automaticamente.
                  </span>
                </div>
                {data.backups.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Criado em</th>
                          <th>Versão</th>
                          <th>Motivo</th>
                          <th>Tamanho</th>
                          <th>Recuperação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.backups.map(b => (
                          <tr key={b.id}>
                            <td>{dateTime(b.createdAt)}</td>
                            <td>
                              <span className="area-tag">v{b.version}</span>
                            </td>
                            <td>{reasons[b.reason] || b.reason}</td>
                            <td>{bytes(b.bytes)}</td>
                            <td>
                              <div className="row-actions">
                                <Button
                                  tone="secondary"
                                  icon={RotateCcw}
                                  onClick={() => act(() => window.advocacia.restoreBackup(b.id))}
                                >
                                  Restaurar dados
                                </Button>
                                {b.runtime && (
                                  <Button tone="ghost" onClick={() => act(() => window.advocacia.rollback(b.id))}>
                                    Voltar versão
                                  </Button>
                                )}
                                <button
                                  className="icon-button danger"
                                  aria-label={`Excluir backup de ${dateTime(b.createdAt)}`}
                                  onClick={() => act(() => window.advocacia.removeBackup(b.id), 'Backup excluído.')}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="backup-empty">
                    <Database size={28} strokeWidth={1.4} />
                    <h3>Nenhum backup criado</h3>
                    <p>Crie o primeiro. Novas atualizações também criam uma cópia automaticamente.</p>
                  </div>
                )}
              </Panel>
              <Panel title="Portabilidade dos seus dados" icon={FileDown}>
                <div className="export-section">
                  <div>
                    <h3>Exportação legível</h3>
                    <p>Cadastros em JSON e documentos nos formatos originais. Guarde em um local protegido.</p>
                  </div>
                  <Button
                    tone="secondary"
                    icon={FileDown}
                    onClick={() => act(() => window.advocacia.exportData(), 'Dados exportados.')}
                  >
                    Exportar dados e documentos
                  </Button>
                </div>
              </Panel>
            </>
          )}
          {tab === 'about' && (
            <div className="about-layout">
              <Panel>
                <div className="about-brand">
                  <Logo
                    description={data.settings.appDescription}
                    name={data.settings.appName}
                    logo={data.settings.brandLogo}
                  />
                  <h1>Magnum Office</h1>
                  <p>Gestão jurídica local. Desenvolvido por Lucianum.</p>
                  <Badge tone="green">
                    Versão {data.version}
                    {!data.packaged ? ' · Desenvolvimento' : ''}
                  </Badge>
                </div>
                <div className="about-links">
                  {[
                    ['repository', 'Repositório GitHub', Github],
                    ['documentation', 'Documentação', FileDown],
                    ['changelog', 'Notas de versão', RefreshCw],
                    ['developer', 'Falar com o desenvolvedor', Info],
                  ].map(([key, name, Icon]) => (
                    <button key={key} onClick={() => act(() => window.advocacia.openLink(key))}>
                      <Icon size={16} />
                      {name}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel title="Saúde do sistema" icon={Activity}>
                <dl className="health-list">
                  <div>
                    <dt>
                      <Monitor size={15} />
                      Sistema operacional
                    </dt>
                    <dd>{{ win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[data.platform]}</dd>
                  </div>
                  <div>
                    <dt>
                      <Database size={15} />
                      Banco de dados
                    </dt>
                    <dd>
                      <Badge tone={data.dbStatus === 'ok' ? 'green' : 'red'}>
                        {data.dbStatus === 'ok' ? 'Integridade OK' : 'Erro'}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <CheckCircle2 size={15} />
                      Serviços locais
                    </dt>
                    <dd>
                      <Badge tone="green">Em execução</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>WhatsApp</dt>
                    <dd>{data.services.whatsapp.status === 'connected' ? 'Conectado' : 'Desconectado'}</dd>
                  </div>
                  <div>
                    <dt>Resend</dt>
                    <dd>{data.services.email === 'configured' ? 'Configurado' : 'Não configurado'}</dd>
                  </div>
                  <div>
                    <dt>Canal</dt>
                    <dd>{data.settings.channel}</dd>
                  </div>
                  <div>
                    <dt>Última verificação</dt>
                    <dd>{dateTime(data.settings.lastCheck)}</dd>
                  </div>
                  <div>
                    <dt>Última atualização</dt>
                    <dd>{dateTime(data.settings.lastUpdate)}</dd>
                  </div>
                </dl>
                <div className="health-actions">
                  <Button
                    tone="secondary"
                    icon={RefreshCw}
                    onClick={() => {
                      setTab('updates');
                      act(() => window.advocacia.checkUpdate());
                    }}
                  >
                    Verificar atualizações
                  </Button>
                  <Button
                    tone="secondary"
                    icon={FileDown}
                    onClick={() => act(() => window.advocacia.diagnostic(), 'Diagnóstico exportado.')}
                  >
                    Exportar diagnóstico
                  </Button>
                  <Button tone="ghost" icon={FolderOpen} onClick={() => act(() => window.advocacia.openLogs())}>
                    Abrir logs
                  </Button>
                </div>
              </Panel>
              <div className="help-inline about-private">
                <CloudOff size={16} />
                <span>
                  O diagnóstico contém apenas informações técnicas. Chaves, mensagens, documentos e dados de clientes
                  não são incluídos.
                </span>
              </div>
            </div>
          )}
          {tab === 'audit' && (
            <Panel
              title="Registro de atividades técnicas"
              icon={Activity}
              aside={<Badge tone="neutral">Últimos 100 eventos</Badge>}
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Evento</th>
                      <th>Informações técnicas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audit.map(row => (
                      <tr key={row.id}>
                        <td>{dateTime(row.createdAt)}</td>
                        <td>
                          <code>{row.event}</code>
                        </td>
                        <td>
                          <code className="audit-meta">{JSON.stringify(row.metadata)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                <span>Atividades de atualização, segurança e operação.</span>
                <Button tone="ghost" icon={FolderOpen} onClick={() => act(() => window.advocacia.openLogs())}>
                  Abrir pasta de logs
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
      {legal && (
        <Modal title={legal.title} onClose={() => setLegal(null)}>
          <pre className="legal-document">{legal.text}</pre>
        </Modal>
      )}
    </>
  );
}
