import { useEffect, useState } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { Button, Panel, Empty, dateTime } from './components.jsx';

const kindNames = {
  clients: 'Cliente',
  cases: 'Processo',
  tasks: 'Compromisso',
  notes: 'Anotação',
  documents: 'Documento',
  people: 'Pessoa',
  finance: 'Lançamento',
  intakes: 'Atendimento',
  time: 'Horas',
};

// Records excluded in the last 30 days. Restoring puts them back with their links.
export default function Trash({ act, reload }) {
  const [items, setItems] = useState(null);
  const load = () =>
    window.advocacia
      .trashList()
      .then(setItems)
      .catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, []);
  async function run(task, message) {
    const done = await act(task, message);
    if (done !== undefined) {
      await load();
      await reload();
    }
  }
  return (
    <Panel title="Lixeira" icon={Trash2}>
      <div className="settings-body">
        <p className="help-text">
          Registros excluídos ficam aqui por 30 dias e depois são apagados de vez. Documentos voltam com o arquivo. Um
          compromisso ou documento de um processo excluído só volta depois do processo.
        </p>
        {items === null ? null : items.length ? (
          <>
            <ul className="trash-list">
              {items.map(item => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {kindNames[item.kind] || item.kind} · excluído em {dateTime(item.deletedAt)}
                    </small>
                  </div>
                  <Button
                    tone="secondary"
                    icon={RotateCcw}
                    onClick={() => run(() => window.advocacia.restoreTrash(item.id), 'Registro restaurado.')}
                  >
                    Restaurar
                  </Button>
                  <Button
                    tone="ghost"
                    onClick={() => run(() => window.advocacia.purgeTrash({ id: item.id }), 'Excluído definitivamente.')}
                  >
                    Excluir de vez
                  </Button>
                </li>
              ))}
            </ul>
            <div className="heading-actions">
              <Button
                tone="ghost"
                icon={Trash2}
                onClick={() => run(() => window.advocacia.purgeTrash({ all: true }), 'Lixeira esvaziada.')}
              >
                Esvaziar lixeira
              </Button>
            </div>
          </>
        ) : (
          <Empty
            icon={Trash2}
            title="A lixeira está vazia"
            description="O que você excluir aparece aqui por 30 dias."
          />
        )}
      </div>
    </Panel>
  );
}
