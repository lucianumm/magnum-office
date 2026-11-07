import { useEffect, useId, useRef, useState } from 'react';
import {
  X,
  Search,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  LoaderCircle,
} from 'lucide-react';

export const date = (value, options = {}) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...options }).format(new Date(value))
    : '—';
export const dateTime = value =>
  value ? date(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Ainda não realizada';
export const capitalize = text => (text ? text[0].toLocaleUpperCase('pt-BR') + text.slice(1) : '');
export const dayKey = value => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const bytes = value =>
  value < 1048576
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : value < 1073741824
      ? `${(value / 1048576).toFixed(1)} MB`
      : `${(value / 1073741824).toFixed(1)} GB`;
export const initials = name =>
  name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase() || 'MO';
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export const formatPhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return value || '';
};
export const relativeDay = (due, today = dayKey(new Date())) => {
  const days = Math.round((Date.parse(due.slice(0, 10) + 'T12:00') - Date.parse(today + 'T12:00')) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  return days < 0 ? `há ${-days} dias` : `em ${days} dias`;
};

export function Logo({ small = false, name = '', logo = '', description = '' }) {
  return (
    <div className={'brand ' + (small ? 'brand-small ' : '') + (name ? 'custom-brand' : '')}>
      {logo ? (
        <div className="custom-logo">
          <img src={logo} alt="Logo do escritório" />
        </div>
      ) : (
        <div className="brand-icon">
          <img src="./app-icon.png" alt="Ícone Magnum Office" />
        </div>
      )}
      {!small && (
        <div>
          <strong title={name || 'Magnum Office'}>{name || 'Magnum Office'}</strong>
          {description && <small>{description}</small>}
        </div>
      )}
    </div>
  );
}
export function Button({ children, icon: Icon, tone = 'primary', busy, className = '', ...props }) {
  return (
    <button className={`button ${tone} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <LoaderCircle className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}
export function Badge({ children, tone }) {
  const t =
    tone ||
    (/Conclu|Ativo|conectado|OK/.test(children)
      ? 'green'
      : /Urgente|Atrasado|Erro|Falha/.test(children)
        ? 'red'
        : /Aguard|Alta|Pendente/.test(children)
          ? 'amber'
          : 'neutral');
  return (
    <span className={'badge ' + t}>
      <i />
      {children}
    </span>
  );
}
export function Empty({ icon: Icon, title, description, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{Icon ? <Icon size={20} strokeWidth={1.6} /> : <Search size={20} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeading({ title, count, children, before }) {
  return (
    <div className="page-heading">
      <div>
        {before}
        <h1>
          {title}
          {count !== undefined && <small>{count}</small>}
        </h1>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function Panel({ title, icon: Icon, aside, children, className = '' }) {
  return (
    <section className={'panel ' + className}>
      {title && (
        <div className="panel-heading">
          <h2>
            {Icon && <Icon size={16} />}
            {title}
          </h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
export function SearchBox({ value, onChange, placeholder = 'Buscar...', label = 'Buscar registros', inputRef, hint }) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value ? (
        <button aria-label="Limpar busca" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      ) : (
        hint && <kbd>{hint}</kbd>
      )}
    </div>
  );
}
export function Modal({ title, subtitle, children, onClose, wide = false, className = '' }) {
  const titleId = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [
      ...dialog.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      ),
    ];
    (
      dialog.querySelector(
        '.modal-body input:not(:disabled),.modal-body textarea:not(:disabled),.modal-body select:not(:disabled)',
      ) || focusable()[0]
    )?.focus();
    const key = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener('keydown', key);
    return () => {
      dialog.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={'modal ' + (wide ? 'wide ' : '') + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export function Calendar({ month, setMonth, selected, onSelect, tasks = [], compact = false }) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const start = (new Date(year, m, 1).getDay() + 6) % 7;
  const days = new Date(year, m + 1, 0).getDate();
  const count = Math.ceil((start + days) / 7) * 7;
  const today = dayKey(new Date());
  const marked = new Set(tasks.filter(t => t.status !== 'Concluída').map(t => t.due.slice(0, 10)));
  return (
    <div className={'calendar ' + (compact ? 'compact' : '')}>
      <div className="calendar-heading">
        <strong>{new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month)}</strong>
        <div>
          <button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(new Date(year, m - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(new Date(year, m + 1, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map(d => (
          <span className="weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: count }, (_, i) => {
          const n = i - start + 1;
          const d = new Date(year, m, n);
          const key = dayKey(d);
          return (
            <button
              aria-label={date(d, { month: 'long', year: 'numeric' })}
              aria-description={marked.has(key) ? 'Com compromisso' : undefined}
              aria-pressed={key === selected}
              aria-current={key === today ? 'date' : undefined}
              key={i}
              className={
                (n < 1 || n > days ? 'muted ' : '') +
                (key === today ? 'today ' : '') +
                (key === selected ? 'selected ' : '')
              }
              onClick={() => onSelect(key)}
            >
              {d.getDate()}
              {marked.has(key) && <i />}
            </button>
          );
        })}
      </div>
      {!compact && (
        <div className="calendar-legend">
          <span>
            <i />
            Com compromisso
          </span>
          <span>
            <CalendarDays size={12} />
            Hoje em destaque
          </span>
        </div>
      )}
    </div>
  );
}
export function TextLink({ children, onClick }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
export function Toggle({ checked, onChange, title, description, disabled = false }) {
  return (
    <label className={'toggle-row ' + (disabled ? 'disabled' : '')}>
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}
const PAGE_SIZE = 100;
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
// One table for every list: fixed header, sorting and pagination over 100 records.
export function DataTable({ columns, rows, rowKey, initialSort, onRowClick, label }) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);
  const column = columns.find(c => c.key === sort?.key);
  const sorted = column?.value
    ? [...rows].sort(
        (a, b) =>
          collator.compare(String(column.value(a) ?? ''), String(column.value(b) ?? '')) *
          (sort.dir === 'asc' ? 1 : -1),
      )
    : rows;
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const toggle = key =>
    setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return (
    <>
      <div className="table-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.value ? (
                    <button onClick={() => toggle(c.key)}>
                      {c.label}
                      {sort?.key === c.key &&
                        (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'row-link' : undefined}
                onClick={
                  onRowClick
                    ? e => {
                        if (!e.target.closest('button,a,input,select,label')) onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map(c => (
                  <td key={c.key} className={c.className}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="table-footer">
          <span>
            Página {current + 1} de {pages}
          </span>
          <div className="pagination">
            <Button tone="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Anterior
            </Button>
            <Button tone="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
