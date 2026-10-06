import React, { useCallback, useEffect, useState } from 'react';
import { Save, KeyRound, Percent, DatabaseBackup, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api, download, upload } from '../api.js';
import { useApp } from '../App.jsx';
import { NumInput, Modal, useToast } from '../components.jsx';
import { fmtSize, fmtDateTime } from '../format.js';

export default function Settings() {
  const { settings, setSettings, user } = useApp();
  const [f, setF] = useState({ societe: settings.societe, tauxIS: settings.tauxIS, cotisationMinimale: settings.cotisationMinimale, cotisationMinimaleActive: settings.cotisationMinimaleActive });
  const [pw, setPw] = useState({ actuel: '', nouveau: '' });
  const toast = useToast();
  const save = async (e) => { e.preventDefault(); try { setSettings(await api('/settings', { method: 'PUT', body: f })); toast('Paramètres enregistrés — tous les résultats sont recalculés'); } catch (x) { toast(x.message, 'err'); } };
  const changePw = async (e) => { e.preventDefault(); try { await api('/auth/password', { method: 'POST', body: pw }); setPw({ actuel: '', nouveau: '' }); toast('Mot de passe modifié'); } catch (x) { toast(x.message, 'err'); } };
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>Paramètres</h1><p className="muted">Connecté en tant que {user.email}</p></div></div>
      <form className="card form" onSubmit={save}>
        <div className="card-head"><h3><Percent size={18} />Entreprise et impôt</h3></div>
        <label className="field"><span>Nom de la société</span><input value={f.societe} onChange={(e) => setF({ ...f, societe: e.target.value })} required /></label>
        <div className="form-grid">
          <label className="field"><span>Taux d’impôt sur les sociétés (IS)</span><NumInput value={f.tauxIS} onChange={(v) => setF({ ...f, tauxIS: Math.min(100, v) })} suffix="%" /></label>
          <label className="field"><span>Cotisation minimale (sur les produits)</span><NumInput value={f.cotisationMinimale} onChange={(v) => setF({ ...f, cotisationMinimale: Math.min(100, v) })} suffix="%" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.cotisationMinimaleActive} onChange={(e) => setF({ ...f, cotisationMinimaleActive: e.target.checked })} />Appliquer la cotisation minimale comme plancher d’impôt</label>
        <p className="muted small">Estimation de l’impôt T = max (IS × résultat brut positif ; cotisation minimale × produits). Vous pouvez aussi saisir T à la main sur chaque situation mensuelle. Faites valider ces taux par votre comptable.</p>
        <div className="modal-foot"><button className="btn primary"><Save size={17} />Enregistrer</button></div>
      </form>
      <Backups />
      <form className="card form" onSubmit={changePw}>
        <div className="card-head"><h3><KeyRound size={18} />Mot de passe</h3></div>
        <div className="form-grid">
          <label className="field"><span>Mot de passe actuel</span><input type="password" autoComplete="current-password" value={pw.actuel} onChange={(e) => setPw({ ...pw, actuel: e.target.value })} required /></label>
          <label className="field"><span>Nouveau (8 caractères min.)</span><input type="password" autoComplete="new-password" minLength={8} value={pw.nouveau} onChange={(e) => setPw({ ...pw, nouveau: e.target.value })} required /></label>
        </div>
        <div className="modal-foot"><button className="btn">Changer le mot de passe</button></div>
      </form>
    </div>
  );
}

function Backups() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);
  const [typed, setTyped] = useState('');
  const toast = useToast();
  const load = useCallback(() => api('/backups').then(setData).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);
  const create = async () => { setBusy(true); try { await api('/backups', { method: 'POST' }); toast('Sauvegarde créée'); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const remove = async (b) => { if (!window.confirm(`Supprimer la sauvegarde ${b.name} ?`)) return; await api(`/backups/${b.name}`, { method: 'DELETE' }); load(); };
  const doRestore = async () => {
    setBusy(true);
    try { const r = await api(`/backups/${restore.name}/restaurer`, { method: 'POST', body: { confirmation: typed } }); toast(`Restauré : ${r.camions} camion(s), ${r.saisies} saisie(s)`); setRestore(null); setTyped(''); load(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const importFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try { await upload('/backups/importer', f); toast('Sauvegarde importée : vous pouvez maintenant la restaurer'); load(); } catch (x) { toast(x.message, 'err'); }
  };
  return (
    <section className="card">
      <div className="card-head"><h3><DatabaseBackup size={18} />Sauvegardes</h3>
        <div className="head-actions">
          <label className="btn sm"><Upload size={15} />Importer<input type="file" accept=".gz" hidden onChange={importFile} /></label>
          <button className="btn sm primary" onClick={create} disabled={busy}>Sauvegarder maintenant</button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>Une sauvegarde automatique est faite chaque nuit (les 30 dernières sont conservées). Téléchargez-en régulièrement une copie et gardez-la hors de cet ordinateur (clé USB, cloud) : une sauvegarde stockée sur la même machine ne protège pas d’une panne de disque.</p>
      {!data ? null : data.fichiers.length === 0 ? <p className="muted">Aucune sauvegarde pour l’instant.</p> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Date</th><th>Fichier</th><th className="r">Taille</th><th /></tr></thead>
          <tbody>{data.fichiers.map((b) => (
            <tr key={b.name}><td>{fmtDateTime(b.createdAt)}</td><td className="muted">{b.name}</td><td className="r">{fmtSize(b.size)}</td>
              <td className="r">
                <button className="icon-btn" title="Télécharger" aria-label="Télécharger" onClick={() => download(`/backups/${b.name}`, b.name).catch((e) => toast(e.message, 'err'))}><Download size={17} /></button>
                <button className="icon-btn" title="Restaurer" aria-label="Restaurer" onClick={() => { setRestore(b); setTyped(''); }}><RotateCcw size={17} /></button>
                <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer" onClick={() => remove(b)}><Trash2 size={17} /></button>
              </td></tr>
          ))}</tbody></table></div>
      )}
      {restore && (
        <Modal title="Restaurer une sauvegarde" onClose={() => setRestore(null)}>
          <div className="form">
            <div className="alert bad"><div><strong>Attention :</strong> les camions et toutes les saisies actuels seront remplacés par ceux de la sauvegarde du {fmtDateTime(restore.createdAt)}. Une sauvegarde de sécurité de l’état actuel est créée juste avant. Les comptes utilisateurs ne sont pas modifiés.</div></div>
            <label className="field"><span>Tapez RESTAURER pour confirmer</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>
            <div className="modal-foot"><button className="btn" onClick={() => setRestore(null)}>Annuler</button><button className="btn primary" disabled={typed !== 'RESTAURER' || busy} onClick={doRestore}>{busy ? 'Restauration…' : 'Restaurer'}</button></div>
          </div>
        </Modal>
      )}
    </section>
  );
}
