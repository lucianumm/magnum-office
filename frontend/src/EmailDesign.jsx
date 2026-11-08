import { useEffect, useState } from 'react';
import { Eye, Monitor, Smartphone, Palette, Image, RotateCcw } from 'lucide-react';
import { Button, Modal } from './components.jsx';
export function useEmailPreview(content, design) {
  const [preview, setPreview] = useState(''),
    [error, setError] = useState('');
  const html = content.html || '',
    body = content.body || '';
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      window.advocacia
        .previewEmail({
          html,
          body:
            body ||
            'Olá!\nEste é um exemplo da apresentação da sua mensagem. Edite o conteúdo e personalize a identidade do escritório.',
          design,
        })
        .then(r => {
          if (active) {
            setPreview(r.html);
            setError('');
          }
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [html, body, design]);
  return { preview, error };
}
export function PreviewFrame({ content, design }) {
  const { preview, error } = useEmailPreview(content, design);
  const [mobile, setMobile] = useState(false);
  return (
    <div className="email-preview-workspace">
      <div className="preview-device-bar">
        <span>
          <Eye size={15} />
          Prévia da mensagem
        </span>
        <div>
          <button
            type="button"
            aria-label="Prévia no computador"
            aria-pressed={!mobile}
            onClick={() => setMobile(false)}
          >
            <Monitor size={16} />
          </button>
          <button type="button" aria-label="Prévia no celular" aria-pressed={mobile} onClick={() => setMobile(true)}>
            <Smartphone size={16} />
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : (
        <iframe title="Prévia do e-mail" sandbox="" srcDoc={preview} className={mobile ? 'mobile-email-preview' : ''} />
      )}
      <small>A aparência pode variar entre Gmail, Outlook e outros leitores. Nenhum e-mail é enviado na prévia.</small>
    </div>
  );
}
export function EmailPreview({ model, onClose }) {
  return (
    <Modal
      wide
      title={model.title || 'Prévia do e-mail'}
      subtitle={model.subject || 'Confira cabeçalho, conteúdo e rodapé antes de usar o modelo.'}
      onClose={onClose}
    >
      <PreviewFrame content={model} design={model.emailDesign} />
    </Modal>
  );
}
export default function EmailDesign({ design = {}, onChange }) {
  const [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  const update = (k, v) => onChange({ ...design, [k]: v });
  return (
    <div className="email-design-controls">
      <div className="email-design-heading">
        <Palette size={19} />
        <div>
          <h3>Identidade da mensagem</h3>
          <p>Um layout pronto, com a personalidade do seu escritório.</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field full">
          <span>Estilo da mensagem</span>
          <select
            aria-label="Estilo da mensagem"
            value={design.enabled === false ? 'plain' : 'designed'}
            onChange={e => update('enabled', e.target.value === 'designed')}
          >
            <option value="designed">Cabeçalho, bordas e rodapé</option>
            <option value="plain">Somente conteúdo</option>
          </select>
        </label>
        <label className="field">
          <span>Nome no cabeçalho</span>
          <input
            aria-label="Nome no cabeçalho"
            value={design.brand || ''}
            maxLength={160}
            placeholder="Nome do escritório"
            onChange={e => update('brand', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Descrição do cabeçalho</span>
          <input
            aria-label="Descrição do cabeçalho"
            value={design.tagline || ''}
            maxLength={160}
            placeholder="Sua descrição profissional"
            onChange={e => update('tagline', e.target.value)}
          />
        </label>
        {[
          ['headerColor', 'Cabeçalho', '#191d23'],
          ['accentColor', 'Destaque', '#b89b63'],
          ['pageColor', 'Fundo externo', '#f2f4f7'],
          ['bodyColor', 'Fundo do conteúdo', '#ffffff'],
          ['textColor', 'Texto', '#28333c'],
          ['borderColor', 'Bordas', '#dce2e7'],
        ].map(([key, label, fallback]) => (
          <label className="field email-color-field" key={key}>
            <span>{label}</span>
            <div>
              <input
                type="color"
                aria-label={'Cor: ' + label}
                value={design[key] || fallback}
                onChange={e => update(key, e.target.value)}
              />
              <code>{design[key] || fallback}</code>
            </div>
          </label>
        ))}
        <label className="field">
          <span>Cantos arredondados</span>
          <input
            aria-label="Cantos arredondados"
            type="range"
            min={0}
            max={30}
            value={design.radius ?? 12}
            onChange={e => update('radius', Number(e.target.value))}
          />
          <small>{design.radius ?? 12} px</small>
        </label>
        <label className="field">
          <span>Espessura da borda</span>
          <select
            aria-label="Espessura da borda"
            value={design.borderWidth ?? 1}
            onChange={e => update('borderWidth', Number(e.target.value))}
          >
            {[0, 1, 2, 3, 4, 5, 6].map(n => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label className="field full">
          <span>Rodapé / assinatura</span>
          <textarea
            aria-label="Rodapé do e-mail"
            value={design.footer ?? 'Mensagem enviada pelo escritório. Em caso de dúvida, entre em contato.'}
            maxLength={600}
            rows={3}
            onChange={e => update('footer', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Texto do botão (opcional)</span>
          <input
            value={design.buttonLabel || ''}
            maxLength={160}
            onChange={e => update('buttonLabel', e.target.value)}
            placeholder="Fale com nosso escritório"
          />
        </label>
        <label className="field">
          <span>Link do botão</span>
          <input
            aria-label="Link do botão do e-mail"
            value={design.buttonURL || ''}
            maxLength={1000}
            onChange={e => update('buttonURL', e.target.value)}
            placeholder="https://wa.me/..."
          />
        </label>
        <label className="email-logo-choice full">
          <input
            type="checkbox"
            checked={design.useOfficeLogo !== false}
            onChange={e => update('useOfficeLogo', e.target.checked)}
          />
          Usar a logo do escritório no cabeçalho, quando cadastrada
        </label>
        <div className="full email-banner-tools">
          <Button
            type="button"
            onClick={async () => {
              try {
                await window.advocacia.saveSettings({ emailDesign: design });
                setSaved('Design definido como padrão para os próximos e-mails.');
                setError('');
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Usar este design como padrão
          </Button>
          <Button
            type="button"
            tone="secondary"
            icon={Image}
            onClick={async () => {
              try {
                const image = await window.advocacia.importEmailImage();
                if (image) update('imageData', image);
                setError('');
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Adicionar imagem à mensagem
          </Button>
          {design.imageData && (
            <Button type="button" tone="ghost" onClick={() => update('imageData', '')}>
              Remover imagem
            </Button>
          )}
          <Button type="button" tone="ghost" icon={RotateCcw} onClick={() => onChange({})}>
            Restaurar padrão visual
          </Button>
        </div>
        {design.imageData && (
          <img className="email-banner-thumbnail full" src={design.imageData} alt="Imagem escolhida para a mensagem" />
        )}
        {saved && (
          <p role="status" className="full">
            {saved}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error full">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
