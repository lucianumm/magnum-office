import { useEffect, useMemo, useState } from 'react';
import { FilePenLine, FileText, ExternalLink, Download, AlertTriangle } from 'lucide-react';
import { Modal, Button, Empty } from './components.jsx';
import { lawyerOAB } from '../../app/document-template.mjs';

// Fields are found by the label shown in the preview ("Falta: Telefone").
const fieldId = label => 'generate-' + encodeURIComponent(label);

// One answer field, by the type written in the template ({?Data:data}, {?CTPS:sim/não}...).
function AnswerField({ q, value, onChange }) {
  const common = { id: fieldId(q.label), value, onChange: e => onChange(e.target.value) };
  if (q.type === 'money') return <input {...common} maxLength={40} inputMode="decimal" placeholder="R$ 0,00" />;
  if (q.type === 'date') return <input {...common} type="date" min="1900-01-01" max="9999-12-31" />;
  if (q.type === 'yesno' || q.type === 'options')
    return (
      <select {...common}>
        <option value="">Escolha…</option>
        {q.options.map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  return <textarea {...common} rows={q.type === 'long' ? 4 : 1} maxLength={4000} />;
}

// Header or footer of the chosen letterhead, as it will look on the first page.
function SheetBand({ lh, slot, source, images }) {
  const band = lh[slot];
  const ref = source?.[slot]?.image;
  const image = ref ? images[ref.id] : null;
  const hasText = band.cols.some(c => c.trim());
  if (!image && !hasText && !(slot === 'footer' && lh.pageNumbers === 'all')) return null;
  return (
    <div className={'sheet-band sheet-' + slot}>
      {image && (
        <img
          alt=""
          src={`data:${image.mime};base64,${image.data}`}
          style={{
            height: `${ref.heightMm * 2.2}px`,
            alignSelf: { left: 'flex-start', center: 'center', right: 'flex-end' }[ref.align],
          }}
        />
      )}
      {hasText && (
        <div className="sheet-cols">
          {band.cols.map((c, i) => (
            <span key={i} style={{ textAlign: ['left', 'center', 'right'][i], whiteSpace: 'pre-line' }}>
              {c}
            </span>
          ))}
        </div>
      )}
      {slot === 'footer' && lh.pageNumbers === 'all' && (
        <span className="sheet-number" style={{ textAlign: lh.pageNumberAlign }}>
          Página 1
        </span>
      )}
    </div>
  );
}

// Fills a document template with the client/case data and saves DOCX/PDF in its encrypted documents.
// Opened from a template (no record), the client and the case are optional and any data the
// template needs can be typed here.
export default function GenerateDocument({ data, initial, onClose, act, navigateSettings }) {
  const templates = useMemo(
    () => data.library.templates.filter(t => t.kind === 'document').sort((a, b) => a.title.localeCompare(b.title)),
    [data.library.templates],
  );
  const lawyers = data.settings.lawyers || [];
  const fixedCase = !!initial.caseId;
  const fixedClient = !!initial.clientId;
  // A receipt opened from the financial screen arrives with its template and answers filled in.
  const [templateId, setTemplateId] = useState(
    () =>
      templates.find(t => t.id === initial.templateId)?.id ||
      templates.find(t => t.title === initial.templateTitle)?.id ||
      templates[0]?.id ||
      '',
  );
  const [clientId, setClientId] = useState(initial.clientId || '');
  const [caseId, setCaseId] = useState(initial.caseId || '');
  const clients = useMemo(
    () => [...data.entities.clients].sort((a, b) => a.name.localeCompare(b.name)),
    [data.entities.clients],
  );
  const cases = data.entities.cases.filter(c => (clientId ? c.clientId === clientId : true));
  const [chosen, setChosen] = useState(() =>
    Array.isArray(initial.lawyers) ? initial.lawyers.filter(i => lawyers[i]) : lawyers.map((_, i) => i),
  );
  const [answers, setAnswers] = useState(() => initial.answers || {});
  const [values, setValues] = useState(() => initial.values || {});
  const [formats, setFormats] = useState({ docx: true, pdf: false });
  // Page options: letterhead (the default one is chosen at first), font, size, spacing and indent.
  const letterheads = useMemo(() => data.letterheads || [], [data.letterheads]);
  const [look, setLook] = useState(() => ({
    letterheadId: initial.layout ? initial.layout.letterheadId || '' : letterheads.find(l => l.isDefault)?.id || '',
    family: initial.layout?.family || '',
    size: initial.layout?.size || 12,
    lineSpacing: initial.layout?.lineSpacing || 1.5,
    firstLineIndent: initial.layout?.firstLineIndent || 0,
  }));
  const [fonts, setFonts] = useState([]);
  const [images, setImages] = useState({});
  useEffect(() => {
    window.advocacia
      .systemFonts()
      .then(setFonts)
      .catch(() => {});
  }, []);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const request = useMemo(
    () => ({
      templateId,
      caseId: caseId || undefined,
      clientId: clientId || undefined,
      lawyers: chosen,
      answers,
      values,
      // Without any choice the document keeps its usual look (Times New Roman 12, A4, ABNT margins).
      ...(look.letterheadId || look.family || look.size !== 12 || look.lineSpacing !== 1.5 || look.firstLineIndent
        ? { layout: { ...look, letterheadId: look.letterheadId || undefined } }
        : {}),
    }),
    [templateId, caseId, clientId, chosen, answers, values, look],
  );
  // The images of the chosen letterhead, for the preview only.
  useEffect(() => {
    const lh = preview?.letterhead;
    if (!lh) return;
    const source = letterheads.find(l => l.id === lh.id);
    for (const slot of ['header', 'footer']) {
      const ref = source?.[slot]?.image;
      if (ref && !images[ref.id])
        window.advocacia
          .letterheadImage(ref.id)
          .then(img => img && setImages(current => ({ ...current, [ref.id]: img })))
          .catch(() => {});
    }
  }, [preview?.letterhead, letterheads, images]);
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
      <Modal
        title="Documento gerado"
        subtitle={
          clientId || caseId
            ? 'Salvo criptografado em Documentos deste cadastro.'
            : 'Salvo criptografado em Documentos, sem vínculo com cadastro.'
        }
        onClose={onClose}
      >
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
        {[...new Set(saved.flatMap(d => d.warnings || []))].map(w => (
          <div key={w} className="conflict-alert info" role="status">
            <AlertTriangle size={16} />
            <small>{w}</small>
          </div>
        ))}
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
    <Modal
      wide
      title="Gerar documento"
      subtitle="Preenche o modelo com os dados do cadastro ou com o que você digitar aqui."
      onClose={onClose}
    >
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
          {!fixedCase && !fixedClient && (
            <label className="field">
              <span>Cliente</span>
              <select
                value={clientId}
                onChange={e => {
                  setClientId(e.target.value);
                  setCaseId('');
                  setValues({});
                }}
              >
                <option value="">Sem cliente (preencher abaixo)</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!fixedCase && (
            <label className="field">
              <span>Processo</span>
              <select
                value={caseId}
                onChange={e => {
                  setCaseId(e.target.value);
                  setValues({});
                  const owner = data.entities.cases.find(c => c.id === e.target.value)?.clientId;
                  if (!fixedClient && owner) setClientId(owner);
                }}
              >
                <option value="">Sem processo</option>
                {cases.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.number ? ` · ${c.number}` : ''}
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
          {preview?.blanks.length > 0 && (
            <fieldset className="field generate-questions">
              <legend>Dados sem cadastro ({preview.blanks.length})</legend>
              <small className="field-hint muted">
                O modelo usa estes dados e o cadastro escolhido não tem. Preencha aqui ou deixe em branco para completar
                depois.
              </small>
              {preview.blanks.map(v => (
                <label className="field" key={v.key}>
                  <span>{v.label}</span>
                  <textarea
                    id={fieldId(v.label)}
                    rows={1}
                    value={values[v.key] || ''}
                    maxLength={4000}
                    onChange={e => setValues(current => ({ ...current, [v.key]: e.target.value }))}
                  />
                </label>
              ))}
            </fieldset>
          )}
          {preview?.questions.length > 0 && (
            <fieldset className="field generate-questions">
              <legend>Perguntas do modelo ({preview.questions.length})</legend>
              {preview.questions.map(q => (
                <label className="field" key={q.key}>
                  <span>{q.label}</span>
                  <AnswerField
                    q={q}
                    value={answers[q.key] || ''}
                    onChange={v => setAnswers(a => ({ ...a, [q.key]: v }))}
                  />
                  {(q.type === 'money' || q.count > 1) && (
                    <small>
                      {q.type === 'money' ? 'O valor sai com o extenso.' : ''}
                      {q.type === 'money' && q.count > 1 ? ' ' : ''}
                      {q.count > 1 ? `Usada em ${q.count} lugares do documento.` : ''}
                    </small>
                  )}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="field generate-look">
            <legend>Aparência</legend>
            <label className="field">
              <span>Papel timbrado</span>
              <select value={look.letterheadId} onChange={e => setLook(l => ({ ...l, letterheadId: e.target.value }))}>
                <option value="">Sem papel timbrado</option>
                {letterheads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isDefault ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Fonte</span>
              <select value={look.family} onChange={e => setLook(l => ({ ...l, family: e.target.value }))}>
                <option value="">Padrão (Times New Roman)</option>
                {fonts.map(f => (
                  <option key={f.family} value={f.family}>
                    {f.family}
                    {f.embeddable ? '' : ' (não vai no PDF)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="generate-look-row">
              <label className="field">
                <span>Tamanho (pt)</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={look.size}
                  onChange={e => setLook(l => ({ ...l, size: Number(e.target.value) || 12 }))}
                />
              </label>
              <label className="field">
                <span>Entrelinhas</span>
                <select
                  value={look.lineSpacing}
                  onChange={e => setLook(l => ({ ...l, lineSpacing: Number(e.target.value) }))}
                >
                  <option value={1}>Simples</option>
                  <option value={1.15}>1,15</option>
                  <option value={1.5}>1,5</option>
                  <option value={2}>Dupla</option>
                </select>
              </label>
              <label className="field">
                <span>Recuo (cm)</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.25}
                  value={look.firstLineIndent}
                  onChange={e => setLook(l => ({ ...l, firstLineIndent: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>
          </fieldset>
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
              Valor inválido em: {preview.invalid.join(', ')}. Confira valores em reais (ex.: 1.500,00), datas e opções
              da lista.
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {preview?.warnings?.map(w => (
            <div key={w} className="conflict-alert info" role="status">
              <AlertTriangle size={16} />
              <small>{w}</small>
            </div>
          ))}
          <article
            className="document-preview"
            aria-label="Prévia do documento"
            style={{
              fontFamily: look.family ? `"${look.family}", "Times New Roman", serif` : undefined,
              fontSize: `${look.size}pt`,
              lineHeight: look.lineSpacing,
            }}
          >
            {preview?.letterhead && (
              <SheetBand
                lh={preview.letterhead}
                slot="header"
                source={letterheads.find(l => l.id === preview.letterhead.id)}
                images={images}
              />
            )}
            {preview?.blocks.map((b, i) => (
              <p key={i} className={b.heading ? 'heading' : ''} style={{ textAlign: b.align }}>
                {b.runs.map((r, j) => {
                  const style = {
                    fontWeight: r.bold ? 700 : undefined,
                    fontStyle: r.italic ? 'italic' : undefined,
                    textDecoration: r.underline ? 'underline' : undefined,
                  };
                  return r.missing ? (
                    <mark
                      key={j}
                      title={`Falta: ${r.missing}. Clique para preencher.`}
                      style={style}
                      onClick={() => {
                        const field = document.getElementById(fieldId(r.missing));
                        field?.scrollIntoView({ block: 'center' });
                        field?.focus();
                      }}
                    >
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
            {preview?.letterhead && (
              <SheetBand
                lh={preview.letterhead}
                slot="footer"
                source={letterheads.find(l => l.id === preview.letterhead.id)}
                images={images}
              />
            )}
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
