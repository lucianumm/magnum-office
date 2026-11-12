import { useState } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { Button, Panel } from './components.jsx';
import {
  importFields as fields,
  importLabels as labels,
  mapHeaders as headerMapping,
} from '../../app/import-fields.mjs';
export default function Imports({ act, reload }) {
  const [kind, setKind] = useState('clients'),
    [file, setFile] = useState(null),
    [sheet, setSheet] = useState(0),
    [mapping, setMapping] = useState({}),
    [preview, setPreview] = useState(null),
    [selected, setSelected] = useState([]),
    [result, setResult] = useState('');
  function reset() {
    setPreview(null);
    setSelected([]);
    setResult('');
  }
  function mapHeaders(f, k, index) {
    const headers = f.sheets[index].headers;
    setMapping(headerMapping(k, headers));
  }
  async function choose() {
    const f = await act(() => window.advocacia.chooseImport());
    if (f) {
      setFile(f);
      setSheet(0);
      mapHeaders(f, kind, 0);
      reset();
    }
  }
  async function review() {
    const p = await act(() => window.advocacia.previewImport({ id: file.id, kind, sheet, mapping }));
    if (p) {
      setPreview(p);
      setSelected(p.rows.filter(r => !r.error && !r.duplicate).map(r => r.row));
    }
  }
  async function commit() {
    const r = await act(() => window.advocacia.commitImport({ id: file.id, rows: selected }));
    if (r) {
      await reload();
      setResult(`${r.count} registro(s) importado(s). Um backup foi criado antes da gravação.`);
      setFile(null);
      setPreview(null);
      setSelected([]);
    }
  }
  return (
    <>
      <Panel title="1. Escolher arquivo" icon={FileSpreadsheet}>
        <div className="settings-body">
          <div className="form-grid">
            <label className="field">
              <span>Importar para</span>
              <select
                aria-label="Importar para"
                value={kind}
                onChange={e => {
                  setKind(e.target.value);
                  reset();
                  if (file) mapHeaders(file, e.target.value, sheet);
                }}
              >
                <option value="clients">Contatos / clientes</option>
                <option value="tasks">Agenda / compromissos</option>
                <option value="cases">Processos (de planilha ou de outro sistema)</option>
              </select>
            </label>
            <div className="field">
              <span>Arquivo</span>
              <Button tone="secondary" icon={Upload} onClick={choose}>
                Selecionar CSV ou Excel
              </Button>
              <small>CSV, TSV ou XLSX · até 5 MB e 5.000 linhas por planilha.</small>
            </div>
          </div>
          <p className="help-text">
            A primeira linha deve conter os nomes das colunas. CSV aceita vírgula, ponto e vírgula ou tabulação. Para
            XLS antigo, salve como XLSX. Datas: DD/MM/AAAA ou AAAA-MM-DD; horários: HH:mm. Sem horário, a agenda usa
            09:00. Datas e horas são locais ao computador. Importar agenda cria compromissos, sem disparar mensagens.
          </p>
          <p className="help-text">
            Exemplo de contatos: Nome;E-mail;Telefone
            <br />
            Exemplo de agenda: Título;Data;Hora;Observações
          </p>
          {result && (
            <p role="status" className="notice">
              {result}
            </p>
          )}
        </div>
      </Panel>
      {file && (
        <Panel title="2. Associar colunas">
          <div className="settings-body">
            <label className="field">
              <span>Planilha</span>
              <select
                value={sheet}
                onChange={e => {
                  const i = Number(e.target.value);
                  setSheet(i);
                  reset();
                  mapHeaders(file, kind, i);
                }}
              >
                {file.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name} · {s.count} linhas
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              {fields[kind].map(f => (
                <label className="field" key={f}>
                  <span>{labels[f]}</span>
                  <select
                    aria-label={'Coluna: ' + labels[f]}
                    value={mapping[f] ?? -1}
                    onChange={e => {
                      setMapping({ ...mapping, [f]: Number(e.target.value) });
                      reset();
                    }}
                  >
                    <option value={-1}>Não importar</option>
                    {file.sheets[sheet].headers.map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {h || '(sem título)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="import-sample">
              <strong>Amostra do arquivo</strong>
              <pre>{file.sheets[sheet].sample.map(r => r.join(' | ')).join('\n')}</pre>
            </div>
            <Button onClick={review}>Revisar importação</Button>
          </div>
        </Panel>
      )}
      {preview && (
        <Panel title="3. Revisar e importar">
          <div className="settings-body">
            <p>
              {preview.valid} novos válidos · {preview.duplicates} duplicados · {preview.errors} com erro. Duplicados e
              linhas inválidas não serão importados.
            </p>
            <p className="help-text">
              Duplicação de contatos considera e-mail ou documento; sem ambos, nome e telefone. Compromissos: título e
              horário. Registros existentes não são alterados.
            </p>
            <div className="table-scroll import-preview">
              <table>
                <thead>
                  <tr>
                    <th>Importar</th>
                    <th>Linha</th>
                    <th>Nome / título</th>
                    <th>E-mail / horário</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.row}>
                      <td>
                        <input
                          aria-label={'Importar linha ' + r.row}
                          type="checkbox"
                          checked={selected.includes(r.row)}
                          disabled={!!r.error || r.duplicate}
                          onChange={e =>
                            setSelected(s => (e.target.checked ? [...s, r.row] : s.filter(n => n !== r.row)))
                          }
                        />
                      </td>
                      <td>{r.row}</td>
                      <td>{r.value?.name || r.value?.title || '—'}</td>
                      <td>{r.value?.email || r.value?.due || '—'}</td>
                      <td>{r.error || (r.duplicate ? 'Duplicado' : 'Pronto')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-footer">
              <span>{selected.length} selecionados. Backup automático antes da importação.</span>
              <Button disabled={!selected.length} onClick={commit}>
                Importar selecionados
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
