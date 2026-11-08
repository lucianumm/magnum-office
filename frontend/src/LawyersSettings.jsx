import { Plus, Trash2 } from 'lucide-react';
import { Button } from './components.jsx';
import { cnjStates } from '../../app/cnj.mjs';

// Lawyers of the office, used in qualifications and, later, in generated powers of attorney.
export default function LawyersSettings({ value = [], onChange }) {
  const change = (index, key, text) => onChange(value.map((l, i) => (i === index ? { ...l, [key]: text } : l)));
  return (
    <div className="lawyers-settings">
      <div className="lawyers-heading">
        <strong>Advogados do escritório</strong>
        <small>Nome e OAB entram nas procurações e na qualificação. Ficam somente neste computador.</small>
      </div>
      {value.map((lawyer, i) => (
        <div className="lawyer-row" key={i}>
          <label className="field">
            <span>Nome</span>
            <input value={lawyer.name} maxLength={160} required onChange={e => change(i, 'name', e.target.value)} />
          </label>
          <label className="field">
            <span>OAB nº</span>
            <input
              value={lawyer.oab}
              maxLength={20}
              required
              inputMode="numeric"
              placeholder="12345"
              onChange={e => change(i, 'oab', e.target.value)}
            />
          </label>
          <label className="field">
            <span>UF</span>
            <select value={lawyer.uf} required onChange={e => change(i, 'uf', e.target.value)}>
              <option value="">UF</option>
              {cnjStates.map(uf => (
                <option key={uf}>{uf}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              value={lawyer.email}
              maxLength={254}
              onChange={e => change(i, 'email', e.target.value)}
            />
          </label>
          <button
            type="button"
            className="icon-button danger"
            aria-label={`Remover ${lawyer.name || 'advogado'}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {value.length < 30 && (
        <Button
          type="button"
          tone="secondary"
          icon={Plus}
          onClick={() => onChange([...value, { name: '', oab: '', uf: '', email: '' }])}
        >
          Adicionar advogado
        </Button>
      )}
    </div>
  );
}
