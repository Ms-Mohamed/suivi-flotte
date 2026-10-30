import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { Truck, Operation } from '../models.js';
import { r2 } from '../../../shared/doc.js';
import { mountCrud } from './crud.js';
import { wrap, plain, who, httpError, isId, today, zDate, zDateOpt, zId, zIdOpt, zMoney, zAmount, zText, zTva } from './util.js';
import { DocumentVehicule, Mission, Location, Panne, Piece, MouvementPiece, Client, Employe, PrimeRetenue, Bulletin, nextNumber } from './models.js';
import { validDate, addDays } from '../ops.js';

export const DOC_TYPES = { carte_grise: 'Carte grise', assurance: 'Assurance', vignette: 'Vignette', visite_technique: 'Visite technique', carte_autorisation: "Carte d'autorisation", permis: 'Permis / agrément', autre: 'Autre' };
export const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');
const EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
export const docStatut = (d, t = today()) => {
  if (!d.dateExpiration) return { jours: null, statut: 'sans_date' };
  const j = daysBetween(t, d.dateExpiration);
  return { jours: j, statut: j < 0 ? 'expire' : j <= 7 ? 'j7' : j <= 15 ? 'j15' : j <= 30 ? 'j30' : 'valide' };
};
/** Un document renouvelé masque les anciens de même type : on garde le plus récent par (camion, type). */
const latestDocs = (docs) => { const m = new Map(); for (const d of docs) { const k = `${d.truck?._id || d.truck}|${d.type}`; const c = m.get(k); if (!c || (d.dateExpiration || '') > (c.dateExpiration || '')) m.set(k, d); } return [...m.values()]; };
const truckPop = { path: 'truck', select: 'immatriculation marque modele chauffeur actif' };

const enumerate = (from, to) => { const out = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
const inclusiveDays = (a, b) => (a && b && b >= a ? daysBetween(a, b) + 1 : 1);

export async function syncLocation(l) {
  await Operation.deleteMany({ 'meta.locationId': String(l._id) });
  if (l.statut !== 'terminee' || !(l.totalHT > 0)) return;
  await Operation.create({ truck: l.truck, date: l.dateDebut, month: l.dateDebut.slice(0, 7), code: '71880000', montant: l.totalHT, km: 0, voyage: `${l.ref} Location`, note: 'Location de camion', createdBy: 'Location', kind: 'voyage',
    meta: { locationId: String(l._id), ref: l.ref }, historique: [{ at: new Date(), par: 'Location', action: 'creation' }] });
}

export function mountFleetExtra(r) {
  const canWrite = requireRole('saisie');
  const raw = express.raw({ type: 'application/octet-stream', limit: '10mb' });

  // ---------- Documents véhicules ----------
  const docBody = z.object({ truck: zId, type: z.string().refine((t) => DOC_TYPES[t], 'Type de document inconnu'), numero: zText(60), dateEmission: zDateOpt, dateExpiration: zDateOpt, observation: zText(500) })
    .superRefine((b, ctx) => { if (b.dateEmission && b.dateExpiration && b.dateExpiration < b.dateEmission) ctx.addIssue({ code: 'custom', path: ['dateExpiration'], message: "L'expiration précède l'émission" }); });
  const rmFile = async (d) => { if (d.fichier?.chemin) await fs.unlink(path.join(uploadDir(), d.fichier.chemin)).catch(() => {}); };
  mountCrud(r, { path: '/documents-vehicules', Model: DocumentVehicule, body: docBody, populate: [truckPop], sort: { dateExpiration: 1 }, filters: ['truck', 'type'],
    search: ['numero', 'type', 'truck.immatriculation', 'observation'],
    view: (d) => ({ ...d, ...docStatut(d), typeLabel: DOC_TYPES[d.type] || d.type, aFichier: !!d.fichier?.chemin }),
    postFilter: (docs, q) => (q.statut ? docs.filter((d) => (q.statut === 'alerte' ? ['expire', 'j7', 'j15', 'j30'].includes(docStatut(d).statut) : docStatut(d).statut === q.statut)) : docs),
    onDelete: rmFile,
    summary: (docs) => { const c = { expire: 0, j7: 0, j15: 0, j30: 0, valide: 0 }; for (const d of docs) { const s = docStatut(d).statut; if (c[s] !== undefined) c[s]++; } return { kpis: { total: docs.length, ...c } }; } });

  r.post('/documents-vehicules/:id/fichier', canWrite, raw, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const d = await DocumentVehicule.findById(req.params.id); if (!d) throw httpError(404, 'Document introuvable');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'Fichier vide');
    const nom = decodeURIComponent(String(req.headers['x-filename'] || 'document')).replace(/[^\w.\- ]+/g, '_').slice(-80);
    const ext = (nom.split('.').pop() || '').toLowerCase();
    if (!EXT_MIME[ext]) throw httpError(400, 'Format non accepté (PDF, JPG, PNG ou WEBP)');
    const head = req.body.subarray(0, 4).toString('latin1');
    const ok = (ext === 'pdf' && head.startsWith('%PDF')) || (['jpg', 'jpeg'].includes(ext) && req.body[0] === 0xff && req.body[1] === 0xd8) || (ext === 'png' && head.startsWith('\x89PNG')) || (ext === 'webp' && head === 'RIFF');
    if (!ok) throw httpError(400, 'Le contenu du fichier ne correspond pas à son format');
    await fs.mkdir(uploadDir(), { recursive: true }); await rmFile(d);
    const chemin = `${d._id}-${Date.now()}.${ext}`; await fs.writeFile(path.join(uploadDir(), chemin), req.body);
    d.fichier = { nom, mime: EXT_MIME[ext], taille: req.body.length, chemin }; await d.save();
    res.json({ ok: true, fichier: { nom, taille: req.body.length } });
  }));
  r.get('/documents-vehicules/:id/fichier', wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const d = await DocumentVehicule.findById(req.params.id).lean(); if (!d?.fichier?.chemin) throw httpError(404, 'Aucun fichier');
    const file = path.join(uploadDir(), path.basename(d.fichier.chemin));
    res.setHeader('Content-Type', d.fichier.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Disposition', `inline; filename="${d.fichier.nom.replace(/"/g, '')}"`);
    res.send(await fs.readFile(file).catch(() => { throw httpError(404, 'Fichier introuvable sur le serveur'); }));
  }));
  r.delete('/documents-vehicules/:id/fichier', canWrite, wrap(async (req, res) => {
    const d = await DocumentVehicule.findById(req.params.id); if (!d) throw httpError(404, 'Document introuvable');
    await rmFile(d); d.fichier = { nom: '', mime: '', taille: 0, chemin: '' }; await d.save(); res.json({ ok: true });
  }));

  // ---------- Alertes véhicules ----------
  r.get('/alertes-vehicules', wrap(async (_req, res) => {
    const docs = latestDocs(await DocumentVehicule.find({ dateExpiration: { $ne: '' } }).populate(truckPop).lean()).filter((d) => d.truck?.actif !== false);
    const rows = docs.map((d) => ({ id: String(d._id), truck: d.truck, type: d.type, typeLabel: DOC_TYPES[d.type] || d.type, numero: d.numero, dateExpiration: d.dateExpiration, ...docStatut(d) })).filter((x) => ['expire', 'j7', 'j15', 'j30'].includes(x.statut)).sort((a, b) => a.jours - b.jours);
    const c = (s) => rows.filter((x) => x.statut === s).length;
    res.json({ kpis: { expire: c('expire'), j7: c('j7'), j15: c('j15'), j30: c('j30'), total: rows.length }, items: rows });
  }));

  // ---------- Disponibilité ----------
  r.get('/disponibilite', wrap(async (req, res) => {
    const date = req.query.date || today(); if (!validDate(date)) throw httpError(400, 'Date invalide');
    const [trucks, docs, missions, locs, pannes] = await Promise.all([
      Truck.find({ actif: true }).sort({ immatriculation: 1 }).lean(), DocumentVehicule.find({}).lean(),
      Mission.find({ statut: { $in: ['planifiee', 'en_cours'] }, truck: { $ne: null } }).populate('client', 'nom').populate('chauffeur', 'nom').lean(),
      Location.find({ statut: { $in: ['planifiee', 'en_cours'] } }).populate('client', 'nom').populate('chauffeur', 'nom').lean(), Panne.find({ statut: { $ne: 'resolue' }, immobilise: true }).lean() ]);
    const latest = latestDocs(docs);
    const items = trucks.map((t) => {
      const id = String(t._id);
      const expired = latest.filter((d) => String(d.truck) === id && docStatut(d, date).statut === 'expire').map((d) => DOC_TYPES[d.type] || d.type);
      const panne = pannes.find((p) => String(p.truck) === id);
      const m = missions.find((x) => String(x.truck) === id && (x.dateChargement || x.dateMission) <= date && (x.dateDechargement || x.dateMission) >= date);
      const l = locs.find((x) => String(x.truck) === id && x.dateDebut <= date && (x.dateFin || x.dateDebut) >= date);
      let statut = 'disponible', motif = '', ref = '', client = '', chauffeur = '', du = '', au = '';
      if (panne) { statut = 'maintenance'; motif = `Panne : ${panne.description}`; }
      else if (expired.length) { statut = 'indisponible'; motif = `Documents expirés : ${expired.join(', ')}`; }
      else if (m) { statut = 'mission'; motif = `${m.villeCharge} → ${m.villeDecharge}`; ref = m.ref; client = m.client?.nom || ''; chauffeur = m.chauffeur?.nom || ''; du = m.dateChargement || m.dateMission; au = m.dateDechargement || m.dateMission; }
      else if (l) { statut = 'location'; motif = 'Location'; ref = l.ref; client = l.client?.nom || ''; chauffeur = l.chauffeur?.nom || ''; du = l.dateDebut; au = l.dateFin || l.dateDebut; }
      return { truck: { _id: id, immatriculation: t.immatriculation, marque: t.marque, modele: t.modele, type: t.type }, statut, motif, ref, client, chauffeur, du, au };
    });
    const c = (s) => items.filter((x) => x.statut === s).length;
    res.json({ date, kpis: { disponible: c('disponible'), mission: c('mission'), location: c('location'), maintenance: c('maintenance'), indisponible: c('indisponible'), total: items.length }, items });
  }));

  // ---------- Locations de camions ----------
  const locBody = z.object({ client: zId, truck: zId, chauffeur: zIdOpt, dateDebut: zDate, dateFin: zDateOpt, heureDebut: zText(5), heureFin: zText(5), mode: z.enum(['jour', 'heure', 'forfait']).default('jour'),
    nbJours: zMoney, heures: zMoney, prix: zMoney, tva: zTva, statut: z.enum(['planifiee', 'en_cours', 'terminee', 'annulee']).default('planifiee'), observation: zText(500) })
    .superRefine((b, ctx) => { if (b.dateFin && b.dateFin < b.dateDebut) ctx.addIssue({ code: 'custom', path: ['dateFin'], message: 'La fin précède le début' }); });
  mountCrud(r, { path: '/locations', Model: Location, body: locBody, populate: [{ path: 'client', select: 'nom' }, truckPop, { path: 'chauffeur', select: 'nom' }, { path: 'facture', select: 'numero' }], sort: { dateDebut: -1 }, dateField: 'dateDebut',
    filters: ['client', 'truck', 'statut', 'chauffeur'], refFilters: ['client', 'chauffeur'], search: ['ref', 'client.nom', 'truck.immatriculation', 'chauffeur.nom', 'observation'],
    lock: (d) => (d.facture ? 'Location déjà facturée' : null), canDelete: (d) => (d.facture ? 'Location facturée' : null), onDelete: (d) => Operation.deleteMany({ 'meta.locationId': String(d._id) }),
    pre: async (b, req, ex) => {
      if (!(await Truck.exists({ _id: b.truck }))) throw httpError(404, 'Camion introuvable');
      if (!b.dateFin) b.dateFin = b.dateDebut;
      if (b.mode === 'jour') { if (!b.nbJours) b.nbJours = inclusiveDays(b.dateDebut, b.dateFin); if (!b.heures) b.heures = b.nbJours * 8; b.totalHT = r2(b.nbJours * b.prix); }
      else if (b.mode === 'heure') { b.totalHT = r2(b.heures * b.prix); if (!b.nbJours) b.nbJours = inclusiveDays(b.dateDebut, b.dateFin); }
      else { b.totalHT = r2(b.prix); if (!b.nbJours) b.nbJours = inclusiveDays(b.dateDebut, b.dateFin); }
      b.totalTTC = r2(b.totalHT * (1 + b.tva / 100));
      if (b.statut !== 'annulee') {
        const clash = await Location.findOne({ truck: b.truck, statut: { $ne: 'annulee' }, dateDebut: { $lte: b.dateFin }, dateFin: { $gte: b.dateDebut }, ...(ex ? { _id: { $ne: ex._id } } : {}) }).lean();
        if (clash) throw httpError(409, `Ce camion est déjà loué du ${clash.dateDebut} au ${clash.dateFin} (${clash.ref})`);
      }
      if (!ex) b.ref = await nextNumber('L', Number(b.dateDebut.slice(0, 4)));
    }, post: (d) => syncLocation(d.toObject()),
    summary: (docs) => { const ok = docs.filter((l) => l.statut !== 'annulee'); return { kpis: { nb: docs.length, heures: r2(ok.reduce((s, l) => s + l.heures, 0)), jours: r2(ok.reduce((s, l) => s + l.nbJours, 0)), ht: r2(ok.reduce((s, l) => s + l.totalHT, 0)), nonFacturees: ok.filter((l) => l.statut === 'terminee' && !l.facture).length } }; } });

  r.get('/rapport-heures', wrap(async (req, res) => {
    const from = req.query.from || `${today().slice(0, 4)}-01-01`, to = req.query.to || today(); const by = ['camion', 'chauffeur', 'client'].includes(req.query.groupBy) ? req.query.groupBy : 'camion';
    const locs = await Location.find({ dateDebut: { $gte: from, $lte: to }, statut: { $ne: 'annulee' } }).populate('client', 'nom').populate('truck', 'immatriculation').populate('chauffeur', 'nom').lean();
    const m = new Map();
    for (const l of locs) { const name = by === 'camion' ? l.truck?.immatriculation : by === 'chauffeur' ? l.chauffeur?.nom || 'Sans chauffeur' : l.client?.nom; const c = m.get(name) || { nom: name || '—', locations: 0, jours: 0, heures: 0, montantHT: 0, montantTTC: 0 };
      c.locations++; c.jours += l.nbJours; c.heures += l.heures; c.montantHT += l.totalHT; c.montantTTC += l.totalTTC; m.set(name, c); }
    const items = [...m.values()].map((c) => ({ ...c, jours: r2(c.jours), heures: r2(c.heures), montantHT: r2(c.montantHT), montantTTC: r2(c.montantTTC) })).sort((a, b) => b.heures - a.heures);
    res.json({ from, to, groupBy: by, items, totaux: { locations: items.reduce((s, x) => s + x.locations, 0), heures: r2(items.reduce((s, x) => s + x.heures, 0)), jours: r2(items.reduce((s, x) => s + x.jours, 0)), montantHT: r2(items.reduce((s, x) => s + x.montantHT, 0)) } });
  }));

  // ---------- Calendrier ----------
  r.get('/calendrier', wrap(async (req, res) => {
    const month = req.query.month || today().slice(0, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, 'Mois invalide');
    const from = `${month}-01`, to = `${month}-31`;
    const [missions, locs] = await Promise.all([
      Mission.find({ statut: { $nin: ['annulee', 'brouillon'] } }).populate('client', 'nom').populate(truckPop).populate('chauffeur', 'nom').populate('sousTraitant', 'nom').lean(),
      Location.find({ statut: { $ne: 'annulee' } }).populate('client', 'nom').populate(truckPop).populate('chauffeur', 'nom').lean() ]);
    const events = [];
    for (const m of missions) { const a = m.dateChargement || m.dateMission, b = m.dateDechargement || m.dateMission; if (b < from || a > to) continue;
      events.push({ kind: 'mission', id: String(m._id), ref: m.ref, from: a, to: b < a ? a : b, label: `${m.ref} ${m.client?.nom || ''}`.trim(), detail: `${m.villeCharge} → ${m.villeDecharge}`, truck: m.truck?.immatriculation || m.sousTraitant?.nom || '', chauffeur: m.chauffeur?.nom || '', statut: m.statut }); }
    for (const l of locs) { const a = l.dateDebut, b = l.dateFin || l.dateDebut; if (b < from || a > to) continue;
      events.push({ kind: 'location', id: String(l._id), ref: l.ref, from: a, to: b, label: `${l.ref} ${l.client?.nom || ''}`.trim(), detail: 'Location', truck: l.truck?.immatriculation || '', chauffeur: l.chauffeur?.nom || '', statut: l.statut }); }
    res.json({ month, events: events.sort((x, y) => x.from.localeCompare(y.from)) });
  }));

  // ---------- Pannes / incidents ----------
  const panneBody = z.object({ truck: zId, date: zDate, description: z.string().trim().min(1, 'Décrivez la panne').max(400), gravite: z.enum(['mineure', 'majeure', 'critique']).default('mineure'), statut: z.enum(['ouverte', 'en_cours', 'resolue']).default('ouverte'),
    immobilise: z.boolean().default(false), dateResolution: zDateOpt, cout: zMoney, chauffeur: zText(80), lieu: zText(120), observation: zText(500) });
  mountCrud(r, { path: '/pannes', Model: Panne, body: panneBody, populate: [truckPop], sort: { date: -1 }, dateField: 'date', filters: ['truck', 'statut', 'gravite'], search: ['ref', 'description', 'truck.immatriculation', 'chauffeur', 'lieu'],
    view: (d) => ({ ...d, dureeJours: daysBetween(d.date, d.statut === 'resolue' && d.dateResolution ? d.dateResolution : today()) }),
    pre: async (b, req, ex) => { if (b.statut === 'resolue') { b.immobilise = false; if (!b.dateResolution) b.dateResolution = today(); } else b.dateResolution = ''; if (!ex) b.ref = await nextNumber('P', Number(b.date.slice(0, 4))); },
    summary: (docs) => ({ kpis: { total: docs.length, ouvertes: docs.filter((p) => p.statut !== 'resolue').length, immobilises: docs.filter((p) => p.statut !== 'resolue' && p.immobilise).length, cout: r2(docs.reduce((s, p) => s + p.cout, 0)) } }) });

  // ---------- Pièces & stock ----------
  const pieceBody = z.object({ reference: zText(40), designation: z.string().trim().min(1, 'Désignation obligatoire').max(150), categorie: zText(60), unite: zText(20), seuil: zMoney, prixUnitaire: zMoney, emplacement: zText(60), actif: z.boolean().default(true) });
  const stockMap = async (ids) => { const m = new Map(); for (const x of await MouvementPiece.find({ piece: { $in: ids } }).lean()) m.set(String(x.piece), (m.get(String(x.piece)) || 0) + (x.type === 'entree' ? x.qte : -x.qte)); return m; };
  mountCrud(r, { path: '/pieces', Model: Piece, body: pieceBody, sort: { designation: 1 }, filters: ['categorie', 'actif'], search: ['reference', 'designation', 'categorie', 'emplacement'],
    postFilter: async (docs, q) => { const sm = await stockMap(docs.map((d) => d._id)); for (const d of docs) { d.stock = r2(sm.get(String(d._id)) || 0); d.valeur = r2(d.stock * d.prixUnitaire); d.alerte = d.seuil > 0 && d.stock <= d.seuil; } return q.alerte === '1' ? docs.filter((d) => d.alerte) : docs; },
    onDelete: async (d) => { if (await MouvementPiece.exists({ piece: d._id })) throw httpError(409, 'Cette pièce a des mouvements de stock : désactivez-la'); },
    summary: (docs) => ({ kpis: { nb: docs.length, alertes: docs.filter((d) => d.alerte).length, valeur: r2(docs.reduce((s, d) => s + (d.valeur || 0), 0)) } }) });
  const mvtBody = z.object({ piece: zId, date: zDate, type: z.enum(['entree', 'sortie']), qte: z.number().finite().gt(0, 'Quantité > 0').max(1e7), prixUnitaire: zMoney, truck: zIdOpt, observation: zText(300) });
  mountCrud(r, { path: '/mouvements-pieces', Model: MouvementPiece, body: mvtBody, populate: [{ path: 'piece', select: 'designation reference unite' }, { path: 'truck', select: 'immatriculation' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['piece', 'type', 'truck'], refFilters: ['piece'],
    search: ['piece.designation', 'piece.reference', 'truck.immatriculation', 'observation'],
    pre: async (b, req, ex) => {
      const p = await Piece.findById(b.piece).lean(); if (!p) throw httpError(404, 'Pièce introuvable');
      if (b.truck && !(await Truck.exists({ _id: b.truck }))) throw httpError(404, 'Camion introuvable');
      const cur = (await stockMap([p._id])).get(String(p._id)) || 0; const undo = ex && String(ex.piece) === String(b.piece) ? (ex.type === 'entree' ? -ex.qte : ex.qte) : 0;
      if (b.type === 'sortie' && cur + undo - b.qte < -1e-9) throw httpError(409, `Stock insuffisant (${r2(cur + undo)} ${p.unite} disponible)`);
      if (!b.prixUnitaire) b.prixUnitaire = p.prixUnitaire;
    }, canDelete: () => null,
    onDelete: async (d) => { if (d.type === 'entree') { const cur = (await stockMap([d.piece])).get(String(d.piece)) || 0; if (cur - d.qte < -1e-9) throw httpError(409, 'Supprimer cette entrée rendrait le stock négatif'); } } });

  // ---------- Gasoil → retenue / prime chauffeur ----------
  r.post('/carburant/:id/transfert', requireRole(), wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const b = z.object({ employe: zId, type: z.enum(['retenue', 'prime']), montant: zAmount, motif: zText(150) }).parse(req.body);
    const o = await Operation.findById(req.params.id); if (!o || o.kind !== 'plein' || o.supprime) throw httpError(404, 'Plein introuvable');
    if (o.meta?.transfert?.id) throw httpError(409, 'Ce plein a déjà été transféré à la paie');
    const e = await Employe.findById(b.employe).lean(); if (!e) throw httpError(404, 'Employé introuvable');
    const t = await Truck.findById(o.truck).lean();
    const pr = await PrimeRetenue.create({ employe: e._id, date: o.date, type: b.type, libelle: b.motif || `${b.type === 'retenue' ? 'Surconsommation' : 'Économie de carburant'} ${o.date} (${t?.immatriculation || ''})`, montant: b.montant, source: 'gasoil', refId: String(o._id) });
    o.meta = { ...(o.meta || {}), transfert: { id: String(pr._id), type: b.type, montant: b.montant, employe: e.nom } }; o.markModified('meta');
    o.historique.push({ at: new Date(), par: who(req), action: 'modification', avant: { transfert: null } }); await o.save();
    res.status(201).json({ ok: true, transfert: o.meta.transfert });
  }));
  r.delete('/carburant/:id/transfert', requireRole(), wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id); if (!o || o.kind !== 'plein') throw httpError(404, 'Plein introuvable');
    const t = o.meta?.transfert; if (!t?.id) throw httpError(404, 'Aucun transfert');
    const pr = await PrimeRetenue.findById(t.id).lean();
    if (pr && await Bulletin.exists({ employe: pr.employe, periode: pr.date.slice(0, 7), statut: { $ne: 'brouillon' } })) throw httpError(409, 'La paie de cette période est validée : annulez la validation avant de retirer ce transfert');
    await PrimeRetenue.deleteOne({ _id: t.id, source: 'gasoil' });
    const m = { ...o.meta }; delete m.transfert; o.meta = m; o.markModified('meta'); await o.save();
    res.json({ ok: true });
  }));
}
