import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, History, Save } from 'lucide-react';
import { api } from '../api.js';
import { PLAN } from '../../../shared/calc.js';
import { Modal, NumInput, useToast } from '../components.jsx';
import { fmtDateTime, n2 } from '../format.js';

const LAST = 'sf_last_op';
export const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { return {}; } };
const saveLast = (v) => { try { localStorage.setItem(LAST, JSON.stringify(v)); } catch { /* ignore */ } };
export const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const LABEL = Object.fromEntries([...PLAN.produits.map((p) => [p.code, p.label]), ...PLAN.charges.flatMap((g) => g.comptes.map((c) => [c.code, c.label]))]);
export function AccountSelect({ value, onChange, id, label }) {
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Produits (recettes)">{PLAN.produits.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</optgroup>
      {PLAN.charges.map((g) => <optgroup key={g.key} label={g.titre}>{g.comptes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</optgroup>)}
    </select>
  );
}
const QUICK = ['61221000', '61420000', '61430000', '61330000', '61222000'];
let uid = 0;
const row = (code, montant = 0) => ({ k: ++uid, code, montant });
const presets = () => [row('71210000'), row('61221000'), row('61420000')];

/** Création d'un voyage (plusieurs lignes) ou modification d'une ligne existante. */
export default function OperationForm({ trucks, initial = {}, edit, onClose, onSaved }) {
  const toast = useToast();
  const last = readLast();
  const list = useMemo(() => {
    const l = [...trucks]; if (edit && !l.some((t) => t._id === edit.truck._id)) l.push(edit.truck); return l;
  }, [trucks, edit]);
  const first = initial.truck || (list.some((t) => t._id === last.truck) ? last.truck : '');
  const [f, setF] = useState(edit
    ? { truck: edit.truck._id, date: edit.date, voyage: edit.voyage, km: edit.km, note: edit.note, code: edit.code, montant: edit.montant }
    : { truck: first, date: initial.date || last.date || todayStr(), voyage: '', km: 0, note: '' });
  const [lines, setLines] = useState(presets);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { if (edit) api(`/operations/${edit.id}`).then((r) => setHist(r.historique)).catch(() => {}); }, [edit]);

  const submit = async (keepOpen) => {
    if (!f.truck) return toast('Choisissez le camion', 'err');
    setBusy(true);
    try {
      if (edit) {
        await api(`/operations/${edit.id}`, { method: 'PUT', body: { truck: f.truck, date: f.date, code: f.code, montant: f.montant, km: f.km || 0, voyage: f.voyage, note: f.note } });
        toast('Opération modifiée (l’ancienne valeur reste dans l’historique)');
      } else {
        const ls = lines.filter((l) => l.montant > 0).map((l) => ({ code: l.code, montant: l.montant }));
        if (!ls.length) { setBusy(false); return toast('Saisissez au moins un montant', 'err'); }
        await api('/operations', { method: 'POST', body: { truck: f.truck, date: f.date, voyage: f.voyage, km: f.km || 0, note: f.note, lignes: ls } });
        saveLast({ truck: f.truck, date: f.date });
        toast(`${ls.length} ligne${ls.length > 1 ? 's' : ''} enregistrée${ls.length > 1 ? 's' : ''}`);
      }
      await onSaved?.();
      if (keepOpen) { setLines(presets()); setF((x) => ({ ...x, voyage: '', km: 0, note: '' })); } else onClose();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const total = lines.reduce((s, l) => s + (l.montant || 0) * (PLAN.produits.some((p) => p.code === l.code) ? 1 : -1), 0);
  return (
    <Modal title={edit ? 'Modifier l’opération' : 'Nouvelle opération'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="form-grid">
          <label className="field"><span>Camion *</span>
            <select value={f.truck} onChange={(e) => set('truck', e.target.value)} autoFocus={!f.truck} required>
              <option value="">— Choisir —</option>
              {list.map((t) => <option key={t._id} value={t._id}>{t.immatriculation}{t.chauffeur ? ` · ${t.chauffeur}` : ''}</option>)}
            </select></label>
          <label className="field"><span>Date *</span><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></label>
          <label className="field"><span>Voyage / trajet <small className="muted">(facultatif)</small></span>
            <input type="text" placeholder="ex. Tanger–Casablanca" value={f.voyage} maxLength={80} onChange={(e) => set('voyage', e.target.value)} /></label>
          <label className="field"><span>Km parcourus <small className="muted">(facultatif)</small></span><NumInput value={f.km} onChange={(v) => set('km', v)} suffix="km" aria-label="Km parcourus" /></label>
        </div>

        {edit ? (
          <div className="form-grid">
            <label className="field"><span>Poste</span><AccountSelect value={f.code} onChange={(v) => set('code', v)} label="Poste" /></label>
            <label className="field"><span>Montant *</span><NumInput value={f.montant} onChange={(v) => set('montant', v)} suffix="DHS" aria-label="Montant" /></label>
          </div>
        ) : (
          <div className="op-lines">
            <div className="op-lines-head"><b>Lignes du voyage</b><small className="muted">Recette en haut, puis les dépenses. Les lignes à 0 sont ignorées.</small></div>
            {lines.map((l, i) => (
              <div key={l.k} className="op-line">
                <AccountSelect value={l.code} label={`Poste ligne ${i + 1}`} onChange={(v) => setLines((x) => x.map((y) => (y.k === l.k ? { ...y, code: v } : y)))} />
                <NumInput value={l.montant} suffix="DHS" aria-label={`Montant ligne ${i + 1}`} onChange={(v) => setLines((x) => x.map((y) => (y.k === l.k ? { ...y, montant: v } : y)))} />
                <button type="button" className="icon-btn" aria-label="Retirer la ligne" onClick={() => setLines((x) => x.filter((y) => y.k !== l.k))}><Trash2 size={16} /></button>
              </div>
            ))}
            <div className="op-quick">
              <span className="muted small">Ajouter :</span>
              {QUICK.filter((c) => !lines.some((l) => l.code === c)).map((c) => <button type="button" key={c} className="chip-btn" onClick={() => setLines((x) => [...x, row(c)])}><Plus size={12} /> {LABEL[c]}</button>)}
              <button type="button" className="chip-btn" onClick={() => setLines((x) => [...x, row('61330000')])}><Plus size={12} /> Autre ligne</button>
            </div>
            <div className="op-total"><span>Résultat de ce voyage</span><b className={total < 0 ? 'neg' : total > 0 ? 'pos' : ''}>{n2(total)} DHS</b></div>
          </div>
        )}

        <label className="field"><span>Note <small className="muted">(facultatif)</small></span>
          <input type="text" value={f.note} maxLength={500} placeholder="ex. plein à la station X, ticket n° 4521" onChange={(e) => set('note', e.target.value)} /></label>

        {edit && hist && (
          <div className="op-hist"><b><History size={15} /> Historique</b>
            {hist.map((h, i) => (
              <div key={i}><span>{fmtDateTime(h.at)} · {h.par}</span>
                <em>{{ creation: 'Création', modification: 'Modification', suppression: 'Suppression', restauration: 'Restauration' }[h.action] || h.action}</em>
                {h.action === 'modification' && h.avant && <small className="muted"> avant : {h.avant.date} · {LABEL[h.avant.code] || h.avant.code} · {n2(h.avant.montant)} DHS{h.avant.km ? ` · ${h.avant.km} km` : ''}{h.avant.voyage ? ` · ${h.avant.voyage}` : ''}</small>}
              </div>
            ))}
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          {!edit && <button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Enregistrer et ajouter un autre</button>}
          <button className="btn primary" disabled={busy}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}
