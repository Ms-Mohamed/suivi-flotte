import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet, CheckCircle2, Upload } from 'lucide-react';
import { download, upload } from '../api.js';
import { Spinner, useToast } from '../components.jsx';
import { n0, tone, monthLong } from '../format.js';

const STATUT = { nouveau: ['pos', 'Nouveau'], remplace: ['info', 'Remplacé'], ignore: ['warn', 'Conservé'], erreur: ['neg', 'Erreur'] };

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [opts, setOpts] = useState({ creerCamions: true, ecraser: false });
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const input = useRef(null); const toast = useToast();
  const qs = `?creerCamions=${opts.creerCamions ? 1 : 0}&ecraser=${opts.ecraser ? 1 : 0}`;

  useEffect(() => {
    if (!file) return;
    let live = true; setBusy(true); setDone(null);
    upload(`/import/apercu${qs}`, file).then((r) => live && setPrev(r)).catch((e) => { if (live) { setPrev(null); toast(e.message, 'err'); } }).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [file, opts.creerCamions, opts.ecraser]); // eslint-disable-line

  const run = async () => {
    setBusy(true);
    try { const r = await upload(`/import/valider${qs}`, file); setDone(r.resume); setPrev(null); setFile(null); toast('Import terminé'); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const r = prev?.resume;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Import Excel</h1><p className="muted">Reprenez vos mois passés sans tout ressaisir.</p></div></div>
      <div className="steps">
        <section className="card">
          <div className="step-head"><span className="step-num">1</span><h3>Téléchargez le modèle et remplissez-le</h3></div>
          <p className="muted" style={{ marginTop: 0 }}>Une ligne = un camion pour un mois. L’onglet « Aide » du modèle explique chaque colonne.</p>
          <button className="btn" onClick={() => download('/import/modele', 'modele-import-suivi-flotte.xlsx').catch((e) => toast(e.message, 'err'))}><Download size={17} />Télécharger le modèle Excel</button>
        </section>

        <section className="card">
          <div className="step-head"><span className="step-num">2</span><h3>Choisissez votre fichier</h3></div>
          <label className={`dropzone ${file ? 'has' : ''}`}>
            <input ref={input} type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPrev(null); setDone(null); }} />
            {file ? <><FileSpreadsheet size={26} /><div><b>{file.name}</b></div><small>Cliquez pour changer de fichier</small></> : <><Upload size={26} /><div><b>Cliquez pour choisir un fichier .xlsx</b></div><small>Rien n’est enregistré avant votre validation à l’étape suivante</small></>}
          </label>
          <div style={{ marginTop: 14 }}>
            <label className="check"><input type="checkbox" checked={opts.creerCamions} onChange={(e) => setOpts({ ...opts, creerCamions: e.target.checked })} />Créer automatiquement les camions qui n’existent pas encore</label>
            <label className="check"><input type="checkbox" checked={opts.ecraser} onChange={(e) => setOpts({ ...opts, ecraser: e.target.checked })} />Remplacer les mois déjà saisis (sinon ils sont conservés)</label>
          </div>
        </section>

        {busy && !prev && <div className="center"><Spinner /></div>}
        {prev && (
          <section className="card">
            <div className="step-head"><span className="step-num">3</span><h3>Vérifiez puis validez</h3></div>
            <div className="summary">
              <span className="pill pos">{r.importes} ligne{r.importes > 1 ? 's' : ''} à importer</span>
              {r.ignores > 0 && <span className="pill warn">{r.ignores} conservée{r.ignores > 1 ? 's' : ''}</span>}
              {r.erreurs > 0 && <span className="pill neg">{r.erreurs} en erreur (ignorée{r.erreurs > 1 ? 's' : ''})</span>}
              {r.camionsCrees.length > 0 && <span className="pill info">{r.camionsCrees.length} camion{r.camionsCrees.length > 1 ? 's' : ''} à créer : {r.camionsCrees.join(', ')}</span>}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Ligne</th><th>Camion</th><th>Mois</th><th>Statut</th><th className="r">Produits</th><th className="r">Charges</th><th className="r">Résultat net</th><th>Remarques</th></tr></thead>
                <tbody>
                  {prev.rows.map((x) => (
                    <tr key={x.line}>
                      <td className="muted">{x.line}</td><td><b>{x.immatriculation || '—'}</b></td><td>{/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month || '') ? monthLong(x.month) : (x.month || '—')}</td>
                      <td><span className={`pill ${STATUT[x.statut][0]}`}>{STATUT[x.statut][1]}</span></td>
                      <td className="r">{x.A != null ? n0(x.A) : ''}</td><td className="r">{x.B != null ? n0(x.B) : ''}</td><td className={`r ${x.net != null ? tone(x.net) : ''}`}>{x.net != null ? n0(x.net) : ''}</td>
                      <td className="msgs">{x.messages.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-foot" style={{ marginTop: 16 }}>
              <button className="btn primary" disabled={busy || r.importes === 0} onClick={run}><CheckCircle2 size={18} />{busy ? 'Import en cours…' : `Importer ${r.importes} ligne${r.importes > 1 ? 's' : ''}`}</button>
            </div>
          </section>
        )}
        {done && (
          <section className="card">
            <div className="alert info"><CheckCircle2 size={18} /><div><strong>Import terminé :</strong> {done.importes} ligne{done.importes > 1 ? 's' : ''} importée{done.importes > 1 ? 's' : ''}{done.camionsCrees.length ? `, ${done.camionsCrees.length} camion(s) créé(s)` : ''}{done.ignores ? `, ${done.ignores} conservée(s)` : ''}{done.erreurs ? `, ${done.erreurs} ignorée(s) en erreur` : ''}. <Link to="/">Voir le tableau de bord →</Link></div></div>
          </section>
        )}
      </div>
    </div>
  );
}
