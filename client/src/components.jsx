import React, { useEffect, useState, useRef, createContext, useContext, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, CheckCircle2, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { addMonths, currentMonth } from '../../shared/calc.js';
import { monthLong, parseNum, n0 } from './format.js';

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>{i.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{i.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Month picker ---------- */
export function MonthPicker({ value, onChange }) {
  return (
    <div className="monthpicker">
      <button className="icon-btn" onClick={() => onChange(addMonths(value, -1))} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
      <label className="monthpicker-label">
        <span>{monthLong(value)}</span>
        <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Choisir le mois" />
      </label>
      <button className="icon-btn" onClick={() => onChange(addMonths(value, 1))} aria-label="Mois suivant"><ChevronRight size={18} /></button>
      {value !== currentMonth() && <button className="chip-btn" onClick={() => onChange(currentMonth())}>Ce mois</button>}
    </div>
  );
}

/* ---------- Plaque d'immatriculation ---------- */
export const Plate = ({ children }) => <span className="plate"><i />{children}</span>;

/* ---------- Nombre saisi (accepte la virgule) ---------- */
export function NumInput({ value, onChange, suffix, placeholder = '0', readOnly, id, width, 'aria-label': aria }) {
  const [txt, setTxt] = useState(value ? String(value).replace('.', ',') : '');
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current && parseNum(txt) !== value) setTxt(value ? String(value).replace('.', ',') : '');
    last.current = value;
  }, [value]); // eslint-disable-line
  return (
    <span className={`numinput ${readOnly ? 'ro' : ''}`} style={width ? { width } : undefined}>
      <input id={id} aria-label={aria} inputMode="decimal" value={txt} placeholder={placeholder} readOnly={readOnly}
        onChange={(e) => { const t = e.target.value.replace(/[^0-9.,\s]/g, ''); setTxt(t); const n = parseNum(t); last.current = n; onChange?.(n); }}
        onBlur={() => { if (txt !== '') setTxt(String(parseNum(txt)).replace('.', ',')); }} />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

/* ---------- Segmented toggle ---------- */
export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Delta vs mois précédent ---------- */
export function Delta({ current, previous, invert, unit = '%' }) {
  if (!previous && !current) return <span className="delta flat"><Minus size={13} /> —</span>;
  if (!previous) return <span className="delta flat">nouveau</span>;
  const d = unit === 'pts' ? current - previous : ((current - previous) / Math.abs(previous)) * 100;
  const good = invert ? d < 0 : d > 0;
  const Icon = Math.abs(d) < 0.05 ? Minus : d > 0 ? TrendingUp : TrendingDown;
  return <span className={`delta ${Math.abs(d) < 0.05 ? 'flat' : good ? 'good' : 'bad'}`}><Icon size={13} /> {d > 0 ? '+' : ''}{d.toFixed(1).replace('.', ',')} {unit === 'pts' ? 'pts' : '%'}</span>;
}

/* ---------- KPI ---------- */
export function Kpi({ label, value, sub, tone, children, accent }) {
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone || ''}`}>{value}</div>
      <div className="kpi-sub">{children}{sub && <span>{sub}</span>}</div>
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Empty = ({ icon: Icon, title, children }) => (
  <div className="empty">{Icon && <Icon size={34} />}<h3>{title}</h3><p>{children}</p></div>
);
export const Spinner = () => <div className="spinner" role="status" aria-label="Chargement" />;
export const moneyShort = (v) => n0(v);
