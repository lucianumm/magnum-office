import { useEffect, useMemo, useState } from 'react';
import { FilePenLine, FileText, ExternalLink, Download, AlertTriangle } from 'lucide-react';
import { Modal, Button, Empty } from './components.jsx';
import { lawyerOAB } from '../../app/document-template.mjs';

// Fills a document template with the client/case data and saves DOCX/PDF in its encrypted documents.
export default function GenerateDocument({ data, initial, onClose, act, navigateSettings }) {
  const templates = useMemo(
    () => data.library.templates.filter(t => t.kind === 'document').sort((a, b) => a.title.localeCompare(b.title)),
    [data.library.templates],
  );
  const lawyers = data.settings.lawyers || [];
  const fixedCase = !!initial.caseId;
  const clientCases = data.entities.cases.filter(c => c.clientId && c.clientId === initial.clientId);
  // A receipt opened from the financial screen arrives with its template and answers filled in.
  const [templateId, setTemplateId] = useState(
    () => templates.find(t => t.title === initial.templateTitle)?.id || templates[0]?.id || '',
  );
  const [caseId, setCaseId] = useState(initial.caseId || '');
  const [chosen, setChosen] = useState(() => lawyers.map((_, i) => i));
  const [answers, setAnswers] = useState(() => initial.answers || {});
  const [formats, setFormats] = useState({ docx: true, pdf: false });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const request = useMemo(
    () => ({
      templateId,
      caseId: caseId || undefined,
      clientId: initial.clientId || undefined,
      lawyers: chosen,
      answers,
    }),
    [templateId, caseId, initial.clientId, chosen, answers],
  );
  useEffect(() => {
    if (!templateId) return;
    let current = true;
    const timer = setTimeout(() => {
      window.advocacia
        .previewDocument(request)
        .then(value => {
          if (!current) return;
          setPreview(value);
          setError('');
        })
        .catch(e => current && setError(e.message));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, templateId]);
  const selectedFormats = Object.keys(formats).filter(f => formats[f]);
  async function generate() {
    const result = await act(() => window.advocacia.generateDocument({ ...request, formats: selectedFormats }));
    if (result) setSaved(result);
  }
  if (!templates.length)
    return (
      <Modal title="Gerar documento" onClose={onClose}>
        <Empty
          icon={FileText}
          title="Nenhum modelo de documento"
          description="Cadastre um modelo em Documentos → Modelos de pedidos para gerar documentos com os dados do cadastro."
        />
      </Modal>
    );
  if (saved)
    return (
      <Modal title="Documento gerado" subtitle="Salvo criptografado em Documentos deste cadastro." onClose={onClose}>
        <ul className="generated-list">
          {saved.map(doc => (
            <li key={doc.id}>
              <FileText size={18} />
              <span>{doc.name}</span>
              <Button
                tone="secondary"
                icon={ExternalLink}
                onClick={() => act(() => window.advocacia.openDocument(doc.id))}
              >
                Abrir
              </Button>
              <Button
                tone="secondary"
                icon={Download}
                onClick={() => act(() => window.advocacia.exportDocument(doc.id))}
              >
                Salvar cópia
              </Button>
            </li>
          ))}
        </ul>
        <p className="help-text">
          Para editar no Word, use Salvar cópia e trabalhe no arquivo salvo. Abrir mostra uma cópia temporária.
        </p>
        <div className="form-footer">
          <div>
            <Button onClick={onClose}>Concluir</Button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal wide title="Gerar documento" subtitle="Preenche o modelo com os dados do cadastro." onClose={onClose}>
      <div className="generate-layout">
        <div className="generate-options">
          <label className="field">
            <span>Modelo</span>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {!fixedCase && (
            <label className="field">
              <span>Processo</span>
              <select value={caseId} onChange={e => setCaseId(e.target.value)}>
                <option value="">Sem processo</option>
                {clientCases.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="field">
            <legend>Advogados</legend>
            {lawyers.length ? (
              lawyers.map((l, i) => (
                <label className="check-row" key={i}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(i)}
                    onChange={e =>
                      setChosen(c => (e.target.checked ? [...c, i].sort((a, b) => a - b) : c.filter(x => x !== i)))
                    }
                  />
                  {l.name} <small>{lawyerOAB(l)}</small>
                </label>
              ))
            ) : (
              <small className="field-hint muted">
                Nenhum advogado cadastrado.{' '}
                <button
                  className="text-link"
                  onClick={() => {
                    onClose();
                    navigateSettings('office');
                  }}
                >
                  Cadastrar em Configurações
                </button>
              </small>
            )}
          </fieldset>
          {preview?.questions.map(q => (
            <label className="field" key={q.key}>
              <span>{q.label}</span>
              <input
                value={answers[q.key] || ''}
                maxLength={4000}
                inputMode={q.type === 'money' ? 'decimal' : undefined}
                placeholder={q.type === 'money' ? 'R$ 0,00' : ''}
                onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
              />
              {q.type === 'money' && <small>O valor sai com o extenso.</small>}
            </label>
          ))}
          <fieldset className="field">
            <legend>Formato</legend>
            {[
              ['docx', 'Word (DOCX), para editar'],
              ['pdf', 'PDF, para enviar ou imprimir'],
            ].map(([key, label]) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={formats[key]}
                  onChange={e => setFormats(f => ({ ...f, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="generate-preview">
          {preview?.missing.length > 0 && (
            <div className="conflict-alert info" role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Faltam dados</strong>
                <small> {preview.missing.join(', ')}. Esses trechos saem como ______ para preencher depois.</small>
              </div>
            </div>
          )}
          {preview?.invalid.length > 0 && (
            <div className="form-error" role="alert">
              Valor inválido em: {preview.invalid.join(', ')}. Use, por exemplo, 1.500,00.
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <article className="document-preview" aria-label="Prévia do documento">
            {preview?.blocks.map((b, i) => (
              <p key={i} className={b.heading ? 'heading' : ''} style={{ textAlign: b.align }}>
                {b.runs.map((r, j) => {
                  const style = {
                    fontWeight: r.bold ? 700 : undefined,
                    fontStyle: r.italic ? 'italic' : undefined,
                    textDecoration: r.underline ? 'underline' : undefined,
                  };
                  return r.missing ? (
                    <mark key={j} title={`Falta: ${r.missing}`} style={style}>
                      {r.text}
                    </mark>
                  ) : (
                    <span key={j} style={style}>
                      {r.text}
                    </span>
                  );
                })}
                {!b.runs.some(r => r.text) && <br />}
              </p>
            ))}
          </article>
        </div>
      </div>
      <div className="form-footer">
        <span>Revise o texto antes de assinar ou protocolar.</span>
        <div>
          <Button tone="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={FilePenLine} disabled={!preview || !selectedFormats.length || !!error} onClick={generate}>
            Gerar e salvar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
