import { useState } from 'react';
import Records from './Records.jsx';
import Templates from './Templates.jsx';

const tabs = [
  ['files', 'Arquivos'],
  ['document', 'Modelos jurídicos'],
  ['whatsapp', 'Modelos de WhatsApp'],
  ['email', 'Modelos de e-mail'],
];
export default function DocumentWorkspace(props) {
  const [tab, setTab] = useState('files');
  const bar = (
    <div className="workspace-tabs" role="tablist" aria-label="Documentos e modelos">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={id === tab}
          className={id === tab ? 'active' : ''}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return tab === 'files' ? (
    <Records kind="documents" headerExtra={bar} {...props} />
  ) : (
    <Templates key={tab} kind={tab} headerExtra={bar} {...props} />
  );
}
