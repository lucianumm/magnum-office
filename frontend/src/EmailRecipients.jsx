import { useState } from 'react';
import { Mail, Plus, Users, X, CheckCheck } from 'lucide-react';
import { Button, SearchBox } from './components.jsx';
import { addEmailRecipients } from '../../app/email-recipients.mjs';
export default function EmailRecipients({ data, value, onChange }) {
  const [text, setText] = useState(''),
    [pasteOpen, setPasteOpen] = useState(!value.length),
    [query, setQuery] = useState(''),
    [info, setInfo] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const clients = data.entities.clients.filter(c =>
    (c.name + ' ' + c.email).toLowerCase().includes(query.toLowerCase()),
  );
  const eligible = c => Boolean(c.email) && c.emailPreference !== 'Não receber' && c.status !== 'Inativo';
  function add(emails) {
    const result = addEmailRecipients(emails, value, data.entities.clients);
    onChange(result.recipients);
    return result;
  }
  async function organize() {
    setBusy(true);
    setError('');
    try {
      const parsed = await window.advocacia.extractEmails(text);
      const result = add(parsed.emails);
      const details = [
        `${result.added} adicionado(s)`,
        ...(parsed.duplicates + result.duplicate ? [`${parsed.duplicates + result.duplicate} repetido(s)`] : []),
        ...(result.blocked ? [`${result.blocked} bloqueado(s) por preferência`] : []),
        ...(result.overflow ? [`${result.overflow} acima do limite de 100`] : []),
        ...(parsed.unrecognized ? [`${parsed.unrecognized} ocorrência(s) de @ não reconhecida(s)`] : []),
      ];
      setInfo(details.join(' · '));
      if (result.added || result.recipients.length) {
        setText('');
        setPasteOpen(false);
      } else setError('Nenhum e-mail foi adicionado. Confira o texto e as preferências dos contatos.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function remove(email) {
    const next = value.filter(r => r.email.toLowerCase() !== email.toLowerCase());
    onChange(next);
    if (!next.length) setPasteOpen(true);
  }
  return (
    <section className="email-recipients full" aria-label="Destinatários do e-mail">
      <div className="recipient-heading">
        <span>
          <Mail size={19} />
          <strong>Destinatários</strong>
        </span>
        <span className="recipient-count">{value.length}/100</span>
      </div>
      {pasteOpen ? (
        <div className="paste-emails">
          <label className="field">
            <span>Colar vários e-mails</span>
            <textarea
              aria-label="Colar vários e-mails"
              rows={3}
              maxLength={100000}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Cole endereços, nomes, textos ou listas. Ex.: Ana <ana@exemplo.com>; contato@empresa.com"
            />
          </label>
          <div className="recipient-input-actions">
            <Button type="button" icon={CheckCheck} busy={busy} disabled={!text.trim()} onClick={organize}>
              Identificar e organizar e-mails
            </Button>
            {value.length > 0 && (
              <Button type="button" tone="ghost" onClick={() => setPasteOpen(false)}>
                Fechar campo
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button type="button" tone="secondary" icon={Plus} onClick={() => setPasteOpen(true)}>
          Adicionar mais e-mails
        </Button>
      )}
      {info && (
        <p role="status" className="recipient-parse-info">
          {info}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <>
          <div className="recipient-list-header">
            <strong>{value.length} e-mail(s) pronto(s) para envio</strong>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                onChange([]);
                setPasteOpen(true);
                setInfo('');
              }}
            >
              Limpar lista
            </button>
          </div>
          <ul className="recipient-compact-list" aria-label="Destinatários selecionados">
            {value.map(r => (
              <li key={r.email.toLowerCase()}>
                <span title={r.email}>{r.email}</span>
                <button
                  type="button"
                  aria-label={'Remover ' + r.email}
                  title="Remover destinatário"
                  onClick={() => remove(r.email)}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="recipient-common-time">
            Um único horário de início para todos. Os endereços não são expostos aos outros destinatários.
          </p>
        </>
      )}
      <details className="recipient-saved-clients">
        <summary>
          <Users size={16} />
          Adicionar clientes do cadastro
        </summary>
        <div className="recipient-client-picker">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Buscar cliente ou e-mail"
            label="Buscar destinatários no cadastro"
          />
          <Button
            type="button"
            tone="ghost"
            onClick={() => {
              const result = add(clients.filter(eligible).map(c => c.email));
              setInfo(`${result.added} cliente(s) adicionado(s) à lista.`);
            }}
          >
            Selecionar até 100 desta busca
          </Button>
          <div className="recipient-client-options">
            {clients.map(c => {
              const selected = value.some(r => r.email.toLowerCase() === c.email?.toLowerCase());
              return (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    aria-label={'Receber e-mail: ' + c.name}
                    checked={selected}
                    disabled={!eligible(c)}
                    onChange={() => (selected ? remove(c.email) : add([c.email]))}
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.email || 'Sem e-mail'}
                      {!eligible(c) ? ' · Recebimento indisponível' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
            {!clients.length && <p>Nenhum contato encontrado.</p>}
          </div>
        </div>
      </details>
    </section>
  );
}
