import { useMemo } from 'react';

// A small sheet that shows where the header, footer, number and watermark fall (an approximation: the real
// pages are laid out when the document is generated).
export default function LetterheadPage({ draft, sample = '' }) {
  const [w, h] = draft.paper === 'oficio' ? [216, 330] : [210, 297];
  const margin = key =>
    `${(Number(draft.margins[key]) / (key === 'left' || key === 'right' ? w / 10 : h / 10)) * 100}%`;
  const imageUrl = useMemo(() => {
    const img = draft.header.image;
    return img?.data ? `data:${img.mime};base64,${img.data}` : '';
  }, [draft.header.image]);
  const footerUrl = draft.footer.image?.data ? `data:${draft.footer.image.mime};base64,${draft.footer.image.data}` : '';
  const cols = list => (
    <div className="lp-cols">
      {list.map((c, i) => (
        <span key={i} style={{ textAlign: ['left', 'center', 'right'][i] }}>
          {c}
        </span>
      ))}
    </div>
  );
  return (
    <div className="letterhead-page-wrap" aria-label="Prévia da página">
      <div className="letterhead-page" style={{ aspectRatio: `${w} / ${h}` }}>
        {draft.watermark && <div className="lp-watermark">{draft.watermark}</div>}
        <div className="lp-header">
          {imageUrl && (
            <img
              alt=""
              src={imageUrl}
              style={{
                height: `${draft.header.image.heightMm * 0.9}px`,
                alignSelf: { left: 'flex-start', center: 'center', right: 'flex-end' }[draft.header.image.align],
              }}
            />
          )}
          {cols(draft.header.cols)}
        </div>
        <div
          className="lp-body"
          style={{ marginTop: margin('top'), marginLeft: margin('left'), marginRight: margin('right') }}
        >
          {sample || 'O texto do documento ocupa esta área, entre as margens. '.repeat(6)}
        </div>
        <div className="lp-footer">
          {footerUrl && <img alt="" src={footerUrl} style={{ height: `${draft.footer.image.heightMm * 0.9}px` }} />}
          {cols(draft.footer.cols)}
          {draft.pageNumbers !== 'none' && <span style={{ textAlign: draft.pageNumberAlign }}>Página 1 de 1</span>}
        </div>
      </div>
      {draft.firstPageDifferent && (
        <small className="muted">As páginas seguintes mostram só o cabeçalho de texto.</small>
      )}
    </div>
  );
}
