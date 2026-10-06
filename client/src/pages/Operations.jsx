import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Undo2, Download, ClipboardList } from 'lucide-react';
import { api, download } from '../api.js';
import { useApp } from '../App.jsx';
import { Plate, Empty, Spinner, useToast } from '../components.jsx';
import { dhs, n0, n2 } from '../format.js';
import OperationForm, { todayStr } from './OperationForm.jsx';

const daysAgo = (n) => new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - n * 86400000).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** Journal des opérations : tous les camions, ou un seul camion si truckId est fourni. */
export function OpsJournal({ truckId, initial, reloadKey, onChanged }) {
  const { user } = useApp();
  const canEdit = user.role !== 'lecture';
  const toast = useToast();
  const [trucksAll, setTrucksAll] = useState([]);
  const [f, setF] = useState({ truck: truckId || initial?.truck || '', from: initial?.from ?? daysAgo(30), to: initial?.to ?? '', type: '', q: '', supprimes: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  useEffect(() => { api('/trucks?tous=1').then(setTrucksAll).catch(() => {}); }, []);
  const active = useMemo(() => trucksAll.filter((t) => t.actif), [trucksAll]);

  const query = useCallback(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, truck: truckId || f.truck })) if (v) p.set(k, v);
    return p;
  }, [f, truckId]);
  const load = useCallback(async () => {
    try { const p = query(); p.set('page', page); p.set('limit', 100); setData(await api(`/operations?${p}`)); } catch (e) { toast(e.message, 'err'); }
  }, [query, page, toast]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, reloadKey]); // eslint-disable-line
  const changed = async () => { await load(); onChanged?.(); };

  const del = async (o) => {
    if (!window.confirm(`Supprimer cette ligne (${o.compte}, ${n2(o.montant)} DHS) ? Elle reste visible dans « supprimées » et peut être restaurée.`)) return;
    try { await api(`/operations/${o.id}`, { method: 'DELETE' }); toast('Opération supprimée'); changed(); } catch (e) { toast(e.message, 'err'); }
  };
  const restore = async (o) => { try { await api(`/operations/${o.id}/restaurer`, { method: 'POST' }); toast('Opération restaurée'); changed(); } catch (e) { toast(e.message, 'err'); } };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <div className="filters no-print">
        {!truckId && (
          <label className="field"><span>Camion</span>
            <select value={f.truck} onChange={(e) => set('truck', e.target.value)}><option value="">Tous les camions</option>
              {trucksAll.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.actif ? '' : ' (archivé)'}</option>)}</select></label>
        )}
        <label className="field"><span>Du</span><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="field"><span>Au</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="field"><span>Type</span>
          <select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">Recettes et dépenses</option><option value="produit">Recettes</option><option value="charge">Dépenses</option></select></label>
        <label className="field"><span>Recherche</span><input type="text" placeholder="voyage, note, poste…" value={f.q} onChange={(e) => set('q', e.target.value)} /></label>
        <label className="field"><span>Afficher</span>
          <select value={f.supprimes} onChange={(e) => set('supprimes', e.target.value)}><option value="">Actives</option><option value="1">Actives + supprimées</option><option value="only">Supprimées seulement</option></select></label>
      </div>
      <div className="opsbox no-print" style={{ marginBottom: 12 }}>
        <div className="btns">
          <button className="chip-btn" onClick={() => { setF((x) => ({ ...x, from: daysAgo(7), to: '' })); setPage(1); }}>7 jours</button>
          <button className="chip-btn" onClick={() => { setF((x) => ({ ...x, from: daysAgo(30), to: '' })); setPage(1); }}>30 jours</button>
          <button className="chip-btn" onClick={() => { setF((x) => ({ ...x, from: `${todayStr().slice(0, 4)}-01-01`, to: '' })); setPage(1); }}>Cette année</button>
          <button className="chip-btn" onClick={() => { setF((x) => ({ ...x, from: '', to: '' })); setPage(1); }}>Tout</button>
        </div>
        <div className="btns">
          <button className="btn sm" onClick={() => download(`/export/operations?${query()}`, 'operations.xlsx').catch((e) => toast(e.message, 'err'))}><Download size={15} />Excel</button>
          {canEdit && <button className="btn sm primary" onClick={() => setForm({ create: true })}><Plus size={15} />Nouvelle opération</button>}
        </div>
      </div>

      {!data ? <div className="center"><Spinner /></div> : (
        <>
          <div className="ops-sum">
            <div><span className="muted">Recettes</span><b className="pos">{dhs(data.totaux.produits)}</b></div>
            <div><span className="muted">Dépenses</span><b>{dhs(data.totaux.charges)}</b></div>
            <div><span className="muted">Solde des opérations</span><b className={data.totaux.net < 0 ? 'neg' : 'pos'}>{dhs(data.totaux.net)}</b></div>
            <div><span className="muted">Km</span><b>{n0(data.totaux.km)}</b></div>
            <div><span className="muted">Lignes</span><b>{n0(data.total)}</b></div>
          </div>
          {data.items.length === 0 ? (
            <Empty icon={ClipboardList} title="Aucune opération sur cette période">Ajoutez un voyage ou élargissez les dates.{canEdit && <><br /><button className="btn primary" style={{ marginTop: 14 }} onClick={() => setForm({ create: true })}><Plus size={18} />Nouvelle opération</button></>}</Empty>
          ) : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="tbl">
                <thead><tr><th>Date</th>{!truckId && <th>Camion</th>}<th>Poste</th><th>Voyage</th><th className="r">Montant</th><th className="r">Km</th><th>Note</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id} className={o.supprime ? 'deleted' : ''}>
                      <td>{fmtDay(o.date)}</td>
                      {!truckId && <td><Link to={`/camion/${o.truck._id}`}><Plate>{o.truck.immatriculation || '—'}</Plate></Link></td>}
                      <td>{o.compte}{o.nbModifs > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>modifié ×{o.nbModifs}</span>}</td>
                      <td className="wrap">{o.voyage || <span className="muted">—</span>}</td>
                      <td className={`r ${o.type === 'produit' ? 'pos' : ''}`}>{o.type === 'produit' ? '+' : '−'} {n2(o.montant)}</td>
                      <td className="r">{o.km ? n0(o.km) : ''}</td>
                      <td className="wrap muted">{o.note}</td>
                      {canEdit && (
                        <td><div className="act">
                          {o.supprime ? <button className="icon-btn" title="Restaurer" aria-label="Restaurer" onClick={() => restore(o)}><Undo2 size={16} /></button> : (<>
                            <button className="icon-btn" title="Modifier / historique" aria-label="Modifier" onClick={() => setForm({ edit: o })}><Pencil size={16} /></button>
                            <button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={() => del(o)}><Trash2 size={16} /></button></>)}
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="opsbox" style={{ marginTop: 12 }}><span className="muted">Page {page} / {totalPages}</span>
              <div className="btns"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédente</button><button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Suivante</button></div></div>
          )}
        </>
      )}
      {form && <OperationForm trucks={active} edit={form.edit} initial={{ truck: truckId || f.truck || undefined }} onClose={() => setForm(null)} onSaved={changed} />}
    </div>
  );
}

export default function Operations() {
  const [sp] = useSearchParams();
  const initial = { truck: sp.get('truck') || '', from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Opérations</h1><p className="muted">Journal de tous les voyages et dépenses, camion par camion et jour par jour. Chaque modification est conservée.</p></div></div>
      <OpsJournal initial={initial} />
    </div>
  );
}
