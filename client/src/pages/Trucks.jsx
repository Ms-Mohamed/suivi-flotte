import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, User, FileText, History, Truck as TruckIcon } from 'lucide-react';
import { api } from '../api.js';
import { PLAN, CODES_ANNUELS, currentMonth } from '../../../shared/calc.js';
import { useApp } from '../App.jsx';
import { Modal, MonthPicker, NumInput, Plate, Empty, Spinner, useToast } from '../components.jsx';
import { dhs, n2, tone, monthLong } from '../format.js';

export default function Trucks() {
  const [trucks, setTrucks] = useState(null);
  const [month, setMonth] = useState(currentMonth());
  const [dash, setDash] = useState(null);
  const [all, setAll] = useState(false);
  const [form, setForm] = useState(null); // null | {} (nouveau) | truck
  const toast = useToast();
  const isAdmin = useApp().user.role === 'admin';

  const load = useCallback(async () => {
    try { setTrucks(await api(`/trucks${all ? '?tous=1' : ''}`)); } catch (e) { toast(e.message, 'err'); }
  }, [all, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDash(null); api(`/reports/dashboard?month=${month}`).then(setDash).catch(() => {}); }, [month, trucks]);

  const byId = new Map((dash?.trucks || []).map((x) => [x.truck._id, x]));
  const archive = async (t) => { await api(`/trucks/${t._id}`, { method: 'DELETE' }); toast('Camion archivé (ses données sont conservées)'); load(); };
  const restore = async (t) => { await api(`/trucks/${t._id}`, { method: 'PUT', body: { ...clean(t), actif: true } }); toast('Camion réactivé'); load(); };
  const purge = async (t) => {
    if (!window.confirm(`Supprimer définitivement ${t.immatriculation} et TOUTES ses saisies mensuelles ? Cette action est irréversible.`)) return;
    await api(`/trucks/${t._id}?definitif=1`, { method: 'DELETE' }); toast('Camion supprimé'); load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Camions</h1><p className="muted">Votre flotte et le résultat de chaque camion.</p></div>
        <div className="head-actions">
          <MonthPicker value={month} onChange={setMonth} />
          {isAdmin && <button className="btn primary" onClick={() => setForm({})}><Plus size={18} />Ajouter un camion</button>}
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Afficher les camions archivés</label>
      {!trucks ? <div className="center"><Spinner /></div> : trucks.length === 0 ? (
        <Empty icon={TruckIcon} title="Aucun camion">Ajoutez votre premier camion pour saisir ses produits et ses charges.{isAdmin && <><br /><button className="btn primary" style={{ marginTop: 14 }} onClick={() => setForm({})}><Plus size={18} />Ajouter un camion</button></>}</Empty>
      ) : (
        <div className="truck-grid">
          {trucks.map((t) => {
            const r = byId.get(t._id);
            return (
              <article key={t._id} className={`truck-card ${t.actif ? '' : 'archived'}`}>
                <div className="tc-top"><Plate>{t.immatriculation}</Plate>{!t.actif && <span className="pill warn">Archivé</span>}</div>
                <h3>{[t.marque, t.modele].filter(Boolean).join(' ') || 'Camion'}{t.annee ? <small> · {t.annee}</small> : null}</h3>
                <p className="driver"><User size={15} />{t.chauffeur || 'Aucun chauffeur'}</p>
                <div className="tc-result">
                  <span>Résultat net · {monthLong(month)}</span>
                  {!dash ? <b>…</b> : r?.saisi ? <><b className={tone(r.calc.net)}>{dhs(r.calc.net)}</b><span className={`pill ${r.calc.net < 0 ? 'neg' : 'pos'}`}>{n2(r.calc.marge)} %</span></> : <b className="muted">Non saisi</b>}
                </div>
                <div className="tc-actions">
                  <Link className="btn sm primary" to={`/camion/${t._id}/${month}`}><FileText size={15} />{r?.saisi ? 'Ouvrir' : 'Saisir'}</Link>
                  <Link className="btn sm" to={`/camion/${t._id}`}><History size={15} />Historique</Link>
                  {isAdmin && <button className="btn sm" onClick={() => setForm(t)}><Pencil size={15} />Modifier</button>}
                  {!isAdmin ? null : t.actif ? <button className="icon-btn" title="Archiver" aria-label="Archiver" onClick={() => archive(t)}><Archive size={17} /></button>
                    : <><button className="icon-btn" title="Réactiver" aria-label="Réactiver" onClick={() => restore(t)}><ArchiveRestore size={17} /></button><button className="icon-btn danger" title="Supprimer définitivement" aria-label="Supprimer définitivement" onClick={() => purge(t)}><Trash2 size={17} /></button></>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {form && <TruckForm truck={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}

const clean = (t) => ({ immatriculation: t.immatriculation, marque: t.marque, modele: t.modele, annee: t.annee || null, chauffeur: t.chauffeur, notes: t.notes, actif: t.actif, defauts: { amounts: t.defauts?.amounts || {}, annuel: t.defauts?.annuel || {}, modes: t.defauts?.modes || {}, tarifKm: t.defauts?.tarifKm || 0, prixLitre: t.defauts?.prixLitre || 0 } });

function TruckForm({ truck, onClose, onSaved }) {
  const edit = !!truck._id;
  const [f, setF] = useState(() => (edit ? clean(truck) : { immatriculation: '', marque: '', modele: '', annee: null, chauffeur: '', notes: '', actif: true, defauts: { amounts: {}, annuel: {}, modes: {}, tarifKm: 0, prixLitre: 0 } }));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setD = (k, v) => setF((x) => ({ ...x, defauts: { ...x.defauts, [k]: v } }));
  const setDC = (bucket, code, v) => setF((x) => ({ ...x, defauts: { ...x.defauts, [bucket]: { ...x.defauts[bucket], [code]: v } } }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(edit ? `/trucks/${truck._id}` : '/trucks', { method: edit ? 'PUT' : 'POST', body: f }); toast(edit ? 'Camion modifié' : 'Camion ajouté'); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const fixed = PLAN.charges.filter((g) => g.key !== 'variables').flatMap((g) => g.comptes);
  return (
    <Modal title={edit ? `Modifier ${truck.immatriculation}` : 'Nouveau camion'} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        <div className="form-grid">
          <label className="field"><span>Immatriculation *</span><input required value={f.immatriculation} onChange={(e) => set('immatriculation', e.target.value)} placeholder="12345-A-1" autoFocus /></label>
          <label className="field"><span>Chauffeur</span><input value={f.chauffeur} onChange={(e) => set('chauffeur', e.target.value)} /></label>
          <label className="field"><span>Marque</span><input value={f.marque} onChange={(e) => set('marque', e.target.value)} placeholder="Volvo" /></label>
          <label className="field"><span>Modèle</span><input value={f.modele} onChange={(e) => set('modele', e.target.value)} placeholder="FH 460" /></label>
          <label className="field"><span>Année</span><input type="number" min="1980" max="2100" value={f.annee || ''} onChange={(e) => set('annee', e.target.value ? Number(e.target.value) : null)} /></label>
        </div>
        <fieldset className="template">
          <legend>Modèle mensuel</legend>
          <p className="muted">Ces valeurs pré-remplissent chaque nouveau mois (modifiables mois par mois). Les mois suivants reprennent ensuite les charges fixes du dernier mois saisi.</p>
          <div className="form-grid">
            <label className="field"><span>Tarif au km habituel</span><NumInput value={f.defauts.tarifKm} onChange={(v) => setD('tarifKm', v)} suffix="DHS/km" /></label>
            <label className="field"><span>Prix moyen du litre</span><NumInput value={f.defauts.prixLitre} onChange={(v) => setD('prixLitre', v)} suffix="DHS/L" /></label>
            {fixed.map((a) => CODES_ANNUELS.includes(a.code)
              ? <label className="field" key={a.code}><span>{a.label} (annuel)</span><NumInput value={f.defauts.annuel[a.code] || 0} onChange={(v) => setDC('annuel', a.code, v)} suffix="DHS/an" /><small className="hint">= {n2((f.defauts.annuel[a.code] || 0) / 12)} DHS / mois</small></label>
              : <label className="field" key={a.code}><span>{a.label}</span><NumInput value={f.defauts.amounts[a.code] || 0} onChange={(v) => setDC('amounts', a.code, v)} suffix="DHS/mois" /></label>)}
          </div>
        </fieldset>
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : edit ? 'Enregistrer' : 'Ajouter le camion'}</button></div>
      </form>
    </Modal>
  );
}
