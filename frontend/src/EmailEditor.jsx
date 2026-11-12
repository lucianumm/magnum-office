import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  X,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RemoveFormatting,
  MessageCircleQuestionMark,
} from 'lucide-react';
import { Button, bytes } from './components.jsx';
import EmailDesign, { PreviewFrame } from './EmailDesign.jsx';
export default function EmailEditor({
  initialHTML = '',
  initialText = '',
  onChange,
  attachments = [],
  onAttachments,
  template = false,
  questions = false,
  design = {},
}) {
  const editor = useRef(null),
    range = useRef(null),
    last = useRef({ html: initialHTML, body: initialText });
  const [url, setURL] = useState(''),
    [error, setError] = useState(''),
    [tab, setTab] = useState('edit'),
    [question, setQuestion] = useState(''),
    [questionKind, setQuestionKind] = useState(''),
    [choices, setChoices] = useState('');
  useEffect(() => {
    last.current = { html: initialHTML, body: initialText };
    if (initialHTML) editor.current.innerHTML = initialHTML;
    else editor.current.textContent = initialText;
  }, [initialHTML, initialText]);
  function remember() {
    const s = window.getSelection();
    if (s.rangeCount && editor.current.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
  }
  function emit() {
    last.current = { html: editor.current.innerHTML, body: editor.current.innerText };
    onChange({ ...last.current, emailDesign: design });
  }
  function command(cmd, value) {
    editor.current.focus();
    if (range.current) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range.current);
    }
    document.execCommand(cmd, false, value);
    remember();
    emit();
  }
  async function attach() {
    try {
      const result = await window.advocacia.emailAttachments();
      const next = [...attachments, ...result];
      if (next.length > 10 || next.reduce((n, a) => n + a.size, 0) > 10 * 1024 * 1024)
        throw new Error('Limite de dez anexos e 10 MB no total.');
      onAttachments(next);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="email-editor full">
      <div className="email-editor-tabs" role="tablist" aria-label="Editor de e-mail">
        {[
          ['edit', 'Editar texto'],
          ['design', 'Design da mensagem'],
          ['preview', 'Visualizar e-mail'],
        ].map(([key, label]) => (
          <button type="button" key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'edit'}>
        <div className="email-toolbar" role="toolbar" aria-label="Formatação do e-mail">
          {[
            ['bold', 'Negrito', Bold],
            ['italic', 'Itálico', Italic],
            ['underline', 'Sublinhado', Underline],
            ['insertUnorderedList', 'Lista com marcadores', List],
            ['insertOrderedList', 'Lista numerada', ListOrdered],
            ['justifyLeft', 'Alinhar à esquerda', AlignLeft],
            ['justifyCenter', 'Centralizar', AlignCenter],
            ['justifyRight', 'Alinhar à direita', AlignRight],
            ['removeFormat', 'Remover formatação', RemoveFormatting],
          ].map(([cmd, label, Icon]) => (
            <button
              key={cmd}
              type="button"
              title={label}
              aria-label={label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => command(cmd)}
            >
              <Icon size={15} />
            </button>
          ))}
          <select aria-label="Tamanho da fonte" defaultValue="3" onChange={e => command('fontSize', e.target.value)}>
            <option value="2">Pequena</option>
            <option value="3">Normal</option>
            <option value="5">Grande</option>
            <option value="6">Muito grande</option>
          </select>
          <input
            type="color"
            aria-label="Cor do texto"
            defaultValue="#223437"
            onChange={e => command('foreColor', e.target.value)}
          />
        </div>
        <div
          ref={editor}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Mensagem formatada"
          aria-multiline="true"
          className="rich-email-body"
          onKeyUp={remember}
          onMouseUp={remember}
          onBlur={remember}
          onInput={() => {
            remember();
            emit();
          }}
          onPaste={e => {
            e.preventDefault();
            command('insertText', e.clipboardData.getData('text/plain'));
          }}
        />
        <div className="email-link-row">
          <input
            aria-label="Endereço do link"
            placeholder="https://... ou mailto:..."
            value={url}
            onChange={e => setURL(e.target.value)}
          />
          <Button
            type="button"
            tone="secondary"
            onClick={() => {
              if (!/^(https?:\/\/|mailto:)/i.test(url)) {
                setError('Use um link https://, http:// ou mailto:.');
                return;
              }
              command('createLink', url);
              setURL('');
            }}
          >
            Inserir link
          </Button>
          {!template && (
            <Button type="button" tone="secondary" icon={Paperclip} onClick={attach}>
              Anexar arquivos
            </Button>
          )}
        </div>
        {questions && (
          <div className="email-link-row">
            <input
              aria-label="Pergunta a fazer ao gerar o documento"
              placeholder="Pergunta, ex.: Nome do reclamante"
              maxLength={100}
              value={question}
              onChange={e => setQuestion(e.target.value)}
            />
            <select aria-label="Tipo da resposta" value={questionKind} onChange={e => setQuestionKind(e.target.value)}>
              <option value="">Texto curto</option>
              <option value="texto longo">Texto longo</option>
              <option value="moeda">Valor em reais</option>
              <option value="data">Data</option>
              <option value="sim/não">Sim ou não</option>
              <option value="opções">Lista de opções</option>
            </select>
            {questionKind === 'opções' && (
              <input
                aria-label="Opções separadas por barra"
                placeholder="solteiro | casado | divorciado"
                maxLength={300}
                value={choices}
                onChange={e => setChoices(e.target.value)}
              />
            )}
            <Button
              type="button"
              tone="secondary"
              icon={MessageCircleQuestionMark}
              onClick={() => {
                const label = question.trim();
                if (!label || /[{}:]/.test(label)) {
                  setError('Escreva a pergunta sem chaves nem dois-pontos, por exemplo: Nome do reclamante.');
                  return;
                }
                const list = choices
                  .split('|')
                  .map(c => c.trim())
                  .filter(Boolean);
                if (questionKind === 'opções' && (list.length < 2 || list.some(c => /[{}]/.test(c)))) {
                  setError('Escreva pelo menos duas opções separadas por barra, por exemplo: solteiro | casado.');
                  return;
                }
                setError('');
                const type = questionKind === 'opções' ? `opções=${list.join('|')}` : questionKind;
                command('insertText', `{?${label}${type ? ':' + type : ''}}`);
                setQuestion('');
                setChoices('');
              }}
            >
              Inserir pergunta
            </Button>
          </div>
        )}
        {attachments.map((a, i) => (
          <div className="email-attachment" key={a.id}>
            <Paperclip size={14} />
            <span>
              {a.name} · {bytes(a.size)}
            </span>
            <button
              type="button"
              aria-label={'Remover anexo ' + a.name}
              onClick={() => onAttachments(attachments.filter((_, n) => n !== i))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!template && (
          <small>Até 10 anexos, somando 10 MB. Os arquivos ficam no cofre local para o envio agendado.</small>
        )}
      </div>
      {tab === 'design' && (
        <EmailDesign design={design} onChange={value => onChange({ ...last.current, emailDesign: value })} />
      )}
      {tab === 'preview' && <PreviewFrame content={last.current} design={design} />}
    </div>
  );
}
