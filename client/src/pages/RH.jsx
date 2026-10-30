import React, { useCallback, useEffect, useState } from 'react';
import { Printer, Wallet, Undo2, CalendarCheck, Settings2, Calculator, Lock, Unlock } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Kpi, Modal, MonthPicker, NumInput, Spinner, Empty, useToast } from '../components.jsx';
import { CrudPage, Pill, useOptions, REFS } from '../crud.jsx';
import { PrintPortal, CompanyHead, CompanyFoot } from '../docs.jsx';
import { n2, fmtDate, todayStr, monthLong, montantEnLettres } from '../format.js';
import { PayModal, ReportPage, neg, MODE_OPTS } from './common.jsx';

const CONTRATS = ['CDI', 'CDD', 'ANAPEC', 'Stage', 'Journalier', 'Autre'].map((x) => [x, x]);
const POINT = { present: ['Présent', 'pos'], absent: ['Absent', 'neg'], conge: ['Congé', 'info'], maladie: ['Maladie', 'warn'], ferie: ['Férié', ''], heures_sup: ['Heures sup.', 'info'] };
const emp = (r) => r.employe && <span>{r.employe.nom}<small className="muted" style={{ display: 'block' }}>{r.employe.matricule}</small></span>;

export function Employes() {
  return <CrudPage title="Employés" subtitle="Dossier du personnel (accès administrateur)" endpoint="/rh/employes" adminOnly addLabel="Nouvel employé" searchPlaceholder="Nom, matricule, CIN…" defaults={{ statut: 'actif', typeContrat: 'CDI', typeSalaire: 'mensuel', soumisCnss: true, departement: 'Exploitation' }}
    filters={[{ key: 'statut', label: 'Statut', options: [['actif', 'Actif'], ['inactif', 'Inactif']] }, { key: 'typeContrat', label: 'Contrat', options: CONTRATS }]}
    kpis={(d) => [{ label: 'Employés', value: d.kpis?.total ?? 0, sub: `${d.kpis?.actifs ?? 0} actifs` }, { label: 'Masse salariale mensuelle', value: n2(d.kpis?.masseSalaire ?? d.kpis?.masseSalariale), sub: 'salaires mensuels de base' }]}
    fields={[{ key: 'nom', label: 'Nom complet', required: true, span: 2 }, { key: 'matricule', label: 'Matricule', hint: 'Vide = automatique (E001…)' }, { key: 'cin', label: 'CIN' }, { key: 'cnss', label: 'N° CNSS' }, { key: 'poste', label: 'Poste (chauffeur, mécanicien…)', list: ['Chauffeur', 'Mécanicien', 'Administratif', 'Comptable', 'Agent d\'exploitation'] },
      { key: 'departement', label: 'Département' }, { key: 'telephone', label: 'Téléphone' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'adresse', label: 'Adresse', span: 2 }, { key: 'dateNaissance', label: 'Date de naissance', type: 'date' }, { key: 'dateEmbauche', label: "Date d'embauche", type: 'date' },
      { key: 'typeContrat', label: 'Type de contrat', type: 'select', options: CONTRATS }, { key: 'dateDebutContrat', label: 'Début du contrat', type: 'date' }, { key: 'dateFinContrat', label: 'Fin du contrat', type: 'date' },
      { key: 'typeSalaire', label: 'Type de salaire', type: 'select', options: [['mensuel', 'Mensuel'], ['journalier', 'Journalier'], ['horaire', 'Horaire']] }, { key: 'salaireBase', label: 'Salaire de base (par mois / jour / heure)', type: 'money' },
      { key: 'truck', label: 'Camion affecté', type: 'ref', ref: 'trucks', empty: '— Aucun —' }, { key: 'statut', label: 'Statut', type: 'select', options: [['actif', 'Actif'], ['inactif', 'Inactif']] }, { key: 'soumisCnss', label: 'CNSS', type: 'check', checkLabel: 'Soumis à la CNSS / AMO' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Matricule', render: (r) => r.matricule }, { label: 'Nom', render: (r) => <strong>{r.nom}</strong> }, { key: 'poste', label: 'Poste' }, { label: 'Contrat', render: (r) => <span>{r.typeContrat}{r.dateFinContrat && <small className="muted" style={{ display: 'block' }}>jusqu'au {fmtDate(r.dateFinContrat)}</small>}</span> },
      { label: 'Salaire', align: 'r', render: (r) => `${n2(r.salaireBase)} /${{ mensuel: 'mois', journalier: 'jour', horaire: 'h' }[r.typeSalaire]}` }, { label: 'Camion', render: (r) => r.truck?.immatriculation || '—' }, { label: 'Statut', render: (r) => <Pill tone={r.statut === 'actif' ? 'pos' : ''}>{r.statut === 'actif' ? 'Actif' : 'Inactif'}</Pill> }]}
    emptyTitle="Aucun employé" />;
}

function LotModal({ onClose, onDone }) {
  const toast = useToast(); const list = useOptions(REFS.employes.url);
  const [f, setF] = useState({ date: todayStr(), type: 'present' }); const [sel, setSel] = useState({}); const [busy, setBusy] = useState(false);
  const all = list || [];
  const go = async () => {
    setBusy(true);
    try { const r = await api('/rh/pointage/lot', { method: 'POST', body: { ...f, employes: all.filter((e) => sel[e._id]).map((e) => e._id) } }); toast(`${r.crees} pointage(s) créé(s)${r.ignores ? `, ${r.ignores} ignoré(s) (déjà pointés ou paie validée)` : ''}`); onDone(); onClose(); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Pointage en lot" onClose={onClose}>
      <div className="form">
        <div className="form-grid">
          <label className="field"><span>Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field"><span>Statut</span><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['present', 'absent', 'conge', 'maladie', 'ferie'].map((k) => <option key={k} value={k}>{POINT[k][0]}</option>)}</select></label>
        </div>
        {!list ? <Spinner /> : <div className="pick-list"><label><input type="checkbox" checked={all.length > 0 && all.every((e) => sel[e._id])} onChange={(e) => setSel(Object.fromEntries(all.map((x) => [x._id, e.target.checked])))} /><span><b>Tout sélectionner</b></span></label>
          {all.map((e) => <label key={e._id}><input type="checkbox" checked={!!sel[e._id]} onChange={(ev) => setSel({ ...sel, [e._id]: ev.target.checked })} /><span>{REFS.employes.label(e)}</span></label>)}</div>}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !Object.values(sel).some(Boolean)} onClick={go}>Pointer</button></div>
      </div>
    </Modal>
  );
}

export function Pointage() {
  const [lot, setLot] = useState(null);
  return (
    <>
      <CrudPage title="Pointage" subtitle="Présences, absences, congés et heures supplémentaires — base du calcul de la paie" endpoint="/rh/pointage" adminOnly addLabel="Nouveau pointage" dateFilter defaults={{ date: todayStr(), type: 'present' }}
        headExtra={({ reload }) => <button className="btn" onClick={() => setLot({ reload })}><CalendarCheck size={17} />Pointage en lot</button>}
        filters={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes' }, { key: 'type', label: 'Type', options: Object.entries(POINT).map(([v, [l]]) => [v, l]) }]}
        kpis={(d) => [{ label: 'Présences', value: d.kpis?.present ?? 0, tone: 'pos' }, { label: 'Absences', value: d.kpis?.absent ?? 0, tone: d.kpis?.absent ? 'neg' : '' }, { label: 'Congés / maladie', value: (d.kpis?.conge ?? 0) + (d.kpis?.maladie ?? 0) }, { label: 'Heures sup.', value: `${n2(d.kpis?.heuresSup)} h` }]}
        fields={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'type', label: 'Type', type: 'select', options: Object.entries(POINT).map(([v, [l]]) => [v, l]) }, { key: 'heures', label: 'Heures', type: 'number', suffix: 'h', hint: 'Obligatoire pour les heures sup. ; vide = 8 h pour un salarié horaire' }, { key: 'observation', label: 'Observation' }]}
        columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Employé', render: emp }, { label: 'Type', render: (r) => <Pill tone={POINT[r.type]?.[1]}>{POINT[r.type]?.[0]}</Pill> }, { label: 'Heures', align: 'r', render: (r) => (r.heures ? `${n2(r.heures)} h` : '—') }, { label: 'Observation', render: (r) => r.observation || '—' }]}
        emptyTitle="Aucun pointage" />
      {lot && <LotModal onClose={() => setLot(null)} onDone={lot.reload} />}
    </>
  );
}

export function Avances() {
  return <CrudPage title="Avances sur salaire" subtitle="Le remboursement mensuel est déduit automatiquement de la paie à la validation" endpoint="/rh/avances" adminOnly addLabel="Nouvelle avance" dateFilter defaults={{ date: todayStr() }}
    filters={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes' }, { key: 'statut', label: 'Statut', options: [['en_cours', 'En cours'], ['soldee', 'Soldée']] }]}
    kpis={(d) => [{ label: 'Avances', value: d.kpis?.nb ?? 0, sub: `${d.kpis?.enCours ?? 0} en cours` }, { label: 'Total accordé', value: n2(d.kpis?.total) }, { label: 'Reste à rembourser', value: n2(d.kpis?.solde), tone: d.kpis?.solde ? 'neg' : '' }]}
    fields={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'remboursementMensuel', label: 'Remboursement mensuel', type: 'money' }, { key: 'motif', label: 'Motif', span: 2 }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Employé', render: emp }, { label: 'Motif', render: (r) => r.motif || '—' }, { label: 'Montant', align: 'r', render: (r) => n2(r.montant) }, { label: 'Par mois', align: 'r', render: (r) => n2(r.remboursementMensuel) }, { label: 'Solde', align: 'r', render: (r) => <b className={r.solde > 0 ? 'neg' : ''}>{n2(r.solde)}</b> }, { label: 'Statut', render: (r) => <Pill tone={r.statut === 'soldee' ? 'pos' : 'warn'}>{r.statut === 'soldee' ? 'Soldée' : 'En cours'}</Pill> }]}
    emptyTitle="Aucune avance" />;
}

export function Primes() {
  return <CrudPage title="Primes & retenues" subtitle="Ajoutées au brut (primes) ou déduites du net (retenues) — celles du gasoil arrivent depuis la page Gasoil" endpoint="/rh/primes" adminOnly addLabel="Nouvelle ligne" dateFilter defaults={{ date: todayStr(), type: 'prime' }}
    rowLock={(r) => r.source !== 'manuel'}
    filters={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes' }, { key: 'type', label: 'Type', options: [['prime', 'Prime'], ['retenue', 'Retenue']] }, { key: 'source', label: 'Origine', options: [['manuel', 'Manuelle'], ['gasoil', 'Gasoil']] }]}
    kpis={(d) => [{ label: 'Primes', value: n2(d.kpis?.primes), tone: 'pos' }, { label: 'Retenues', value: n2(d.kpis?.retenues), tone: 'neg' }, { label: 'Lignes', value: d.kpis?.nb ?? 0 }]}
    fields={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'type', label: 'Type', type: 'select', options: [['prime', 'Prime'], ['retenue', 'Retenue']] }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'libelle', label: 'Libellé', required: true, span: 2 }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Employé', render: emp }, { label: 'Type', render: (r) => <Pill tone={r.type === 'prime' ? 'pos' : 'neg'}>{r.type === 'prime' ? 'Prime' : 'Retenue'}</Pill> }, { label: 'Libellé', render: (r) => r.libelle }, { label: 'Origine', render: (r) => (r.source === 'gasoil' ? <Pill tone="info">Gasoil</Pill> : 'Manuelle') }, { label: 'Montant', align: 'r', render: (r) => n2(r.montant) }]}
    emptyTitle="Aucune prime ni retenue" />;
}

export function Contrats() {
  return <CrudPage title="Contrats" subtitle="Historique des contrats — le contrat actif met à jour la fiche employé" endpoint="/rh/contrats" adminOnly addLabel="Nouveau contrat" defaults={{ type: 'CDI', statut: 'actif', dateDebut: todayStr() }}
    filters={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes' }, { key: 'statut', label: 'Statut', options: [['actif', 'Actif'], ['termine', 'Terminé']] }, { key: 'type', label: 'Type', options: CONTRATS }]}
    fields={[{ key: 'employe', label: 'Employé', type: 'ref', ref: 'employes', required: true }, { key: 'type', label: 'Type', type: 'select', options: CONTRATS }, { key: 'dateDebut', label: 'Début', type: 'date', required: true }, { key: 'dateFin', label: 'Fin', type: 'date', hint: 'Obligatoire pour un CDD' }, { key: 'salaireBase', label: 'Salaire de base', type: 'money' }, { key: 'poste', label: 'Poste' },
      { key: 'statut', label: 'Statut', type: 'select', options: [['actif', 'Actif'], ['termine', 'Terminé']] }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Employé', render: emp }, { label: 'Type', render: (r) => r.type }, { label: 'Début', render: (r) => fmtDate(r.dateDebut) }, { label: 'Fin', render: (r) => fmtDate(r.dateFin) }, { label: 'Poste', render: (r) => r.poste || '—' }, { label: 'Salaire', align: 'r', render: (r) => n2(r.salaireBase) }, { label: 'Statut', render: (r) => <Pill tone={r.statut === 'actif' ? 'pos' : ''}>{r.statut === 'actif' ? 'Actif' : 'Terminé'}</Pill> }]}
    emptyTitle="Aucun contrat" />;
}

const AL = { expire: ['Expiré', 'neg'], j7: ['≤ 7 jours', 'neg'], j15: ['≤ 15 jours', 'warn'], j30: ['≤ 30 jours', 'warn'] };
export function AlertesRH() {
  return <ReportPage title="Alertes RH" subtitle="Contrats arrivant à échéance (30 jours) ou expirés" endpoint="/rh/alertes"
    kpis={(d) => [{ label: 'Expirés', value: d.kpis?.expire ?? 0, tone: d.kpis?.expire ? 'neg' : '' }, { label: '≤ 7 jours', value: d.kpis?.j7 ?? 0 }, { label: '≤ 15 jours', value: d.kpis?.j15 ?? 0 }, { label: '≤ 30 jours', value: d.kpis?.j30 ?? 0 }]}
    columns={[{ label: 'Employé', render: (r) => <strong>{r.nom}</strong> }, { label: 'Matricule', render: (r) => r.matricule }, { label: 'Poste', render: (r) => r.poste || '—' }, { label: 'Contrat', render: (r) => r.typeContrat }, { label: 'Fin', render: (r) => fmtDate(r.dateFin) },
      { label: 'Échéance', render: (r) => <Pill tone={AL[r.statut]?.[1]}>{r.jours < 0 ? `Expiré depuis ${-r.jours} j` : `Dans ${r.jours} j`}</Pill>, print: (r) => (r.jours < 0 ? `Expiré depuis ${-r.jours} j` : `Dans ${r.jours} j`) }]}
    emptyText="Aucun contrat à renouveler dans les 30 prochains jours." />;
}

/* ============ Paie ============ */
const BS = { brouillon: ['Brouillon', ''], validee: ['Validé', 'info'], payee: ['Payé', 'pos'] };
function IrCell({ b, onSaved }) {
  const toast = useToast(); const [v, setV] = useState(b.ir);
  useEffect(() => setV(b.ir), [b.ir]);
  if (b.statut !== 'brouillon') return n2(b.ir);
  const save = async () => { if (v === b.ir) return; try { await api(`/rh/paie/bulletins/${b._id}`, { method: 'PUT', body: { ir: v } }); onSaved(); } catch (e) { toast(e.message, 'err'); setV(b.ir); } };
  return <span onBlur={save}><NumInput value={v} onChange={setV} width={96} aria-label="IR" /></span>;
}

function BulletinSheet({ bu, settings }) {
  const e = bu.employe || {}; const c = bu.config || {};
  const gains = [['Salaire de base', bu.base], ...(bu.montantHeuresSup ? [[`Heures supplémentaires (${n2(bu.heuresSup)} h, +${c.majorationHS ?? 25} %)`, bu.montantHeuresSup]] : []), ...(bu.primes ? [['Primes', bu.primes]] : [])];
  const ret = [...(bu.retenueAbsences ? [[`Absences (${bu.absences} j)`, bu.retenueAbsences]] : []), ['CNSS', bu.cnss], ['AMO', bu.amo], ['Impôt sur le revenu (IR)', bu.ir], ...(bu.retenues ? [['Retenues diverses', bu.retenues]] : []), ...(bu.avances ? [['Remboursement avances', bu.avances]] : [])];
  return (
    <div className="doc-sheet">
      <div className="doc-head"><CompanyHead settings={settings} /><div className="doc-meta"><h2 style={{ fontSize: 20 }}>Bulletin de paie</h2><div className="num">{monthLong(bu.periode)}</div></div></div>
      <div className="doc-client" style={{ width: '100%' }}><b>{e.nom}</b> — Matricule {e.matricule}<br />{[e.poste, e.cin && `CIN ${e.cin}`, e.cnss && `CNSS ${e.cnss}`, e.dateEmbauche && `Embauché le ${fmtDate(e.dateEmbauche)}`].filter(Boolean).join(' · ')}<br />Jours payés : {bu.joursTravailles}{bu.heures ? ` · Heures : ${n2(bu.heures)}` : ''}</div>
      <table><thead><tr><th>Gains</th><th className="r">Montant</th></tr></thead><tbody>{gains.map(([l, v]) => <tr key={l}><td>{l}</td><td className="r">{n2(v)}</td></tr>)}<tr><td><b>Salaire brut</b></td><td className="r"><b>{n2(bu.brut)}</b></td></tr></tbody></table>
      <table><thead><tr><th>Retenues</th><th className="r">Montant</th></tr></thead><tbody>{ret.map(([l, v]) => <tr key={l}><td>{l}</td><td className="r">{n2(v)}</td></tr>)}<tr><td><b>Total retenues</b></td><td className="r"><b>{n2(bu.brut - bu.net)}</b></td></tr></tbody></table>
      <div className="doc-sum"><div className="doc-words">Net à payer en lettres :<br /><b>{montantEnLettres(bu.net)}</b>{bu.datePaiement && <div>Payé le {fmtDate(bu.datePaiement)}</div>}</div><div className="tot"><div className="big"><span>NET À PAYER</span><span>{n2(bu.net)} DHS</span></div></div></div>
      <div className="doc-sign"><div>L'employeur</div><div>L'employé (lu et approuvé)</div></div>
      <CompanyFoot settings={settings} />
    </div>
  );
}

export function Paie() {
  const { settings, user } = useApp(); const toast = useToast();
  const [periode, setPeriode] = useState(todayStr().slice(0, 7));
  const [data, setData] = useState(null); const [slip, setSlip] = useState(null); const [pay, setPay] = useState(null); const [cfg, setCfg] = useState(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api(`/rh/paie?periode=${periode}`)); } catch (e) { toast(e.message, 'err'); setData({ items: [], totaux: {}, statut: 'vide' }); } }, [periode, toast]);
  useEffect(() => { setData(null); load(); }, [load]);
  const post = async (url, body, msg, ask) => {
    if (ask && !window.confirm(ask)) return; setBusy(true);
    try { const r = await api(url, { method: 'POST', body }); toast(typeof msg === 'function' ? msg(r) : msg); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const openSlip = async (b) => { try { setSlip(await api(`/rh/paie/bulletins/${b._id}`)); } catch (e) { toast(e.message, 'err'); } };
  const openCfg = async () => { try { setCfg(await api('/rh/paie/config')); } catch (e) { toast(e.message, 'err'); } };
  const saveCfg = async () => { try { await api('/rh/paie/config', { method: 'PUT', body: cfg }); toast('Taux enregistrés — régénérez la paie pour les appliquer'); setCfg(null); } catch (e) { toast(e.message, 'err'); } };
  if (user.role !== 'admin') return null;
  const t = data?.totaux || {}; const items = data?.items || []; const st = data?.statut;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Paie</h1><p className="muted">Calcul mensuel à partir du pointage, des primes, retenues et avances</p></div>
        <div className="head-actions"><MonthPicker value={periode} onChange={setPeriode} /><button className="btn" onClick={openCfg}><Settings2 size={17} />Taux</button></div></div>
      <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn primary" disabled={busy || st === 'validee' || st === 'payee'} onClick={() => post('/rh/paie/generer', { periode }, (r) => `${r.crees} créé(s), ${r.majs} mis à jour${r.ignores ? `, ${r.ignores} ignoré(s)` : ''}`)}><Calculator size={17} />{items.length ? 'Recalculer la paie' : 'Générer la paie'}</button>
        <button className="btn" disabled={busy || !items.some((b) => b.statut === 'brouillon')} onClick={() => post('/rh/paie/valider', { periode }, (r) => `${r.valides} bulletin(s) validé(s)`, 'Valider la paie ? Les avances seront déduites et le pointage de la période sera verrouillé.')}><Lock size={17} />Valider la paie</button>
        <button className="btn" disabled={busy || !items.some((b) => b.statut === 'validee')} onClick={() => post('/rh/paie/devalider', { periode }, 'Validation annulée', 'Annuler la validation ? Les avances déduites seront restaurées.')}><Unlock size={17} />Annuler la validation</button>
        <span className="muted small">Statut : <b>{{ vide: 'aucun bulletin', brouillon: 'brouillon', validee: 'validée', payee: 'payée' }[st] || st}</b>. L'IR se saisit à la main sur chaque bulletin brouillon ; faites valider ces calculs par votre comptable.</span>
      </div>
      {!data ? <div className="center"><Spinner /></div> : (
        <>
          <section className="kpis"><Kpi label="Bulletins" value={t.nb ?? 0} sub={`${t.payes ?? 0} payé(s)`} /><Kpi label="Brut total" value={n2(t.brut)} /><Kpi label="CNSS + AMO" value={n2((t.cnss || 0) + (t.amo || 0))} /><Kpi label="IR" value={n2(t.ir)} /><Kpi label="Net à payer" value={n2(t.net)} tone="pos" /></section>
          {items.length === 0 ? <Empty title="Aucun bulletin">Cliquez sur « Générer la paie » pour calculer {monthLong(periode)}.</Empty> : (
            <div className="card table-wrap" style={{ padding: 8 }}>
              <table className="tbl"><thead><tr><th>Employé</th><th className="r">Base</th><th className="r">H. sup.</th><th className="r">Primes</th><th className="r">Absences</th><th className="r">Brut</th><th className="r">CNSS</th><th className="r">AMO</th><th className="r">IR</th><th className="r">Retenues</th><th className="r">Avances</th><th className="r">Net</th><th>Statut</th><th /></tr></thead>
                <tbody>{items.map((b) => (
                  <tr key={b._id}><td>{b.employe && <span><strong>{b.employe.nom}</strong><small className="muted" style={{ display: 'block' }}>{b.employe.matricule} · {b.joursTravailles} j</small></span>}</td>
                    <td className="r num">{n2(b.base)}</td><td className="r num">{n2(b.montantHeuresSup)}</td><td className="r num">{n2(b.primes)}</td><td className="r num">{b.retenueAbsences ? `−${n2(b.retenueAbsences)}` : '—'}</td><td className="r num"><b>{n2(b.brut)}</b></td>
                    <td className="r num">{n2(b.cnss)}</td><td className="r num">{n2(b.amo)}</td><td className="r"><IrCell b={b} onSaved={load} /></td><td className="r num">{n2(b.retenues)}</td><td className="r num">{n2(b.avances)}</td><td className="r num"><b>{n2(b.net)}</b></td>
                    <td><Pill tone={BS[b.statut][1]}>{BS[b.statut][0]}</Pill></td>
                    <td><div className="act">
                      <button className="icon-btn" title="Bulletin" aria-label="Bulletin" onClick={() => openSlip(b)}><Printer size={16} /></button>
                      {b.statut === 'validee' && <button className="icon-btn" title="Payer" aria-label="Payer" onClick={() => setPay(b)}><Wallet size={16} /></button>}
                      {b.statut === 'payee' && <button className="icon-btn" title="Annuler le paiement" aria-label="Annuler le paiement" onClick={() => post(`/rh/paie/bulletins/${b._id}/annuler-paiement`, {}, 'Paiement annulé', 'Annuler ce paiement ?')}><Undo2 size={16} /></button>}
                    </div></td></tr>))}</tbody>
                <tfoot><tr><td>Total</td><td /><td /><td className="r num">{n2(t.primes)}</td><td /><td className="r num">{n2(t.brut)}</td><td className="r num">{n2(t.cnss)}</td><td className="r num">{n2(t.amo)}</td><td className="r num">{n2(t.ir)}</td><td className="r num">{n2(t.retenues)}</td><td className="r num">{n2(t.avances)}</td><td className="r num">{n2(t.net)}</td><td /><td /></tr></tfoot></table>
            </div>
          )}
        </>
      )}
      {slip && <PrintPortal onClose={() => setSlip(null)} title="Bulletin de paie"><BulletinSheet bu={slip} settings={settings} /></PrintPortal>}
      {pay && <PayModal title={`Payer ${pay.employe?.nom}`} endpoint={`/rh/paie/bulletins/${pay._id}/payer`} body={{}} reste={pay.net} info={`Net à payer : ${n2(pay.net)} DHS`} onClose={() => setPay(null)} onDone={load} />}
      {cfg && (
        <Modal title="Taux de paie" onClose={() => setCfg(null)}>
          <div className="form"><div className="form-grid">
            {[['cnssTaux', 'CNSS (part salariale)', '%'], ['amoTaux', 'AMO (part salariale)', '%'], ['plafondCnss', 'Plafond CNSS mensuel', 'DHS'], ['majorationHS', 'Majoration heures sup.', '%'], ['joursMois', 'Jours ouvrés / mois', 'j'], ['heuresMois', 'Heures / mois', 'h']].map(([k, l, s]) => <label className="field" key={k}><span>{l}</span><NumInput value={cfg[k]} onChange={(v) => setCfg({ ...cfg, [k]: v })} suffix={s} /></label>)}
          </div><p className="muted small" style={{ margin: 0 }}>Valeurs par défaut indicatives (CNSS 4,48 % plafonnée à 6 000 DHS, AMO 2,26 %). Vérifiez les taux en vigueur avec votre comptable.</p>
            <div className="modal-foot"><button className="btn" onClick={() => setCfg(null)}>Annuler</button><button className="btn primary" onClick={saveCfg}>Enregistrer</button></div></div>
        </Modal>
      )}
    </div>
  );
}
