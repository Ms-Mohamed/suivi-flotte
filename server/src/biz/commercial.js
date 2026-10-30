import { z } from 'zod';
import { requireRole } from '../auth.js';
import { Truck, Operation, getSettings } from '../models.js';
import { PLAN, CODE_VENTES } from '../../../shared/calc.js';
import { calcDoc, calcMission, statutReglement, r2 } from '../../../shared/doc.js';
import { mountCrud } from './crud.js';
import { wrap, plain, who, httpError, isId, today, zDate, zDateOpt, zId, zIdOpt, zMoney, zAmount, zText, zTva, zMode, zLignes, zFrais, oid } from './util.js';
import { Client, Mission, Devis, BonLivraison, Facture, Avoir, Paiement, Caisse, Depense, Employe, SousTraitant, VehiculeST, nextNumber } from './models.js';

export const VAR_CODES = PLAN.charges.find((g) => g.key === 'variables').comptes.map((c) => c.code);
const MISSION_STATUTS = ['brouillon', 'planifiee', 'en_cours', 'terminee', 'annulee'];
const REVENUE_STATUS = ['terminee'];            // une mission compte dans le résultat des camions quand elle est terminée

const tiersBody = z.object({
  nom: z.string().trim().min(1, 'Le nom est obligatoire').max(120), ice: zText(30), if: zText(30), rc: zText(30), adresse: zText(200), ville: zText(60), telephone: zText(40), email: zText(120), contact: zText(80), notes: zText(1000),
  actif: z.boolean().default(true), tvaDefaut: zTva, delaiPaiement: z.number().int().min(0).max(365).default(30),
});

// ---------- Totaux & liens ----------
export const applyTotals = (b) => { const t = calcDoc(b); Object.assign(b, { totalBrutHT: t.totalBrutHT, totalHT: t.totalHT, totalTVA: t.totalTVA, totalTTC: t.totalTTC }); return t; };
const yearOf = (d) => Number((d || today()).slice(0, 4));

/** Recalcule payé / avoirs / reste d'une facture. */
export async function recomputeFacture(id) {
  const f = await Facture.findById(id); if (!f) return null;
  const [pay, av] = await Promise.all([Paiement.find({ facture: id }).lean(), Avoir.find({ facture: id }).lean()]);
  f.paye = r2(pay.reduce((s, p) => s + p.montant, 0)); f.avoirs = r2(av.reduce((s, a) => s + a.totalTTC, 0));
  f.reste = r2(f.totalTTC - f.paye - f.avoirs); await f.save(); return f;
}
const syncCaisse = async (source, refId, { date, sens, libelle, montant, mode }) => {
  await Caisse.deleteMany({ source, refId: String(refId) });
  if (mode === 'especes' && montant > 0) await Caisse.create({ date, sens, libelle, categorie: source, montant, source, refId: String(refId) });
};
export { syncCaisse };

// ---------- Mission → opérations des camions ----------
export async function syncMission(m) {
  await Operation.deleteMany({ 'meta.missionId': String(m._id) });
  if (m.type !== 'interne' || !m.truck || !REVENUE_STATUS.includes(m.statut)) return;
  const date = m.dateMission, month = date.slice(0, 7), voyage = `${m.ref} ${m.villeCharge}${m.villeDecharge ? `–${m.villeDecharge}` : ''}`.trim();
  const base = { truck: m.truck, date, month, voyage, createdBy: 'Mission', kind: 'voyage', meta: { missionId: String(m._id), ref: m.ref }, historique: [{ at: new Date(), par: 'Mission', action: 'creation' }] };
  const docs = [];
  if (m.totalHT > 0) docs.push({ ...base, code: CODE_VENTES, montant: m.totalHT, km: m.distance || 0, note: m.marchandise || '' });
  for (const c of m.charges || []) if (c.montant > 0) docs.push({ ...base, code: c.code, montant: c.montant, km: 0, note: c.note || '' });
  if (docs.length) await Operation.insertMany(docs);
}

// ---------- Mission ----------
const missionBody = z.object({
  type: z.enum(['interne', 'soustraite']).default('interne'), client: zId, numeroBL: zText(40), villeCharge: zText(80), villeDecharge: zText(80),
  dateMission: zDate, dateChargement: zDateOpt, dateDechargement: zDateOpt, marchandise: zText(120), tonnage: zMoney, distance: zMoney,
  mode: z.enum(['tonnage', 'forfait']).default('tonnage'), prixUnitaire: zMoney, prixForfait: zMoney, tva: zTva,
  fraisChargement: zMoney, fraisDechargement: zMoney, fraisImmobilisation: zMoney, statut: z.enum(MISSION_STATUTS).default('planifiee'),
  truck: zIdOpt, remorque: zText(40), chauffeur: zIdOpt, sousTraitant: zIdOpt, vehiculeST: zIdOpt,
  modeST: z.enum(['tonnage', 'forfait']).default('tonnage'), prixUnitaireST: zMoney, coutST: zMoney,
  charges: z.array(z.object({ code: z.string().refine((c) => VAR_CODES.includes(c), 'Compte de charge inconnu'), montant: zAmount, note: zText(200) })).max(20).default([]),
  observation: zText(1000),
}).superRefine((b, ctx) => {
  if (b.type === 'soustraite' && !b.sousTraitant) ctx.addIssue({ code: 'custom', path: ['sousTraitant'], message: 'Choisissez le sous-traitant' });
  if (b.dateChargement && b.dateDechargement && b.dateDechargement < b.dateChargement) ctx.addIssue({ code: 'custom', path: ['dateDechargement'], message: 'Le déchargement précède le chargement' });
});
async function missionPre(b, req, existing) {
  Object.assign(b, calcMission(b), { totalHT: calcMission(b).totalHT, totalTTC: calcMission(b).totalTTC });
  delete b.base; delete b.frais; delete b.totalTVA;
  if (b.type === 'interne') { b.sousTraitant = null; b.vehiculeST = null; b.coutST = 0; }
  else { b.truck = null; b.coutST = b.modeST === 'forfait' ? b.coutST : r2(b.tonnage * b.prixUnitaireST); }
  b.coutTotal = r2(b.coutST + b.charges.reduce((s, c) => s + c.montant, 0));
  if (b.type === 'interne' && b.truck && !(await Truck.exists({ _id: b.truck }))) throw httpError(404, 'Camion introuvable');
  if (!existing) b.ref = await nextNumber('M', yearOf(b.dateMission));
}
const missionPop = [{ path: 'client', select: 'nom ice tvaDefaut' }, { path: 'truck', select: 'immatriculation marque modele' }, { path: 'chauffeur', select: 'nom matricule' },
  { path: 'sousTraitant', select: 'nom' }, { path: 'vehiculeST', select: 'immatriculation' }, { path: 'facture', select: 'numero statut' }];

// ---------- Factures : lignes depuis missions / locations ----------
export function lignesDepuisMission(m) {
  const lignes = [];
  const desig = `${m.ref} — ${[m.villeCharge, m.villeDecharge].filter(Boolean).join(' → ')}${m.numeroBL ? ` (BL ${m.numeroBL})` : ''}${m.marchandise ? ` · ${m.marchandise}` : ''}`;
  const base = calcMission(m).base;
  if (m.mode === 'forfait' || !(m.tonnage > 0)) lignes.push({ designation: desig, qte: 1, pu: base, tva: m.tva, unite: 'forfait', missionId: String(m._id) });
  else lignes.push({ designation: desig, qte: m.tonnage, pu: m.prixUnitaire, tva: m.tva, unite: 't', missionId: String(m._id) });
  for (const [k, l] of [['fraisChargement', 'Frais de chargement'], ['fraisDechargement', 'Frais de déchargement'], ['fraisImmobilisation', "Frais d'immobilisation"]])
    if (m[k] > 0) lignes.push({ designation: `${l} — ${m.ref}`, qte: 1, pu: m[k], tva: m.tva, unite: 'forfait', missionId: String(m._id) });
  return lignes;
}
const factureBody = z.object({
  client: zId, date: zDate, echeance: zDateOpt, dateDepot: zDateOpt, modePaiement: zText(40), prestation: zText(80), nomPdf: zText(80),
  lignes: zLignes, fraisSupp: zFrais, remisePct: z.number().min(0).max(100).default(0), observation: zText(1000),
  missions: z.array(zId).default([]), locations: z.array(zId).default([]),
});
const lockFacture = (d) => (d.statut !== 'brouillon' ? 'Une facture émise ne peut plus être modifiée : créez un avoir pour la corriger' : null);
async function facturePre(b, req, existing) {
  const client = await Client.findById(b.client).lean(); if (!client) throw httpError(404, 'Client introuvable');
  b.clientSnap = { nom: client.nom, ice: client.ice, adresse: client.adresse, ville: client.ville };
  if (!b.echeance) { const d = new Date(`${b.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (client.delaiPaiement ?? 30)); b.echeance = d.toISOString().slice(0, 10); }
  applyTotals(b); b.reste = r2(b.totalTTC - (existing?.paye || 0) - (existing?.avoirs || 0));
  const { Location } = await import('./models.js');
  for (const [Model, ids, label] of [[Mission, b.missions, 'mission'], [Location, b.locations, 'location']]) {
    if (!ids.length) continue;
    const docs = await Model.find({ _id: { $in: ids } }).lean();
    if (docs.length !== ids.length) throw httpError(404, `${label} introuvable`);
    for (const d of docs) {
      if (String(d.client) !== String(b.client)) throw httpError(400, `La ${label} ${d.ref} appartient à un autre client`);
      if (d.facture && String(d.facture) !== String(existing?._id)) throw httpError(409, `La ${label} ${d.ref} est déjà facturée`);
    }
  }
}
async function factureLinks(doc) {
  const { Location } = await import('./models.js');
  await Mission.updateMany({ facture: doc._id }, { $set: { facture: null } }); await Location.updateMany({ facture: doc._id }, { $set: { facture: null } });
  if (doc.statut === 'annulee') return;
  if (doc.missions?.length) await Mission.updateMany({ _id: { $in: doc.missions } }, { $set: { facture: doc._id } });
  if (doc.locations?.length) await Location.updateMany({ _id: { $in: doc.locations } }, { $set: { facture: doc._id } });
}
const regl = (f) => statutReglement({ totalTTC: f.totalTTC, paye: f.paye, avoirs: f.avoirs, echeance: f.statut === 'emise' ? f.echeance : '' });
const factureView = (f) => ({ ...f, reglement: f.statut === 'emise' ? regl(f).statut : f.statut === 'annulee' ? 'annulee' : 'brouillon', reste: f.statut === 'emise' ? regl(f).reste : f.reste });

export function mountCommercial(r) {
  const canWrite = requireRole('saisie');

  // ---------- Tiers ----------
  mountCrud(r, { path: '/clients', Model: Client, body: tiersBody, search: ['nom', 'ice', 'ville', 'telephone', 'email'], sort: { nom: 1 }, filters: ['actif'],
    canDelete: () => null, onDelete: async (d) => { if (await Mission.exists({ client: d._id }) || await Facture.exists({ client: d._id })) throw httpError(409, 'Ce client a des missions ou des factures : désactivez-le plutôt que de le supprimer'); } });

  r.get('/chauffeurs', wrap(async (_req, res) => {
    res.json({ items: (await Employe.find({ statut: 'actif' }).sort({ nom: 1 }).select('nom matricule poste truck').lean()) });
  }));

  // ---------- Missions ----------
  mountCrud(r, { path: '/missions', Model: Mission, body: missionBody, populate: missionPop, sort: { dateMission: -1, createdAt: -1 }, dateField: 'dateMission',
    filters: ['client', 'statut', 'type', 'truck', 'sousTraitant', 'chauffeur'], refFilters: ['client', 'sousTraitant', 'chauffeur'],
    search: ['ref', 'numeroBL', 'villeCharge', 'villeDecharge', 'marchandise', 'client.nom', 'truck.immatriculation', 'sousTraitant.nom', 'observation'],
    query: (q) => (q.facturable === '1' ? { statut: 'terminee', facture: null } : q.nonFacturees === '1' ? { facture: null } : {}),
    pre: missionPre, post: (d) => syncMission(d.toObject()),
    lock: (d) => (d.facture ? 'Mission déjà facturée : annulez ou supprimez la facture pour la modifier' : null),
    canDelete: (d) => (d.facture ? 'Mission facturée : supprimez ou annulez la facture d\'abord' : null),
    onDelete: async (d) => { await Operation.deleteMany({ 'meta.missionId': String(d._id) }); },
    summary: (docs) => {
      const ok = docs.filter((m) => m.statut !== 'annulee' && m.statut !== 'brouillon');
      const by = (s) => docs.filter((m) => m.statut === s).length;
      return { kpis: { total: docs.length, brouillon: by('brouillon'), planifiee: by('planifiee'), en_cours: by('en_cours'), terminee: by('terminee'), annulee: by('annulee'),
        totalHT: r2(ok.reduce((s, m) => s + m.totalHT, 0)), totalTTC: r2(ok.reduce((s, m) => s + m.totalTTC, 0)), tonnage: r2(ok.reduce((s, m) => s + m.tonnage, 0)),
        nonFacturees: docs.filter((m) => m.statut === 'terminee' && !m.facture).length, montantNonFacture: r2(docs.filter((m) => m.statut === 'terminee' && !m.facture).reduce((s, m) => s + m.totalHT, 0)) } };
    } });

  r.post('/missions/:id/bl', canWrite, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const m = await Mission.findById(req.params.id).populate('truck chauffeur').lean();
    if (!m) throw httpError(404, 'Mission introuvable');
    if (await BonLivraison.exists({ mission: m._id })) throw httpError(409, 'Un bon de livraison existe déjà pour cette mission');
    const bl = await BonLivraison.create({ numero: await nextNumber('BL', yearOf(m.dateMission)), client: m.client, mission: m._id, date: m.dateDechargement || m.dateMission, lieuLivraison: m.villeDecharge,
      camion: m.truck?.immatriculation || '', chauffeur: m.chauffeur?.nom || '', lignes: [{ designation: m.marchandise || `Marchandise ${m.ref}`, qte: m.tonnage || 1, unite: m.tonnage ? 't' : 'u', pu: 0, tva: 0 }] });
    res.status(201).json(plain(bl));
  }));

  // ---------- Rentabilité ----------
  r.get('/rentabilite', wrap(async (req, res) => {
    const from = req.query.from || `${today().slice(0, 4)}-01-01`, to = req.query.to || today();
    const [missions, ops, trucks, clients] = await Promise.all([
      Mission.find({ dateMission: { $gte: from, $lte: to }, statut: { $nin: ['brouillon', 'annulee'] } }).populate('client', 'nom').populate('truck', 'immatriculation').populate('sousTraitant', 'nom').lean(),
      Operation.find({ date: { $gte: from, $lte: to }, supprime: { $ne: true } }).lean(), Truck.find({}).lean(), Client.find({}).lean() ]);
    const done = missions.filter((m) => REVENUE_STATUS.includes(m.statut));
    const parMission = missions.map((m) => { const rev = REVENUE_STATUS.includes(m.statut) ? m.totalHT : 0; const cout = REVENUE_STATUS.includes(m.statut) ? m.coutTotal : 0;
      return { id: String(m._id), ref: m.ref, date: m.dateMission, client: m.client?.nom || '—', type: m.type, truck: m.truck?.immatriculation || m.sousTraitant?.nom || '—', statut: m.statut, revenu: r2(rev), cout: r2(cout), marge: r2(rev - cout), taux: rev ? r2(((rev - cout) / rev) * 100) : 0, montantPrevu: m.totalHT }; });
    const cl = new Map();
    for (const m of done) { const k = String(m.client?._id); const c = cl.get(k) || { client: m.client?.nom || '—', missions: 0, revenu: 0, cout: 0 }; c.missions++; c.revenu += m.totalHT; c.cout += m.coutTotal; cl.set(k, c); }
    const tk = new Map(trucks.map((t) => [String(t._id), { id: String(t._id), immatriculation: t.immatriculation, produits: 0, charges: 0, gasoil: 0, maintenance: 0, km: 0, missions: 0 }]));
    const prod = new Set(PLAN.produits.map((p) => p.code));
    let gasoil = 0, maintenance = 0;
    for (const o of ops) { const t = tk.get(String(o.truck)); if (!t) continue;
      if (prod.has(o.code)) t.produits += o.montant; else t.charges += o.montant;
      if (o.kind === 'plein') { t.gasoil += o.montant; gasoil += o.montant; } if (o.kind === 'entretien') { t.maintenance += o.montant; maintenance += o.montant; } t.km += o.km || 0; }
    for (const m of done) { const t = tk.get(String(m.truck?._id)); if (t) t.missions++; }
    const sum = (a, k) => r2(a.reduce((s, x) => s + x[k], 0));
    const revenu = sum(parMission, 'revenu'), coutMissions = sum(parMission, 'cout');
    res.json({ from, to,
      kpis: { revenu, coutMissions, gasoil: r2(gasoil), maintenance: r2(maintenance), profit: r2(revenu - coutMissions - gasoil - maintenance), taux: revenu ? r2(((revenu - coutMissions - gasoil - maintenance) / revenu) * 100) : 0,
        nbMissions: done.length, enCours: missions.filter((m) => m.statut === 'en_cours').length, planifiees: missions.filter((m) => m.statut === 'planifiee').length, perte: parMission.filter((m) => m.marge < 0 && m.revenu > 0).length },
      parMission: parMission.sort((a, b) => a.marge - b.marge),
      parClient: [...cl.values()].map((c) => ({ ...c, revenu: r2(c.revenu), cout: r2(c.cout), marge: r2(c.revenu - c.cout), taux: c.revenu ? r2(((c.revenu - c.cout) / c.revenu) * 100) : 0 })).sort((a, b) => b.revenu - a.revenu),
      parVehicule: [...tk.values()].filter((t) => t.produits || t.charges).map((t) => ({ ...t, produits: r2(t.produits), charges: r2(t.charges), net: r2(t.produits - t.charges), taux: t.produits ? r2(((t.produits - t.charges) / t.produits) * 100) : 0 })).sort((a, b) => a.net - b.net) });
  }));

  // ---------- Devis ----------
  const devisBody = z.object({ client: zId, date: zDate, validite: zDateOpt, statut: z.enum(['brouillon', 'envoye', 'accepte', 'refuse']).default('brouillon'),
    lignes: zLignes, fraisSupp: zFrais, remisePct: z.number().min(0).max(100).default(0), observation: zText(1000) });
  mountCrud(r, { path: '/devis', Model: Devis, body: devisBody, populate: [{ path: 'client', select: 'nom ice adresse ville' }, { path: 'facture', select: 'numero' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['client', 'statut'], refFilters: ['client'],
    search: ['numero', 'client.nom', 'observation'], lock: (d) => (d.statut === 'converti' ? 'Devis déjà converti en facture' : null),
    pre: async (b, req, ex) => { applyTotals(b); if (!ex) b.numero = await nextNumber('D', yearOf(b.date)); },
    summary: (docs) => ({ kpis: { total: docs.length, ttc: r2(docs.filter((d) => d.statut !== 'refuse').reduce((s, d) => s + d.totalTTC, 0)), acceptes: docs.filter((d) => d.statut === 'accepte').length } }) });
  r.post('/devis/:id/convertir', canWrite, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const d = await Devis.findById(req.params.id); if (!d) throw httpError(404, 'Devis introuvable');
    if (d.statut === 'converti') throw httpError(409, 'Devis déjà converti');
    const b = factureBody.parse({ client: String(d.client), date: today(), lignes: d.lignes.map((l) => l.toObject ? l.toObject() : l), fraisSupp: d.fraisSupp.map((l) => l.toObject ? l.toObject() : l), remisePct: d.remisePct, observation: `Devis ${d.numero}` });
    await facturePre(b, req, null);
    const f = await Facture.create(b); d.statut = 'converti'; d.facture = f._id; await d.save();
    res.status(201).json(plain(f));
  }));

  // ---------- Bons de livraison ----------
  const blBody = z.object({ client: zId, mission: zIdOpt, date: zDate, lieuLivraison: zText(120), camion: zText(40), chauffeur: zText(80), statut: z.enum(['emis', 'livre', 'signe']).default('emis'),
    lignes: z.array(z.object({ designation: z.string().trim().min(1).max(300), qte: z.number().min(0).default(1), unite: zText(20), pu: zMoney, tva: zTva })).max(100).default([]), observation: zText(500) });
  mountCrud(r, { path: '/bons-livraison', Model: BonLivraison, body: blBody, populate: [{ path: 'client', select: 'nom ice adresse' }, { path: 'mission', select: 'ref villeCharge villeDecharge' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['client', 'statut'], refFilters: ['client'],
    search: ['numero', 'client.nom', 'camion', 'chauffeur', 'lieuLivraison'], pre: async (b, req, ex) => { if (!ex) b.numero = await nextNumber('BL', yearOf(b.date)); } });

  // ---------- Factures ----------
  mountCrud(r, { path: '/factures', Model: Facture, body: factureBody, populate: [{ path: 'client', select: 'nom ice adresse ville email' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['client', 'statut'], refFilters: ['client'],
    search: ['numero', 'client.nom', 'prestation', 'observation'], view: factureView, lock: lockFacture,
    postFilter: (docs, q) => (q.reglement ? docs.filter((f) => factureView(f).reglement === q.reglement) : docs),
    pre: facturePre, post: factureLinks,
    canDelete: (d) => (d.statut !== 'brouillon' ? 'Seul un brouillon peut être supprimé : annulez la facture émise' : null),
    onDelete: async (d) => { await Mission.updateMany({ facture: d._id }, { $set: { facture: null } }); const { Location } = await import('./models.js'); await Location.updateMany({ facture: d._id }, { $set: { facture: null } }); },
    summary: (docs) => { const em = docs.filter((f) => f.statut === 'emise').map(factureView);
      return { kpis: { nb: docs.length, brouillons: docs.filter((f) => f.statut === 'brouillon').length, ttc: r2(em.reduce((s, f) => s + f.totalTTC, 0)), ht: r2(em.reduce((s, f) => s + f.totalHT, 0)), paye: r2(em.reduce((s, f) => s + f.paye, 0)), reste: r2(em.reduce((s, f) => s + f.reste, 0)),
        impayees: em.filter((f) => f.reglement !== 'payee').length, enRetard: em.filter((f) => f.reglement === 'en_retard').length } }; } });

  r.post('/factures/depuis-missions', canWrite, wrap(async (req, res) => {
    const b = z.object({ client: zId, missionIds: z.array(zId).default([]), locationIds: z.array(zId).default([]), date: zDate.default(today()), echeance: zDateOpt, modePaiement: zText(40),
      regrouper: z.boolean().default(false) }).parse(req.body);
    if (!b.missionIds.length && !b.locationIds.length) throw httpError(400, 'Sélectionnez au moins une mission ou une location');
    const { Location } = await import('./models.js');
    const missions = await Mission.find({ _id: { $in: b.missionIds } }).populate('truck', 'immatriculation').lean();
    const locations = await Location.find({ _id: { $in: b.locationIds } }).populate('truck', 'immatriculation').lean();
    if (missions.some((m) => m.statut !== 'terminee')) throw httpError(400, 'Seules les missions terminées peuvent être facturées');
    let lignes = missions.flatMap(lignesDepuisMission);
    for (const l of locations) lignes.push({ designation: `Location ${l.truck?.immatriculation || ''} — ${l.ref} du ${l.dateDebut} au ${l.dateFin || l.dateDebut}`, qte: 1, pu: l.totalHT, tva: l.tva, unite: 'forfait', locationId: String(l._id) });
    if (b.regrouper) { const tot = lignes.reduce((s, l) => s + l.qte * l.pu, 0); lignes = [{ designation: `Prestations de transport (${missions.map((m) => m.ref).join(', ')})`, qte: 1, pu: r2(tot), tva: lignes[0]?.tva ?? 20, unite: 'forfait' }]; }
    const body = factureBody.parse({ client: b.client, date: b.date, echeance: b.echeance, modePaiement: b.modePaiement, lignes, missions: b.missionIds, locations: b.locationIds });
    await facturePre(body, req, null);
    const f = await Facture.create(body); await factureLinks(f);
    res.status(201).json(plain(f));
  }));

  r.post('/factures/:id/emettre', canWrite, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const f = await Facture.findById(req.params.id); if (!f) throw httpError(404, 'Facture introuvable');
    if (f.statut !== 'brouillon') throw httpError(409, 'Facture déjà émise');
    if (!f.lignes.length || !(f.totalTTC > 0)) throw httpError(400, 'Une facture doit avoir au moins une ligne avec un montant');
    f.numero = await nextNumber('F', yearOf(f.date)); f.statut = 'emise'; f.reste = r2(f.totalTTC - f.paye - f.avoirs); await f.save();
    res.json(factureView(plain(f)));
  }));
  r.post('/factures/:id/annuler', canWrite, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const f = await Facture.findById(req.params.id); if (!f) throw httpError(404, 'Facture introuvable');
    if (f.statut !== 'emise') throw httpError(409, 'Seule une facture émise peut être annulée');
    if (f.paye > 0) throw httpError(409, 'Cette facture a des paiements : supprimez-les d\'abord');
    f.statut = 'annulee'; await f.save(); await factureLinks(f);
    res.json(factureView(plain(f)));
  }));

  // Relevé des règlements clients
  r.get('/releve-reglements', wrap(async (req, res) => {
    const q = { statut: 'emise' }; if (req.query.client) { if (!isId(req.query.client)) throw httpError(400, 'Client invalide'); q.client = req.query.client; }
    if (req.query.from || req.query.to) { q.date = {}; if (req.query.from) q.date.$gte = req.query.from; if (req.query.to) q.date.$lte = req.query.to; }
    let list = (await Facture.find(q).populate('client', 'nom').sort({ date: -1 }).lean()).map(factureView);
    if (req.query.statut) list = list.filter((f) => f.reglement === req.query.statut);
    const pay = await Paiement.find({ facture: { $in: list.map((f) => f._id) } }).sort({ date: -1 }).lean(); const last = new Map(); for (const p of pay) if (!last.has(String(p.facture))) last.set(String(p.facture), p);
    const items = list.map((f) => ({ id: String(f._id), numero: f.numero, date: f.date, echeance: f.echeance, client: f.client?.nom || '', ttc: f.totalTTC, paye: f.paye, avoirs: f.avoirs, reste: f.reste, reglement: f.reglement, dernierPaiement: last.get(String(f._id))?.date || '', mode: last.get(String(f._id))?.mode || '', reference: last.get(String(f._id))?.reference || '' }));
    const s = (k) => r2(items.reduce((a, x) => a + x[k], 0));
    res.json({ items, totaux: { facture: s('ttc'), paye: s('paye'), avoirs: s('avoirs'), reste: s('reste'), nonPayees: items.filter((x) => x.reglement === 'impayee' || x.reglement === 'en_retard').length, partielles: items.filter((x) => x.reglement === 'partielle').length, payees: items.filter((x) => x.reglement === 'payee').length } });
  }));

  // ---------- Avoirs ----------
  const avoirBody = z.object({ facture: zId, date: zDate, motif: zText(300), lignes: zLignes, fraisSupp: zFrais, remisePct: z.number().min(0).max(100).default(0), observation: zText(500) });
  mountCrud(r, { path: '/avoirs', Model: Avoir, body: avoirBody, populate: [{ path: 'client', select: 'nom ice adresse ville' }, { path: 'facture', select: 'numero totalTTC' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['client', 'facture'], refFilters: ['client', 'facture'],
    search: ['numero', 'client.nom', 'facture.numero', 'motif'],
    pre: async (b, req, ex) => {
      const f = await Facture.findById(b.facture).lean(); if (!f) throw httpError(404, 'Facture introuvable'); if (f.statut !== 'emise') throw httpError(409, 'Un avoir se rattache à une facture émise');
      const t = applyTotals(b); if (t.totalTTC <= 0) throw httpError(400, "Le montant de l'avoir doit être supérieur à 0");
      const others = (await Avoir.find({ facture: b.facture, ...(ex ? { _id: { $ne: ex._id } } : {}) }).lean()).reduce((s, a) => s + a.totalTTC, 0);
      if (others + t.totalTTC > f.totalTTC + 0.005) throw httpError(400, `Les avoirs dépassent le montant de la facture (${r2(f.totalTTC - others)} DHS maximum)`);
      b.client = f.client; if (!ex) b.numero = await nextNumber('AV', yearOf(b.date));
    }, post: (d) => recomputeFacture(d.facture), afterDelete: (d) => recomputeFacture(d.facture),
    summary: (docs) => ({ kpis: { nb: docs.length, ttc: r2(docs.reduce((s, a) => s + a.totalTTC, 0)) } }) });

  // ---------- Paiements clients ----------
  const paiementBody = z.object({ facture: zId, date: zDate, montant: zAmount, mode: zMode, reference: zText(60), observation: zText(300) });
  mountCrud(r, { path: '/paiements', Model: Paiement, body: paiementBody, populate: [{ path: 'client', select: 'nom' }, { path: 'facture', select: 'numero totalTTC' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['client', 'facture', 'mode'], refFilters: ['client', 'facture'],
    search: ['reference', 'client.nom', 'facture.numero', 'observation'],
    pre: async (b, req, ex) => {
      const f = await recomputeFacture(b.facture); if (!f) throw httpError(404, 'Facture introuvable'); if (f.statut !== 'emise') throw httpError(409, 'Seule une facture émise peut être réglée');
      const reste = f.reste + (ex && String(ex.facture) === String(b.facture) ? ex.montant : 0);
      if (b.montant > reste + 0.005) throw httpError(400, `Le paiement dépasse le reste à payer (${r2(reste)} DHS)`);
      b.client = f.client;
    },
    post: async (d, req, before) => { const f = await recomputeFacture(d.facture); if (before && String(before.facture) !== String(d.facture)) await recomputeFacture(before.facture);
      await syncCaisse('paiement_client', d._id, { date: d.date, sens: 'entree', libelle: `Règlement ${f?.numero || ''}`, montant: d.montant, mode: d.mode }); },
    onDelete: (d) => Caisse.deleteMany({ source: 'paiement_client', refId: String(d._id) }), afterDelete: (d) => recomputeFacture(d.facture),
    summary: (docs) => ({ kpis: { nb: docs.length, total: r2(docs.reduce((s, p) => s + p.montant, 0)) } }) });

  // ---------- Caisse & dépenses ----------
  const caisseBody = z.object({ date: zDate, sens: z.enum(['entree', 'sortie']), libelle: z.string().trim().min(1).max(200), categorie: zText(60), montant: zAmount, observation: zText(300) });
  mountCrud(r, { path: '/caisse', Model: Caisse, body: caisseBody, sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['sens', 'source'], search: ['libelle', 'categorie', 'observation'],
    lock: (d) => (d.source !== 'manuel' ? 'Mouvement généré automatiquement : modifiez le paiement ou la dépense d\'origine' : null),
    canDelete: (d) => (d.source !== 'manuel' ? 'Mouvement généré automatiquement : supprimez le paiement ou la dépense d\'origine' : null),
    pre: (b, req, ex) => { if (!ex) b.source = 'manuel'; },
    summary: async (docs) => { const all = await Caisse.find({}).lean(); const s = (a, k) => r2(a.filter((x) => x.sens === k).reduce((t, x) => t + x.montant, 0));
      return { kpis: { entrees: s(docs, 'entree'), sorties: s(docs, 'sortie'), solde: r2(s(all, 'entree') - s(all, 'sortie')) } }; } });

  const depenseBody = z.object({ date: zDate, categorie: z.string().trim().min(1, 'Catégorie obligatoire').max(60), libelle: z.string().trim().min(1, 'Libellé obligatoire').max(200), montant: zAmount, fournisseur: zIdOpt, truck: zIdOpt, mode: zMode.default('especes'), reference: zText(60), observation: zText(300) });
  mountCrud(r, { path: '/depenses', Model: Depense, body: depenseBody, populate: [{ path: 'fournisseur', select: 'nom' }, { path: 'truck', select: 'immatriculation' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['categorie', 'truck', 'fournisseur', 'mode'], refFilters: ['fournisseur'],
    search: ['libelle', 'categorie', 'reference', 'fournisseur.nom', 'truck.immatriculation'],
    post: (d) => syncCaisse('depense', d._id, { date: d.date, sens: 'sortie', libelle: d.libelle, montant: d.montant, mode: d.mode }), onDelete: (d) => Caisse.deleteMany({ source: 'depense', refId: String(d._id) }),
    summary: (docs) => { const m = new Map(); for (const d of docs) m.set(d.categorie, (m.get(d.categorie) || 0) + d.montant);
      return { kpis: { total: r2(docs.reduce((s, d) => s + d.montant, 0)), nb: docs.length }, parCategorie: [...m].map(([categorie, montant]) => ({ categorie, montant: r2(montant) })).sort((a, b) => b.montant - a.montant) }; } });
}
