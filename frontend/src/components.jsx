import { useEffect, useId, useRef } from 'react';
import { X, Search, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';

export const date = (value, options = {}) => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...options }).format(new Date(value)) : '—';
export const dateTime = value => value ? date(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Ainda não realizada';
export const dayKey = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const bytes = value => value < 1048576 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1048576).toFixed(1)} MB`;
export const initials = name => name?.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'AG';
export function Logo({ small = false, name = '', logo = '', description = 'SEU ESCRITÓRIO, CONECTADO.' }) { return <div className={'brand ' + (small ? 'brand-small ' : '') + (name ? 'custom-brand' : '')}>{logo ? <div className="custom-logo"><img src={logo} alt="Logo do escritório"/></div> : <div className="brand-icon"><img src="./app-icon.png" alt="Ícone Magnum Office"/></div>}{!small && <div><strong title={name || 'Advocacia — Gestão'}>{name || <>advocacia<span>gestão</span></>}</strong><small>{description}</small></div>}</div>; }
export function Button({ children, icon: Icon, tone = 'primary', busy, className = '', ...props }) { return <button className={`button ${tone} ${className}`} disabled={busy || props.disabled} {...props}>{busy ? <LoaderCircle className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}{children}</button>; }
export function Badge({ children, tone }) { const t = tone || (/Conclu|Ativo|conectado|OK/.test(children) ? 'green' : /Urgente|Atrasado|Erro|Falha/.test(children) ? 'red' : /Aguard|Alta|Pendente/.test(children) ? 'amber' : 'neutral'); return <span className={'badge ' + t}><i />{children}</span>; }
export function Empty({ icon: Icon, title, description, action }) { return <div className="empty"><div className="empty-icon">{Icon ? <Icon size={25} strokeWidth={1.4} /> : <Search size={25} />}</div><h3>{title}</h3><p>{description}</p>{action}</div>; }
export function PageHeading({ eyebrow, title, description, children }) { return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="heading-actions">{children}</div></div>; }
export function Panel({ title, icon: Icon, aside, children, className = '' }) { return <section className={'panel ' + className}>{title && <div className="panel-heading"><h2>{Icon && <Icon size={18} />}{title}</h2>{aside}</div>}{children}</section>; }
export function SearchBox({ value, onChange, placeholder = 'Buscar...', label = 'Buscar registros' }) { return <div className="search-box"><Search size={17} /><input aria-label={label} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />{value && <button aria-label="Limpar busca" onClick={() => onChange('')}><X size={14} /></button>}</div>; }
export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const titleId = useId(); const ref = useRef(null);const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];
    focusable()[0]?.focus();
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') { const items = focusable(); const first = items[0]; const last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    dialog.addEventListener('keydown', key);
    return () => { dialog.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></div>{children}</section></div>;
}
export function Calendar({ month, setMonth, selected, onSelect, tasks = [], compact = false }) {
  const year = month.getFullYear(), m = month.getMonth();
  const start = (new Date(year, m, 1).getDay() + 6) % 7;
  const days = new Date(year, m + 1, 0).getDate();
  const count = Math.ceil((start + days) / 7) * 7;
  const today = dayKey(new Date());
  const marked = new Set(tasks.filter(t => t.status !== 'Concluída').map(t => t.due.slice(0, 10)));
  return <div className={'calendar ' + (compact ? 'compact' : '')}><div className="calendar-heading"><strong>{date(month, { day: undefined, month: 'long', year: 'numeric' })}</strong><div><button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth(new Date(year, m - 1, 1))}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Próximo mês" onClick={() => setMonth(new Date(year, m + 1, 1))}><ChevronRight size={17} /></button></div></div><div className="calendar-grid">{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => <span className="weekday" key={i}>{d}</span>)}{Array.from({ length: count }, (_, i) => { const n = i - start + 1; const d = new Date(year, m, n); const key = dayKey(d); return <button aria-label={date(d, { month: 'long', year: 'numeric' })} aria-pressed={key === selected} aria-current={key===today?'date':undefined} key={i} className={(n < 1 || n > days ? 'muted ' : '') + (key === today ? 'today ' : '') + (key === selected ? 'selected ' : '')} onClick={() => onSelect(key)}>{d.getDate()}{marked.has(key) && <i />}</button>; })}</div><div className="calendar-legend"><span><i />Com compromisso</span><span className="today-label"><CalendarDays size={12} />Hoje</span></div></div>;
}
export function TextLink({ children, onClick }) { return <button className="text-link" onClick={onClick}>{children}<ArrowUpRight size={15} /></button>; }
export function Toggle({ checked, onChange, title, description, disabled = false }) { return <label className={'toggle-row ' + (disabled ? 'disabled' : '')}><span><strong>{title}</strong>{description && <small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span className="toggle" aria-hidden="true" /></label>; }
