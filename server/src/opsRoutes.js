import mongoose from 'mongoose';
import { z } from 'zod';
import { Truck, Entry, Operation, getSettings } from './models.js';
import { requireRole } from './auth.js';
import { PLAN, calcEntry, num, r2, addMonths, montantBase, isOpsMonth, OPS_CODES } from '../../shared/calc.js';
import { opsIndex, validDate, addDays, mondayOf, isoWeek } from './ops.js';
import { operationsWorkbook } from './exporter.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const plain = (d) => (d?.toObject ? d.toObject({ minimize: false }) : d);
const LABELS = Object.fromEntries([
  ...PLAN.produits.map((p) => [p.code, { label: p.label, type: 'produit' }]),
  ...PLAN.charges.flatMap((g) => g.comptes.map((c) => [c.code, { label: c.label, type: 'charge' }])),
]);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const checkId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Identifiant invalide' }));
const dateStr = z.string().refine(validDate, 'Date invalide (AAAA-MM-JJ)');
const code = z.string().refine((c) => LABELS[c], 'Numéro de compte inconnu');
const money = z.number().finite().min(0).max(1e9);
const common = { voyage: z.string().trim().max(80).default(''), note: z.string().trim().max(500).default('') };
const lotBody = z.object({
  truck: z.string().refine(mongoose.isValidObjectId, 'Camion invalide'), date: dateStr, km: money.default(0), ...common,
  lignes: z.array(z.object({ code, montant: z.number().finite().gt(0, 'Le montant doit être supérieur à 0').max(1e9), note: z.string().trim().max(500).default('') })).min(1, 'Ajoutez au moins une ligne').max(30),
});
const editBody = z.object({
  truck: z.string().refine(mongoose.isValidObjectId, 'Camion invalide'), date: dateStr, code, montant: z.number().finite().gt(0, 'Le montant doit être supérieur à 0').max(1e9),
  km: money.default(0), ...common,
});
const SNAP = ['truck', 'date', 'code', 'montant', 'km', 'voyage', 'note'];
const snap = (o) => Object.fromEntries(SNAP.map((k) => [k, k === 'truck' ? String(o.truck) : o[k]]));
const who = (req) => req.user.nom || req.user.email;
export const opView = (o, trucks) => ({
  id: String(o._id), truck: trucks?.get(String(o.truck)) || { _id: String(o.truck) }, date: o.date, month: o.month, code: o.code,
  compte: LABELS[o.code]?.label || o.code, type: LABELS[o.code]?.type || 'charge', montant: o.montant, km: o.km || 0, voyage: o.voyage || '', note: o.note || '',
  kind: o.kind || 'voyage', meta: o.meta || {}, supprime: !!o.supprime, createdBy: o.createdBy || '', createdAt: o.createdAt, updatedAt: o.updatedAt, nbModifs: (o.historique || []).filter((h) => h.action === 'modification').length,
});
const truckMap = async (ids) => new Map((await Truck.find({ _id: { $in: ids } }).lean()).map((t) => [String(t._id), { _id: String(t._id), immatriculation: t.immatriculation, marque: t.marque, modele: t.modele, chauffeur: t.chauffeur, actif: t.actif }]));
const totaux = (list) => {
  let produits = 0, charges = 0, km = 0;
  for (const o of list) { if (LABELS[o.code]?.type === 'produit') produits += o.montant; else charges += o.montant; km += o.km || 0; }
  return { produits: r2(produits), charges: r2(charges), net: r2(produits - charges), km: r2(km), n: list.length };
};

function listFilter(q) {
  const f = {};
  if (q.truck) { if (!mongoose.isValidObjectId(q.truck)) throw Object.assign(new Error('Camion invalide'), { status: 400 }); f.truck = oid(q.truck); }
  if (q.from || q.to) {
    for (const d of [q.from, q.to]) if (d && !validDate(d)) throw Object.assign(new Error('Date invalide (AAAA-MM-JJ)'), { status: 400 });
    f.date = {}; if (q.from) f.date.$gte = q.from; if (q.to) f.date.$lte = q.to;
  }
  if (q.code) f.code = String(q.code);
  if (q.supprimes === 'only') f.supprime = true; else if (q.supprimes !== '1') f.supprime = { $ne: true };
  return f;
}
const textMatch = (o, term) => !term || `${o.voyage} ${o.note} ${LABELS[o.code]?.label || ''} ${o.code}`.toLowerCase().includes(term.toLowerCase());
async function fetchOps(q) {
  let docs = await Operation.find(listFilter(q)).sort({ date: -1, createdAt: -1 }).lean();
  if (q.type === 'produit' || q.type === 'charge') docs = docs.filter((o) => LABELS[o.code]?.type === q.type);
  if (q.q) docs = docs.filter((o) => textMatch(o, String(q.q)));
  if (q.voyage) docs = docs.filter((o) => (o.voyage || '').toLowerCase() === String(q.voyage).toLowerCase());
  return docs;
}

/** Alerte de double comptage : le compte a déjà un montant saisi à la main dans la fiche du mois, et l'opération s'y ajoute. */
export async function sheetWarnings(truckId, month, codes) {
  const settings = plain(await getSettings());
  const e = await Entry.findOne({ truck: truckId, month }).lean();
  if (!e) return [];
  return [...new Set(codes)].filter((c) => !(isOpsMonth(month, settings) && OPS_CODES.includes(c)) && montantBase(e, c) > 0)
    .map((c) => ({ code: c, compte: LABELS[c]?.label || c, month, montantFiche: montantBase(e, c) }));
}

export function mountOps(r) {
  const canWrite = requireRole('saisie');

  // ---------- Journal des opérations ----------
  r.get('/operations', wrap(async (req, res) => {
    const docs = await fetchOps(req.query);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const slice = docs.slice((page - 1) * limit, page * limit);
    const trucks = await truckMap([...new Set(slice.map((o) => String(o.truck)))]);
    res.json({ items: slice.map((o) => opView(o, trucks)), total: docs.length, page, limit, totaux: totaux(docs.filter((o) => !o.supprime)) });
  }));

  r.post('/operations', canWrite, wrap(async (req, res) => {
    const b = lotBody.parse(req.body);
    const truck = await Truck.findById(b.truck);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const now = new Date();
    const docs = b.lignes.map((l, i) => ({
      truck: truck._id, date: b.date, month: b.date.slice(0, 7), code: l.code, montant: l.montant, km: i === 0 ? b.km : 0,
      voyage: b.voyage, note: l.note || b.note, createdBy: who(req), historique: [{ at: now, par: who(req), action: 'creation' }],
    }));
    const created = await Operation.insertMany(docs);
    const trucks = await truckMap([String(truck._id)]);
    res.status(201).json({ items: created.map((o) => opView(plain(o), trucks)), avertissements: await sheetWarnings(truck._id, b.date.slice(0, 7), b.lignes.map((l) => l.code)) });
  }));

  r.get('/operations/:id', checkId, wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id).lean();
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    const trucks = await truckMap([String(o.truck)]);
    res.json({ ...opView(o, trucks), historique: (o.historique || []).slice().reverse() });
  }));

  r.put('/operations/:id', canWrite, checkId, wrap(async (req, res) => {
    const b = editBody.parse(req.body);
    const o = await Operation.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    if (o.meta?.missionId || o.meta?.locationId) return res.status(409).json({ error: 'Cette ligne vient d\u2019une mission ou d\u2019une location : modifiez-la depuis cette page' });
    if (o.kind && o.kind !== 'voyage') return res.status(409).json({ error: o.kind === 'plein' ? 'Modifiez ce plein depuis la page Gasoil' : 'Modifiez cette intervention depuis la page Maintenance' });
    if (!(await Truck.exists({ _id: b.truck }))) return res.status(404).json({ error: 'Camion introuvable' });
    const avant = snap(o);
    Object.assign(o, { truck: oid(b.truck), date: b.date, month: b.date.slice(0, 7), code: b.code, montant: b.montant, km: b.km, voyage: b.voyage, note: b.note });
    o.historique.push({ at: new Date(), par: who(req), action: 'modification', avant });
    await o.save();
    res.json({ ...opView(plain(o), await truckMap([String(o.truck)])), avertissements: await sheetWarnings(o.truck, o.month, [o.code]) });
  }));

  r.delete('/operations/:id', canWrite, checkId, wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    if (o.meta?.missionId || o.meta?.locationId) return res.status(409).json({ error: 'Cette ligne vient d\u2019une mission ou d\u2019une location : supprimez-la depuis cette page' });
    if (!o.supprime) { o.supprime = true; o.historique.push({ at: new Date(), par: who(req), action: 'suppression', avant: snap(o) }); await o.save(); }
    res.json({ ok: true });
  }));
  r.post('/operations/:id/restaurer', canWrite, checkId, wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    if (o.supprime) { o.supprime = false; o.historique.push({ at: new Date(), par: who(req), action: 'restauration' }); await o.save(); }
    res.json({ ok: true });
  }));

  // ---------- Dashboard hebdomadaire ----------
  // net = recettes − dépenses des opérations ; F = charges fixes + amortissements du mois répartis au jour le jour ;
  // netComplet = net − F (résultat avant impôt de la semaine).
  r.get('/reports/semaines', wrap(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!validDate(date)) return res.status(400).json({ error: 'Date invalide (AAAA-MM-JJ)' });
    const nb = Math.min(26, Math.max(1, parseInt(req.query.nb, 10) || 8));
    const monday = mondayOf(date);
    const starts = Array.from({ length: nb }, (_, i) => addDays(monday, -7 * (nb - 1 - i)));
    const last = addDays(monday, 6);
    const settings = plain(await getSettings());
    const docs = await Operation.find({ supprime: { $ne: true }, date: { $gte: starts[0], $lte: last } }).lean();
    const trucksAll = (await Truck.find({}).sort({ immatriculation: 1 }).lean()).map((t) => ({ ...t, _id: String(t._id) }));
    const months = []; for (let m = starts[0].slice(0, 7); m <= last.slice(0, 7); m = addMonths(m, 1)) months.push(m);
    const fixes = new Map(); // `${month}|${truck}` -> charges fixes mensuelles (fiche du mois, sans les opérations)
    for (const e of await Entry.find({ month: { $in: months } }).lean()) {
      const c = calcEntry({ ...e, month: e.month }, settings);
      fixes.set(`${e.month}|${e.truck}`, r2(c.sousTotaux.fixes + c.sousTotaux.amortissements));
    }
    const dim = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const cell = () => ({ A: 0, B: 0, F: 0, km: 0, n: 0, manque: false });
    const grid = new Map(); const fleet = new Map(starts.map((s) => [s, cell()]));
    const bump = (k, wk, fn) => { const c = grid.get(k) || cell(); fn(c); fn(fleet.get(wk), true); grid.set(k, c); };
    for (const o of docs) {
      const wk = mondayOf(o.date); if (!fleet.has(wk)) continue;
      bump(`${o.truck}|${wk}`, wk, (c) => { if (LABELS[o.code]?.type === 'produit') c.A += o.montant; else c.B += o.montant; c.km += o.km || 0; c.n += 1; });
    }
    for (const t of trucksAll) {
      for (const wk of starts) {
        let F = 0, manque = false;
        for (let i = 0; i < 7; i++) {
          const day = addDays(wk, i), m = day.slice(0, 7), v = fixes.get(`${m}|${t._id}`);
          if (v == null) manque = true; else F += v / dim(m);
        }
        if (F > 0) bump(`${t._id}|${wk}`, wk, (c, isFleet) => { c.F += F; if (manque && !isFleet) c.manque = true; });
        else if (manque && grid.has(`${t._id}|${wk}`)) grid.get(`${t._id}|${wk}`).manque = true;
      }
    }
    const fin = (c) => ({ A: r2(c.A), B: r2(c.B), F: r2(c.F), net: r2(c.A - c.B), netComplet: r2(c.A - c.B - c.F), km: r2(c.km), n: c.n, fixesManquantes: !!c.manque });
    const rows = trucksAll.map((t) => ({ truck: t, cells: starts.map((s) => (grid.has(`${t._id}|${s}`) ? fin(grid.get(`${t._id}|${s}`)) : null)) }))
      .filter((x) => x.truck.actif || x.cells.some(Boolean));
    res.json({
      semaine: { debut: monday, fin: last, ...isoWeek(monday) }, starts, rows,
      flotte: starts.map((s) => ({ debut: s, ...isoWeek(s), ...fin(fleet.get(s)) })),
      courante: rows.map((x) => ({ truck: x.truck, ...(x.cells[nb - 1] || { A: 0, B: 0, F: 0, net: 0, netComplet: 0, km: 0, n: 0, fixesManquantes: false }) })),
    });
  }));

  // ---------- Historique d'un camion (mois par mois) ----------
  r.get('/trucks/:id/historique', checkId, wrap(async (req, res) => {
    const truck = await Truck.findById(req.params.id).lean();
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const settings = plain(await getSettings());
    const entries = await Entry.find({ truck: truck._id }).lean();
    const idx = await opsIndex({ truck: truck._id });
    const emap = new Map(entries.map((e) => [e.month, e]));
    const months = [...new Set([...entries.map((e) => e.month), ...[...idx.keys()].map((k) => k.split('|')[0])])].sort();
    const mois = months.map((m) => {
      const c = calcEntry({ ...(emap.get(m) || {}), month: m, ops: idx.get(`${m}|${truck._id}`) }, settings);
      return { month: m, saisi: emap.has(m), A: c.A, B: c.B, net: c.net, km: c.km, nbOps: c.nbOps };
    });
    let cum = 0; for (const x of mois) { cum = r2(cum + x.net); x.cumul = cum; }
    const best = mois.reduce((a, x) => (!a || x.net > a.net ? x : a), null);
    const worst = mois.reduce((a, x) => (!a || x.net < a.net ? x : a), null);
    res.json({ truck: { ...truck, _id: String(truck._id) }, mois, resume: { total: cum, moyenne: mois.length ? r2(cum / mois.length) : 0, meilleur: best, pire: worst, nbMois: mois.length, nbOps: mois.reduce((s, x) => s + x.nbOps, 0) } });
  }));

  // ---------- Export Excel du journal ----------
  r.get('/export/operations', wrap(async (req, res) => {
    const docs = await fetchOps(req.query);
    const trucks = await truckMap([...new Set(docs.map((o) => String(o.truck)))]);
    const wb = await operationsWorkbook(docs.map((o) => opView(o, trucks)), (await getSettings()).societe);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="operations.xlsx"');
    await wb.xlsx.write(res); res.end();
  }));
}
