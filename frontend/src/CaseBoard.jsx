import { useState } from 'react';
import { caseChoices } from '../../app/legal-options.mjs';

// Cases in columns by phase. Dragging a card to another column changes its phase; Enter on a card
// opens it, and the arrow keys move it between phases without a mouse.
export default function CaseBoard({ cases, clients, save, openDetail }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const phases = caseChoices.phase;
  const clientName = id => clients.find(c => c.id === id)?.name || '';
  async function move(item, phase) {
    if ((item.phase || '') === phase) return;
    await save('cases', { ...item, phase });
  }
  return (
    <div className="case-board" role="list" aria-label="Processos por fase">
      {phases.map(phase => {
        const list = cases.filter(c => (c.phase || '') === phase);
        return (
          <section
            key={phase || 'none'}
            className={'board-column' + (over === phase ? ' over' : '')}
            role="listitem"
            aria-label={`${phase || 'Sem fase'}: ${list.length}`}
            onDragOver={e => {
              e.preventDefault();
              setOver(phase);
            }}
            onDragLeave={() => setOver(current => (current === phase ? null : current))}
            onDrop={e => {
              e.preventDefault();
              setOver(null);
              const item = cases.find(c => c.id === dragging);
              setDragging(null);
              if (item) void move(item, phase);
            }}
          >
            <header>
              <strong>{phase || 'Sem fase'}</strong>
              <span>{list.length}</span>
            </header>
            {list.map(item => (
              <article
                key={item.id}
                className="board-card"
                draggable
                tabIndex={0}
                onDragStart={() => setDragging(item.id)}
                onDragEnd={() => setDragging(null)}
                onClick={() => openDetail('cases', item.id)}
                onKeyDown={e => {
                  const index = phases.indexOf(item.phase || '');
                  if (e.key === 'Enter') openDetail('cases', item.id);
                  if (e.key === 'ArrowRight' && index < phases.length - 1) void move(item, phases[index + 1]);
                  if (e.key === 'ArrowLeft' && index > 0) void move(item, phases[index - 1]);
                }}
              >
                <strong>{item.title}</strong>
                {item.clientId && <small>{clientName(item.clientId)}</small>}
                {item.number && <small className="tabular">{item.number}</small>}
                <small className="muted">{item.status}</small>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
