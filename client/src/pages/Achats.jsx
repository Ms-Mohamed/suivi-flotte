import React, { useState } from 'react';
import { Printer, Wallet } from 'lucide-react';
import { useApp } from '../App.jsx';
import { CrudPage, Pill, Tabs, idOf } from '../crud.jsx';
import { DocFormModal, DocSheet, PrintPortal } from '../docs.jsx';
import { n2, fmtDate, todayStr } from '../format.js';
import { MODE_OPTS, MODE_LABEL, PayModal, ReglPill, ReportPage } from './common.jsx';

const TIERS = [
  { key: 'nom', label: 'Nom / raison sociale', required: true, span: 2 }, { key: 'ice', label: 'ICE' }, { key: 'if', label: 'Identifiant fiscal' }, { key: 'rc', label: 'RC' }, { key: 'telephone', label: 'Téléphone' },
  { key: 'adresse', label: 'Adresse', span: 2 }, { key: 'ville', label: 'Ville' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'contact', label: 'Contact' }, { key: 'delaiPaiement', label: 'Délai de paiement', type: 'number', suffix: 'jours' },
  { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Actif' },
];
const ACHAT_REF = { url: '/achats?statut=validee&limit=1000', label: (o) => `${o.numero}${o.numeroFournisseur ? ` (${o.numeroFournisseur})` : ''} — ${o.fournisseur?.nom || ''} · reste ${n2(o.reste)}` };

export function Fournisseurs() {
  return <CrudPage title="Fournisseurs" subtitle="Fichier fournisseurs" endpoint="/fournisseurs" addLabel="Nouveau fournisseur" defaults={{ actif: true, delaiPaiement: 30 }} fields={TIERS}
    columns={[{ label: 'Nom', render: (r) => <strong>{r.nom}</strong> }, { key: 'ice', label: 'ICE' }, { key: 'ville', label: 'Ville' }, { key: 'telephone', label: 'Téléphone' }, { label: 'Délai', render: (r) => `${r.delaiPaiement} j` }, { label: '', render: (r) => (r.actif ? null : <Pill>Inactif</Pill>) }]}
    emptyTitle="Aucun fournisseur" />;
}

export function Articles() {
  return <CrudPage title="Articles & services" subtitle="Catalogue d'achats (pièces, pneus, carburant, prestations…)" endpoint="/articles" addLabel="Nouvel article" defaults={{ actif: true, tva: 20, unite: 'u' }}
    fields={[{ key: 'reference', label: 'Référence' }, { key: 'designation', label: 'Désignation', required: true }, { key: 'categorie', label: 'Catégorie' }, { key: 'unite', label: 'Unité' }, { key: 'prixAchat', label: 'Prix d\'achat HT', type: 'money' }, { key: 'tva', label: 'TVA', type: 'number', suffix: '%' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Actif' }]}
    columns={[{ key: 'reference', label: 'Réf.' }, { label: 'Désignation', render: (r) => <strong>{r.designation}</strong> }, { key: 'categorie', label: 'Catégorie' }, { key: 'unite', label: 'Unité' }, { label: 'Prix HT', align: 'r', render: (r) => n2(r.prixAchat) }, { label: 'TVA', align: 'r', render: (r) => `${r.tva} %` }]}
    emptyTitle="Aucun article" />;
}

export function Achats() {
  const { settings } = useApp();
  const [view, setView] = useState(null); const [pay, setPay] = useState(null);
  return (
    <>
      <CrudPage title="Achats" subtitle="Factures et bons d'achat fournisseurs" endpoint="/achats" addLabel="Nouvel achat" dateFilter rowLock={(r) => r.statut === 'annulee'} searchPlaceholder="N°, fournisseur…"
        filters={[{ key: 'fournisseur', label: 'Fournisseur', type: 'ref', ref: 'fournisseurs' }, { key: 'statut', label: 'Statut', options: [['brouillon', 'Brouillon'], ['validee', 'Validé'], ['annulee', 'Annulé']] }, { key: 'reglement', label: 'Règlement', options: [['payee', 'Payé'], ['partielle', 'Partiel'], ['impayee', 'Impayé'], ['en_retard', 'En retard']] }]}
        kpis={(d) => [{ label: 'Achats TTC', value: n2(d.kpis?.ttc) }, { label: 'Payé', value: n2(d.kpis?.paye), tone: 'pos' }, { label: 'Reste à payer', value: n2(d.kpis?.reste), tone: d.kpis?.reste ? 'neg' : '' }, { label: 'En retard', value: d.kpis?.enRetard ?? 0, tone: d.kpis?.enRetard ? 'neg' : '' }]}
        columns={[{ label: 'N°', render: (r) => <span><strong>{r.numero}</strong>{r.numeroFournisseur && <small className="muted" style={{ display: 'block' }}>Fourn. {r.numeroFournisseur}</small>}</span> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Fournisseur', render: (r) => r.fournisseur?.nom },
          { label: 'Échéance', render: (r) => fmtDate(r.echeance) }, { label: 'Total TTC', align: 'r', render: (r) => n2(r.totalTTC) }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Reste', align: 'r', render: (r) => (r.statut === 'validee' ? n2(r.reste) : '—') },
          { label: 'Statut', render: (r) => <ReglPill v={r.statut === 'validee' ? r.reglement : r.statut} /> }]}
        viewActions={(r) => <button className="icon-btn" title="Imprimer" aria-label="Imprimer" onClick={() => setView(r)}><Printer size={16} /></button>}
        rowActions={(r, { reload }) => <>
          {r.statut === 'validee' && r.reste > 0.005 && <button className="icon-btn" title="Enregistrer un paiement" aria-label="Enregistrer un paiement" onClick={() => setPay({ r, reload })}><Wallet size={16} /></button>}
        </>}
        renderForm={({ row, onClose, onSave }) => <DocFormModal title={row ? `Achat ${row.numero}` : 'Nouvel achat'} onClose={onClose} onSubmit={(b) => onSave(b, true)}
          initial={row ? { ...row, fournisseur: idOf(row.fournisseur) } : { fournisseur: '', numeroFournisseur: '', date: todayStr(), echeance: '', statut: 'validee', observation: '', lignes: [], fraisSupp: [], remisePct: 0 }}
          headFields={[{ key: 'fournisseur', label: 'Fournisseur', type: 'ref', ref: 'fournisseurs', required: true }, { key: 'numeroFournisseur', label: 'N° facture fournisseur' }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'echeance', label: 'Échéance', type: 'date', hint: 'Vide = date + délai du fournisseur' },
            { key: 'statut', label: 'Statut', type: 'select', options: [['validee', 'Validé'], ['brouillon', 'Brouillon'], ['annulee', 'Annulé']] }, { key: 'observation', label: 'Observation', type: 'textarea' }]} />}
        emptyTitle="Aucun achat" />
      {view && <PrintPortal onClose={() => setView(null)} title={`Achat ${view.numero}`}><DocSheet kind="achat" doc={view} tiers={view.fournisseur} settings={settings} /></PrintPortal>}
      {pay && <PayModal title={`Paiement — ${pay.r.numero}`} endpoint="/paiements-fournisseurs" body={{ achat: pay.r._id }} reste={pay.r.reste} info={`Reste à payer : ${n2(pay.r.reste)} DHS`} onClose={() => setPay(null)} onDone={pay.reload} />}
    </>
  );
}

export function SuiviPaiementsAchats() {
  return <CrudPage title="Suivi des paiements fournisseurs" subtitle="Règlements effectués — chaque paiement réduit le reste à payer de l'achat" endpoint="/paiements-fournisseurs" addLabel="Nouveau paiement" dateFilter defaults={{ date: todayStr(), mode: 'virement' }}
    filters={[{ key: 'fournisseur', label: 'Fournisseur', type: 'ref', ref: 'fournisseurs' }, { key: 'mode', label: 'Mode', options: MODE_OPTS }]}
    kpis={(d) => [{ label: 'Paiements', value: d.kpis?.nb ?? 0 }, { label: 'Total payé', value: n2(d.kpis?.total), tone: 'neg' }]}
    fields={[{ key: 'achat', label: 'Achat', type: 'ref', ref: ACHAT_REF, required: true, span: 2 }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'mode', label: 'Mode', type: 'select', options: MODE_OPTS }, { key: 'reference', label: 'Référence' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Achat', render: (r) => r.achat?.numero }, { label: 'Fournisseur', render: (r) => r.fournisseur?.nom }, { label: 'Mode', render: (r) => MODE_LABEL[r.mode] }, { label: 'Référence', render: (r) => r.reference || '—' }, { label: 'Montant', align: 'r', render: (r) => <b>{n2(r.montant)}</b> }]}
    emptyTitle="Aucun paiement" />;
}

export function ReleveAchats() {
  return <ReportPage title="Relevé des achats" subtitle="Achats validés : montant, payé, reste à payer par fournisseur" endpoint="/releve-achats" dateFrom
    filters={[{ key: 'fournisseur', label: 'Fournisseur', type: 'ref', ref: 'fournisseurs' }, { key: 'statut', label: 'Règlement', options: [['payee', 'Payé'], ['partielle', 'Partiel'], ['impayee', 'Impayé'], ['en_retard', 'En retard']] }]}
    kpis={(d) => [{ label: 'Acheté TTC', value: n2(d.totaux?.achete) }, { label: 'Payé', value: n2(d.totaux?.paye), tone: 'pos' }, { label: 'Reste à payer', value: n2(d.totaux?.reste), tone: d.totaux?.reste ? 'neg' : '' }, { label: 'Non payés', value: d.totaux?.nonPayes ?? 0 }]}
    columns={[{ label: 'N°', render: (r) => <strong>{r.numero}</strong> }, { label: 'N° fournisseur', render: (r) => r.numeroFournisseur || '—' }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Fournisseur', render: (r) => r.fournisseur }, { label: 'Échéance', render: (r) => fmtDate(r.echeance) },
      { label: 'TTC', align: 'r', render: (r) => n2(r.ttc) }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Reste', align: 'r', render: (r) => <span className={r.reste > 0 ? 'neg' : ''}>{n2(r.reste)}</span> },
      { label: 'Statut', render: (r) => <ReglPill v={r.reglement} />, print: (r) => ({ payee: 'Payé', partielle: 'Partiel', impayee: 'Impayé', en_retard: 'En retard' }[r.reglement]) }]}
    totalRow={(d) => ['Total', '', '', '', '', n2(d.totaux.achete), n2(d.totaux.paye), n2(d.totaux.reste), '']} />;
}
