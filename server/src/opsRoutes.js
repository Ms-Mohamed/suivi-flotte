import mongoose from 'mongoose';
import { z } from 'zod';
import { Truck, Entry, Operation, getSettings } from './models.js';
import { requireRole } from './auth.js';
import { PLAN, calcEntry, num, r2 } from '../../shared/calc.js';
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
  supprime: !!o.supprime, createdBy: o.createdBy || '', createdAt: o.createdAt, updatedAt: o.updatedAt, nbModifs: (o.historique || []).filter((h) => h.action === 'modification').length,
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
    res.status(201).json({ items: created.map((o) => opView(plain(o), trucks)) });
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
    if (!(await Truck.exists({ _id: b.truck }))) return res.status(404).json({ error: 'Camion introuvable' });
    const avant = snap(o);
    Object.assign(o, { truck: oid(b.truck), date: b.date, month: b.date.slice(0, 7), code: b.code, montant: b.montant, km: b.km, voyage: b.voyage, note: b.note });
    o.historique.push({ at: new Date(), par: who(req), action: 'modification', avant });
    await o.save();
    res.json(opView(plain(o), await truckMap([String(o.truck)])));
  }));

  r.delete('/operations/:id', canWrite, checkId, wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    if (!o.supprime) { o.supprime = true; o.historique.push({ at: new Date(), par: who(req), action: 'suppression', avant: snap(o) }); await o.save(); }
    res.json({ ok: true });
  }));
  r.post('/operations/:id/restaurer', canWrite, checkId, wrap(async (req, res) => {
    const o = await Operation.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Opération introuvable' });
    if (o.supprime) { o.supprime = false; o.historique.push({ at: new Date(), par: who(req), action: 'restauration' }); await o.save(); }
    res.json({ ok: true });
  }));

  // ---------- Dashboard hebdomadaire (opérations uniquement : les charges fixes restent mensuelles) ----------
  r.get('/reports/semaines', wrap(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!validDate(date)) return res.status(400).json({ error: 'Date invalide (AAAA-MM-JJ)' });
    const nb = Math.min(26, Math.max(1, parseInt(req.query.nb, 10) || 8));
    const monday = mondayOf(date);
    const starts = Array.from({ length: nb }, (_, i) => addDays(monday, -7 * (nb - 1 - i)));
    const docs = await Operation.find({ supprime: { $ne: true }, date: { $gte: starts[0], $lte: addDays(monday, 6) } }).lean();
    const trucksAll = (await Truck.find({}).sort({ immatriculation: 1 }).lean()).map((t) => ({ ...t, _id: String(t._id) }));
    const cell = () => ({ A: 0, B: 0, km: 0, n: 0 });
    const grid = new Map(); // `${truck}|${weekStart}`
    const fleet = new Map(starts.map((s) => [s, cell()]));
    for (const o of docs) {
      const wk = mondayOf(o.date); if (!fleet.has(wk)) continue;
      const k = `${o.truck}|${wk}`; const c = grid.get(k) || cell();
      for (const t of [c, fleet.get(wk)]) { if (LABELS[o.code]?.type === 'produit') t.A += o.montant; else t.B += o.montant; t.km += o.km || 0; t.n += 1; }
      grid.set(k, c);
    }
    const fin = (c) => ({ A: r2(c.A), B: r2(c.B), net: r2(c.A - c.B), km: r2(c.km), n: c.n });
    const rows = trucksAll.map((t) => ({ truck: t, cells: starts.map((s) => (grid.has(`${t._id}|${s}`) ? fin(grid.get(`${t._id}|${s}`)) : null)) }))
      .filter((x) => x.truck.actif || x.cells.some(Boolean));
    res.json({
      semaine: { debut: monday, fin: addDays(monday, 6), ...isoWeek(monday) }, starts, rows,
      flotte: starts.map((s) => ({ debut: s, ...isoWeek(s), ...fin(fleet.get(s)) })),
      courante: rows.map((x) => ({ truck: x.truck, ...(x.cells[nb - 1] || { A: 0, B: 0, net: 0, km: 0, n: 0 }) })),
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
      const c = calcEntry({ ...(emap.get(m) || {}), ops: idx.get(`${m}|${truck._id}`) }, settings);
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
