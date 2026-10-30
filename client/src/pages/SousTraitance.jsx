import React, { useState } from 'react';
import { CrudPage, Pill, Tabs } from '../crud.jsx';
import { n2, fmtDate, todayStr } from '../format.js';
import { MODE_OPTS, MODE_LABEL, ReportPage, neg } from './common.jsx';

const TIERS = [
  { key: 'nom', label: 'Nom / raison sociale', required: true, span: 2 }, { key: 'ice', label: 'ICE' }, { key: 'if', label: 'Identifiant fiscal' }, { key: 'rc', label: 'RC' }, { key: 'telephone', label: 'Téléphone' },
  { key: 'adresse', label: 'Adresse', span: 2 }, { key: 'ville', label: 'Ville' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'contact', label: 'Contact' },
  { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Actif' },
];
const ST_PERIOD = [{ key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants' }];

export function SousTraitants() {
  return <CrudPage title="Sous-traitants" subtitle="Transporteurs partenaires à qui vous confiez des missions" endpoint="/sous-traitants" addLabel="Nouveau sous-traitant" defaults={{ actif: true }} fields={TIERS}
    columns={[{ label: 'Nom', render: (r) => <strong>{r.nom}</strong> }, { key: 'ice', label: 'ICE' }, { key: 'ville', label: 'Ville' }, { key: 'telephone', label: 'Téléphone' }, { key: 'contact', label: 'Contact' }, { label: '', render: (r) => (r.actif ? null : <Pill>Inactif</Pill>) }]}
    emptyTitle="Aucun sous-traitant" />;
}

export function VehiculesST() {
  return <CrudPage title="Véhicules des sous-traitants" subtitle="Immatriculations utilisées pour le suivi du tonnage" endpoint="/vehicules-st" addLabel="Nouveau véhicule" defaults={{ actif: true }}
    filters={[{ key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants' }]}
    fields={[{ key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants', required: true }, { key: 'immatriculation', label: 'Immatriculation', required: true }, { key: 'type', label: 'Type (semi, benne…)' }, { key: 'capaciteTonnes', label: 'Capacité', type: 'number', suffix: 't' },
      { key: 'chauffeur', label: 'Chauffeur' }, { key: 'telephone', label: 'Téléphone' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Actif' }]}
    columns={[{ label: 'Immatriculation', render: (r) => <strong>{r.immatriculation}</strong> }, { label: 'Sous-traitant', render: (r) => r.sousTraitant?.nom }, { key: 'type', label: 'Type' }, { label: 'Capacité', align: 'r', render: (r) => (r.capaciteTonnes ? `${n2(r.capaciteTonnes)} t` : '—') }, { key: 'chauffeur', label: 'Chauffeur' }, { key: 'telephone', label: 'Téléphone' }]}
    emptyTitle="Aucun véhicule" />;
}

export function OperationsST() {
  return <ReportPage title="Opérations de sous-traitance" subtitle="Missions confiées à des sous-traitants — créez-les dans Missions (type « Sous-traitée »)" endpoint="/st/operations" dateFrom
    filters={[...ST_PERIOD, { key: 'statut', label: 'Statut', options: [['planifiee', 'Planifiée'], ['en_cours', 'En cours'], ['terminee', 'Terminée'], ['brouillon', 'Brouillon']] }]}
    kpis={(d) => [{ label: 'Opérations', value: d.totaux?.nb ?? 0, sub: `${n2(d.totaux?.tonnage)} t` }, { label: 'Revenu client HT', value: n2(d.totaux?.revenu) }, { label: 'Coût sous-traitance', value: n2(d.totaux?.cout) }, { label: 'Marge', value: n2(d.totaux?.marge), tone: neg(d.totaux?.marge) }, { label: 'Reste à payer', value: n2(d.totaux?.reste), tone: d.totaux?.reste ? 'neg' : '' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Réf.', render: (r) => r.ref }, { label: 'Client', render: (r) => r.client }, { label: 'Sous-traitant', render: (r) => r.sousTraitant }, { label: 'Véhicule', render: (r) => r.vehicule || '—' }, { label: 'Trajet', render: (r) => r.trajet },
      { label: 'Tonnage', align: 'r', render: (r) => n2(r.tonnage) }, { label: 'Revenu', align: 'r', render: (r) => n2(r.revenu) }, { label: 'Coût', align: 'r', render: (r) => n2(r.cout) }, { label: 'Marge', align: 'r', render: (r) => <span className={neg(r.marge)}>{n2(r.marge)}</span> }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Reste', align: 'r', render: (r) => n2(r.reste) }]}
    totalRow={(d) => ['Total', '', '', '', '', '', n2(d.totaux.tonnage), n2(d.totaux.revenu), n2(d.totaux.cout), n2(d.totaux.marge), n2(d.totaux.paye), n2(d.totaux.reste)]} />;
}

export function RapportTonnage() {
  return <ReportPage title="Rapport tonnage sous-traitants" subtitle="Tonnage et montants par sous-traitant et par matricule" endpoint="/st/tonnage" dateFrom filters={ST_PERIOD}
    kpis={(d) => [{ label: 'Tonnage total', value: `${n2(d.totaux?.tonnage)} t` }, { label: 'Missions', value: d.totaux?.missions ?? 0 }, { label: 'Montant dû', value: n2(d.totaux?.montant) }, { label: 'Payé', value: n2(d.totaux?.paye), tone: 'pos' }, { label: 'Reste', value: n2(d.totaux?.reste), tone: d.totaux?.reste ? 'neg' : '' }]}
    columns={[{ label: 'Sous-traitant', render: (r) => <strong>{r.sousTraitant}</strong> }, { label: 'Matricule', render: (r) => r.matricule }, { label: 'Missions', align: 'r', render: (r) => r.missions }, { label: 'Tonnage', align: 'r', render: (r) => n2(r.tonnage) },
      { label: 'Montant', align: 'r', render: (r) => n2(r.montant) }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Reste', align: 'r', render: (r) => n2(r.reste) }]}
    totalRow={(d) => ['Total', '', d.totaux.missions, n2(d.totaux.tonnage), n2(d.totaux.montant), n2(d.totaux.paye), n2(d.totaux.reste)]} />;
}

export function SuiviPaiementsST() {
  const [tab, setTab] = useState('soldes');
  const tabs = <Tabs value={tab} onChange={setTab} items={[['soldes', 'Soldes'], ['paiements', 'Paiements']]} />;
  if (tab === 'soldes') return <ReportPage title="Suivi des paiements sous-traitants" subtitle="Ce qui est dû (missions terminées), payé et restant par sous-traitant" endpoint="/sous-traitants-soldes" tabs={tabs}
    kpis={(d) => [{ label: 'Total dû', value: n2(d.totaux?.du) }, { label: 'Payé', value: n2(d.totaux?.paye), tone: 'pos' }, { label: 'Reste à payer', value: n2(d.totaux?.reste), tone: d.totaux?.reste ? 'neg' : '' }]}
    columns={[{ label: 'Sous-traitant', render: (r) => <strong>{r.nom}</strong> }, { label: 'Missions terminées', align: 'r', render: (r) => r.missions }, { label: 'Tonnage', align: 'r', render: (r) => n2(r.tonnage) }, { label: 'Dû', align: 'r', render: (r) => n2(r.du) }, { label: 'Payé', align: 'r', render: (r) => n2(r.paye) }, { label: 'Reste', align: 'r', render: (r) => <span className={r.reste > 0 ? 'neg' : ''}>{n2(r.reste)}</span> }]}
    totalRow={(d) => ['Total', '', '', n2(d.totaux.du), n2(d.totaux.paye), n2(d.totaux.reste)]} />;
  return <CrudPage title="Suivi des paiements sous-traitants" subtitle="Règlements versés aux sous-traitants" endpoint="/paiements-st" addLabel="Nouveau paiement" dateFilter tabs={tabs} defaults={{ date: todayStr(), mode: 'virement' }}
    filters={[{ key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants' }, { key: 'mode', label: 'Mode', options: MODE_OPTS }]}
    kpis={(d) => [{ label: 'Paiements', value: d.kpis?.nb ?? 0 }, { label: 'Total versé', value: n2(d.kpis?.total), tone: 'neg' }]}
    fields={[{ key: 'sousTraitant', label: 'Sous-traitant', type: 'ref', ref: 'sousTraitants', required: true }, { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'mission', label: 'Mission concernée (facultatif)', type: 'ref', span: 2, empty: '— Paiement global —', ref: { url: (f) => `/st/operations?x=1${f.sousTraitant ? `&sousTraitant=${typeof f.sousTraitant === 'object' ? f.sousTraitant._id : f.sousTraitant}` : ''}`, label: (o) => `${o.ref} — ${o.trajet} (reste ${n2(o.reste)})` } },
      { key: 'montant', label: 'Montant', type: 'money', required: true }, { key: 'mode', label: 'Mode', type: 'select', options: MODE_OPTS }, { key: 'reference', label: 'Référence' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Sous-traitant', render: (r) => r.sousTraitant?.nom }, { label: 'Mission', render: (r) => r.mission?.ref || 'Global' }, { label: 'Mode', render: (r) => MODE_LABEL[r.mode] }, { label: 'Référence', render: (r) => r.reference || '—' }, { label: 'Montant', align: 'r', render: (r) => <b>{n2(r.montant)}</b> }]}
    emptyTitle="Aucun paiement" />;
}
