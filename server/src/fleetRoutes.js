import mongoose from 'mongoose';
import { z } from 'zod';
import { Truck, Operation, Plan, getSettings } from './models.js';
import { requireRole } from './auth.js';
import { CODE_GAZOLE, r2 } from '../../shared/calc.js';
import { validDate } from './ops.js';
import { opView, sheetWarnings } from './opsRoutes.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const checkId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Identifiant invalide' }));
const dateStr = z.string().refine(validDate, 'Date invalide (AAAA-MM-JJ)');
const truckId = z.string().refine(mongoose.isValidObjectId, 'Camion invalide');
const who = (req) => req.user.nom || req.user.email;
const text = (n) => z.string().trim().max(n).default('');

export const CODE_PNEUS = '61222000';
export const CODE_MAINTENANCE = '61330000';
export const CATEGORIES = ['vidange', 'moteur', 'freins', 'pneus', 'transmission', 'electricite', 'carrosserie', 'climatisation', 'remorque', 'autre'];

const truckMini = (t) => ({ _id: String(t._id), immatriculation: t.immatriculation, marque: t.marque, modele: t.modele, chauffeur: t.chauffeur, consoTheorique: t.consoTheorique || 0, actif: t.actif });
const truckMapAll = async () => new Map((await Truck.find({}).lean()).map((t) => [String(t._id), truckMini(t)]));
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
const checkDates = (q) => { for (const d of [q.from, q.to]) if (d && !validDate(d)) throw Object.assign(new Error('Date invalide (AAAA-MM-JJ)'), { status: 400 }); };
const addDaysISO = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const today = () => new Date().toISOString().slice(0, 10);
const histSnap = (o) => ({ truck: String(o.truck), date: o.date, code: o.code, montant: o.montant, voyage: o.voyage, note: o.note, meta: o.meta });

// ---------------------------------------------------------------------------------------------
// Gasoil : méthode « plein à plein » — la consommation d'un plein = litres ÷ km parcourus depuis le plein précédent du même camion.
// ---------------------------------------------------------------------------------------------
/** Statuts : normal | surconsommation | suspect (valeur incohérente) | incomplet (pas de plein précédent exploitable) | sans_reference. */
export function analyserPleins(docs, trucks, seuilPct) {
  const byTruck = new Map();
  for (const o of docs) { const k = String(o.truck); (byTruck.get(k) || byTruck.set(k, []).get(k)).push(o); }
  const out = [];
  for (const [tid, list] of byTruck) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.meta?.kmCompteur || 0) - (b.meta?.kmCompteur || 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const theo = trucks.get(tid)?.consoTheorique || 0;
    let prev = null;
    for (const o of list) {
      const m = o.meta || {};
      const km = m.kmCompteur || 0;
      const litres = m.litres || 0;
      const row = { o, kmCompteur: km, litres, prixLitre: m.prixLitre || 0, distance: null, conso: null, ecart: null, surplusLitres: 0, surplusDh: 0, statut: 'incomplet', raison: 'Premier plein enregistré pour ce camion' };
      if (prev) {
        const dist = km - prev.kmCompteur;
        if (dist <= 0) row.raison = `Kilométrage (${km}) inférieur ou égal au plein précédent (${prev.kmCompteur})`;
        else if (!litres) row.raison = 'Litres manquants';
        else {
          row.distance = r2(dist); row.conso = r2((litres / dist) * 100);
          if (!theo) { row.statut = 'sans_reference'; row.raison = 'Consommation théorique non renseignée pour ce camion'; }
          else {
            row.ecart = r2(row.conso - theo);
            if (row.conso < theo * 0.5 || row.conso > theo * 2.5) { row.statut = 'suspect'; row.raison = 'Valeur incohérente : vérifiez le kilométrage ou les litres saisis'; }
            else if (row.conso > theo * (1 + seuilPct / 100)) {
              row.statut = 'surconsommation'; row.surplusLitres = r2(((row.conso - theo) * dist) / 100); row.surplusDh = r2(row.surplusLitres * (row.prixLitre || 0)); row.raison = '';
            } else { row.statut = 'normal'; row.raison = ''; }
          }
        }
      }
      if (km > 0) prev = row;
      out.push(row);
    }
  }
  return out;
}
const pleinView = (row, trucks) => ({
  ...opView(row.o, trucks), litres: row.litres, prixLitre: row.prixLitre, kmCompteur: row.kmCompteur, source: row.o.meta?.source || 'externe',
  station: row.o.meta?.station || '', bon: row.o.meta?.bon || '', chauffeur: row.o.meta?.chauffeur || '', transfert: row.o.meta?.transfert || null,
  distance: row.distance, conso: row.conso, ecart: row.ecart, surplusLitres: row.surplusLitres, surplusDh: row.surplusDh, statutConso: row.statut, raison: row.raison,
});

const pleinBody = z.object({
  truck: truckId, date: dateStr, kmCompteur: z.number().finite().gt(0, 'Le kilométrage actuel est obligatoire').max(5e6),
  litres: z.number().finite().gt(0, 'Les litres doivent être supérieurs à 0').max(5000),
  prixLitre: z.number().finite().min(0).max(1000).default(0), montant: z.number().finite().min(0).max(1e8).default(0),
  source: z.enum(['interne', 'externe']).default('externe'), station: text(80), bon: text(40), chauffeur: text(80), voyage: text(80), note: text(500),
}).superRefine((b, ctx) => { if (!b.prixLitre && !b.montant) ctx.addIssue({ code: 'custom', path: ['prixLitre'], message: 'Indiquez le prix du litre ou le montant total' }); });
function pleinFields(b) {
  let { prixLitre, montant } = b;
  if (montant > 0 && !prixLitre) prixLitre = r2(montant / b.litres); else if (!montant) montant = r2(b.litres * prixLitre);
  return { code: CODE_GAZOLE, montant: r2(montant), km: 0, voyage: b.voyage, note: b.note, kind: 'plein',
    meta: { litres: b.litres, prixLitre, kmCompteur: b.kmCompteur, source: b.source, station: b.station, bon: b.bon, chauffeur: b.chauffeur } };
}

// ---------------------------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------------------------
const entretienBody = z.object({
  truck: truckId, date: dateStr, type: z.enum(['preventive', 'curative']).default('curative'), categorie: z.enum(CATEGORIES).default('autre'),
  garage: text(80), kmCompteur: z.number().finite().min(0).max(5e6).default(0), montant: z.number().finite().gt(0, 'Le montant doit être supérieur à 0').max(1e9),
  description: text(500), note: text(500),
});
const entretienFields = (b) => ({ code: b.categorie === 'pneus' ? CODE_PNEUS : CODE_MAINTENANCE, montant: r2(b.montant), km: 0, voyage: '', note: b.note || b.description, kind: 'entretien',
  meta: { type: b.type, categorie: b.categorie, garage: b.garage, kmCompteur: b.kmCompteur, description: b.description } });
const entretienView = (o, trucks) => ({ ...opView(o, trucks), type: o.meta?.type || 'curative', categorie: o.meta?.categorie || 'autre', garage: o.meta?.garage || '', kmCompteur: o.meta?.kmCompteur || 0, description: o.meta?.description || '' });

const planBody = z.object({
  truck: truckId, libelle: z.string().trim().min(1, 'Libellé obligatoire').max(80), categorie: z.enum(CATEGORIES).default('autre'),
  intervalleKm: z.number().finite().min(0).max(1e6).default(0), intervalleJours: z.number().int().min(0).max(5000).default(0),
  dernierKm: z.number().finite().min(0).max(5e6).default(0), dernierDate: z.union([dateStr, z.literal('')]).default(''), actif: z.boolean().default(true),
}).refine((b) => b.intervalleKm > 0 || b.intervalleJours > 0, { message: "Indiquez un intervalle en km et/ou en jours", path: ['intervalleKm'] });

/** Dernier kilométrage connu par camion : relevé le plus récent (pleins et interventions). */
async function kmActuels() {
  const docs = await Operation.find({ kind: { $in: ['plein', 'entretien'] }, supprime: { $ne: true }, 'meta.kmCompteur': { $gt: 0 } }, { truck: 1, date: 1, createdAt: 1, 'meta.kmCompteur': 1 }).lean();
  docs.sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const m = new Map();
  for (const o of docs) m.set(String(o.truck), o.meta.kmCompteur);   // le relevé le plus récent par date fait foi
  return m;
}
export function etatPlan(p, kmActuel, now = today()) {
  const joursRestants = p.intervalleJours > 0 && p.dernierDate ? daysBetween(now, addDaysISO(p.dernierDate, p.intervalleJours)) : null;
  const kmRestants = p.intervalleKm > 0 && p.dernierKm > 0 && kmActuel > 0 ? Math.round(p.dernierKm + p.intervalleKm - kmActuel) : null;
  let statut = 'sans_historique';
  if (joursRestants !== null || kmRestants !== null) {
    if ((joursRestants !== null && joursRestants < 0) || (kmRestants !== null && kmRestants < 0)) statut = 'en_retard';
    else if ((joursRestants !== null && joursRestants <= 15) || (kmRestants !== null && kmRestants <= 1000)) statut = 'bientot';
    else statut = 'ok';
  }
  return { joursRestants, kmRestants, statut,
    prochaineDate: p.intervalleJours > 0 && p.dernierDate ? addDaysISO(p.dernierDate, p.intervalleJours) : '', prochainKm: p.intervalleKm > 0 && p.dernierKm > 0 ? p.dernierKm + p.intervalleKm : 0 };
}
async function plansView() {
  const [plans, trucks, kms] = await Promise.all([Plan.find({}).lean(), truckMapAll(), kmActuels()]);
  return plans.map((p) => ({ id: String(p._id), truck: trucks.get(String(p.truck)) || { _id: String(p.truck) }, libelle: p.libelle, categorie: p.categorie, intervalleKm: p.intervalleKm, intervalleJours: p.intervalleJours,
    dernierKm: p.dernierKm, dernierDate: p.dernierDate, actif: p.actif, kmActuel: kms.get(String(p.truck)) || 0, ...etatPlan(p, kms.get(String(p.truck)) || 0) }));
}
async function majPlans(truck, categorie, date, km) {
  const plans = await Plan.find({ truck, categorie, actif: true });
  for (const p of plans) {
    if (!p.dernierDate || date >= p.dernierDate) { p.dernierDate = date; if (km > 0) p.dernierKm = km; await p.save(); }
  }
}

export function mountFleet(r) {
  const canWrite = requireRole('saisie');
  const seuil = async () => { const s = await getSettings(); return Number.isFinite(s.seuilSurconso) ? s.seuilSurconso : 10; };

  // ---------- Gasoil ----------
  r.get('/carburant', wrap(async (req, res) => {
    checkDates(req.query);
    if (req.query.truck && !mongoose.isValidObjectId(req.query.truck)) return res.status(400).json({ error: 'Camion invalide' });
    const [docs, trucks, seuilPct] = await Promise.all([Operation.find({ kind: 'plein', supprime: { $ne: true } }).lean(), truckMapAll(), seuil()]);
    let rows = analyserPleins(docs, trucks, seuilPct).filter((x) => inRange(x.o.date, req.query.from, req.query.to) && (!req.query.truck || String(x.o.truck) === req.query.truck));
    const total = rows.length;
    if (req.query.source) rows = rows.filter((x) => (x.o.meta?.source || 'externe') === req.query.source);
    const q = String(req.query.q || '').toLowerCase();
    if (q) rows = rows.filter((x) => `${x.o.meta?.bon || ''} ${x.o.meta?.station || ''} ${x.o.meta?.chauffeur || ''} ${trucks.get(String(x.o.truck))?.immatriculation || ''}`.toLowerCase().includes(q));
    const base = rows;
    const eval_ = rows.filter((x) => x.conso !== null);
    const kmEval = eval_.reduce((s, x) => s + x.distance, 0), lEval = eval_.reduce((s, x) => s + x.litres, 0);
    const anomalies = rows.filter((x) => x.statut === 'surconsommation' || x.statut === 'suspect');
    const kpis = {
      nbPleins: rows.length, litres: r2(rows.reduce((s, x) => s + x.litres, 0)), cout: r2(rows.reduce((s, x) => s + x.o.montant, 0)),
      kmAnalyses: r2(kmEval), consoMoyenne: kmEval ? r2((lEval / kmEval) * 100) : 0,
      nbSurconsommation: rows.filter((x) => x.statut === 'surconsommation').length, nbSuspects: rows.filter((x) => x.statut === 'suspect').length, nbNormaux: rows.filter((x) => x.statut === 'normal').length,
      surplusLitres: r2(anomalies.reduce((s, x) => s + x.surplusLitres, 0)), surplusDh: r2(anomalies.reduce((s, x) => s + x.surplusDh, 0)),
    };
    const parCamion = new Map();
    for (const x of rows) {
      const k = String(x.o.truck); const c = parCamion.get(k) || { truck: trucks.get(k) || { _id: k }, litres: 0, cout: 0, km: 0, lEval: 0, surplusDh: 0, nb: 0 };
      c.litres += x.litres; c.cout += x.o.montant; c.nb += 1; c.surplusDh += x.surplusDh; if (x.conso !== null) { c.km += x.distance; c.lEval += x.litres; } parCamion.set(k, c);
    }
    let shown = base;
    if (req.query.statut) { const st = String(req.query.statut).split(','); shown = base.filter((x) => st.includes(x.statut)); }
    shown = [...shown].sort((a, b) => b.o.date.localeCompare(a.o.date) || b.kmCompteur - a.kmCompteur);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100)); const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const mini = new Map([...trucks]);
    res.json({
      items: shown.slice((page - 1) * limit, page * limit).map((x) => pleinView(x, mini)), total: shown.length, totalAvantFiltre: total, page, limit, seuil: seuilPct, kpis,
      parCamion: [...parCamion.values()].map((c) => ({ truck: c.truck, nb: c.nb, litres: r2(c.litres), cout: r2(c.cout), km: r2(c.km), conso: c.km ? r2((c.lEval / c.km) * 100) : null, theorique: c.truck.consoTheorique || 0, surplusDh: r2(c.surplusDh) }))
        .sort((a, b) => b.cout - a.cout),
    });
  }));

  r.post('/carburant', canWrite, wrap(async (req, res) => {
    const b = pleinBody.parse(req.body);
    const truck = await Truck.findById(b.truck);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const o = await Operation.create({ truck: truck._id, date: b.date, month: b.date.slice(0, 7), ...pleinFields(b), createdBy: who(req), historique: [{ at: new Date(), par: who(req), action: 'creation' }] });
    const view = opView(o.toObject({ minimize: false }), new Map([[String(truck._id), truckMini(truck)]]));
    res.status(201).json({ ...view, avertissements: await sheetWarnings(truck._id, b.date.slice(0, 7), [CODE_GAZOLE]) });
  }));

  r.put('/carburant/:id', canWrite, checkId, wrap(async (req, res) => {
    const b = pleinBody.parse(req.body);
    const o = await Operation.findById(req.params.id);
    if (!o || o.kind !== 'plein') return res.status(404).json({ error: 'Plein introuvable' });
    if (!(await Truck.exists({ _id: b.truck }))) return res.status(404).json({ error: 'Camion introuvable' });
    const avant = histSnap(o);
    const transfert = o.meta?.transfert;
    Object.assign(o, { truck: oid(b.truck), date: b.date, month: b.date.slice(0, 7), ...pleinFields(b) });
    if (transfert) o.meta = { ...o.meta, transfert };
    o.markModified('meta');
    o.historique.push({ at: new Date(), par: who(req), action: 'modification', avant });
    await o.save();
    res.json({ ok: true, avertissements: await sheetWarnings(o.truck, o.month, [CODE_GAZOLE]) });
  }));

  // ---------- Maintenance ----------
  r.get('/entretien', wrap(async (req, res) => {
    checkDates(req.query);
    if (req.query.truck && !mongoose.isValidObjectId(req.query.truck)) return res.status(400).json({ error: 'Camion invalide' });
    const [all, trucks] = await Promise.all([Operation.find({ kind: 'entretien', supprime: { $ne: true } }).sort({ date: -1, createdAt: -1 }).lean(), truckMapAll()]);
    let rows = all.filter((o) => inRange(o.date, req.query.from, req.query.to) && (!req.query.truck || String(o.truck) === req.query.truck));
    if (req.query.type) rows = rows.filter((o) => o.meta?.type === req.query.type);
    if (req.query.categorie) rows = rows.filter((o) => o.meta?.categorie === req.query.categorie);
    const q = String(req.query.q || '').toLowerCase();
    if (q) rows = rows.filter((o) => `${o.meta?.garage || ''} ${o.meta?.description || ''} ${o.note || ''} ${trucks.get(String(o.truck))?.immatriculation || ''}`.toLowerCase().includes(q));
    const sum = (a) => r2(a.reduce((s, o) => s + o.montant, 0));
    const group = (keyFn) => { const m = new Map(); for (const o of rows) { const k = keyFn(o); m.set(k, r2((m.get(k) || 0) + o.montant)); } return m; };
    const parCamionMap = new Map();
    for (const o of rows) { const k = String(o.truck); const c = parCamionMap.get(k) || { truck: trucks.get(k) || { _id: k }, nb: 0, cout: 0 }; c.nb += 1; c.cout = r2(c.cout + o.montant); parCamionMap.set(k, c); }
    const plans = await plansView();
    const actifs = plans.filter((p) => p.actif);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100)); const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json({
      items: rows.slice((page - 1) * limit, page * limit).map((o) => entretienView(o, trucks)), total: rows.length, page, limit,
      kpis: { nb: rows.length, cout: sum(rows), coutMoyen: rows.length ? r2(sum(rows) / rows.length) : 0, preventives: rows.filter((o) => o.meta?.type === 'preventive').length, curatives: rows.filter((o) => o.meta?.type === 'curative').length,
        coutPreventif: sum(rows.filter((o) => o.meta?.type === 'preventive')), coutCuratif: sum(rows.filter((o) => o.meta?.type !== 'preventive')),
        alertesRetard: actifs.filter((p) => p.statut === 'en_retard').length, alertesBientot: actifs.filter((p) => p.statut === 'bientot').length },
      parMois: [...group((o) => o.date.slice(0, 7))].map(([mois, cout]) => ({ mois, cout })).sort((a, b) => a.mois.localeCompare(b.mois)),
      parCategorie: [...group((o) => o.meta?.categorie || 'autre')].map(([categorie, cout]) => ({ categorie, cout })).sort((a, b) => b.cout - a.cout),
      parCamion: [...parCamionMap.values()].sort((a, b) => b.cout - a.cout).slice(0, 10),
      alertes: actifs.filter((p) => p.statut === 'en_retard' || p.statut === 'bientot').sort((a, b) => (a.statut === b.statut ? 0 : a.statut === 'en_retard' ? -1 : 1)).slice(0, 20),
    });
  }));

  r.post('/entretien', canWrite, wrap(async (req, res) => {
    const b = entretienBody.parse(req.body);
    const truck = await Truck.findById(b.truck);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const f = entretienFields(b);
    const o = await Operation.create({ truck: truck._id, date: b.date, month: b.date.slice(0, 7), ...f, createdBy: who(req), historique: [{ at: new Date(), par: who(req), action: 'creation' }] });
    await majPlans(truck._id, b.categorie, b.date, b.kmCompteur);
    res.status(201).json({ ...entretienView(o.toObject({ minimize: false }), new Map([[String(truck._id), truckMini(truck)]])), avertissements: await sheetWarnings(truck._id, b.date.slice(0, 7), [f.code]) });
  }));

  r.put('/entretien/:id', canWrite, checkId, wrap(async (req, res) => {
    const b = entretienBody.parse(req.body);
    const o = await Operation.findById(req.params.id);
    if (!o || o.kind !== 'entretien') return res.status(404).json({ error: 'Intervention introuvable' });
    if (!(await Truck.exists({ _id: b.truck }))) return res.status(404).json({ error: 'Camion introuvable' });
    const avant = histSnap(o);
    Object.assign(o, { truck: oid(b.truck), date: b.date, month: b.date.slice(0, 7), ...entretienFields(b) });
    o.markModified('meta');
    o.historique.push({ at: new Date(), par: who(req), action: 'modification', avant });
    await o.save();
    await majPlans(o.truck, b.categorie, b.date, b.kmCompteur);
    res.json({ ok: true, avertissements: await sheetWarnings(o.truck, o.month, [o.code]) });
  }));

  r.get('/entretien/plans', wrap(async (_req, res) => {
    const plans = await plansView();
    const ordre = { en_retard: 0, bientot: 1, sans_historique: 2, ok: 3 };
    res.json({ items: plans.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.truck.immatriculation?.localeCompare(b.truck.immatriculation || '') || 0) });
  }));
  r.post('/entretien/plans', canWrite, wrap(async (req, res) => {
    const b = planBody.parse(req.body);
    if (!(await Truck.exists({ _id: b.truck }))) return res.status(404).json({ error: 'Camion introuvable' });
    res.status(201).json({ id: String((await Plan.create(b))._id) });
  }));
  r.put('/entretien/plans/:id', canWrite, checkId, wrap(async (req, res) => {
    const b = planBody.parse(req.body);
    const p = await Plan.findByIdAndUpdate(req.params.id, b, { new: true, runValidators: true });
    if (!p) return res.status(404).json({ error: 'Plan introuvable' });
    res.json({ ok: true });
  }));
  r.delete('/entretien/plans/:id', canWrite, checkId, wrap(async (req, res) => {
    if (!(await Plan.findByIdAndDelete(req.params.id))) return res.status(404).json({ error: 'Plan introuvable' });
    res.json({ ok: true });
  }));
}
