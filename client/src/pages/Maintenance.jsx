import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Wrench, Save, History, AlertTriangle, CalendarClock } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Kpi, Modal, NumInput, Plate, Empty, Spinner, useToast } from '../components.jsx';
import { dhs, n0, n2, fmtDateTime, monthShort, compact } from '../format.js';
import { todayStr } from './OperationForm.jsx';

export const CATEGORIES = { vidange: 'Vidange', moteur: 'Moteur', freins: 'Freins', pneus: 'Pneumatiques', transmission: 'Transmission', electricite: 'Électricité', carrosserie: 'Carrosserie', climatisation: 'Climatisation', remorque: 'Remorque', autre: 'Autre' };
const TYPE = { preventive: 'Préventive', curative: 'Curative' };
const PLAN_STATUT = { en_retard: ['neg', 'En retard'], bientot: ['warn', 'Bientôt'], ok: ['pos', 'À jour'], sans_historique: ['info', 'Sans historique'] };
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '—');
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const warnToast = (toast, list = []) => list.forEach((w) => toast(`Attention : « ${w.compte} » a déjà ${n2(w.montantFiche)} DHS dans la fiche de ${w.month}. L’intervention s’y ajoute : vérifiez qu’il n’y a pas de double comptage.`, 'err'));
const TruckSelect = ({ value, onChange, list, autoFocus }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus}><option value="">— Choisir —</option>
    {list.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.chauffeur ? ` · ${t.chauffeur}` : ''}</option>)}</select>
);

function InterventionForm({ trucks, edit, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(edit
    ? { truck: edit.truck._id, date: edit.date, type: edit.type, categorie: edit.categorie, garage: edit.garage, kmCompteur: edit.kmCompteur, montant: edit.montant, description: edit.description }
    : { truck: '', date: todayStr(), type: 'curative', categorie: 'vidange', garage: '', kmCompteur: 0, montant: 0, description: '' });
  const [hist, setHist] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const list = useMemo(() => { const l = [...trucks]; if (edit && !l.some((t) => t._id === edit.truck._id)) l.push(edit.truck); return l; }, [trucks, edit]);
  useEffect(() => { if (edit) api(`/operations/${edit.id}`).then((r) => setHist(r.historique)).catch(() => {}); }, [edit]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = edit ? await api(`/entretien/${edit.id}`, { method: 'PUT', body: f }) : await api('/entretien', { method: 'POST', body: f });
      toast(edit ? 'Intervention modifiée (l’ancienne valeur reste dans l’historique)' : 'Intervention enregistrée'); warnToast(toast, r.avertissements); await onSaved?.(); onClose();
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={edit ? 'Modifier l’intervention' : 'Nouvelle intervention'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>Camion *</span><TruckSelect value={f.truck} onChange={(v) => set('truck', v)} list={list} autoFocus={!f.truck} /></label>
          <label className="field"><span>Date *</span><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></label>
          <label className="field"><span>Type</span><select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="curative">Curative (panne, réparation)</option><option value="preventive">Préventive (entretien prévu)</option></select></label>
          <label className="field"><span>Catégorie</span><select value={f.categorie} onChange={(e) => set('categorie', e.target.value)}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Garage / prestataire</span><input value={f.garage} maxLength={80} onChange={(e) => set('garage', e.target.value)} /></label>
          <label className="field"><span>Km compteur</span><NumInput value={f.kmCompteur} onChange={(v) => set('kmCompteur', v)} suffix="km" aria-label="Km compteur" /></label>
          <label className="field"><span>Montant *</span><NumInput value={f.montant} onChange={(v) => set('montant', v)} suffix="DHS" aria-label="Montant" /></label>
        </div>
        <label className="field"><span>Description</span><input value={f.description} maxLength={500} placeholder="ex. vidange + filtres à huile et à gazole" onChange={(e) => set('description', e.target.value)} /></label>
        <p className="muted small" style={{ margin: 0 }}>Le montant alimente automatiquement le compte {f.categorie === 'pneus' ? '« Pneumatiques »' : '« Maintenance & Réparations »'} du camion, au jour saisi. Le kilométrage met à jour les plans d’entretien de la même catégorie.</p>
        {edit && hist && (
          <div className="op-hist"><b><History size={15} /> Historique</b>
            {hist.map((h, i) => (
              <div key={i}><span>{fmtDateTime(h.at)} · {h.par}</span><em>{{ creation: 'Création', modification: 'Modification', suppression: 'Suppression', restauration: 'Restauration' }[h.action] || h.action}</em>
                {h.action === 'modification' && h.avant && <small className="muted"> avant : {h.avant.date} · {CATEGORIES[h.avant.meta?.categorie] || ''} · {n2(h.avant.montant)} DHS</small>}</div>))}
          </div>)}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function PlanForm({ trucks, edit, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(edit
    ? { truck: edit.truck._id, libelle: edit.libelle, categorie: edit.categorie, intervalleKm: edit.intervalleKm, intervalleJours: edit.intervalleJours, dernierKm: edit.dernierKm, dernierDate: edit.dernierDate, actif: edit.actif }
    : { truck: '', libelle: 'Vidange', categorie: 'vidange', intervalleKm: 30000, intervalleJours: 0, dernierKm: 0, dernierDate: '', actif: true });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api(edit ? `/entretien/plans/${edit.id}` : '/entretien/plans', { method: edit ? 'PUT' : 'POST', body: f }); toast('Plan enregistré'); await onSaved?.(); onClose(); }
    catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={edit ? 'Modifier le plan d’entretien' : 'Nouveau plan d’entretien'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>Camion *</span><TruckSelect value={f.truck} onChange={(v) => set('truck', v)} list={trucks} autoFocus={!f.truck} /></label>
          <label className="field"><span>Libellé *</span><input required value={f.libelle} maxLength={80} onChange={(e) => set('libelle', e.target.value)} /></label>
          <label className="field"><span>Catégorie</span><select value={f.categorie} onChange={(e) => set('categorie', e.target.value)}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Tous les</span><NumInput value={f.intervalleKm} onChange={(v) => set('intervalleKm', v)} suffix="km" aria-label="Intervalle en km" /></label>
          <label className="field"><span>et/ou tous les</span><NumInput value={f.intervalleJours} onChange={(v) => set('intervalleJours', Math.round(v))} suffix="jours" aria-label="Intervalle en jours" /></label>
          <label className="field"><span>Dernier entretien — km</span><NumInput value={f.dernierKm} onChange={(v) => set('dernierKm', v)} suffix="km" aria-label="Dernier km" /></label>
          <label className="field"><span>Dernier entretien — date</span><input type="date" value={f.dernierDate} onChange={(e) => set('dernierDate', e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.actif} onChange={(e) => set('actif', e.target.checked)} />Plan actif (génère des alertes)</label>
        <p className="muted small" style={{ margin: 0 }}>Chaque nouvelle intervention de la même catégorie sur ce camion remet automatiquement le plan à jour. L’alerte passe à « Bientôt » à 15 jours ou 1 000 km de l’échéance.</p>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}><Save size={16} />Enregistrer</button></div>
      </form>
    </Modal>
  );
}

const PlanPill = ({ s }) => <span className={`pill ${PLAN_STATUT[s]?.[0]}`}>{PLAN_STATUT[s]?.[1]}</span>;
const planEcheance = (p) => [p.prochaineDate && `${fmtDay(p.prochaineDate)}${p.joursRestants !== null ? ` (${p.joursRestants < 0 ? `${-p.joursRestants} j de retard` : `dans ${p.joursRestants} j`})` : ''}`, p.prochainKm && `${n0(p.prochainKm)} km${p.kmRestants !== null ? ` (${p.kmRestants < 0 ? `${n0(-p.kmRestants)} km de retard` : `dans ${n0(p.kmRestants)} km`})` : ''}`].filter(Boolean).join(' · ') || '—';

export default function Maintenance() {
  const { user } = useApp();
  const canEdit = user.role !== 'lecture';
  const toast = useToast();
  const [trucks, setTrucks] = useState([]);
  const [tab, setTab] = useState('dash');
  const [f, setF] = useState({ truck: '', from: monthsAgo(12), to: '', type: '', categorie: '', q: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  useEffect(() => { api('/trucks?tous=1').then(setTrucks).catch(() => {}); }, []);
  const active = useMemo(() => trucks.filter((t) => t.actif), [trucks]);

  const load = useCallback(async () => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v); p.set('page', page); p.set('limit', 100);
    try { const [r, pl] = await Promise.all([api(`/entretien?${p}`), api('/entretien/plans')]); setD(r); setPlans(pl.items); } catch (e) { toast(e.message, 'err'); }
  }, [f, page, toast]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load]); // eslint-disable-line

  const del = async (o) => { if (!window.confirm(`Supprimer cette intervention (${CATEGORIES[o.categorie]}, ${n2(o.montant)} DHS) ? Elle reste récupérable depuis le journal des opérations.`)) return; try { await api(`/operations/${o.id}`, { method: 'DELETE' }); toast('Intervention supprimée'); load(); } catch (e) { toast(e.message, 'err'); } };
  const delPlan = async (p) => { if (!window.confirm(`Supprimer le plan « ${p.libelle} » (${p.truck.immatriculation}) ?`)) return; try { await api(`/entretien/plans/${p.id}`, { method: 'DELETE' }); toast('Plan supprimé'); load(); } catch (e) { toast(e.message, 'err'); } };
  const k = d?.kpis; const totalPages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  const maxCat = Math.max(1, ...(d?.parCategorie || []).map((c) => c.cout)); const maxTruck = Math.max(1, ...(d?.parCamion || []).map((c) => c.cout));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Maintenance</h1><p className="muted">Interventions, coût d’entretien par camion et alertes d’échéance.</p></div>
        <div className="head-actions">
          <div className="seg" role="tablist">
            {[['dash', 'Tableau de bord'], ['liste', 'Interventions'], ['plans', 'Plans d’entretien']].map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}{id === 'plans' && k?.alertesRetard > 0 ? ` (${k.alertesRetard})` : ''}</button>)}
          </div>
          {canEdit && (tab === 'plans' ? <button className="btn primary" onClick={() => setForm({ plan: true })}><Plus size={18} />Nouveau plan</button> : <button className="btn primary" onClick={() => setForm({})}><Plus size={18} />Intervention</button>)}
        </div>
      </div>

      {tab !== 'plans' && (
        <div className="filters no-print">
          <label className="field"><span>Camion</span><select value={f.truck} onChange={(e) => set('truck', e.target.value)}><option value="">Tous les camions</option>{trucks.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.actif ? '' : ' (archivé)'}</option>)}</select></label>
          <label className="field"><span>Du</span><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="field"><span>Au</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
          <label className="field"><span>Type</span><select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">Tous</option><option value="preventive">Préventive</option><option value="curative">Curative</option></select></label>
          <label className="field"><span>Catégorie</span><select value={f.categorie} onChange={(e) => set('categorie', e.target.value)}><option value="">Toutes</option>{Object.entries(CATEGORIES).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          {tab === 'liste' && <label className="field"><span>Recherche</span><input type="text" placeholder="garage, description…" value={f.q} onChange={(e) => set('q', e.target.value)} /></label>}
        </div>
      )}

      {!d || !plans ? <div className="center"><Spinner /></div> : (
        <>
          {tab === 'dash' && (
            <>
              {d.alertes.length > 0 && (
                <div className={`alert ${d.alertes.some((a) => a.statut === 'en_retard') ? 'warn' : 'info'}`}><AlertTriangle size={18} /><div style={{ flex: 1 }}>
                  <strong>{k.alertesRetard} entretien{k.alertesRetard > 1 ? 's' : ''} en retard · {k.alertesBientot} bientôt</strong>
                  {d.alertes.slice(0, 4).map((a) => <div key={a.id} className="small">{a.truck.immatriculation} — {a.libelle} : {planEcheance(a)}</div>)}
                  <button className="chip-btn" style={{ marginTop: 8 }} onClick={() => setTab('plans')}>Voir tous les plans</button></div></div>
              )}
              <section className="kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
                <Kpi label="Interventions" value={n0(k.nb)} sub={`${k.preventives} préventive${k.preventives > 1 ? 's' : ''} · ${k.curatives} curative${k.curatives > 1 ? 's' : ''}`} />
                <Kpi accent label="Coût de maintenance" value={dhs(k.cout)} />
                <Kpi label="Coût moyen / intervention" value={dhs(k.coutMoyen)} />
                <Kpi label="Préventif vs curatif" value={k.cout ? `${Math.round((k.coutPreventif / k.cout) * 100)} % préventif` : '—'} sub={`${dhs(k.coutCuratif)} en curatif`} />
                <Kpi label="Alertes" value={n0(k.alertesRetard + k.alertesBientot)} sub={`${k.alertesRetard} en retard`} tone={k.alertesRetard ? 'neg' : ''} />
              </section>
              {d.items.length === 0 && d.total === 0 ? <Empty icon={Wrench} title="Aucune intervention sur cette période">Enregistrez une intervention ou élargissez les dates.</Empty> : (
                <div className="grid-3-2">
                  <section className="card"><div className="card-head"><h3>Coût par mois (DHS)</h3></div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={d.parMois.map((m) => ({ ...m, label: monthShort(m.mois) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid stroke="var(--line)" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} />
                        <Tooltip formatter={(v) => dhs(v)} labelFormatter={(l, p) => p?.[0]?.payload?.mois || l} /><Bar dataKey="cout" name="Coût" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                      </BarChart></ResponsiveContainer></section>
                  <section className="card"><div className="card-head"><h3>Camions les plus coûteux</h3></div>
                    <div className="rank-list">{d.parCamion.slice(0, 6).map((c) => (
                      <div key={c.truck._id} className="rank-row"><Link to={`/camion/${c.truck._id}`}><Plate>{c.truck.immatriculation}</Plate></Link>
                        <div className="bar"><i style={{ width: `${(c.cout / maxTruck) * 100}%`, background: 'var(--neg)' }} /></div><b>{n0(c.cout)}</b></div>))}</div></section>
                  <section className="card"><div className="card-head"><h3>Par catégorie</h3></div>
                    <div className="rank-list">{d.parCategorie.map((c) => (
                      <div key={c.categorie} className="rank-row"><span>{CATEGORIES[c.categorie] || c.categorie}</span><div className="bar"><i style={{ width: `${(c.cout / maxCat) * 100}%`, background: 'var(--brand)' }} /></div><b>{n0(c.cout)}</b></div>))}</div></section>
                </div>
              )}
            </>
          )}

          {tab === 'liste' && (d.items.length === 0 ? <Empty icon={Wrench} title="Aucune intervention">Enregistrez une intervention ou modifiez les filtres.</Empty> : (
            <>
              <div className="card table-wrap" style={{ padding: 8 }}><table className="tbl">
                <thead><tr><th>Date</th><th>Camion</th><th>Type</th><th>Catégorie</th><th>Garage</th><th className="r">Km</th><th className="r">Montant</th><th>Description</th>{canEdit && <th />}</tr></thead>
                <tbody>{d.items.map((o) => (
                  <tr key={o.id}><td>{fmtDay(o.date)}</td><td><Link to={`/camion/${o.truck._id}`}><Plate>{o.truck.immatriculation || '—'}</Plate></Link></td>
                    <td><span className={`pill ${o.type === 'preventive' ? 'pos' : 'warn'}`}>{TYPE[o.type]}</span></td><td>{CATEGORIES[o.categorie] || o.categorie}</td><td className="wrap">{o.garage || <span className="muted">—</span>}</td>
                    <td className="r">{o.kmCompteur ? n0(o.kmCompteur) : ''}</td><td className="r">{n2(o.montant)}</td><td className="wrap muted">{o.description}</td>
                    {canEdit && <td><div className="act"><button className="icon-btn" title="Modifier / historique" aria-label="Modifier" onClick={() => setForm({ edit: o })}><Pencil size={16} /></button>
                      <button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={() => del(o)}><Trash2 size={16} /></button></div></td>}</tr>))}</tbody>
              </table></div>
              {totalPages > 1 && <div className="opsbox" style={{ marginTop: 12 }}><span className="muted">Page {page} / {totalPages}</span><div className="btns"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédente</button><button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Suivante</button></div></div>}
            </>))}

          {tab === 'plans' && (plans.length === 0 ? (
            <Empty icon={CalendarClock} title="Aucun plan d’entretien">Un plan dit « vidange tous les 30 000 km ou 180 jours » pour un camion. L’application vous alerte avant l’échéance.{canEdit && <><br /><button className="btn primary" style={{ marginTop: 14 }} onClick={() => setForm({ plan: true })}><Plus size={16} />Nouveau plan</button></>}</Empty>
          ) : (
            <div className="card table-wrap" style={{ padding: 8 }}><table className="tbl">
              <thead><tr><th>Statut</th><th>Camion</th><th>Plan</th><th>Intervalle</th><th>Dernier entretien</th><th className="r">Km actuel</th><th>Prochaine échéance</th>{canEdit && <th />}</tr></thead>
              <tbody>{plans.map((p) => (
                <tr key={p.id} style={p.actif ? undefined : { opacity: 0.55 }}><td><PlanPill s={p.statut} />{!p.actif && <span className="pill info" style={{ marginLeft: 6 }}>inactif</span>}</td>
                  <td><Link to={`/camion/${p.truck._id}`}><Plate>{p.truck.immatriculation || '—'}</Plate></Link></td><td>{p.libelle}<small className="muted"> · {CATEGORIES[p.categorie]}</small></td>
                  <td>{[p.intervalleKm && `${n0(p.intervalleKm)} km`, p.intervalleJours && `${p.intervalleJours} j`].filter(Boolean).join(' / ')}</td>
                  <td>{p.dernierDate ? fmtDay(p.dernierDate) : '—'}{p.dernierKm ? ` · ${n0(p.dernierKm)} km` : ''}</td><td className="r">{p.kmActuel ? n0(p.kmActuel) : '—'}</td><td className="wrap">{planEcheance(p)}</td>
                  {canEdit && <td><div className="act"><button className="icon-btn" title="Modifier" aria-label="Modifier" onClick={() => setForm({ plan: true, edit: p })}><Pencil size={16} /></button>
                    <button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={() => delPlan(p)}><Trash2 size={16} /></button></div></td>}</tr>))}</tbody>
            </table></div>
          ))}
        </>
      )}
      {form && (form.plan ? <PlanForm trucks={active} edit={form.edit} onClose={() => setForm(null)} onSaved={load} /> : <InterventionForm trucks={active} edit={form.edit} onClose={() => setForm(null)} onSaved={load} />)}
    </div>
  );
}
