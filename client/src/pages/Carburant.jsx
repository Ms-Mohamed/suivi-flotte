import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Fuel, Save, History, HandCoins, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Kpi, Modal, NumInput, Plate, Empty, Spinner, useToast } from '../components.jsx';
import { dhs, n0, n2, fmtDateTime } from '../format.js';
import { todayStr } from './OperationForm.jsx';
import { RefSelect, REFS } from '../crud.jsx';

const daysAgo = (n) => new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - n * 86400000).toISOString().slice(0, 10);
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const STATUT = {
  normal: ['pos', 'Normal'], surconsommation: ['neg', 'Surconsommation'], suspect: ['warn', 'Suspect'], incomplet: ['info', 'Non évalué'], sans_reference: ['info', 'Sans référence'],
};
export const StatutPill = ({ s, raison }) => <span className={`pill ${STATUT[s]?.[0] || 'info'}`} title={raison || ''}>{STATUT[s]?.[1] || s}</span>;
const warnToast = (toast, list = []) => list.forEach((w) => toast(`Attention : « ${w.compte} » a déjà ${n2(w.montantFiche)} DHS dans la fiche de ${w.month}. Le plein s’y ajoute : vérifiez qu’il n’y a pas de double comptage.`, 'err'));

function PleinForm({ trucks, edit, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(edit
    ? { truck: edit.truck._id, date: edit.date, kmCompteur: edit.kmCompteur, litres: edit.litres, prixLitre: edit.prixLitre, montant: edit.montant, source: edit.source, station: edit.station, bon: edit.bon, chauffeur: edit.chauffeur, voyage: edit.voyage, note: edit.note }
    : { truck: '', date: todayStr(), kmCompteur: 0, litres: 0, prixLitre: 0, montant: 0, source: 'externe', station: '', bon: '', chauffeur: '', voyage: '', note: '' });
  const [auto, setAuto] = useState(true);               // montant = litres × prix
  const [last, setLast] = useState(null);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const list = useMemo(() => { const l = [...trucks]; if (edit && !l.some((t) => t._id === edit.truck._id)) l.push(edit.truck); return l; }, [trucks, edit]);

  useEffect(() => { if (edit) api(`/operations/${edit.id}`).then((r) => setHist(r.historique)).catch(() => {}); }, [edit]);
  useEffect(() => {
    setLast(null);
    if (f.truck) api(`/carburant?truck=${f.truck}&limit=1`).then((r) => setLast(r.items[0] && r.items[0].id !== edit?.id ? r.items[0] : null)).catch(() => {});
  }, [f.truck, edit]);
  const pickTruck = (id) => { const t = list.find((x) => x._id === id); setF((x) => ({ ...x, truck: id, chauffeur: x.chauffeur || t?.chauffeur || '' })); };
  const calc = (patch) => setF((x) => {
    const n = { ...x, ...patch };
    if (auto) n.montant = Math.round(n.litres * n.prixLitre * 100) / 100;
    else if (n.litres > 0 && 'montant' in patch) n.prixLitre = Math.round((n.montant / n.litres) * 100) / 100;
    return n;
  });
  const consoPrev = last && f.kmCompteur > last.kmCompteur && f.litres > 0 ? (f.litres / (f.kmCompteur - last.kmCompteur)) * 100 : null;
  const theo = list.find((t) => t._id === f.truck)?.consoTheorique || 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!f.truck) return toast('Choisissez le camion', 'err');
    setBusy(true);
    try {
      const body = { ...f, prixLitre: f.prixLitre || 0, montant: auto ? 0 : f.montant };
      const r = edit ? await api(`/carburant/${edit.id}`, { method: 'PUT', body }) : await api('/carburant', { method: 'POST', body });
      toast(edit ? 'Plein modifié (l’ancienne valeur reste dans l’historique)' : 'Plein enregistré'); warnToast(toast, r.avertissements);
      await onSaved?.(); onClose();
    } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={edit ? 'Modifier le plein' : 'Saisir un plein'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>Camion *</span>
            <select value={f.truck} onChange={(e) => pickTruck(e.target.value)} required autoFocus={!f.truck}>
              <option value="">— Choisir —</option>{list.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.chauffeur ? ` · ${t.chauffeur}` : ''}</option>)}</select></label>
          <label className="field"><span>Date *</span><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></label>
          <label className="field"><span>Km actuel (compteur) *</span><NumInput value={f.kmCompteur} onChange={(v) => set('kmCompteur', v)} suffix="km" aria-label="Km actuel" />
            {last && <small className="muted">Dernier relevé : {n0(last.kmCompteur)} km le {fmtDay(last.date)}</small>}</label>
          <label className="field"><span>Litres *</span><NumInput value={f.litres} onChange={(v) => calc({ litres: v })} suffix="L" aria-label="Litres" /></label>
          <label className="field"><span>Prix du litre</span><NumInput value={f.prixLitre} onChange={(v) => { setAuto(true); calc({ prixLitre: v }); }} suffix="DHS/L" aria-label="Prix du litre" /></label>
          <label className="field"><span>Montant total</span>
            <NumInput value={f.montant} onChange={(v) => calc({ montant: v })} readOnly={auto} suffix="DHS" aria-label="Montant total" />
            <small className="muted"><label className="check" style={{ display: 'inline-flex' }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />calculé (litres × prix) — décochez pour saisir le total de la facture</label></small></label>
        </div>
        {last && f.kmCompteur > 0 && (f.kmCompteur <= last.kmCompteur || f.kmCompteur - last.kmCompteur > 5000) && (
          <div className="alert warn"><Fuel size={18} /><div>{f.kmCompteur <= last.kmCompteur ? `Ce kilométrage (${n0(f.kmCompteur)} km) n’est pas supérieur au dernier relevé (${n0(last.kmCompteur)} km) : le plein ne pourra pas être analysé.` : `Écart de ${n0(f.kmCompteur - last.kmCompteur)} km depuis le dernier relevé : vérifiez le compteur (faute de frappe ?).`}</div></div>
        )}
        {consoPrev !== null && (
          <div className={`alert ${theo && consoPrev > theo * 1.1 ? 'warn' : 'info'}`}><Fuel size={18} /><div>Consommation estimée depuis le plein précédent : <b>{n2(consoPrev)} L/100 km</b>{theo ? ` (référence du camion : ${n2(theo)})` : ' — renseignez la consommation théorique du camion pour la comparer.'}</div></div>
        )}
        <div className="form-grid">
          <label className="field"><span>Chauffeur</span><input value={f.chauffeur} maxLength={80} onChange={(e) => set('chauffeur', e.target.value)} /></label>
          <label className="field"><span>Mission / voyage <small className="muted">(facultatif)</small></span><input value={f.voyage} maxLength={80} placeholder="ex. Tanger–Casablanca" onChange={(e) => set('voyage', e.target.value)} /></label>
          <label className="field"><span>N° bon carburant</span><input value={f.bon} maxLength={40} onChange={(e) => set('bon', e.target.value)} /></label>
          <label className="field"><span>Source du gasoil</span>
            <select value={f.source} onChange={(e) => set('source', e.target.value)}><option value="externe">Station externe</option><option value="interne">Cuve interne</option></select></label>
          <label className="field"><span>Station / fournisseur</span><input value={f.station} maxLength={80} placeholder="ex. Shell Aïn Sebaâ" onChange={(e) => set('station', e.target.value)} /></label>
          <label className="field"><span>Observation</span><input value={f.note} maxLength={500} onChange={(e) => set('note', e.target.value)} /></label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Le montant du plein alimente automatiquement le compte « Gazole &amp; AdBlue » du camion, au jour saisi. Pour une consommation juste, remplissez le réservoir à chaque plein (méthode plein à plein).</p>
        {edit && hist && (
          <div className="op-hist"><b><History size={15} /> Historique</b>
            {hist.map((h, i) => (
              <div key={i}><span>{fmtDateTime(h.at)} · {h.par}</span><em>{{ creation: 'Création', modification: 'Modification', suppression: 'Suppression', restauration: 'Restauration' }[h.action] || h.action}</em>
                {h.action === 'modification' && h.avant && <small className="muted"> avant : {h.avant.date} · {h.avant.meta?.litres} L · {h.avant.meta?.kmCompteur} km · {n2(h.avant.montant)} DHS</small>}</div>
            ))}
          </div>
        )}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function TransfertModal({ o, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ employe: '', type: o.statutConso === 'surconsommation' ? 'retenue' : 'prime', montant: o.surplusDh || 0, motif: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!f.employe) return setErr('Choisissez le chauffeur');
    setBusy(true);
    try { await api(`/carburant/${o.id}/transfert`, { method: 'POST', body: f }); toast(f.type === 'retenue' ? 'Retenue ajoutée à la paie du chauffeur' : 'Prime ajoutée à la paie du chauffeur'); onSaved(); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title="Transférer à la paie du chauffeur" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>Plein du {fmtDay(o.date)} — {o.truck.immatriculation} — {n2(o.litres)} L{o.surplusDh ? ` · surcoût estimé ${n2(o.surplusDh)} DHS` : ''}</p>
        <div className="form-grid">
          <label className="field span2"><span>Chauffeur (employé)</span><RefSelect url={REFS.employes.url} label={REFS.employes.label} value={f.employe} onChange={(v) => setF({ ...f, employe: v })} /></label>
          <label className="field"><span>Type</span><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="retenue">Retenue (surconsommation)</option><option value="prime">Prime (économie de carburant)</option></select></label>
          <label className="field"><span>Montant</span><NumInput value={f.montant} onChange={(v) => setF({ ...f, montant: v })} suffix="DHS" /></label>
          <label className="field span2"><span>Libellé sur le bulletin (facultatif)</span><input value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></label>
        </div>
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !(f.montant > 0)}>Transférer</button></div>
      </form>
    </Modal>
  );
}

export default function Carburant() {
  const { user } = useApp();
  const canEdit = user.role !== 'lecture';
  const toast = useToast();
  const [trucks, setTrucks] = useState([]);
  const [tab, setTab] = useState('pleins');
  const [f, setF] = useState({ truck: '', from: daysAgo(90), to: '', source: '', q: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [tr, setTr] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  useEffect(() => { api('/trucks?tous=1').then(setTrucks).catch(() => {}); }, []);
  const active = useMemo(() => trucks.filter((t) => t.actif), [trucks]);

  const load = useCallback(async () => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    if (tab === 'surconso') p.set('statut', 'surconsommation,suspect');
    p.set('page', page); p.set('limit', 100);
    try { setD(await api(`/carburant?${p}`)); } catch (e) { toast(e.message, 'err'); }
  }, [f, tab, page, toast]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load]); // eslint-disable-line

  const retirerTransfert = async (o) => {
    if (!window.confirm('Retirer ce transfert de la paie du chauffeur ?')) return;
    try { await api(`/carburant/${o.id}/transfert`, { method: 'DELETE' }); toast('Transfert retiré'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const del = async (o) => {
    if (!window.confirm(`Supprimer ce plein (${n2(o.litres)} L, ${n2(o.montant)} DHS) ? Il reste récupérable depuis le journal des opérations.`)) return;
    try { await api(`/operations/${o.id}`, { method: 'DELETE' }); toast('Plein supprimé'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const k = d?.kpis;
  const totalPages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  const preset = (n) => { setF((x) => ({ ...x, from: n ? daysAgo(n) : '', to: '' })); setPage(1); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Gasoil</h1><p className="muted">Pleins par camion et analyse de la consommation (L/100 km, méthode plein à plein).</p></div>
        <div className="head-actions">
          <div className="seg" role="tablist">
            <button className={tab === 'pleins' ? 'on' : ''} onClick={() => { setTab('pleins'); setPage(1); }}>Pleins</button>
            <button className={tab === 'surconso' ? 'on' : ''} onClick={() => { setTab('surconso'); setPage(1); }}>Surconsommation</button>
          </div>
          {canEdit && <button className="btn primary" onClick={() => setForm({})}><Plus size={18} />Saisir un plein</button>}
        </div>
      </div>
      <div className="filters no-print">
        <label className="field"><span>Camion</span><select value={f.truck} onChange={(e) => set('truck', e.target.value)}><option value="">Tous les camions</option>
          {trucks.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.actif ? '' : ' (archivé)'}</option>)}</select></label>
        <label className="field"><span>Du</span><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="field"><span>Au</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="field"><span>Source</span><select value={f.source} onChange={(e) => set('source', e.target.value)}><option value="">Toutes</option><option value="interne">Cuve interne</option><option value="externe">Station externe</option></select></label>
        <label className="field"><span>Recherche</span><input type="text" placeholder="bon, station, chauffeur…" value={f.q} onChange={(e) => set('q', e.target.value)} /></label>
      </div>
      <div className="btns no-print" style={{ marginBottom: 12 }}>
        <button className="chip-btn" onClick={() => preset(30)}>30 jours</button><button className="chip-btn" onClick={() => preset(90)}>90 jours</button>
        <button className="chip-btn" onClick={() => { setF((x) => ({ ...x, from: `${todayStr().slice(0, 4)}-01-01`, to: '' })); setPage(1); }}>Cette année</button><button className="chip-btn" onClick={() => preset(0)}>Tout</button>
      </div>

      {!d ? <div className="center"><Spinner /></div> : (
        <>
          <section className="kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
            <Kpi label="Pleins" value={n0(k.nbPleins)} sub={`${n0(k.litres)} L au total`} />
            <Kpi label="Coût du carburant" value={dhs(k.cout)} />
            <Kpi label="Consommation moyenne" value={k.consoMoyenne ? `${n2(k.consoMoyenne)} L/100` : '—'} sub={k.kmAnalyses ? `sur ${n0(k.kmAnalyses)} km analysés` : 'pas assez de pleins'} />
            <Kpi label="Anomalies" value={n0(k.nbSurconsommation + k.nbSuspects)} sub={`${k.nbSurconsommation} surconso · ${k.nbSuspects} suspect${k.nbSuspects > 1 ? 's' : ''}`} tone={k.nbSurconsommation + k.nbSuspects ? 'neg' : ''} />
            <Kpi accent label="Surcoût estimé" value={dhs(k.surplusDh)} sub={`${n0(k.surplusLitres)} L en trop (seuil +${d.seuil} %)`} tone={k.surplusDh ? 'neg' : ''} />
          </section>

          {tab === 'surconso' && d.parCamion.length > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <div className="card-head"><h3>Consommation par camion</h3></div>
              <div className="table-wrap"><table className="tbl">
                <thead><tr><th>Camion</th><th className="r">Pleins</th><th className="r">Litres</th><th className="r">Coût</th><th className="r">Km analysés</th><th className="r">L/100 réel</th><th className="r">L/100 théorique</th><th className="r">Surcoût estimé</th></tr></thead>
                <tbody>{d.parCamion.map((c) => (
                  <tr key={c.truck._id}><td><Link to={`/camion/${c.truck._id}`}><Plate>{c.truck.immatriculation}</Plate></Link></td><td className="r">{c.nb}</td><td className="r">{n0(c.litres)}</td><td className="r">{n0(c.cout)}</td>
                    <td className="r">{c.km ? n0(c.km) : '—'}</td><td className={`r ${c.conso && c.theorique && c.conso > c.theorique * (1 + d.seuil / 100) ? 'neg' : ''}`}>{c.conso ? n2(c.conso) : '—'}</td>
                    <td className="r">{c.theorique ? n2(c.theorique) : <span className="muted">non renseignée</span>}</td><td className={`r ${c.surplusDh ? 'neg' : ''}`}>{c.surplusDh ? n0(c.surplusDh) : '—'}</td></tr>))}</tbody>
              </table></div>
            </section>
          )}

          {d.items.length === 0 ? (
            <Empty icon={Fuel} title={tab === 'surconso' ? 'Aucune anomalie sur cette période' : 'Aucun plein sur cette période'}>
              {tab === 'surconso' ? <>Bonne nouvelle, ou pas encore assez de pleins : il en faut au moins deux par camion, avec le kilométrage du compteur, et la consommation théorique du camion renseignée.</> : <>Saisissez un plein ou élargissez les dates.{canEdit && <><br /><button className="btn primary" style={{ marginTop: 14 }} onClick={() => setForm({})}><Plus size={16} />Saisir un plein</button></>}</>}
            </Empty>
          ) : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="tbl">
                <thead><tr><th>Date</th><th>Camion</th><th>Chauffeur</th><th className="r">Km compteur</th><th className="r">Distance</th><th className="r">Litres</th><th className="r">L/100</th>
                  {tab === 'surconso' ? <><th className="r">Écart</th><th className="r">Surcoût</th></> : <><th className="r">Prix/L</th><th className="r">Coût</th><th>Source</th></>}<th>Statut</th>{canEdit && <th />}</tr></thead>
                <tbody>{d.items.map((o) => (
                  <tr key={o.id}>
                    <td>{fmtDay(o.date)}</td><td><Link to={`/camion/${o.truck._id}`}><Plate>{o.truck.immatriculation || '—'}</Plate></Link></td><td className="wrap">{o.chauffeur || <span className="muted">—</span>}{o.bon && <><br /><small className="muted">{o.bon}</small></>}</td><td className="r">{n0(o.kmCompteur)}</td><td className="r">{o.distance ? n0(o.distance) : '—'}</td><td className="r">{n2(o.litres)}</td>
                    <td className={`r ${o.statutConso === 'surconsommation' ? 'neg' : ''}`}>{o.conso !== null ? n2(o.conso) : '—'}</td>
                    {tab === 'surconso' ? <><td className="r">{o.ecart !== null ? `${o.ecart > 0 ? '+' : ''}${n2(o.ecart)}` : '—'}</td><td className="r neg">{o.surplusDh ? n0(o.surplusDh) : '—'}</td></>
                      : <><td className="r">{n2(o.prixLitre)}</td><td className="r">{n2(o.montant)}</td><td>{o.source === 'interne' ? 'Cuve interne' : o.station || 'Station externe'}</td></>}
                    <td><StatutPill s={o.statutConso} raison={o.raison} />{o.transfert && <small className="muted" style={{ display: 'block' }}>{o.transfert.type === 'retenue' ? 'Retenue' : 'Prime'} {n2(o.transfert.montant)} → {o.transfert.employe}</small>}</td>
                    {canEdit && <td><div className="act">
                      {user.role === 'admin' && (o.transfert ? <button className="icon-btn" title="Retirer le transfert à la paie" aria-label="Retirer le transfert" onClick={() => retirerTransfert(o)}><Undo2 size={16} /></button> : (o.statutConso === 'surconsommation' || tab === 'surconso' || o.statutConso === 'normal') && <button className="icon-btn" title="Retenue / prime sur la paie du chauffeur" aria-label="Retenue ou prime chauffeur" onClick={() => setTr(o)}><HandCoins size={16} /></button>)}
                      <button className="icon-btn" title="Modifier / historique" aria-label="Modifier" onClick={() => setForm({ edit: o })}><Pencil size={16} /></button>
                      <button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={() => del(o)}><Trash2 size={16} /></button></div></td>}
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && <div className="opsbox" style={{ marginTop: 12 }}><span className="muted">Page {page} / {totalPages}</span>
            <div className="btns"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédente</button><button className="btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Suivante</button></div></div>}
        </>
      )}
      {tr && <TransfertModal o={tr} onClose={() => setTr(null)} onSaved={load} />}
      {form && <PleinForm trucks={active} edit={form.edit} onClose={() => setForm(null)} onSaved={load} />}
    </div>
  );
}
