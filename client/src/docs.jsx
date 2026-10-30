import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Printer, X } from 'lucide-react';
import { calcDoc } from '../../shared/doc.js';
import { Modal, NumInput } from './components.jsx';
import { FieldInput, idOf } from './crud.jsx';
import { n2, fmtDate, montantEnLettres } from './format.js';

export const TVA_OPTS = [0, 7, 10, 14, 20];
export const newLigne = (tva = 20) => ({ designation: '', qte: 1, pu: 0, tva, unite: '' });

/* ---------- Éditeur de lignes + totaux en direct ---------- */
export function DocLines({ lignes, setLignes, fraisSupp = [], setFrais, remisePct = 0, setRemise, defaultTva = 20, readOnly }) {
  const t = useMemo(() => calcDoc({ lignes, remisePct, fraisSupp }), [lignes, remisePct, fraisSupp]);
  const upd = (i, k, v) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="stack">
      <div className="doc-lines">
        <div className="doc-line head"><span>Désignation</span><span>Qté</span><span>Unité</span><span>P.U. HT</span><span>TVA</span><span className="r">Total HT</span><span /></div>
        {lignes.map((l, i) => (
          <div className="doc-line" key={i}>
            <input value={l.designation} onChange={(e) => upd(i, 'designation', e.target.value)} placeholder="Désignation" aria-label="Désignation" readOnly={readOnly} />
            <NumInput value={l.qte} onChange={(v) => upd(i, 'qte', v)} aria-label="Quantité" />
            <input value={l.unite || ''} onChange={(e) => upd(i, 'unite', e.target.value)} placeholder="u" aria-label="Unité" />
            <NumInput value={l.pu} onChange={(v) => upd(i, 'pu', v)} aria-label="Prix unitaire" />
            <select value={l.tva} onChange={(e) => upd(i, 'tva', Number(e.target.value))} aria-label="TVA">{TVA_OPTS.map((x) => <option key={x} value={x}>{x} %</option>)}</select>
            <span className="amt">{n2(t.lines[i]?.totalHT)}</span>
            <button type="button" className="icon-btn danger" aria-label="Retirer la ligne" onClick={() => setLignes(lignes.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
        <div><button type="button" className="chip-btn" onClick={() => setLignes([...lignes, newLigne(defaultTva)])}><Plus size={13} /> Ajouter une ligne</button></div>
      </div>
      {setFrais && (
        <div className="doc-lines">
          <strong className="small">Frais supplémentaires (HT)</strong>
          {fraisSupp.map((f, i) => (
            <div className="op-line" key={i} style={{ gridTemplateColumns: 'minmax(0,1fr) 140px 90px 34px' }}>
              <input value={f.libelle} placeholder="Libellé" onChange={(e) => setFrais(fraisSupp.map((x, j) => (j === i ? { ...x, libelle: e.target.value } : x)))} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 9, padding: 8 }} />
              <NumInput value={f.montant} onChange={(v) => setFrais(fraisSupp.map((x, j) => (j === i ? { ...x, montant: v } : x)))} suffix="DHS" />
              <select value={f.tva} onChange={(e) => setFrais(fraisSupp.map((x, j) => (j === i ? { ...x, tva: Number(e.target.value) } : x)))}>{TVA_OPTS.map((x) => <option key={x} value={x}>{x} %</option>)}</select>
              <button type="button" className="icon-btn danger" aria-label="Retirer" onClick={() => setFrais(fraisSupp.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <div><button type="button" className="chip-btn" onClick={() => setFrais([...fraisSupp, { libelle: '', montant: 0, tva: defaultTva }])}><Plus size={13} /> Ajouter un frais</button></div>
        </div>
      )}
      <div className="doc-totals">
        {setRemise && <div><span>Remise globale</span><NumInput value={remisePct} onChange={setRemise} suffix="%" width={110} aria-label="Remise" /></div>}
        <div><span>Total brut HT</span><b>{n2(t.totalBrutHT)}</b></div>
        {t.remise > 0 && <div><span>Remise</span><b>− {n2(t.remise)}</b></div>}
        <div><span>Total HT</span><b>{n2(t.totalHT)}</b></div>
        {t.parTaux.map((g) => <div key={g.taux}><span>TVA {g.taux} % sur {n2(g.base)}</span><b>{n2(g.tva)}</b></div>)}
        <div className="big"><span>Total TTC</span><b>{n2(t.totalTTC)} DHS</b></div>
      </div>
    </div>
  );
}

/* ---------- Modale de saisie d'un document (devis, facture, avoir, achat, BL) ---------- */
export function DocFormModal({ title, headFields, initial, onSubmit, onClose, withFrais = true, withRemise = true, submitLabel = 'Enregistrer', extra, defaultTva = 20, linesLabel }) {
  const [form, setForm] = useState(initial);
  const [lignes, setLignes] = useState(initial.lignes?.length ? initial.lignes : [{ designation: '', qte: 1, pu: 0, tva: defaultTva, unite: '' }]);
  const [frais, setFrais] = useState(initial.fraisSupp || []);
  const [remise, setRemise] = useState(initial.remisePct || 0);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    for (const f of headFields) if (f.required && (form[f.key] === '' || form[f.key] == null)) return setErr(`${f.label} : champ obligatoire`);
    const clean = lignes.filter((l) => l.designation.trim() || l.pu || l.qte !== 1);
    if (clean.some((l) => !l.designation.trim())) return setErr('Chaque ligne doit avoir une désignation');
    setBusy(true);
    try {
      const body = { ...form };
      for (const f of headFields) if (f.type === 'ref') body[f.key] = idOf(body[f.key]) || null;
      await onSubmit({ ...body, lignes: clean.map((l) => ({ designation: l.designation.trim(), qte: Number(l.qte) || 0, pu: Number(l.pu) || 0, tva: Number(l.tva), unite: l.unite || '', missionId: l.missionId || '', locationId: l.locationId || '' })),
        fraisSupp: frais.filter((f) => f.libelle.trim() && f.montant > 0), remisePct: Number(remise) || 0 });
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          {headFields.map((f) => (
            <div key={f.key} className={`field ${f.span === 2 || f.type === 'textarea' ? 'span2' : ''}`}>
              <span>{f.label}{f.required ? ' *' : ''}</span>
              <FieldInput f={f} value={form[f.key]} onChange={(v) => set(f.key, v)} form={form} />
            </div>
          ))}
        </div>
        {linesLabel && <strong>{linesLabel}</strong>}
        <DocLines lignes={lignes} setLignes={setLignes} fraisSupp={frais} setFrais={withFrais ? setFrais : undefined} remisePct={remise} setRemise={withRemise ? setRemise : undefined} defaultTva={defaultTva} />
        {extra?.(form, set)}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button></div>
      </form>
    </Modal>
  );
}

/* ---------- Impression : portail plein écran ; l'impression masque l'application ---------- */
export function PrintPortal({ children, onClose, title = 'Aperçu' }) {
  useEffect(() => {
    document.body.classList.add('print-doc');
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => { document.body.classList.remove('print-doc'); window.removeEventListener('keydown', h); };
  }, [onClose]);
  return createPortal(
    <div className="print-portal" role="dialog" aria-label={title}>
      <div className="print-bar"><button className="btn primary" onClick={() => window.print()}><Printer size={17} />Imprimer / PDF</button><button className="btn" onClick={onClose}><X size={17} />Fermer</button></div>
      {children}
    </div>, document.body);
}

export const CompanyHead = ({ settings }) => {
  const e = settings?.entreprise || {};
  return (
    <div className="co">
      <strong>{settings?.societe}</strong>
      {[e.adresse, e.ville].filter(Boolean).join(', ')}
      {(e.telephone || e.email) && <div>{[e.telephone && `Tél : ${e.telephone}`, e.email].filter(Boolean).join(' · ')}</div>}
      {(e.ice || e.if || e.rc || e.patente || e.cnss) && <div>{[e.ice && `ICE : ${e.ice}`, e.if && `IF : ${e.if}`, e.rc && `RC : ${e.rc}`, e.patente && `Patente : ${e.patente}`, e.cnss && `CNSS : ${e.cnss}`].filter(Boolean).join(' · ')}</div>}
    </div>
  );
};
export const CompanyFoot = ({ settings }) => {
  const e = settings?.entreprise || {};
  const l = [e.banque && e.rib ? `${e.banque} — RIB : ${e.rib}` : e.rib && `RIB : ${e.rib}`, e.mentions].filter(Boolean);
  return l.length ? <div className="doc-foot">{l.map((x, i) => <div key={i}>{x}</div>)}</div> : null;
};

/** Facture / devis / avoir / bon de commande : mise en page imprimable. */
export function DocSheet({ kind, doc, tiers, settings, brouillon }) {
  const t = calcDoc({ lignes: doc.lignes || [], remisePct: doc.remisePct, fraisSupp: doc.fraisSupp });
  const TITRE = { facture: 'Facture', devis: 'Devis', avoir: 'Avoir', achat: 'Bon d\'achat', bl: 'Bon de livraison' };
  return (
    <div className="doc-sheet">
      <div className="doc-head">
        <CompanyHead settings={settings} />
        <div className="doc-meta">
          <h2>{TITRE[kind]}</h2>
          <div className="num">{doc.numero || (brouillon ? 'BROUILLON' : '')}</div>
          <div>Date : {fmtDate(doc.date)}</div>
          {doc.echeance && <div>Échéance : {fmtDate(doc.echeance)}</div>}
          {doc.validite && <div>Valable jusqu'au : {fmtDate(doc.validite)}</div>}
          {kind === 'avoir' && doc.facture?.numero && <div>Sur facture : {doc.facture.numero}</div>}
        </div>
      </div>
      <div className="doc-client">
        <b>{kind === 'achat' ? 'Fournisseur' : 'Client'}</b><br />
        {tiers?.nom}{tiers?.adresse && <><br />{tiers.adresse}{tiers.ville ? `, ${tiers.ville}` : ''}</>}{tiers?.ice && <><br />ICE : {tiers.ice}</>}
      </div>
      {doc.prestation && <p><b>Objet :</b> {doc.prestation}</p>}
      {doc.motif && <p><b>Motif :</b> {doc.motif}</p>}
      <table>
        <thead><tr><th>Désignation</th><th className="r">Qté</th><th className="r">P.U. HT</th><th className="r">TVA</th><th className="r">Total HT</th></tr></thead>
        <tbody>
          {t.lines.map((l, i) => <tr key={i}><td>{l.designation}</td><td className="r">{l.qte}{l.unite ? ` ${l.unite}` : ''}</td><td className="r">{n2(l.pu)}</td><td className="r">{l.tva} %</td><td className="r">{n2(l.totalHT)}</td></tr>)}
          {(doc.fraisSupp || []).map((f, i) => <tr key={`f${i}`}><td>{f.libelle}</td><td className="r">1</td><td className="r">{n2(f.montant)}</td><td className="r">{f.tva} %</td><td className="r">{n2(f.montant)}</td></tr>)}
        </tbody>
      </table>
      <div className="doc-sum">
        <div className="doc-words">Arrêté {kind === 'facture' ? 'la présente facture' : kind === 'avoir' ? 'le présent avoir' : kind === 'devis' ? 'le présent devis' : 'le présent document'} à la somme de :<br /><b>{montantEnLettres(t.totalTTC)}</b>
          {doc.paye > 0 && <div>Déjà réglé : {n2(doc.paye)} DHS · Reste à payer : {n2(doc.reste)} DHS</div>}
          {doc.observation && <div style={{ fontStyle: 'normal', marginTop: 8 }}>{doc.observation}</div>}
        </div>
        <div className="tot">
          <div><span>Total brut HT</span><span>{n2(t.totalBrutHT)}</span></div>
          {t.remise > 0 && <div><span>Remise ({doc.remisePct} %)</span><span>− {n2(t.remise)}</span></div>}
          <div><span>Total HT</span><span>{n2(t.totalHT)}</span></div>
          {t.parTaux.map((g) => <div key={g.taux}><span>TVA {g.taux} %</span><span>{n2(g.tva)}</span></div>)}
          <div className="big"><span>Total TTC</span><span>{n2(t.totalTTC)} DHS</span></div>
        </div>
      </div>
      <CompanyFoot settings={settings} />
    </div>
  );
}

export function BLSheet({ doc, settings }) {
  return (
    <div className="doc-sheet">
      <div className="doc-head"><CompanyHead settings={settings} />
        <div className="doc-meta"><h2>Bon de livraison</h2><div className="num">{doc.numero}</div><div>Date : {fmtDate(doc.date)}</div>{doc.mission?.ref && <div>Mission : {doc.mission.ref}</div>}</div></div>
      <div className="doc-client"><b>Client</b><br />{doc.client?.nom}{doc.client?.adresse && <><br />{doc.client.adresse}</>}{doc.client?.ice && <><br />ICE : {doc.client.ice}</>}</div>
      <p>{doc.lieuLivraison && <>Lieu de livraison : <b>{doc.lieuLivraison}</b><br /></>}{doc.camion && <>Camion : <b>{doc.camion}</b> · </>}{doc.chauffeur && <>Chauffeur : <b>{doc.chauffeur}</b></>}</p>
      <table><thead><tr><th>Désignation</th><th className="r">Quantité</th></tr></thead>
        <tbody>{(doc.lignes || []).map((l, i) => <tr key={i}><td>{l.designation}</td><td className="r">{l.qte} {l.unite}</td></tr>)}</tbody></table>
      {doc.observation && <p>{doc.observation}</p>}
      <div className="doc-sign"><div>Le transporteur</div><div>Le client (nom, signature, cachet)</div></div>
      <CompanyFoot settings={settings} />
    </div>
  );
}

/** Impression d'un tableau (relevés, rapports) dans la même feuille. */
export function TableSheet({ title, subtitle, settings, columns, rows, totalRow }) {
  return (
    <div className="doc-sheet">
      <div className="doc-head"><CompanyHead settings={settings} /><div className="doc-meta"><h2 style={{ fontSize: 18 }}>{title}</h2>{subtitle && <div>{subtitle}</div>}<div>Édité le {fmtDate(new Date().toISOString().slice(0, 10))}</div></div></div>
      <table>
        <thead><tr>{columns.map((c, i) => <th key={i} className={c.align === 'r' ? 'r' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c, j) => <td key={j} className={c.align === 'r' ? 'r' : ''}>{c.print ? c.print(r) : c.render ? c.render(r) : r[c.key]}</td>)}</tr>)}</tbody>
        {totalRow && <tfoot><tr>{totalRow.map((v, i) => <td key={i} className={columns[i]?.align === 'r' ? 'r' : ''}><b>{v}</b></td>)}</tr></tfoot>}
      </table>
    </div>
  );
}
