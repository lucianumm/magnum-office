import { Coffee } from 'lucide-react';
import { Modal, Button } from './components.jsx';
export default function SupportPrompt({ data, act, onClose, onSupport }) {
  return (
    <Modal title="Me pague um café ☕" subtitle="Projeto independente e 100% sem custo." onClose={onClose}>
      <div className="coffee-prompt">
        <img src={data.support.qrPath} alt="QR Code Pix para contribuir com o projeto" />
        <div>
          <p>Sua contribuição voluntária ajuda a manter o sistema e suas melhorias.</p>
          <p>Todos os recursos continuam disponíveis sem contribuição.</p>
          <Button type="button" icon={Coffee} onClick={() => act(() => window.advocacia.copyPix(), 'Pix copiado.')}>
            Copiar Pix
          </Button>
        </div>
      </div>
      <div className="form-footer">
        <Button type="button" tone="ghost" onClick={onClose}>
          Agora não
        </Button>
        <Button type="button" tone="secondary" onClick={onSupport}>
          Conhecer o projeto
        </Button>
      </div>
    </Modal>
  );
}
