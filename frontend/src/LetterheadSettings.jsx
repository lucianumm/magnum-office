import { useState } from 'react';
import { FileImage, Plus, Pencil, Star, Trash2, ImagePlus, X } from 'lucide-react';
import { Button, Modal, Panel, Empty, Toggle, Badge } from './components.jsx';
import LetterheadPage from './LetterheadPage.jsx';

const blank = () => ({
  name: '',
  paper: 'a4',
  margins: { top: 3, right: 2, bottom: 2, left: 3 },
  firstPageDifferent: false,
  pageNumbers: 'all',
  pageNumberAlign: 'center',
  watermark: '',
  header: { cols: ['', '', ''], image: null },
  continuation: { cols: ['', '', ''] },
  footer: { cols: ['', '', ''], image: null },
});
const variables = [
  '{escritorio.nome}',
  '{cliente.nome}',
  '{processo.numero}',
  '{advogado.nome}',
  '{advogado.oab}',
  '{data.hoje}',
];

// One header or footer: an optional image and text in three columns.
function BandEditor({ title, value, onChange, notice }) {
  const setCol = (i, text) => onChange({ ...value, cols: value.cols.map((c, j) => (j === i ? text : c)) });
  async function pick() {
    try {
      const picked = await window.advocacia.chooseLetterheadImage();
      if (picked)
        onChange({
          ...value,
          image: {
            data: picked.data,
            mime: picked.mime,
            width: picked.width,
            height: picked.height,
            heightMm: value.image?.heightMm || 20,
            align: value.image?.align || 'left',
          },
        });
    } catch (e) {
      notice(e.message);
    }
  }
  return (
    <fieldset className="field letterhead-band">
      <legend>{title}</legend>
      <div className="letterhead-image-row">
        {value.image ? (
          <>
            <span className="muted">
              <FileImage size={14} /> Imagem {value.image.width}×{value.image.height}
            </span>
            <label>
              Altura (mm){' '}
              <input
                type="number"
                min={5}
                max={40}
                value={value.image.heightMm}
                onChange={e => onChange({ ...value, image: { ...value.image, heightMm: Number(e.target.value) } })}
              />
            </label>
            <select
              aria-label="Posição da imagem"
              value={value.image.align}
              onChange={e => onChange({ ...value, image: { ...value.image, align: e.target.value } })}
            >
              <option value="left">À esquerda</option>
              <option value="center">Centralizada</option>
              <option value="right">À direita</option>
            </select>
            <Button type="button" tone="ghost" icon={X} onClick={() => onChange({ ...value, image: null })}>
              Remover imagem
            </Button>
          </>
        ) : (
          <Button type="button" tone="secondary" icon={ImagePlus} onClick={pick}>
            Escolher imagem (PNG ou JPG)
          </Button>
        )}
      </div>
      <div className="letterhead-cols">
        {['Esquerda', 'Centro', 'Direita'].map((label, i) => (
          <label key={label} className="field">
            <span>{label}</span>
            <textarea rows={3} maxLength={300} value={value.cols[i]} onChange={e => setCol(i, e.target.value)} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Letterheads (papel timbrado) for generated documents: header, footer, image, page numbers, watermark, paper, margins.
export default function LetterheadSettings({ data, act, reload }) {
  const list = data.letterheads || [];
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const edit = item => {
    setError('');
    setDraft(
      item
        ? {
            ...item,
            header: { ...item.header, image: item.header.image ? { ...item.header.image } : null },
            footer: { ...item.footer, image: item.footer.image ? { ...item.footer.image } : null },
          }
        : blank(),
    );
  };
  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await window.advocacia.saveLetterhead(draft);
      await reload();
      setDraft(null);
    } catch (err) {
      setError(err.message);
    }
  }
  const margin = key => ({
    type: 'number',
    step: 0.1,
    min: 1,
    max: 6,
    value: draft.margins[key],
    onChange: e => setDraft(d => ({ ...d, margins: { ...d.margins, [key]: e.target.value } })),
  });
  return (
    <>
      <Panel
        title="Papel timbrado"
        icon={FileImage}
        aside={
          <Button icon={Plus} onClick={() => edit(null)}>
            Novo papel timbrado
          </Button>
        }
      >
        <div className="settings-body">
          <p className="help-text">
            Cabeçalho e rodapé com imagem e texto, número de página, primeira página diferente, marca d’água, papel e
            margens. Na hora de gerar um documento você escolhe qual papel usar. O padrão é o papel marcado com a
            estrela.
          </p>
          {list.length ? (
            <div className="table-scroll">
              <table>
                <tbody>
                  {list.map(l => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.name}</strong> {l.isDefault && <Badge tone="green">Padrão</Badge>}
                        <br />
                        <small>
                          {l.paper === 'oficio' ? 'Ofício' : 'A4'} · margens {l.margins.top}/{l.margins.right}/
                          {l.margins.bottom}/{l.margins.left} cm
                          {l.header.image ? ' · imagem no cabeçalho' : ''}
                          {l.pageNumbers !== 'none' ? ' · numera as páginas' : ''}
                          {l.watermark ? ` · marca d’água “${l.watermark}”` : ''}
                        </small>
                      </td>
                      <td>
                        <div className="row-actions">
                          {!l.isDefault && (
                            <Button
                              tone="ghost"
                              icon={Star}
                              onClick={() =>
                                act(() => window.advocacia.setDefaultLetterhead(l.id), 'Papel padrão alterado.').then(
                                  reload,
                                )
                              }
                            >
                              Tornar padrão
                            </Button>
                          )}
                          <Button tone="ghost" icon={Pencil} onClick={() => edit(l)}>
                            Editar
                          </Button>
                          <Button
                            tone="ghost"
                            icon={Trash2}
                            onClick={() =>
                              act(() => window.advocacia.removeLetterhead(l.id), 'Papel timbrado excluído.').then(
                                reload,
                              )
                            }
                          >
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={FileImage}
              title="Nenhum papel timbrado"
              description="Crie um para que os documentos gerados saiam com o cabeçalho e o rodapé do escritório."
            />
          )}
        </div>
      </Panel>
      {draft && (
        <Modal wide title={draft.id ? 'Editar papel timbrado' : 'Novo papel timbrado'} onClose={() => setDraft(null)}>
          <form onSubmit={save}>
            <div className="settings-body notice-body">
              <div className="form-grid letterhead-grid">
                <label className="field full">
                  <span>Nome</span>
                  <input
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Papel</span>
                  <select value={draft.paper} onChange={e => setDraft({ ...draft, paper: e.target.value })}>
                    <option value="a4">A4 (21 × 29,7 cm)</option>
                    <option value="oficio">Ofício (21,6 × 33 cm)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Numeração das páginas</span>
                  <select value={draft.pageNumbers} onChange={e => setDraft({ ...draft, pageNumbers: e.target.value })}>
                    <option value="all">Em todas as páginas</option>
                    <option value="skipFirst">Sem número na primeira</option>
                    <option value="none">Sem numeração</option>
                  </select>
                </label>
                {[
                  ['top', 'Margem superior (cm)'],
                  ['bottom', 'Margem inferior (cm)'],
                  ['left', 'Margem esquerda (cm)'],
                  ['right', 'Margem direita (cm)'],
                ].map(([key, label]) => (
                  <label key={key} className="field">
                    <span>{label}</span>
                    <input {...margin(key)} />
                  </label>
                ))}
                <label className="field">
                  <span>Marca d’água (opcional)</span>
                  <input
                    maxLength={30}
                    value={draft.watermark}
                    onChange={e => setDraft({ ...draft, watermark: e.target.value })}
                    placeholder="Ex.: RASCUNHO"
                  />
                </label>
                <label className="field">
                  <span>Posição do número</span>
                  <select
                    value={draft.pageNumberAlign}
                    onChange={e => setDraft({ ...draft, pageNumberAlign: e.target.value })}
                  >
                    <option value="center">Centro</option>
                    <option value="right">Direita</option>
                    <option value="left">Esquerda</option>
                  </select>
                </label>
              </div>
              <BandEditor
                title="Cabeçalho"
                value={draft.header}
                onChange={header => setDraft({ ...draft, header })}
                notice={setError}
              />
              <Toggle
                checked={draft.firstPageDifferent}
                onChange={v => setDraft({ ...draft, firstPageDifferent: v })}
                title="Primeira página diferente"
                description="O cabeçalho completo (com imagem) só aparece na primeira página; nas seguintes entra só o texto abaixo."
              />
              {draft.firstPageDifferent && (
                <fieldset className="field letterhead-band">
                  <legend>Cabeçalho das páginas seguintes</legend>
                  <div className="letterhead-cols">
                    {['Esquerda', 'Centro', 'Direita'].map((label, i) => (
                      <label key={label} className="field">
                        <span>{label}</span>
                        <textarea
                          rows={2}
                          maxLength={300}
                          value={draft.continuation.cols[i]}
                          onChange={e =>
                            setDraft({
                              ...draft,
                              continuation: {
                                cols: draft.continuation.cols.map((c, j) => (j === i ? e.target.value : c)),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <BandEditor
                title="Rodapé"
                value={draft.footer}
                onChange={footer => setDraft({ ...draft, footer })}
                notice={setError}
              />
              <small className="field-hint muted">
                Nos textos você pode usar dados do documento: {variables.join(' ')}. Imagens PNG ou JPG, até 2 MB, ficam
                guardadas criptografadas e nunca são buscadas na internet.
              </small>
              <LetterheadPage draft={draft} data={data} />
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="form-footer">
              <span />
              <Button type="submit">Salvar papel timbrado</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
