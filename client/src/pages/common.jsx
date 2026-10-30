import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer, Inbox } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Modal, Empty, Spinner, Kpi, NumInput, useToast } from '../components.jsx';
import { RefSelect, REFS, Pill } from '../crud.jsx';
import { PrintPortal, TableSheet } from '../docs.jsx';
import { n2, fmtDate, todayStr } from '../format.js';

export const MODE_OPTS = [['especes', 'Espèces'], ['cheque', 'Chèque'], ['virement', 'Virement'], ['effet', 'Effet'], ['carte', 'Carte']];
export const MODE_LABEL = Object.fromEntries(MODE_OPTS);
export const REGL = { payee: ['Payée', 'pos'], partielle: ['Partielle', 'warn'], impayee: ['Impayée', 'neg'], en_retard: ['En retard', 'neg'], brouillon: ['Brouillon', ''], annulee: ['Annulée', ''], validee: ['Validée', 'info'] };
export const ReglPill = ({ v }) => <Pill tone={REGL[v]?.[1] || ''}>{REGL[v]?.[0] || v}</Pill>;
export const DOWS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const neg = (v) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');

/** Enregistrer un règlement (client / fournisseur / sous-traitant / paie) en une modale. */
export function PayModal({ title, endpoint, body, reste, onClose, onDone, modes = MODE_OPTS, info }) {
  const toast = useToast();
  const [f, setF] = useState({ date: todayStr(), montant: reste || 0, mode: 'virement', reference: '', observation: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api(endpoint, { method: 'POST', body: { ...body, ...f } }); toast('Règlement enregistré'); onDone?.(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {info && <p className="muted" style={{ margin: 0 }}>{info}</p>}
        <div className="form-grid">
          <label className="field"><span>Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          <label className="field"><span>Montant (DHS)</span><NumInput value={f.montant} onChange={(v) => setF({ ...f, montant: v })} suffix="DHS" /></label>
          <label className="field"><span>Mode</span><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{modes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field"><span>Référence (n° chèque, virement…)</span><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        </div>
        {f.mode === 'especes' && <p className="muted small" style={{ margin: 0 }}>Un mouvement de caisse sera créé automatiquement.</p>}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !(f.montant > 0)}>Enregistrer</button></div>
      </form>
    </Modal>
  );
}

/** Page de rapport générique : filtres → GET → KPI + tableau + impression. */
export function ReportPage({ title, subtitle, endpoint, filters = [], columns, rows = (d) => d.items, kpis, totalRow, dateFrom = false, extraParams, emptyText, printSubtitle, tabs }) {
  const { settings } = useApp();
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries([...(dateFrom ? [['from', `${todayStr().slice(0, 4)}-01-01`], ['to', todayStr()]] : []), ...filters.map((x) => [x.key, x.default ?? ''])]));
  const [data, setData] = useState(null);
  const [print, setPrint] = useState(false);
  const qs = useMemo(() => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...f, ...(extraParams || {}) })) if (v !== '' && v != null) p.set(k, v); return p.toString(); }, [f, extraParams]);
  const load = useCallback(async () => { try { setData(await api(`${endpoint}?${qs}`)); } catch (e) { toast(e.message, 'err'); setData({ items: [] }); } }, [endpoint, qs, toast]);
  useEffect(() => { load(); }, [load]);
  const list = data ? rows(data) : [];
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="page">
      <div className="page-head"><div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
        <div className="head-actions">{tabs}<button className="btn" onClick={() => setPrint(true)} disabled={!list.length}><Printer size={17} />Imprimer</button></div></div>
      <div className="filters no-print" style={{ gridTemplateColumns: `repeat(${Math.min(6, filters.length + (dateFrom ? 2 : 0)) || 1},minmax(0,1fr))` }}>
        {dateFrom && <><label className="field"><span>Du</span><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label><label className="field"><span>Au</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label></>}
        {filters.map((x) => (
          <label className="field" key={x.key}><span>{x.label}</span>
            {x.type === 'ref' ? <RefSelect url={REFS[x.ref].url} label={REFS[x.ref].label} value={f[x.key]} onChange={(v) => set(x.key, v)} allLabel="Tous" />
              : x.type === 'month' ? <input type="month" value={f[x.key]} onChange={(e) => set(x.key, e.target.value)} />
                : <select value={f[x.key]} onChange={(e) => set(x.key, e.target.value)}>{x.noAll ? null : <option value="">Tous</option>}{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
          </label>
        ))}
      </div>
      {!data ? <div className="center"><Spinner /></div> : (
        <>
          {kpis && <section className="kpis" style={{ gridTemplateColumns: `repeat(${Math.min(6, kpis(data).length)},minmax(0,1fr))` }}>{kpis(data).map((k, i) => <Kpi key={i} {...k} />)}</section>}
          {list.length === 0 ? <Empty icon={Inbox} title="Aucune donnée">{emptyText || 'Aucun résultat pour ces filtres.'}</Empty> : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="tbl">
                <thead><tr>{columns.map((c, i) => <th key={i} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>{list.map((row, i) => <tr key={row.id || row._id || i}>{columns.map((c, j) => <td key={j} className={`${c.align === 'r' ? 'r num' : ''}`}>{c.render ? c.render(row) : row[c.key]}</td>)}</tr>)}</tbody>
                {totalRow && <tfoot><tr>{totalRow(data).map((v, i) => <td key={i} className={columns[i]?.align === 'r' ? 'r num' : ''}>{v}</td>)}</tr></tfoot>}
              </table>
            </div>
          )}
        </>
      )}
      {print && data && (
        <PrintPortal onClose={() => setPrint(false)} title={title}>
          <TableSheet title={title} subtitle={printSubtitle ? printSubtitle(f, data) : data.from ? `Du ${fmtDate(data.from)} au ${fmtDate(data.to)}` : ''} settings={settings}
            columns={columns.map((c) => ({ ...c, render: c.print || c.render }))} rows={list} totalRow={totalRow?.(data)} />
        </PrintPortal>
      )}
    </div>
  );
}

/** Éditeur simple de lignes (désignation, quantité, unité) pour BL. */
export function SimpleLines({ value, onChange }) {
  const list = value || [];
  const upd = (i, k, v) => onChange(list.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="doc-lines">
      {list.map((l, i) => (
        <div className="doc-line" key={i} style={{ gridTemplateColumns: 'minmax(0,3fr) 90px 80px 34px' }}>
          <input value={l.designation} onChange={(e) => upd(i, 'designation', e.target.value)} placeholder="Désignation" aria-label="Désignation" />
          <NumInput value={l.qte} onChange={(v) => upd(i, 'qte', v)} aria-label="Quantité" />
          <input value={l.unite || ''} onChange={(e) => upd(i, 'unite', e.target.value)} placeholder="t, u…" aria-label="Unité" />
          <button type="button" className="icon-btn danger" aria-label="Retirer" onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div><button type="button" className="chip-btn" onClick={() => onChange([...list, { designation: '', qte: 1, unite: 't', pu: 0, tva: 0 }])}>+ Ajouter une ligne</button></div>
    </div>
  );
}

export const Sum = ({ rows, k }) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
export { n2, fmtDate };
