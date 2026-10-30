import React, { useEffect, useMemo, useState } from 'react';
import { Paperclip, Download, XCircle, ArrowDownUp } from 'lucide-react';
import { api, download, upload } from '../api.js';
import { Kpi, MonthPicker, Spinner, useToast } from '../components.jsx';
import { CrudPage, FormModal, Pill, initialFrom, payloadFrom } from '../crud.jsx';
import { n2, fmtDate, todayStr } from '../format.js';
import { ReportPage, neg } from './common.jsx';

const DOC_TYPES = [['carte_grise', 'Carte grise'], ['assurance', 'Assurance'], ['vignette', 'Vignette'], ['visite_technique', 'Visite technique'], ['carte_autorisation', "Carte d'autorisation"], ['permis', 'Permis / agrément'], ['autre', 'Autre']];
const DS = { expire: ['Expiré', 'neg'], j7: ['≤ 7 jours', 'neg'], j15: ['≤ 15 jours', 'warn'], j30: ['≤ 30 jours', 'warn'], valide: ['Valide', 'pos'], sans_date: ['Sans date', ''] };
const DocPill = ({ r }) => <Pill tone={DS[r.statut]?.[1]}>{r.jours == null ? DS[r.statut]?.[0] : r.jours < 0 ? `Expiré depuis ${-r.jours} j` : r.jours === 0 ? "Expire aujourd'hui" : `${DS[r.statut]?.[0] === 'Valide' ? 'Valide · ' : ''}${r.jours} j`}</Pill>;
const pickFile = (accept, onFile) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => i.files[0] && onFile(i.files[0]); i.click(); };

export function DocumentsVehicules() {
  const toast = useToast();
  const attach = (row, reload) => pickFile('.pdf,.jpg,.jpeg,.png,.webp', async (f) => {
    if (f.size > 10 * 1024 * 1024) return toast('Fichier trop volumineux (10 Mo maximum)', 'err');
    try { await upload(`/documents-vehicules/${row._id}/fichier`, f); toast('Fichier joint'); reload(); } catch (e) { toast(e.message, 'err'); }
  });
  const detach = async (row, reload) => { if (!window.confirm('Retirer le fichier joint ?')) return; try { await api(`/documents-vehicules/${row._id}/fichier`, { method: 'DELETE' }); toast('Fichier retiré'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return <CrudPage title="Documents véhicules" subtitle="Carte grise, assurance, visite technique, vignette… avec scan et alertes d'expiration (un document renouvelé masque l'ancien dans les alertes)" endpoint="/documents-vehicules" addLabel="Nouveau document" searchPlaceholder="Camion, type, numéro…" defaults={{ type: 'assurance' }}
    filters={[{ key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }, { key: 'type', label: 'Type', options: DOC_TYPES }, { key: 'statut', label: 'État', options: [['alerte', 'À surveiller'], ['expire', 'Expirés'], ['j7', '≤ 7 jours'], ['j15', '≤ 15 jours'], ['j30', '≤ 30 jours'], ['valide', 'Valides']] }]}
    kpis={(d) => [{ label: 'Documents', value: d.kpis?.total ?? 0 }, { label: 'Expirés', value: d.kpis?.expire ?? 0, tone: d.kpis?.expire ? 'neg' : '' }, { label: '≤ 7 jours', value: d.kpis?.j7 ?? 0, tone: d.kpis?.j7 ? 'neg' : '' }, { label: '≤ 15 jours', value: d.kpis?.j15 ?? 0 }, { label: '≤ 30 jours', value: d.kpis?.j30 ?? 0 }]}
    fields={[{ key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks', required: true }, { key: 'type', label: 'Type de document', type: 'select', options: DOC_TYPES }, { key: 'numero', label: 'Numéro / police' }, { key: 'dateEmission', label: "Date d'émission", type: 'date' }, { key: 'dateExpiration', label: "Date d'expiration", type: 'date' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Camion', render: (r) => <strong>{r.truck?.immatriculation}</strong> }, { label: 'Type', render: (r) => r.typeLabel }, { label: 'Numéro', render: (r) => r.numero || '—' }, { label: 'Émission', render: (r) => fmtDate(r.dateEmission) }, { label: 'Expiration', render: (r) => fmtDate(r.dateExpiration) },
      { label: 'État', render: (r) => <DocPill r={r} /> }, { label: 'Scan', render: (r) => (r.aFichier ? <button className="row-link" onClick={() => download(`/documents-vehicules/${r._id}/fichier`, r.fichier?.nom || 'document').catch((e) => toast(e.message, 'err'))}>{r.fichier?.nom || 'Télécharger'}</button> : <span className="muted">—</span>) }]}
    rowActions={(r, { reload }) => <>
      <button className="icon-btn" title={r.aFichier ? 'Remplacer le scan' : 'Joindre un scan'} aria-label="Joindre un scan" onClick={() => attach(r, reload)}><Paperclip size={16} /></button>
      {r.aFichier && <button className="icon-btn" title="Retirer le scan" aria-label="Retirer le scan" onClick={() => detach(r, reload)}><XCircle size={16} /></button>}
    </>}
    emptyTitle="Aucun document" emptyText="Enregistrez les documents de vos camions pour être alerté avant leur expiration." />;
}

export function AlertesVehicules() {
  return <ReportPage title="Alertes véhicules" subtitle="Documents expirés ou arrivant à échéance dans les 30 jours (camions actifs)" endpoint="/alertes-vehicules"
    kpis={(d) => [{ label: 'Expirés', value: d.kpis?.expire ?? 0, tone: d.kpis?.expire ? 'neg' : '' }, { label: '≤ 7 jours', value: d.kpis?.j7 ?? 0, tone: d.kpis?.j7 ? 'neg' : '' }, { label: '≤ 15 jours', value: d.kpis?.j15 ?? 0 }, { label: '≤ 30 jours', value: d.kpis?.j30 ?? 0 }]}
    columns={[{ label: 'Camion', render: (r) => <strong>{r.truck?.immatriculation}</strong>, print: (r) => r.truck?.immatriculation }, { label: 'Document', render: (r) => r.typeLabel }, { label: 'Numéro', render: (r) => r.numero || '—' }, { label: 'Expiration', render: (r) => fmtDate(r.dateExpiration) },
      { label: 'Échéance', render: (r) => <DocPill r={r} />, print: (r) => (r.jours < 0 ? `Expiré depuis ${-r.jours} j` : `Dans ${r.jours} j`) }]}
    emptyText="Tous les documents sont à jour." />;
}

/* ============ Disponibilité ============ */
const DISPO = { disponible: ['Disponible', 'pos'], mission: ['En mission', 'info'], location: ['En location', 'warn'], maintenance: ['Maintenance', 'neg'], indisponible: ['Indisponible', 'neg'] };
export function Disponibilite() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr()); const [data, setData] = useState(null); const [f, setF] = useState('');
  useEffect(() => { setData(null); api(`/disponibilite?date=${date}`).then(setData).catch((e) => { toast(e.message, 'err'); setData({ items: [], kpis: {} }); }); }, [date]); // eslint-disable-line
  const items = (data?.items || []).filter((x) => !f || x.statut === f);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Disponibilité des véhicules</h1><p className="muted">Qui est libre, en mission, en location, en panne ou sans documents valides à une date donnée</p></div>
        <div className="head-actions"><label className="field" style={{ margin: 0 }}><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" /></label></div></div>
      {!data ? <div className="center"><Spinner /></div> : (
        <>
          <section className="kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>{Object.entries(DISPO).map(([k, [l]]) => <button key={k} className="kpi" style={{ textAlign: 'left', cursor: 'pointer', outline: f === k ? '2px solid var(--brand)' : 'none' }} onClick={() => setF(f === k ? '' : k)}><div className="kpi-label">{l}</div><div className="kpi-value">{data.kpis?.[k] ?? 0}</div></button>)}</section>
          <div className="dispo-grid">
            {items.map((x) => (
              <div key={x.truck._id} className={`dispo-card ${x.statut}`}>
                <strong>{x.truck.immatriculation}</strong><small>{[x.truck.marque, x.truck.modele].filter(Boolean).join(' ')}</small>
                <div style={{ margin: '6px 0' }}><Pill tone={DISPO[x.statut][1]}>{DISPO[x.statut][0]}</Pill></div>
                {x.motif && <small>{x.motif}</small>}{x.client && <small>Client : {x.client}</small>}{x.chauffeur && <small>Chauffeur : {x.chauffeur}</small>}{x.du && <small>{fmtDate(x.du)} → {fmtDate(x.au)}</small>}
              </div>))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============ Calendrier ============ */
export function Calendrier() {
  const toast = useToast();
  const [month, setMonth] = useState(todayStr().slice(0, 7)); const [events, setEvents] = useState(null);
  useEffect(() => { setEvents(null); api(`/calendrier?month=${month}`).then((r) => setEvents(r.events)).catch((e) => { toast(e.message, 'err'); setEvents([]); }); }, [month]); // eslint-disable-line
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1)); const lead = (first.getUTCDay() + 6) % 7; const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  }, [month]);
  const on = (d) => (events || []).filter((e) => e.from <= d && e.to >= d);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Calendrier</h1><p className="muted">Missions et locations du mois, jour par jour</p></div><div className="head-actions"><MonthPicker value={month} onChange={setMonth} /></div></div>
      {!events ? <div className="center"><Spinner /></div> : (
        <div className="card">
          <div className="cal">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div className="dow" key={d}>{d}</div>)}
            {days.map((d, i) => d === null ? <div className="day out" key={`o${i}`} /> : (
              <div className={`day ${d === todayStr() ? 'today' : ''}`} key={d}><b>{Number(d.slice(8))}</b>
                {on(d).slice(0, 4).map((e) => <span key={e.kind + e.id} className={`ev ${e.kind} ${e.statut === 'terminee' ? 'terminee' : ''}`} title={`${e.label} — ${e.detail}${e.truck ? ` — ${e.truck}` : ''}${e.chauffeur ? ` — ${e.chauffeur}` : ''}`}>{e.truck ? `${e.truck} · ` : ''}{e.label}</span>)}
                {on(d).length > 4 && <small className="muted">+{on(d).length - 4} autres</small>}
              </div>))}
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>Bleu : missions · Orange : locations · Vert : terminées. Survolez un événement pour le détail.</p>
        </div>
      )}
    </div>
  );
}

/* ============ Locations ============ */
const LOC_ST = { planifiee: ['Planifiée', 'info'], en_cours: ['En cours', 'warn'], terminee: ['Terminée', 'pos'], annulee: ['Annulée', 'neg'] };
export function Locations() {
  return <CrudPage title="Locations de camions" subtitle="Camions loués à des clients (au jour, à l'heure ou forfait) — les locations terminées alimentent le résultat du camion" endpoint="/locations" addLabel="Nouvelle location" dateFilter rowLock={(r) => !!r.facture}
    defaults={{ mode: 'jour', statut: 'planifiee', tva: 20, dateDebut: todayStr() }}
    filters={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients' }, { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }, { key: 'statut', label: 'Statut', options: Object.entries(LOC_ST).map(([v, [l]]) => [v, l]) }]}
    kpis={(d) => [{ label: 'Locations', value: d.kpis?.nb ?? 0 }, { label: 'Jours', value: n2(d.kpis?.jours) }, { label: 'Heures', value: n2(d.kpis?.heures) }, { label: 'Total HT', value: n2(d.kpis?.ht) }, { label: 'À facturer', value: d.kpis?.nonFacturees ?? 0, tone: d.kpis?.nonFacturees ? 'neg' : '' }]}
    fields={[{ key: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true }, { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks', required: true }, { key: 'chauffeur', label: 'Chauffeur', type: 'ref', ref: 'chauffeurs', empty: '— Aucun —' }, { key: 'statut', label: 'Statut', type: 'select', options: Object.entries(LOC_ST).map(([v, [l]]) => [v, l]) },
      { key: 'dateDebut', label: 'Début', type: 'date', required: true }, { key: 'dateFin', label: 'Fin', type: 'date' }, { key: 'heureDebut', label: 'Heure de début', type: 'time' }, { key: 'heureFin', label: 'Heure de fin', type: 'time' },
      { key: 'mode', label: 'Tarification', type: 'select', options: [['jour', 'Au jour'], ['heure', "À l'heure"], ['forfait', 'Forfait']] }, { key: 'prix', label: 'Prix (HT) par jour / heure / forfait', type: 'money' },
      { key: 'nbJours', label: 'Nombre de jours', type: 'number', hint: 'Vide = calculé depuis les dates' }, { key: 'heures', label: "Nombre d'heures", type: 'number', hint: 'Au jour : 8 h par jour si vide' }, { key: 'tva', label: 'TVA', type: 'number', suffix: '%' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Réf.', render: (r) => <strong>{r.ref}</strong> }, { label: 'Client', render: (r) => r.client?.nom }, { label: 'Camion', render: (r) => r.truck?.immatriculation }, { label: 'Période', render: (r) => `${fmtDate(r.dateDebut)} → ${fmtDate(r.dateFin)}` },
      { label: 'Durée', align: 'r', render: (r) => `${n2(r.nbJours)} j · ${n2(r.heures)} h` }, { label: 'Total HT', align: 'r', render: (r) => n2(r.totalHT) }, { label: 'Statut', render: (r) => <Pill tone={LOC_ST[r.statut]?.[1]}>{LOC_ST[r.statut]?.[0]}</Pill> }, { label: 'Facture', render: (r) => (r.facture ? <Pill tone="pos">{r.facture.numero || 'Brouillon'}</Pill> : '—') }]}
    emptyTitle="Aucune location" />;
}

export function RapportHeures() {
  return <ReportPage title="Rapport des heures de location" subtitle="Heures, jours et montants de location par camion, chauffeur ou client" endpoint="/rapport-heures" dateFrom
    filters={[{ key: 'groupBy', label: 'Regrouper par', default: 'camion', noAll: true, options: [['camion', 'Camion'], ['chauffeur', 'Chauffeur'], ['client', 'Client']] }]}
    kpis={(d) => [{ label: 'Locations', value: d.totaux?.locations ?? 0 }, { label: 'Jours', value: n2(d.totaux?.jours) }, { label: 'Heures', value: n2(d.totaux?.heures) }, { label: 'Montant HT', value: n2(d.totaux?.montantHT) }]}
    columns={[{ label: 'Nom', render: (r) => <strong>{r.nom}</strong> }, { label: 'Locations', align: 'r', render: (r) => r.locations }, { label: 'Jours', align: 'r', render: (r) => n2(r.jours) }, { label: 'Heures', align: 'r', render: (r) => n2(r.heures) }, { label: 'Montant HT', align: 'r', render: (r) => n2(r.montantHT) }, { label: 'Montant TTC', align: 'r', render: (r) => n2(r.montantTTC) }]}
    totalRow={(d) => ['Total', d.totaux.locations, n2(d.totaux.jours), n2(d.totaux.heures), n2(d.totaux.montantHT), '']} />;
}

/* ============ Pannes ============ */
const GRAV = { mineure: ['Mineure', 'info'], majeure: ['Majeure', 'warn'], critique: ['Critique', 'neg'] };
const PST = { ouverte: ['Ouverte', 'neg'], en_cours: ['En cours', 'warn'], resolue: ['Résolue', 'pos'] };
export function Pannes() {
  return <CrudPage title="Pannes & incidents" subtitle="Une panne qui immobilise le camion le rend indisponible jusqu'à sa résolution" endpoint="/pannes" addLabel="Déclarer une panne" dateFilter defaults={{ date: todayStr(), gravite: 'mineure', statut: 'ouverte' }}
    filters={[{ key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }, { key: 'statut', label: 'Statut', options: Object.entries(PST).map(([v, [l]]) => [v, l]) }, { key: 'gravite', label: 'Gravité', options: Object.entries(GRAV).map(([v, [l]]) => [v, l]) }]}
    kpis={(d) => [{ label: 'Pannes', value: d.kpis?.total ?? 0 }, { label: 'Ouvertes', value: d.kpis?.ouvertes ?? 0, tone: d.kpis?.ouvertes ? 'neg' : '' }, { label: 'Camions immobilisés', value: d.kpis?.immobilises ?? 0, tone: d.kpis?.immobilises ? 'neg' : '' }, { label: 'Coût des réparations', value: n2(d.kpis?.cout) }]}
    fields={[{ key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'description', label: 'Description de la panne', required: true, span: 2 }, { key: 'gravite', label: 'Gravité', type: 'select', options: Object.entries(GRAV).map(([v, [l]]) => [v, l]) },
      { key: 'statut', label: 'Statut', type: 'select', options: Object.entries(PST).map(([v, [l]]) => [v, l]) }, { key: 'immobilise', label: 'Immobilisation', type: 'check', checkLabel: 'Le camion est immobilisé', show: (f) => f.statut !== 'resolue' }, { key: 'dateResolution', label: 'Date de résolution', type: 'date', show: (f) => f.statut === 'resolue', hint: "Vide = aujourd'hui" },
      { key: 'cout', label: 'Coût de réparation', type: 'money' }, { key: 'chauffeur', label: 'Chauffeur' }, { key: 'lieu', label: 'Lieu' }, { key: 'observation', label: 'Observation', type: 'textarea' }]}
    columns={[{ label: 'Réf.', render: (r) => <strong>{r.ref}</strong> }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Camion', render: (r) => r.truck?.immatriculation }, { label: 'Description', render: (r) => r.description }, { label: 'Gravité', render: (r) => <Pill tone={GRAV[r.gravite][1]}>{GRAV[r.gravite][0]}</Pill> },
      { label: 'Statut', render: (r) => <span><Pill tone={PST[r.statut][1]}>{PST[r.statut][0]}</Pill>{r.immobilise && r.statut !== 'resolue' && <Pill tone="neg">Immobilisé</Pill>}</span> }, { label: 'Durée', align: 'r', render: (r) => `${r.dureeJours} j` }, { label: 'Coût', align: 'r', render: (r) => n2(r.cout) }]}
    emptyTitle="Aucune panne" />;
}

/* ============ Pièces & stock ============ */
const MVT_FIELDS = [{ key: 'piece', label: 'Pièce', type: 'ref', ref: 'pieces', required: true, span: 2 }, { key: 'type', label: 'Type', type: 'select', options: [['entree', 'Entrée (achat)'], ['sortie', 'Sortie (montage)']] }, { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'qte', label: 'Quantité', type: 'number', required: true }, { key: 'prixUnitaire', label: 'Prix unitaire', type: 'money', hint: 'Vide = prix de la fiche' }, { key: 'truck', label: 'Camion (pour une sortie)', type: 'ref', ref: 'trucks', empty: '— Aucun —' }, { key: 'observation', label: 'Observation' }];
export function Pieces() {
  const toast = useToast(); const [mvt, setMvt] = useState(null);
  return (
    <>
      <CrudPage title="Pièces & stock" subtitle="Pièces détachées, stock en temps réel et seuils d'alerte" endpoint="/pieces" addLabel="Nouvelle pièce" defaults={{ unite: 'u' }} searchPlaceholder="Référence, désignation…"
        filters={[{ key: 'alerte', label: 'Stock', options: [['1', 'Sous le seuil']] }]}
        kpis={(d) => [{ label: 'Références', value: d.kpis?.nb ?? 0 }, { label: 'Sous le seuil', value: d.kpis?.alertes ?? 0, tone: d.kpis?.alertes ? 'neg' : '' }, { label: 'Valeur du stock', value: n2(d.kpis?.valeur) }]}
        fields={[{ key: 'reference', label: 'Référence' }, { key: 'designation', label: 'Désignation', required: true }, { key: 'categorie', label: 'Catégorie' }, { key: 'unite', label: 'Unité' }, { key: 'seuil', label: "Seuil d'alerte", type: 'number' }, { key: 'prixUnitaire', label: 'Prix unitaire', type: 'money' }, { key: 'emplacement', label: 'Emplacement' }, { key: 'actif', label: 'Actif', type: 'check', checkLabel: 'Active' }]}
        columns={[{ label: 'Réf.', render: (r) => r.reference || '—' }, { label: 'Désignation', render: (r) => <strong>{r.designation}</strong> }, { label: 'Catégorie', render: (r) => r.categorie || '—' }, { label: 'Stock', align: 'r', render: (r) => <span className={r.alerte ? 'neg' : ''}><b>{n2(r.stock)}</b> {r.unite}</span> },
          { label: 'Seuil', align: 'r', render: (r) => (r.seuil ? n2(r.seuil) : '—') }, { label: 'Valeur', align: 'r', render: (r) => n2(r.valeur) }, { label: '', render: (r) => (r.alerte ? <Pill tone="neg">Réapprovisionner</Pill> : null) }]}
        rowActions={(r, { reload }) => <button className="icon-btn" title="Mouvement de stock" aria-label="Mouvement de stock" onClick={() => setMvt({ r, reload })}><ArrowDownUp size={16} /></button>} emptyTitle="Aucune pièce" />
      {mvt && <FormModal title={`Mouvement — ${mvt.r.designation}`} fields={MVT_FIELDS} initial={initialFrom(MVT_FIELDS, { piece: mvt.r._id, date: todayStr(), type: 'entree', prixUnitaire: mvt.r.prixUnitaire })} onClose={() => setMvt(null)}
        onSubmit={async (v) => { await api('/mouvements-pieces', { method: 'POST', body: payloadFrom(MVT_FIELDS, v) }); toast('Mouvement enregistré'); mvt.reload(); setMvt(null); }} />}
    </>
  );
}

export function MouvementsPieces() {
  return <CrudPage title="Mouvements de stock" subtitle="Entrées et sorties de pièces — la sortie est refusée si le stock est insuffisant" endpoint="/mouvements-pieces" addLabel="Nouveau mouvement" dateFilter defaults={{ date: todayStr(), type: 'entree' }} fields={MVT_FIELDS}
    filters={[{ key: 'piece', label: 'Pièce', type: 'ref', ref: 'pieces' }, { key: 'type', label: 'Type', options: [['entree', 'Entrées'], ['sortie', 'Sorties']] }, { key: 'truck', label: 'Camion', type: 'ref', ref: 'trucks' }]}
    columns={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Pièce', render: (r) => <strong>{r.piece?.designation}</strong> }, { label: 'Type', render: (r) => <Pill tone={r.type === 'entree' ? 'pos' : 'warn'}>{r.type === 'entree' ? 'Entrée' : 'Sortie'}</Pill> }, { label: 'Quantité', align: 'r', render: (r) => n2(r.qte) },
      { label: 'Prix unitaire', align: 'r', render: (r) => n2(r.prixUnitaire) }, { label: 'Camion', render: (r) => r.truck?.immatriculation || '—' }, { label: 'Observation', render: (r) => r.observation || '—' }]}
    emptyTitle="Aucun mouvement" />;
}
