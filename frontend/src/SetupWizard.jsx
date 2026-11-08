import { useState } from 'react';
import { Building2, Scale, Palette, Upload, Trash2, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Modal, Button, Logo, Toggle } from './components.jsx';
import LawyersSettings from './LawyersSettings.jsx';
import { themes } from './Personalization.jsx';

const steps = [
  { title: 'Escritório', icon: Building2 },
  { title: 'Advogados', icon: Scale },
  { title: 'Identidade visual', icon: Palette },
];
// Values that come with every new installation; the office has to replace them.
const placeholders = { officeName: 'Meu escritório', userName: 'Administrador', appDescription: 'Gestão jurídica' };
const own = (value, key) => (value && value !== placeholders[key] ? value : '');

// Shown once after the terms, and impossible to close: the system is used only after the office is configured.
export default function SetupWizard({ data, act }) {
  const s = data.settings;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    officeName: own(s.officeName, 'officeName'),
    officeCity: s.officeCity || '',
    officeAddress: s.officeAddress || '',
    userName: own(s.userName, 'userName'),
    appName: s.appName || '',
    appDescription: own(s.appDescription, 'appDescription'),
    theme: s.theme || 'teal',
    lawyers: s.lawyers?.length ? s.lawyers : [{ name: '', oab: '', uf: '', email: '' }],
    noLogo: false,
  }));
  // The visible name and the first lawyer follow what was typed before, until edited.
  const [appNameEdited, setAppNameEdited] = useState(Boolean(s.appName));
  const set = (key, value) => {
    setError('');
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === 'officeName' && !appNameEdited) next.appName = value.slice(0, 60);
      if (key === 'userName' && f.lawyers.length === 1 && (!f.lawyers[0].name || f.lawyers[0].name === f.userName))
        next.lawyers = [{ ...f.lawyers[0], name: value }];
      return next;
    });
  };
  const color = themes.find(t => t[0] === form.theme)?.[2];
  const hasLogo = Boolean(s.brandLogo);

  function check() {
    if (step === 0) {
      if (form.officeName.trim().toLowerCase() === placeholders.officeName.toLowerCase())
        return 'Troque "Meu escritório" pelo nome do seu escritório.';
    }
    if (step === 1) {
      if (form.userName.trim().toLowerCase() === placeholders.userName.toLowerCase())
        return 'Troque "Administrador" pelo seu nome.';
      if (!form.lawyers.length) return 'Cadastre pelo menos um advogado com a OAB.';
    }
    if (step === 2 && !hasLogo && !form.noLogo) return 'Escolha a logo do escritório ou indique que ainda não tem uma.';
    return '';
  }
  async function submit(event) {
    event.preventDefault();
    const problem = check();
    if (problem) return setError(problem);
    if (step < steps.length - 1) return setStep(step + 1);
    setBusy(true);
    const { noLogo, ...rest } = form;
    const result = await act(
      () => window.advocacia.completeSetup({ ...rest, noLogo: noLogo && !hasLogo }),
      'Escritório configurado. Tudo pronto para começar.',
    );
    setBusy(false);
    if (result === false) setError('Confira os dados destacados no aviso e tente novamente.');
  }

  return (
    <Modal
      title="Configure o seu escritório"
      subtitle="Leva um minuto. Estes dados entram nos documentos, procurações, e-mails e na tela do sistema."
      onClose={() => {}}
      wide
      className="setup-modal"
    >
      <form onSubmit={submit}>
        <ol className="setup-progress" aria-label="Etapas da configuração">
          {steps.map((item, i) => (
            <li key={item.title} className={i === step ? 'current' : i < step ? 'done' : ''}>
              <span>{i < step ? <Check size={14} /> : <item.icon size={14} />}</span>
              {item.title}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="form-grid">
            <label className="field full">
              <span>Nome do escritório</span>
              <input
                value={form.officeName}
                onChange={e => set('officeName', e.target.value)}
                required
                minLength={2}
                maxLength={160}
                placeholder="Ex.: Silva & Souza Advogados Associados"
              />
              <small>Aparece nos documentos gerados, nos relatórios e nos e-mails aos clientes.</small>
            </label>
            <label className="field">
              <span>Cidade/UF</span>
              <input
                value={form.officeCity}
                onChange={e => set('officeCity', e.target.value)}
                required
                minLength={2}
                maxLength={120}
                placeholder="Ex.: Goiânia/GO"
              />
              <small>Usada no local e data das procurações e contratos.</small>
            </label>
            <label className="field">
              <span>Endereço (opcional)</span>
              <input
                value={form.officeAddress}
                onChange={e => set('officeAddress', e.target.value)}
                maxLength={254}
                placeholder="Rua, número, sala, bairro"
              />
              <small>Entra na qualificação do advogado nas procurações.</small>
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <label className="field full">
              <span>Seu nome</span>
              <input
                value={form.userName}
                onChange={e => set('userName', e.target.value)}
                required
                minLength={2}
                maxLength={160}
                placeholder="Como você quer ser chamado no sistema"
              />
              <small>Aparece no canto da tela e na saudação inicial.</small>
            </label>
            <div className="full">
              <LawyersSettings value={form.lawyers} onChange={v => set('lawyers', v)} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="form-grid setup-identity">
            <div className="setup-identity-fields">
              <label className="field">
                <span>Nome exibido no sistema</span>
                <input
                  value={form.appName}
                  onChange={e => {
                    setAppNameEdited(true);
                    set('appName', e.target.value);
                  }}
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Ex.: Silva & Souza Advocacia"
                />
                <small>Substitui “Magnum Office” no menu, na janela e na bandeja.</small>
              </label>
              <label className="field">
                <span>Descrição abaixo do nome</span>
                <input
                  aria-label="Descrição do sistema"
                  value={form.appDescription}
                  onChange={e => set('appDescription', e.target.value)}
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="Ex.: Advocacia cível e trabalhista"
                />
              </label>
              <div className="logo-editor">
                <div className="logo-preview">
                  {hasLogo ? <img src={s.brandLogo} alt="Logo atual do escritório" /> : <Logo small />}
                </div>
                <div>
                  <h3>Logo do escritório</h3>
                  <p>PNG, JPG ou WebP, até 5 MB.</p>
                  <div className="heading-actions">
                    <Button
                      type="button"
                      tone="secondary"
                      icon={Upload}
                      onClick={() => {
                        setError('');
                        act(() => window.advocacia.importLogo(), 'Logo atualizada.');
                      }}
                    >
                      {hasLogo ? 'Trocar logo' : 'Escolher logo'}
                    </Button>
                    {hasLogo && (
                      <Button
                        type="button"
                        tone="ghost"
                        icon={Trash2}
                        onClick={() => act(() => window.advocacia.removeLogo(), 'Logo removida.')}
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {!hasLogo && (
                <Toggle
                  checked={form.noLogo}
                  onChange={v => set('noLogo', v)}
                  title="Ainda não tenho uma logo"
                  description="O sistema usa o ícone padrão. Você pode escolher a logo depois em Configurações → Personalizar."
                />
              )}
              <div className="field">
                <span>Cor principal</span>
              </div>
              <div className="theme-options" role="group" aria-label="Cor do tema">
                {themes.map(([id, name, hex]) => (
                  <button
                    type="button"
                    key={id}
                    className={form.theme === id ? 'selected' : ''}
                    aria-pressed={form.theme === id}
                    onClick={() => set('theme', id)}
                  >
                    <i style={{ background: hex }} />
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            </div>
            <aside className="brand-preview" style={{ '--preview-accent': color }}>
              <span className="eyebrow">PRÉVIA</span>
              <Logo description={form.appDescription} name={form.appName} logo={s.brandLogo} />
              <div className="preview-line" />
              <div className="preview-card">
                <span>{form.officeName || 'Seu escritório'}</span>
                <strong>Bem-vindo, {form.userName.split(/\s+/)[0] || 'doutor(a)'}</strong>
                <span className="preview-button">Novo cadastro</span>
              </div>
            </aside>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span>
            Etapa {step + 1} de {steps.length}
          </span>
          <div>
            {step > 0 && (
              <Button
                type="button"
                tone="ghost"
                icon={ArrowLeft}
                onClick={() => {
                  setError('');
                  setStep(step - 1);
                }}
              >
                Voltar
              </Button>
            )}
            <Button type="submit" icon={step < steps.length - 1 ? ArrowRight : Check} busy={busy}>
              {step < steps.length - 1 ? 'Continuar' : 'Concluir configuração'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
