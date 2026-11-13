import { paragraphs, segments } from '../../app/intimation-text.mjs';

// The text of a publication in paragraphs, with deadlines, dates and amounts marked.
export default function PublicationText({ text, open }) {
  const blocks = paragraphs(text);
  const shown = open ? blocks : blocks.slice(0, 2);
  return (
    <div className={'intimation-body' + (open ? ' open' : '')}>
      {shown.map((block, i) => (
        <p key={i} className="intimation-text open">
          {segments(block).map((s, j) =>
            s.kind ? (
              <mark key={j} className={'hl hl-' + s.kind}>
                {s.text}
              </mark>
            ) : (
              s.text
            ),
          )}
        </p>
      ))}
    </div>
  );
}
