import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Inbox, Search } from 'lucide-react';
import { api } from './api.js';
import { useApp } from './App.jsx';
import { Modal, Empty, Spinner, Kpi, NumInput, useToast } from './components.jsx';
import { n0, n2, fmtDate } from './format.js';

/* ---------- Pastille de statut ---------- */
export const TONES = { pos: 'pos', neg: 'neg', warn: 'warn', info: 'info', '': '' };
export const Pill = ({ tone = '', children }) => <span className={`pill ${TONES[tone] ?? ''}`}>{children}</span>;
export const pillFor = (map, v) => { const m = map[v]; return m ? <Pill tone={m[1]}>{m[0]}</Pill> : <span>{v}</span>; };

/* ---------- Listes de référence (clients, camions…) avec cache court ---------- */
const cache = new Map();
export function useOptions(url) {
  const [items, setItems] = useState(() => cache.get(url)?.items || null);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < 20000) { setItems(hit.items); return undefined; }
    api(url).then((r) => { const list = Array.isArray(r) ? r : r.items || []; cache.set(url, { items: list, t: Date.now() }); if (live) setItems(list); }).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [url]);
  return items;
}
export const clearOptionsCache = () => cache.clear();
export const idOf = (v) => (v && typeof v === 'object' ? v._id || v.id : v) || '';

export function RefSelect({ url, label, value, onChange, empty = '— Choisir —', disabled, allLabel }) {
  const items = useOptions(url);
  return (
    <select value={idOf(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled || !items}>
      <option value="">{allLabel || empty}</option>
      {(items || []).map((o) => <option key={o._id || o.id} value={o._id || o.id}>{label(o)}</option>)}
    </select>
  );
}
export const REFS = {
  clients: { url: '/clients?limit=1000&actif=true', label: (o) => o.nom },
  fournisseurs: { url: '/fournisseurs?limit=1000&actif=true', label: (o) => o.nom },
  sousTraitants: { url: '/sous-traitants?limit=1000&actif=true', label: (o) => o.nom },
  trucks: { url: '/trucks', label: (o) => o.immatriculation },
  chauffeurs: { url: '/chauffeurs', label: (o) => `${o.nom}${o.matricule ? ` (${o.matricule})` : ''}` },
  employes: { url: '/rh/employes?limit=1000&statut=actif', label: (o) => `${o.nom} (${o.matricule})` },
  pieces: { url: '/pieces?limit=1000', label: (o) => `${o.designation}${o.reference ? ` · ${o.reference}` : ''}` },
  vehiculesST: { url: '/vehicules-st?limit=1000&actif=true', label: (o) => `${o.immatriculation} — ${o.sousTraitant?.nom || ''}` },
  articles: { url: '/articles?limit=1000&actif=true', label: (o) => o.designation },
};

/* ---------- Champ de formulaire générique ---------- */
export function FieldInput({ f, value, onChange, form }) {
  const common = { 'aria-label': f.label };
  if (f.type === 'select') return <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common}>{f.allowEmpty && <option value="">{f.empty || '—'}</option>}{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  if (f.type === 'ref') { const r = typeof f.ref === 'string' ? REFS[f.ref] : f.ref; return <RefSelect url={typeof r.url === 'function' ? r.url(form) : r.url} label={r.label} value={value} onChange={onChange} empty={f.empty} />; }
  if (f.type === 'number' || f.type === 'money') return <NumInput value={Number(value) || 0} onChange={onChange} suffix={f.suffix || (f.type === 'money' ? 'DHS' : undefined)} aria-label={f.label} />;
  if (f.type === 'custom') return f.render(value, onChange, form);
  if (f.type === 'textarea') return <textarea rows={f.rows || 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
  if (f.type === 'check') return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{f.checkLabel || f.label}</label>;
  return <><input type={f.type || 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} list={f.list ? `dl-${f.key}` : undefined} {...common} />{f.list && <datalist id={`dl-${f.key}`}>{f.list.map((o) => <option key={o} value={o} />)}</datalist>}</>;
}

export function FormModal({ title, fields, initial, onSubmit, onClose, wide = true, submitLabel = 'Enregistrer', children }) {
  const [form, setForm] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    for (const f of fields) if (f.required && (f.show ? f.show(form) : true) && (form[f.key] === '' || form[f.key] == null)) return setErr(`${f.label} : champ obligatoire`);
    setBusy(true);
    try { await onSubmit(form); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          {fields.filter((f) => !f.show || f.show(form)).map((f) => (
            <div key={f.key} className={`field ${f.span === 2 || f.type === 'textarea' ? 'span2' : ''}`}>
              {f.type !== 'check' && <span>{f.label}{f.required ? ' *' : ''}</span>}
              <FieldInput f={f} value={form[f.key]} onChange={(v) => set(f.key, v)} form={form} />
              {f.hint && <small className="muted">{f.hint}</small>}
            </div>
          ))}
        </div>
        {children?.(form, set)}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button></div>
      </form>
    </Modal>
  );
}

/** Valeurs initiales d'un formulaire : défauts, puis la ligne éditée (références ramenées à leur id). */
export const initialFrom = (fields, defaults, row) => {
  const o = {};
  for (const f of fields) o[f.key] = f.type === 'check' ? true : f.type === 'custom' ? (f.default ?? []) : f.type === 'number' || f.type === 'money' ? 0 : f.type === 'ref' ? '' : f.default ?? '';
  Object.assign(o, defaults);
  if (row) for (const f of fields) { if (f.noPayload) continue; const v = row[f.key]; o[f.key] = f.type === 'ref' ? idOf(v) : v ?? o[f.key]; }
  return o;
};
export const payloadFrom = (fields, form) => {
  const o = {};
  for (const f of fields) { if (f.noPayload || (f.show && !f.show(form))) continue; let v = form[f.key]; if (f.type === 'number' || f.type === 'money') v = Number(v) || 0; if (f.type === 'ref' && v === '') v = null; o[f.key] = v; }
  return o;
};

/* ---------- Page CRUD générique ---------- */
export function CrudPage({
  title, subtitle, endpoint, columns, fields, filters = [], kpis, adminOnly = false, defaults = {}, addLabel = 'Ajouter', emptyTitle, emptyText, rowActions, headExtra,
  dateFilter = false, searchPlaceholder = 'Rechercher…', tabs, extraQuery, onSaved, rowLock, deleteLabel, formTitle, modalChildren, canAdd = true, canDelete = true, noDelete = false, nowrap, renderForm, hideFilters, kpiCols, viewActions,
}) {
  const { user } = useApp();
  const toast = useToast();
  const canEdit = adminOnly ? user.role === 'admin' : user.role !== 'lecture';
  const [f, setF] = useState({ q: '', from: '', to: '', ...Object.fromEntries(filters.map((x) => [x.key, x.default ?? ''])) });
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const query = useMemo(() => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...f, ...(extraQuery || {}) })) if (v !== '' && v != null) p.set(k, v); p.set('limit', 1000); return p.toString(); }, [f, extraQuery]);
  const load = useCallback(async () => { try { setData(await api(`${endpoint}?${query}`)); } catch (e) { toast(e.message, 'err'); setData({ items: [], total: 0 }); } }, [endpoint, query, toast]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load]); // eslint-disable-line
  const items = data?.items || [];

  const remove = async (row) => {
    if (!window.confirm(deleteLabel ? deleteLabel(row) : 'Supprimer cet élément ? Cette action est définitive.')) return;
    try { await api(`${endpoint}/${row._id}`, { method: 'DELETE' }); toast('Supprimé'); load(); onSaved?.(); } catch (e) { toast(e.message, 'err'); }
  };
  const hasForm = !!renderForm || fields?.length > 0;
  const save = (row) => async (values, raw) => {
    const body = raw ? values : payloadFrom(fields, values);
    await api(row ? `${endpoint}/${row._id}` : endpoint, { method: row ? 'PUT' : 'POST', body });
    toast(row ? 'Modifications enregistrées' : 'Ajouté'); setForm(null); load(); onSaved?.();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
        <div className="head-actions">
          {tabs}{headExtra?.({ data, reload: load, f })}
          {canEdit && canAdd && hasForm && <button className="btn primary" onClick={() => setForm({})}><Plus size={18} />{addLabel}</button>}
        </div>
      </div>
      <div className="filters no-print" hidden={hideFilters} style={{ gridTemplateColumns: `repeat(${Math.min(6, 1 + filters.length + (dateFilter ? 2 : 0))},minmax(0,1fr))` }}>
        <label className="field"><span>Recherche</span><div className="searchbox"><Search size={15} /><input type="text" placeholder={searchPlaceholder} value={f.q} onChange={(e) => set('q', e.target.value)} /></div></label>
        {dateFilter && <><label className="field"><span>Du</span><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label><label className="field"><span>Au</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label></>}
        {filters.map((x) => (
          <label className="field" key={x.key}><span>{x.label}</span>
            {x.type === 'ref' ? <RefSelect url={(typeof x.ref === 'string' ? REFS[x.ref] : x.ref).url} label={(typeof x.ref === 'string' ? REFS[x.ref] : x.ref).label} value={f[x.key]} onChange={(v) => set(x.key, v)} allLabel="Tous" />
              : <select value={f[x.key]} onChange={(e) => set(x.key, e.target.value)}><option value="">Tous</option>{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          </label>
        ))}
      </div>
      {!data ? <div className="center"><Spinner /></div> : (
        <>
          {kpis && <section className="kpis" style={{ gridTemplateColumns: `repeat(${Math.min(6, kpis(data, items).length)},minmax(0,1fr))` }}>{kpis(data, items).map((k, i) => <Kpi key={i} {...k} />)}</section>}
          {items.length === 0 ? <Empty icon={Inbox} title={emptyTitle || 'Aucun résultat'}>{emptyText || 'Ajoutez un élément ou modifiez les filtres.'}</Empty> : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="tbl">
                <thead><tr>{columns.map((c, i) => <th key={i} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}{(canEdit ? (hasForm || rowActions || viewActions) : viewActions) && <th />}</tr></thead>
                <tbody>{items.map((row) => {
                  const lock = rowLock?.(row);
                  return (
                    <tr key={row._id}>{columns.map((c, i) => <td key={i} className={`${c.align === 'r' ? 'r' : ''} ${c.wrap || !nowrap ? 'wrapc' : ''}`}>{c.render ? c.render(row, { reload: load }) : row[c.key] ?? <span className="muted">—</span>}</td>)}
                      {(canEdit ? (hasForm || rowActions || viewActions) : viewActions) && <td><div className="act">
                        {viewActions?.(row)}
                        {canEdit && rowActions?.(row, { reload: load, toast })}
                        {canEdit && hasForm && !lock && <button className="icon-btn" title="Modifier" aria-label="Modifier" onClick={() => setForm({ row })}><Pencil size={16} /></button>}
                        {canEdit && canDelete && !noDelete && !lock && <button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={() => remove(row)}><Trash2 size={16} /></button>}
                      </div></td>}</tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {form && renderForm && renderForm({ row: form.row, onClose: () => setForm(null), onSave: save(form.row), reload: load })}
      {form && !renderForm && <FormModal title={formTitle ? formTitle(form.row) : form.row ? 'Modifier' : addLabel} fields={fields} initial={initialFrom(fields, form.row ? {} : defaults, form.row)} onSubmit={save(form.row)} onClose={() => setForm(null)}>{modalChildren}</FormModal>}
    </div>
  );
}

/* ---------- Petits utilitaires d'affichage ---------- */
export const money2 = (v) => n2(v);
export const Money = ({ v, tone }) => <span className={tone}>{n2(v)}</span>;
export const D = ({ v }) => <>{fmtDate(v)}</>;
export const Tabs = ({ value, onChange, items }) => (
  <div className="seg" role="tablist">{items.map(([id, label]) => <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>)}</div>
);
export { n0, n2 };
