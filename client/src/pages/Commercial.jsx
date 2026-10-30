import React, { useEffect, useState } from 'react';
import { FileText, Receipt, Play, CheckCircle2, Printer, ArrowRightCircle, Wallet, Ban, FilePlus2, Send, Plus, Trash2 } from 'lucide-react';
import { PLAN } from '../../../shared/calc.js';
import { calcMission } from '../../../shared/doc.js';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Modal, NumInput, Spinner, useToast } from '../components.jsx';
import { CrudPage, Pill, RefSelect, REFS, Tabs, idOf, initialFrom, payloadFrom } from '../crud.jsx';
import { DocFormModal, DocSheet, BLSheet, PrintPortal } from '../docs.jsx';
import { n2, fmtDate, todayStr, addDaysStr } from '../format.js';
import { MODE_OPTS, MODE_LABEL, PayModal, ReglPill, ReportPage, SimpleLines, neg } from './common.jsx';

const VAR_COMPTES = PLAN.charges.find((g) => g.key === 'variables').comptes;
const TVA_FIELD = { key: 'tva', label: 'TVA', type: 'number', suffix: '%' };
const FACT_REF = { url: '/factures?statut=emise&limit=1000', label: (o) => `${o.numero} — ${o.client?.nom || ''} (reste ${n2(o.reste)})` };
const MISSION_ST = { brouillon: ['Brouillon', ''], planifiee: ['Planifiée', 'info'], en_cours: ['En cours', 'warn'], terminee: ['Terminée', 'pos'], annulee: ['Annulée', 'neg'] };
const MStatut = ({ v }) => <Pill tone={MISSION_ST[v]?.[1]}>{MISSION_ST[v]?.[0] || v}</Pill>;
const TIERS_FIELDS = [
  { key: 'nom', label: 'Nom / raison sociale', required: true, span: 2 }, { key: 'ice', label: 'ICE' }, { key: 'if', label: 'Identifiant fiscal' }, { key: 'rc', label: 'RC' }, { key: 'telephone', label: 'Téléphone' },
  { key: 'adresse', label: 'Adresse', span: 2 }, { key: 'ville', label: 'Ville' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'contact', label: 'Contact' },
];

/* ============ Clients ============ */
export function Clients() {
  return <CrudPage title="Clients" subtitle="Fichier clients : coordonnées, TVA et délai de paiement par défaut" endpoint="/clients" addLabel="Nouveau client" searchPlaceholder="Nom, ICE, ville…"
    defaults={{ tvaDefaut: 20, delaiPaiement: 30, actif: true }} filters={[{ key: 'actif', label: 'Statut', options: [['true', 'Actifs'], ['false', 'Inactifs']] }]}
    fields={[...TIERS_FIELDS, { key: 'tvaDefaut', label: 'TVA par défaut', type: 'number', suffix: '%' }, { key: 'delaiPaiement', label: 'Délai de paiement', type: 'number', suffix: 'jours' }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Client actif' }]}
    columns={[{ label: 'Client', render: (r) => <strong>{r.nom}</strong> }, { key: 'ice', label: 'ICE' }, { key: 'ville', label: 'Ville' }, { key: 'telephone', label: 'Téléphone' }, { key: 'email', label: 'E-mail' },
      { label: 'Délai', render: (r) => `${r.delaiPaiement} j` }, { label: '', render: (r) => (r.actif ? null : <Pill>Inactif</Pill>) }]}
    emptyTitle="Aucun client" emptyText="Ajoutez votre premier client pour créer des missions et des factures." />;
}

/* ============ Missions ============ */
function ChargesEditor({ value, onChange }) {
  const list = value || [];
  const upd = (i, k, v) => onChange(list.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="op-lines">
      <div className="op-lines-head"><strong>Charges de la mission</strong><span className="muted small">Gasoil, péages, frais de route… imputés au camion quand la mission est terminée</span></div>
      {list.map((l, i) => (
        <div className="op-line" key={i}>
          <select value={l.code} onChange={(e) => upd(i, 'code', e.target.value)} aria-label="Compte">{VAR_COMPTES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
          <NumInput value={l.montant} onChange={(v) => upd(i, 'montant', v)} suffix="DHS" aria-label="Montant" />
          <button type="button" className="icon-btn danger" aria-label="Retirer" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
        </div>
      ))}
      <div><button type="button" className="chip-btn" onClick={() => onChange([...list, { code: VAR_COMPTES[3].code, montant: 0, note: '' }])}><Plus size={13} /> Ajouter une charge</button></div>
    </div>
  );
}
const missionFields = [
  { key: 'type', label: 'Type de mission', type: 'select', options: [['interne', 'Interne (nos camions)'], ['soustraite', 'Sous-traitée']] },
  { key: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true },
  { key: 'dateMission', label: 'Date de la mission', type: 'date', required: true },
  { key: 'statut', label: 'Statut', type: 'select', options: Object.entries(MISSION_ST).map(([v, [l]]) => [v, l]) },
  { key: 'villeCharge', label: 'Chargement (ville)' }, { key: 'villeDecharge', label: 'Déchargement (ville)' },
  { key: 'dateChargement', label: 'Date de chargement', type: 'date' }, { key: 'dateDechargement', label: 'Date de déchargement', type: 'date' },
  { key: 'numeroBL', label: 'N° BL client' }, { key: 'marchandise', label: 'Marchandise' },
  { key: 'tonnage', label: 'Tonnage', type: 'number', suffix: 't' }, { key: 'distance', label: 'Distance', type: 'number', suffix: 'km' },
  { key: 'mode', label: 'Tarification', type: 'select', options: [['tonnage', 'Au tonnage'], ['forfait', 'Forfait']] },
  { key: 'prixUnitaire', label: 'Prix par tonne (HT)', type: 'number', suffix: 'DHS/t', show: (f) => f.mode === 'tonnage' },
  { key: 'prixForfait', label: 'Prix forfaitaire (HT)', type: 'money', show: (f) => f.mode === 'forfait' },
  TVA_FIELD,
  { key: 'fraisChargement', label: 'Frais de chargement', type: 'money' }, { key: 'fraisDechargement', label: 'Frais de déchargement', type: 'money' }, { key: 'fraisImmobilisation', label: "Frais d'immobilisation", type: 'money' },
  { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks', show: (f) => f.type === 'interne', empty: '— Aucun —' },
  { key: 'remorque', label: 'Remorque', show: (f) => f.type === 'interne' },
  { key: 'chauffeur', label: 'Chauffeur', type: 'ref', ref: 'chauffeurs', show: (f) => f.type === 'interne', empty: '— Aucun —' },
  { key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants', show: (f) => f.type === 'soustraite', required: true },
  { key: 'vehiculeST', label: 'Véhicule du sous-traitant', type: 'ref', ref: { url: (f) => `/vehicules-st?limit=1000&actif=true${idOf(f.sousTraitant) ? `&sousTraitant=${idOf(f.sousTraitant)}` : ''}`, label: REFS.vehiculesST.label }, show: (f) => f.type === 'soustraite', empty: '— Non renseigné —' },
  { key: 'modeST', label: 'Rémunération du sous-traitant', type: 'select', options: [['tonnage', 'Au tonnage'], ['forfait', 'Forfait']], show: (f) => f.type === 'soustraite' },
  { key: 'prixUnitaireST', label: 'Prix par tonne payé', type: 'number', suffix: 'DHS/t', show: (f) => f.type === 'soustraite' && f.modeST === 'tonnage' },
  { key: 'coutST', label: 'Coût forfaitaire sous-traitant', type: 'money', show: (f) => f.type === 'soustraite' && f.modeST === 'forfait' },
  { key: 'charges', label: 'Charges', type: 'custom', default: [], span: 2, render: (v, c) => <ChargesEditor value={v} onChange={c} /> },
  { key: '_recap', label: 'Récapitulatif', type: 'custom', noPayload: true, span: 2, render: (_v, _c, f) => {
    const m = calcMission(f); const ch = (f.charges || []).reduce((s, c) => s + (c.montant || 0), 0);
    const cst = f.type === 'soustraite' ? (f.modeST === 'forfait' ? f.coutST : (f.tonnage || 0) * (f.prixUnitaireST || 0)) : 0;
    return <div className="op-total" style={{ flexWrap: 'wrap', gap: 14 }}><span>Total HT <b>{n2(m.totalHT)}</b></span><span>TTC <b>{n2(m.totalTTC)}</b></span><span>Coûts <b>{n2(cst + ch)}</b></span><span className={neg(m.totalHT - cst - ch)}>Marge estimée <b>{n2(m.totalHT - cst - ch)}</b></span></div>;
  } },
  { key: 'observation', label: 'Observation', type: 'textarea' },
];

export function Missions() {
  const toast = useToast();
  const [bill, setBill] = useState(null);
  const statutRapide = async (row, statut, reload) => {
    try { await api(`/missions/${row._id}`, { method: 'PUT', body: payloadFrom(missionFields, { ...initialFrom(missionFields, {}, row), statut }) }); toast('Statut mis à jour'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const bl = async (row) => { try { await api(`/missions/${row._id}/bl`, { method: 'POST' }); toast('Bon de livraison créé'); } catch (e) { toast(e.message, 'err'); } };
  const facturer = async (row, reload) => {
    if (!window.confirm(`Créer un brouillon de facture pour la mission ${row.ref} ?`)) return;
    try { await api('/factures/depuis-missions', { method: 'POST', body: { client: idOf(row.client), missionIds: [row._id], date: todayStr() } }); toast('Brouillon de facture créé — voir Factures'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <>
      <CrudPage title="Missions" subtitle="Transports réalisés pour vos clients — alimentent la rentabilité et les factures" endpoint="/missions" addLabel="Nouvelle mission" fields={missionFields} dateFilter searchPlaceholder="Réf, BL, ville, client, camion…"
        defaults={{ type: 'interne', statut: 'planifiee', mode: 'tonnage', modeST: 'tonnage', tva: 20, dateMission: todayStr() }} rowLock={(r) => !!r.facture}
        filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Statut', options: Object.entries(MISSION_ST).map(([v, [l]]) => [v, l]) }, { key: 'type', label: 'Type', options: [['interne', 'Interne'], ['soustraite', 'Sous-traitée']] }, { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }]}
        kpis={(d) => [{ label: 'Missions', value: d.kpis?.total ?? 0, sub: `${d.kpis?.en_cours ?? 0} en cours · ${d.kpis?.planifiee ?? 0} planifiées` }, { label: 'Terminées', value: d.kpis?.terminee ?? 0 }, { label: 'Tonnage', value: `${n2(d.kpis?.tonnage)} t` },
          { label: 'Chiffre HT', value: n2(d.kpis?.totalHT), sub: 'hors brouillons et annulées' }, { label: 'À facturer', value: n2(d.kpis?.montantNonFacture), sub: `${d.kpis?.nonFacturees ?? 0} mission(s) terminée(s)`, tone: d.kpis?.nonFacturees ? 'neg' : '' }]}
        columns={[{ label: 'Mission', render: (r) => <span><strong>{r.ref}</strong><small className="muted" style={{ display: 'block' }}>{fmtDate(r.dateMission)}</small></span> }, { label: 'Client', render: (r) => r.client?.nom },
          { label: 'Trajet', render: (r) => <span>{r.villeCharge}{r.villeDecharge ? ` → ${r.villeDecharge}` : ''}<small className="muted" style={{ display: 'block' }}>{r.marchandise}{r.numeroBL ? ` · BL ${r.numeroBL}` : ''}</small></span> },
          { label: 'Tonnage', align: 'r', render: (r) => (r.tonnage ? `${n2(r.tonnage)} t` : '—') },
          { label: 'Véhicule', render: (r) => (r.type === 'soustraite' ? <span>{r.sousTraitant?.nom}<small className="muted" style={{ display: 'block' }}>Sous-traité{r.vehiculeST ? ` · ${r.vehiculeST.immatriculation}` : ''}</small></span> : <span>{r.truck?.immatriculation || '—'}<small className="muted" style={{ display: 'block' }}>{r.chauffeur?.nom}</small></span>) },
          { label: 'Total HT', align: 'r', render: (r) => n2(r.totalHT) },
          { label: 'Statut', render: (r) => <span><MStatut v={r.statut} />{r.facture && <small className="muted" style={{ display: 'block' }}>Facture {r.facture.numero || '(brouillon)'}</small>}</span> }]}
        rowActions={(r, { reload }) => <>
          {r.statut === 'planifiee' && <button className="icon-btn" title="Démarrer" aria-label="Démarrer" onClick={() => statutRapide(r, 'en_cours', reload)}><Play size={16} /></button>}
          {(r.statut === 'planifiee' || r.statut === 'en_cours') && <button className="icon-btn" title="Marquer terminée" aria-label="Marquer terminée" onClick={() => statutRapide(r, 'terminee', reload)}><CheckCircle2 size={16} /></button>}
          <button className="icon-btn" title="Créer le bon de livraison" aria-label="Créer le bon de livraison" onClick={() => bl(r)}><FileText size={16} /></button>
          {r.statut === 'terminee' && !r.facture && <button className="icon-btn" title="Facturer" aria-label="Facturer" onClick={() => facturer(r, reload)}><Receipt size={16} /></button>}
        </>}
        emptyTitle="Aucune mission" emptyText="Créez une mission : une fois terminée, elle alimente automatiquement le résultat du camion." />
      {bill}
    </>
  );
}

/* ============ Relevé des missions d'un client ============ */
export function ReleveMissions() {
  return <ReportPage title="Relevé des missions client" subtitle="Toutes les missions d'un client sur une période — à joindre à la facturation" endpoint="/missions" extraParams={{ limit: 2000 }} dateFrom
    filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Statut', options: Object.entries(MISSION_ST).map(([v, [l]]) => [v, l]) }]}
    kpis={(d) => [{ label: 'Missions', value: d.total ?? 0 }, { label: 'Tonnage', value: `${n2(d.kpis?.tonnage)} t` }, { label: 'Total HT', value: n2(d.kpis?.totalHT) }, { label: 'Total TTC', value: n2(d.kpis?.totalTTC) }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.dateMission) }, { label: 'Réf.', render: (r) => r.ref }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'BL', render: (r) => r.numeroBL || '—' },
      { label: 'Trajet', render: (r) => `${r.villeCharge || ''} → ${r.villeDecharge || ''}` }, { label: 'Marchandise', render: (r) => r.marchandise || '—' }, { label: 'Tonnage', align: 'r', render: (r) => n2(r.tonnage) },
      { label: 'Total HT', align: 'r', render: (r) => n2(r.totalHT) }, { label: 'Statut', render: (r) => <MStatut v={r.statut} />, print: (r) => MISSION_ST[r.statut]?.[0] }]}
    totalRow={(d) => ['Total', '', '', '', '', '', n2(d.items.reduce((s, r) => s + r.tonnage, 0)), n2(d.items.reduce((s, r) => s + r.totalHT, 0)), '']} />;
}

/* ============ Devis ============ */
const DEVIS_ST = { brouillon: ['Brouillon', ''], envoye: ['Envoyé', 'info'], accepte: ['Accepté', 'pos'], refuse: ['Refusé', 'neg'], converti: ['Converti', 'pos'] };
export function Devis() {
  const { settings } = useApp(); const toast = useToast();
  const [view, setView] = useState(null);
  const convertir = async (r, reload) => {
    if (!window.confirm(`Convertir le devis ${r.numero} en brouillon de facture ?`)) return;
    try { await api(`/devis/${r._id}/convertir`, { method: 'POST' }); toast('Brouillon de facture créé — voir Factures'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <>
      <CrudPage title="Devis" subtitle="Offres de prix — convertibles en facture en un clic" endpoint="/devis" addLabel="Nouveau devis" dateFilter rowLock={(r) => r.statut === 'converti'}
        filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Statut', options: Object.entries(DEVIS_ST).map(([v, [l]]) => [v, l]) }]}
        kpis={(d) => [{ label: 'Devis', value: d.kpis?.total ?? 0 }, { label: 'Montant TTC (hors refusés)', value: n2(d.kpis?.ttc) }, { label: 'Acceptés', value: d.kpis?.acceptes ?? 0 }]}
        columns={[{ label: 'N°', render: (r) => <strong>{r.numero}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'Validité', render: (r) => fmtDate(r.validite) },
          { label: 'Total HT', align: 'r', render: (r) => n2(r.totalHT) }, { label: 'Total TTC', align: 'r', render: (r) => n2(r.totalTTC) }, { label: 'Statut', render: (r) => <Pill tone={DEVIS_ST[r.statut]?.[1]}>{DEVIS_ST[r.statut]?.[0]}</Pill> }]}
        viewActions={(r) => <button className="icon-btn" title="Imprimer" aria-label="Imprimer" onClick={() => setView(r)}><Printer size={16} /></button>}
        rowActions={(r, { reload }) => <>
          {r.statut !== 'converti' && r.statut !== 'refuse' && <button className="icon-btn" title="Convertir en facture" aria-label="Convertir en facture" onClick={() => convertir(r, reload)}><ArrowRightCircle size={16} /></button>}
        </>}
        renderForm={({ row, onClose, onSave }) => <DocFormModal title={row ? `Devis ${row.numero}` : 'Nouveau devis'} onClose={onClose} onSubmit={(b) => onSave(b, true)}
          initial={row ? { ...row, client: idOf(row.client) } : { client: '', date: todayStr(), validite: addDaysStr(todayStr(), 30), statut: 'brouillon', observation: '', lignes: [], fraisSupp: [], remisePct: 0 }}
          headFields={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'validite', label: 'Valable jusqu\'au', type: 'date' },
            { key: 'statut', label: 'Statut', type: 'select', options: [['brouillon', 'Brouillon'], ['envoye', 'Envoyé'], ['accepte', 'Accepté'], ['refuse', 'Refusé']] }, { key: 'observation', label: 'Observation / conditions', type: 'textarea' }]} />}
        emptyTitle="Aucun devis" />
      {view && <PrintPortal onClose={() => setView(null)} title={`Devis ${view.numero}`}><DocSheet kind="devis" doc={view} tiers={view.client} settings={settings} /></PrintPortal>}
    </>
  );
}

/* ============ Bons de livraison ============ */
export function BonsLivraison() {
  const { settings } = useApp();
  const [view, setView] = useState(null);
  return (
    <>
      <CrudPage title="Bons de livraison" subtitle="Créés depuis une mission (bouton « BL ») ou à la main" endpoint="/bons-livraison" addLabel="Nouveau BL" dateFilter defaults={{ date: todayStr(), statut: 'emis', lignes: [{ designation: '', qte: 1, unite: 't', pu: 0, tva: 0 }] }}
        filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Statut', options: [['emis', 'Émis'], ['livre', 'Livré'], ['signe', 'Signé']] }]}
        fields={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'lieuLivraison', label: 'Lieu de livraison' }, { key: 'statut', label: 'Statut', type: 'select', options: [['emis', 'Émis'], ['livre', 'Livré'], ['signe', 'Signé']] },
          { key: 'camion', label: 'Camion (immatriculation)' }, { key: 'chauffeur', label: 'Chauffeur' }, { key: 'lignes', label: 'Marchandises', type: 'custom', span: 2, default: [], render: (v, c) => <SimpleLines value={v} onChange={c} /> }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
        columns={[{ label: 'N°', render: (r) => <strong>{r.numero}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'Mission', render: (r) => r.mission?.ref || '—' },
          { label: 'Livraison', render: (r) => r.lieuLivraison || '—' }, { label: 'Camion', render: (r) => r.camion || '—' }, { label: 'Statut', render: (r) => <Pill tone={r.statut === 'signe' ? 'pos' : r.statut === 'livre' ? 'info' : ''}>{{ emis: 'Émis', livre: 'Livré', signe: 'Signé' }[r.statut]}</Pill> }]}
        viewActions={(r) => <button className="icon-btn" title="Imprimer" aria-label="Imprimer" onClick={() => setView(r)}><Printer size={16} /></button>} emptyTitle="Aucun bon de livraison" />
      {view && <PrintPortal onClose={() => setView(null)} title={`BL ${view.numero}`}><BLSheet doc={view} settings={settings} /></PrintPortal>}
    </>
  );
}

/* ============ Factures ============ */
function FactureDepuisMissions({ onClose, onDone }) {
  const toast = useToast();
  const [client, setClient] = useState('');
  const [data, setData] = useState({ m: [], l: [] }); const [sel, setSel] = useState({}); const [date, setDate] = useState(todayStr()); const [regrouper, setRegrouper] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSel({}); if (!client) { setData({ m: [], l: [] }); return; }
    Promise.all([api(`/missions?client=${client}&facturable=1&limit=1000`), api(`/locations?client=${client}&statut=terminee&limit=1000`)])
      .then(([m, l]) => { const d = { m: m.items, l: l.items.filter((x) => !x.facture) }; setData(d); setSel(Object.fromEntries([...d.m, ...d.l].map((x) => [x._id, true]))); }).catch((e) => toast(e.message, 'err'));
  }, [client]); // eslint-disable-line
  const ids = (list) => list.filter((x) => sel[x._id]).map((x) => x._id);
  const total = [...data.m, ...data.l].filter((x) => sel[x._id]).reduce((s, x) => s + x.totalHT, 0);
  const go = async () => {
    setBusy(true);
    try { await api('/factures/depuis-missions', { method: 'POST', body: { client, missionIds: ids(data.m), locationIds: ids(data.l), date, regrouper } }); toast('Brouillon de facture créé'); onDone(); onClose(); } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const Row = ({ x, kind }) => <label><input type="checkbox" checked={!!sel[x._id]} onChange={(e) => setSel({ ...sel, [x._id]: e.target.checked })} /><span>{kind === 'm' ? `${x.ref} — ${x.villeCharge} → ${x.villeDecharge} (${fmtDate(x.dateMission)})` : `${x.ref} — Location ${x.truck?.immatriculation} (${fmtDate(x.dateDebut)})`}</span><b>{n2(x.totalHT)}</b></label>;
  return (
    <Modal title="Facturer des missions" onClose={onClose} wide>
      <div className="form">
        <div className="form-grid">
          <label className="field"><span>Client</span><RefSelect url={REFS.clients.url} label={REFS.clients.label} value={client} onChange={setClient} /></label>
          <label className="field"><span>Date de la facture</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {client && (data.m.length + data.l.length === 0 ? <p className="muted">Aucune mission terminée ni location terminée à facturer pour ce client.</p> : <div className="pick-list">{data.m.map((x) => <Row key={x._id} x={x} kind="m" />)}{data.l.map((x) => <Row key={x._id} x={x} kind="l" />)}</div>)}
        <label className="check"><input type="checkbox" checked={regrouper} onChange={(e) => setRegrouper(e.target.checked)} />Regrouper en une seule ligne « Prestations de transport »</label>
        <div className="op-total"><span>Total HT sélectionné</span><b>{n2(total)}</b></div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !total} onClick={go}>Créer le brouillon</button></div>
      </div>
    </Modal>
  );
}

function AvoirForm({ facture, onClose, onSave }) {
  const [fid, setFid] = useState(facture ? idOf(facture) : '');
  const [fac, setFac] = useState(facture?.lignes ? facture : null);
  useEffect(() => { if (fid && !fac) api(`/factures/${fid}`).then(setFac).catch(() => {}); }, [fid]); // eslint-disable-line
  if (!fac) return <Modal title="Nouvel avoir" onClose={onClose}><div className="form"><label className="field"><span>Facture concernée</span><RefSelect url={FACT_REF.url} label={FACT_REF.label} value={fid} onChange={setFid} /></label>{fid && <Spinner />}</div></Modal>;
  return <DocFormModal title={`Avoir sur la facture ${fac.numero}`} onClose={onClose} onSubmit={(b) => onSave(b, true)}
    initial={{ facture: fac._id, date: todayStr(), motif: '', observation: '', lignes: fac.lignes, fraisSupp: fac.fraisSupp || [], remisePct: fac.remisePct || 0 }}
    headFields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'motif', label: 'Motif', required: true, span: 2 }]} linesLabel="Lignes à créditer (ajustez les quantités ou montants)" />;
}

export function Factures() {
  const { settings } = useApp(); const toast = useToast();
  const [view, setView] = useState(null); const [pay, setPay] = useState(null); const [avoir, setAvoir] = useState(null); const [dep, setDep] = useState(null);
  const act = async (url, msg, reload, ask) => { if (ask && !window.confirm(ask)) return; try { await api(url, { method: 'POST' }); toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <CrudPage title="Factures" subtitle="Brouillon modifiable → émise (numéro définitif, verrouillée) → règlements et avoirs" endpoint="/factures" addLabel="Nouvelle facture" dateFilter rowLock={(r) => r.statut !== 'brouillon'}
        searchPlaceholder="N°, client, objet…"
        filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Statut', options: [['brouillon', 'Brouillon'], ['emise', 'Émise'], ['annulee', 'Annulée']] }, { key: 'reglement', label: 'Règlement', options: [['payee', 'Payée'], ['partielle', 'Partielle'], ['impayee', 'Impayée'], ['en_retard', 'En retard']] }]}
        kpis={(d) => [{ label: 'Facturé TTC', value: n2(d.kpis?.ttc), sub: `${n2(d.kpis?.ht)} HT` }, { label: 'Encaissé', value: n2(d.kpis?.paye), tone: 'pos' }, { label: 'Reste à encaisser', value: n2(d.kpis?.reste), sub: `${d.kpis?.impayees ?? 0} facture(s)` }, { label: 'En retard', value: d.kpis?.enRetard ?? 0, tone: d.kpis?.enRetard ? 'neg' : '' }, { label: 'Brouillons', value: d.kpis?.brouillons ?? 0 }]}
        headExtra={({ reload }) => <button className="btn" onClick={() => setDep({ reload })}><FilePlus2 size={17} />Depuis des missions</button>}
        columns={[{ label: 'N°', render: (r) => (r.numero ? <strong>{r.numero}</strong> : <span className="muted">Brouillon</span>) }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Client', render: (r) => r.client?.nom || r.clientSnap?.nom },
          { label: 'Échéance', render: (r) => (r.statut === 'emise' ? fmtDate(r.echeance) : '—') }, { label: 'Total TTC', align: 'r', render: (r) => n2(r.totalTTC) }, { label: 'Réglé', align: 'r', render: (r) => (r.statut === 'emise' ? n2(r.paye + r.avoirs) : '—') },
          { label: 'Reste', align: 'r', render: (r) => (r.statut === 'emise' ? <span className={r.reste > 0 ? 'neg' : 'pos'}>{n2(r.reste)}</span> : '—') }, { label: 'Statut', render: (r) => <ReglPill v={r.reglement} /> }]}
        viewActions={(r) => <button className="icon-btn" title="Aperçu / imprimer" aria-label="Aperçu / imprimer" onClick={() => setView(r)}><Printer size={16} /></button>}
        rowActions={(r, { reload }) => <>
          {r.statut === 'brouillon' && <button className="icon-btn" title="Émettre (numéro définitif)" aria-label="Émettre" onClick={() => act(`/factures/${r._id}/emettre`, 'Facture émise', reload, 'Émettre cette facture ? Elle recevra son numéro définitif et ne sera plus modifiable.')}><Send size={16} /></button>}
          {r.statut === 'emise' && r.reste > 0.005 && <button className="icon-btn" title="Enregistrer un règlement" aria-label="Enregistrer un règlement" onClick={() => setPay({ r, reload })}><Wallet size={16} /></button>}
          {r.statut === 'emise' && <button className="icon-btn" title="Créer un avoir" aria-label="Créer un avoir" onClick={() => setAvoir({ r, reload })}><FileText size={16} /></button>}
          {r.statut === 'emise' && !(r.paye > 0) && <button className="icon-btn danger" title="Annuler la facture" aria-label="Annuler la facture" onClick={() => act(`/factures/${r._id}/annuler`, 'Facture annulée', reload, `Annuler la facture ${r.numero} ? Les missions seront libérées.`)}><Ban size={16} /></button>}
        </>}
        renderForm={({ row, onClose, onSave }) => <DocFormModal title={row ? 'Modifier le brouillon' : 'Nouvelle facture'} onClose={onClose} onSubmit={(b) => onSave(b, true)}
          initial={row ? { ...row, client: idOf(row.client) } : { client: '', date: todayStr(), echeance: '', modePaiement: '', prestation: '', observation: '', lignes: [], fraisSupp: [], remisePct: 0, missions: [], locations: [] }}
          headFields={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'echeance', label: 'Échéance', type: 'date', hint: 'Vide = date + délai du client' },
            { key: 'modePaiement', label: 'Mode de paiement', type: 'select', allowEmpty: true, options: MODE_OPTS }, { key: 'prestation', label: 'Objet de la facture', span: 2 }, { key: 'observation', label: 'Observation', type: 'textarea' }]} />}
        emptyTitle="Aucune facture" emptyText="Créez une facture à la main ou depuis des missions terminées." />
      {dep && <FactureDepuisMissions onClose={() => setDep(null)} onDone={dep.reload} />}
      {view && <PrintPortal onClose={() => setView(null)} title={`Facture ${view.numero || ''}`}><DocSheet kind="facture" doc={view} tiers={{ ...view.clientSnap, ...view.client }} settings={settings} brouillon={view.statut === 'brouillon'} /></PrintPortal>}
      {pay && <PayModal title={`Règlement — ${pay.r.numero}`} endpoint="/paiements" body={{ facture: pay.r._id }} reste={pay.r.reste} info={`Reste à payer : ${n2(pay.r.reste)} DHS`} onClose={() => setPay(null)} onDone={pay.reload} />}
      {avoir && <AvoirForm facture={avoir.r} onClose={() => setAvoir(null)} onSave={async (b) => { await api('/avoirs', { method: 'POST', body: b }); toast('Avoir créé'); avoir.reload(); setAvoir(null); }} />}
    </>
  );
}

/* ============ Avoirs ============ */
export function Avoirs() {
  const { settings } = useApp();
  const [view, setView] = useState(null);
  return (
    <>
      <CrudPage title="Avoirs" subtitle="Notes de crédit rattachées à une facture émise" endpoint="/avoirs" addLabel="Nouvel avoir" dateFilter
        filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }]}
        kpis={(d) => [{ label: 'Avoirs', value: d.kpis?.nb ?? 0 }, { label: 'Total TTC', value: n2(d.kpis?.ttc) }]}
        columns={[{ label: 'N°', render: (r) => <strong>{r.numero}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Facture', render: (r) => r.facture?.numero }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'Motif', render: (r) => r.motif || '—' }, { label: 'Total TTC', align: 'r', render: (r) => n2(r.totalTTC) }]}
        viewActions={(r) => <button className="icon-btn" title="Imprimer" aria-label="Imprimer" onClick={() => setView(r)}><Printer size={16} /></button>} rowLock={() => true}
        renderForm={({ onClose, onSave }) => <AvoirForm onClose={onClose} onSave={onSave} />} emptyTitle="Aucun avoir" />
      {view && <PrintPortal onClose={() => setView(null)} title={`Avoir ${view.numero}`}><DocSheet kind="avoir" doc={view} tiers={view.client} settings={settings} /></PrintPortal>}
    </>
  );
}

/* ============ Paiements clients ============ */
export function Paiements() {
  return <CrudPage title="Paiements clients" subtitle="Règlements encaissés — mettent à jour le reste à payer des factures" endpoint="/paiements" addLabel="Nouveau règlement" dateFilter defaults={{ date: todayStr(), mode: 'virement' }}
    filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'mode', label: 'Mode', options: MODE_OPTS }]}
    kpis={(d) => [{ label: 'Règlements', value: d.kpis?.nb ?? 0 }, { label: 'Total encaissé', value: n2(d.kpis?.total), tone: 'pos' }]}
    fields={[{ key: 'facture', label: 'Facture', type: 'ref', ref: FACT_REF, required: true, span: 2 }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'mode', label: 'Mode', type: 'select', options: MODE_OPTS }, { key: 'reference', label: 'Référence' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Facture', render: (r) => r.facture?.numero }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'Mode', render: (r) => MODE_LABEL[r.mode] || r.mode }, { label: 'Référence', render: (r) => r.reference || '—' }, { label: 'Montant', align: 'r', render: (r) => <b>{n2(r.montant)}</b> }]}
    emptyTitle="Aucun règlement" />;
}

/* ============ Relevé des règlements clients ============ */
export function ReleveReglements() {
  return <ReportPage title="Relevé des règlements clients" subtitle="État des factures émises : facturé, payé, reste à encaisser" endpoint="/releve-reglements" dateFrom
    filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'statut', label: 'Règlement', options: [['payee', 'Payée'], ['partielle', 'Partielle'], ['impayee', 'Impayée'], ['en_retard', 'En retard']] }]}
    kpis={(d) => [{ label: 'Facturé TTC', value: n2(d.totaux?.facture) }, { label: 'Encaissé', value: n2(d.totaux?.paye), tone: 'pos' }, { label: 'Avoirs', value: n2(d.totaux?.avoirs) }, { label: 'Reste à encaisser', value: n2(d.totaux?.reste), tone: d.totaux?.reste ? 'neg' : '' }, { label: 'Non payées', value: d.totaux?.nonPayees ?? 0 }]}
    columns={[{ label: 'Facture', render: (r) => <strong>{r.numero}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Client', render: (r) => r.client }, { label: 'Échéance', render: (r) => fmtDate(r.echeance) },
      { label: 'TTC', align: 'r', render: (r) => n2(r.ttc) }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Avoirs', align: 'r', render: (r) => n2(r.avoirs) }, { label: 'Reste', align: 'r', render: (r) => <span className={r.reste > 0 ? 'neg' : ''}>{n2(r.reste)}</span> },
      { label: 'Dernier règlement', render: (r) => (r.dernierPaiement ? `${fmtDate(r.dernierPaiement)} · ${MODE_LABEL[r.mode] || r.mode}` : '—') }, { label: 'Statut', render: (r) => <ReglPill v={r.reglement} />, print: (r) => ({ payee: 'Payée', partielle: 'Partielle', impayee: 'Impayée', en_retard: 'En retard' }[r.reglement]) }]}
    totalRow={(d) => ['Total', '', '', '', n2(d.totaux.facture), n2(d.totaux.paye), n2(d.totaux.avoirs), n2(d.totaux.reste), '', '']} />;
}

/* ============ Caisse ============ */
export function Caisse() {
  return <CrudPage title="Caisse" subtitle="Mouvements d'espèces — les règlements en espèces, dépenses et paies y sont ajoutés automatiquement" endpoint="/caisse" addLabel="Nouveau mouvement" dateFilter defaults={{ date: todayStr(), sens: 'sortie' }}
    rowLock={(r) => r.source !== 'manuel'} noDelete={false}
    filters={[{ key: 'sens', label: 'Sens', options: [['entree', 'Entrées'], ['sortie', 'Sorties']] }, { key: 'source', label: 'Origine', options: [['manuel', 'Manuel'], ['paiement_client', 'Règlement client'], ['paiement_fournisseur', 'Règlement fournisseur'], ['paiement_st', 'Sous-traitant'], ['depense', 'Dépense'], ['paie', 'Paie']] }]}
    kpis={(d) => [{ label: 'Entrées (période)', value: n2(d.kpis?.entrees), tone: 'pos' }, { label: 'Sorties (période)', value: n2(d.kpis?.sorties), tone: 'neg' }, { label: 'Solde de caisse', value: n2(d.kpis?.solde), tone: neg(d.kpis?.solde), sub: 'tous mouvements confondus' }]}
    fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'sens', label: 'Sens', type: 'select', options: [['entree', 'Entrée'], ['sortie', 'Sortie']] }, { key: 'libelle', label: 'Libellé', required: true, span: 2 }, { key: 'categorie', label: 'Catégorie' }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Libellé', render: (r) => r.libelle }, { label: 'Catégorie', render: (r) => r.categorie || '—' }, { label: 'Origine', render: (r) => <Pill tone={r.source === 'manuel' ? '' : 'info'}>{r.source === 'manuel' ? 'Manuel' : 'Automatique'}</Pill> },
      { label: 'Entrée', align: 'r', render: (r) => (r.sens === 'entree' ? <span className="pos">{n2(r.montant)}</span> : '') }, { label: 'Sortie', align: 'r', render: (r) => (r.sens === 'sortie' ? <span className="neg">{n2(r.montant)}</span> : '') }]}
    emptyTitle="Aucun mouvement de caisse" />;
}

/* ============ Dépenses ============ */
const CATS = ['Carburant (divers)', 'Péages', 'Réparations', 'Pneumatiques', 'Assurance', 'Taxes & vignettes', 'Loyer', 'Électricité / eau / télécom', 'Fournitures de bureau', 'Frais de déplacement', 'Honoraires', 'Autre'];
export function Depenses() {
  return <CrudPage title="Dépenses" subtitle="Frais généraux et dépenses courantes (les dépenses en espèces alimentent la caisse)" endpoint="/depenses" addLabel="Nouvelle dépense" dateFilter defaults={{ date: todayStr(), mode: 'especes' }}
    filters={[{ key: 'categorie', label: 'Catégorie', options: CATS.map((c) => [c, c]) }, { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }]}
    kpis={(d) => [{ label: 'Total dépenses', value: n2(d.kpis?.total), tone: 'neg' }, { label: 'Nombre', value: d.kpis?.nb ?? 0 }, { label: 'Principale catégorie', value: d.parCategorie?.[0]?.categorie || '—', sub: d.parCategorie?.[0] ? n2(d.parCategorie[0].montant) : '' }]}
    fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'categorie', label: 'Catégorie', required: true, list: CATS }, { key: 'libelle', label: 'Libellé', required: true, span: 2 }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'mode', label: 'Mode', type: 'select', options: MODE_OPTS },
      { key: 'fournisseur', label: 'Fournisseur', type: 'ref', ref: 'fournisseurs', empty: '— Aucun —' }, { key: 'truck', label: 'Camion concerné', type: 'ref', ref: 'trucks', empty: '— Aucun —' }, { key: 'reference', label: 'Référence / n° pièce' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Catégorie', render: (r) => r.categorie }, { label: 'Libellé', render: (r) => r.libelle }, { label: 'Fournisseur', render: (r) => r.fournisseur?.nom || '—' }, { label: 'Camion', render: (r) => r.truck?.immatriculation || '—' },
      { label: 'Mode', render: (r) => MODE_LABEL[r.mode] || r.mode }, { label: 'Montant', align: 'r', render: (r) => <b>{n2(r.montant)}</b> }]}
    emptyTitle="Aucune dépense" />;
}

/* ============ Rentabilité ============ */
export function Rentabilite() {
  const [tab, setTab] = useState('mission');
  const cols = {
    mission: [{ label: 'Mission', render: (r) => <strong>{r.ref}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Client', render: (r) => r.client }, { label: 'Véhicule', render: (r) => r.truck }, { label: 'Statut', render: (r) => <MStatut v={r.statut} />, print: (r) => MISSION_ST[r.statut]?.[0] },
      { label: 'Revenu', align: 'r', render: (r) => n2(r.revenu) }, { label: 'Coût', align: 'r', render: (r) => n2(r.cout) }, { label: 'Marge', align: 'r', render: (r) => <span className={neg(r.marge)}>{n2(r.marge)}</span> }, { label: 'Taux', align: 'r', render: (r) => `${n2(r.taux)} %` }],
    client: [{ label: 'Client', render: (r) => <strong>{r.client}</strong> }, { label: 'Missions', align: 'r', render: (r) => r.missions }, { label: 'Revenu', align: 'r', render: (r) => n2(r.revenu) }, { label: 'Coût', align: 'r', render: (r) => n2(r.cout) }, { label: 'Marge', align: 'r', render: (r) => <span className={neg(r.marge)}>{n2(r.marge)}</span> }, { label: 'Taux', align: 'r', render: (r) => `${n2(r.taux)} %` }],
    vehicule: [{ label: 'Camion', render: (r) => <strong>{r.immatriculation}</strong> }, { label: 'Missions', align: 'r', render: (r) => r.missions }, { label: 'Km', align: 'r', render: (r) => n2(r.km) }, { label: 'Produits', align: 'r', render: (r) => n2(r.produits) }, { label: 'Gasoil', align: 'r', render: (r) => n2(r.gasoil) }, { label: 'Maintenance', align: 'r', render: (r) => n2(r.maintenance) },
      { label: 'Charges', align: 'r', render: (r) => n2(r.charges) }, { label: 'Résultat', align: 'r', render: (r) => <span className={neg(r.net)}>{n2(r.net)}</span> }, { label: 'Taux', align: 'r', render: (r) => `${n2(r.taux)} %` }],
  };
  const key = { mission: 'parMission', client: 'parClient', vehicule: 'parVehicule' }[tab];
  return <ReportPage title="Rentabilité" subtitle="Marge réelle par mission, par client et par véhicule (missions terminées)" endpoint="/rentabilite" dateFrom columns={cols[tab]} rows={(d) => d[key] || []}
    tabs={<Tabs value={tab} onChange={setTab} items={[['mission', 'Par mission'], ['client', 'Par client'], ['vehicule', 'Par véhicule']]} />}
    kpis={(d) => [{ label: 'Revenu (missions terminées)', value: n2(d.kpis?.revenu) }, { label: 'Coûts missions', value: n2(d.kpis?.coutMissions), sub: 'sous-traitance + charges' }, { label: 'Gasoil + maintenance', value: n2((d.kpis?.gasoil || 0) + (d.kpis?.maintenance || 0)) },
      { label: 'Résultat', value: n2(d.kpis?.profit), tone: neg(d.kpis?.profit), sub: `${n2(d.kpis?.taux)} % du revenu` }, { label: 'Missions en perte', value: d.kpis?.perte ?? 0, tone: d.kpis?.perte ? 'neg' : '' }]} />;
}
