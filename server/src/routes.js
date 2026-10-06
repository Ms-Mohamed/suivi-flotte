import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User, Truck, Entry, Operation, Settings, getSettings } from './models.js';
import { requireAuth, signToken, check, hash, requireRole, publicUser } from './auth.js';
import { mountAdmin } from './adminRoutes.js';
import { mountOps } from './opsRoutes.js';
import { opsIndex } from './ops.js';
import { PLAN, calcEntry, MONTH_RE, prevMonth, addMonths } from '../../shared/calc.js';
import { monthWorkbook, entryWorkbook } from './exporter.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const CODES = new Set([...PLAN.produits.map((p) => p.code), ...PLAN.charges.flatMap((g) => g.comptes.map((c) => c.code))]);
const FIXED_CODES = PLAN.charges.filter((g) => g.key !== 'variables').flatMap((g) => g.comptes.map((c) => c.code));

const money = z.number().finite().min(0).max(1e9);
const byCode = z.record(z.string(), money).default({}).refine((o) => Object.keys(o).every((k) => CODES.has(k)), 'Numéro de compte inconnu');
const modesSchema = z.record(z.string(), z.enum(['calcul', 'factures', 'montant', 'annuel', 'mensuel'])).default({})
  .refine((o) => Object.keys(o).every((k) => CODES.has(k)), 'Numéro de compte inconnu');
const entryBody = z.object({
  km: money.default(0), tarifKm: money.default(0), litres: money.default(0), prixLitre: money.default(0),
  amounts: byCode, annuel: byCode, modes: modesSchema,
  impot: z.object({ mode: z.enum(['auto', 'manuel']), montant: money.default(0) }).default({ mode: 'auto', montant: 0 }),
  notes: z.string().max(2000).default(''),
});
const truckBody = z.object({
  immatriculation: z.string().trim().min(1).max(30),
  marque: z.string().trim().max(60).default(''), modele: z.string().trim().max(60).default(''),
  annee: z.number().int().min(1980).max(2100).nullish(), chauffeur: z.string().trim().max(80).default(''),
  notes: z.string().max(2000).default(''), actif: z.boolean().default(true),
  defauts: z.object({ amounts: byCode, annuel: byCode, modes: modesSchema, tarifKm: money.default(0), prixLitre: money.default(0) }).default({}),
});
const settingsBody = z.object({
  societe: z.string().trim().min(1).max(100), tauxIS: z.number().min(0).max(100),
  cotisationMinimale: z.number().min(0).max(100), cotisationMinimaleActive: z.boolean(),
});

const checkMonth = (req, res, next) => (MONTH_RE.test(req.params.month || req.query.month || '') ? next() : res.status(400).json({ error: 'Mois invalide (format AAAA-MM)' }));
const checkTruckId = (req, res, next) => (mongoose.isValidObjectId(req.params.truckId || req.params.id) ? next() : res.status(400).json({ error: 'Identifiant invalide' }));
const plain = (d) => (d?.toObject ? d.toObject({ minimize: false }) : d);
const entryView = (e) => ({ km: e.km || 0, tarifKm: e.tarifKm || 0, litres: e.litres || 0, prixLitre: e.prixLitre || 0,
  amounts: e.amounts || {}, annuel: e.annuel || {}, modes: e.modes || {}, impot: e.impot || { mode: 'auto', montant: 0 }, notes: e.notes || '' });

/** Modèle d'un nouveau mois : reprend les charges fixes du dernier mois saisi, sinon les valeurs par défaut du camion. */
async function buildTemplate(truck, month) {
  const prev = await Entry.findOne({ truck: truck._id, month: { $lt: month } }).sort({ month: -1 });
  const src = prev ? plain(prev) : { ...plain(truck).defauts };
  const amounts = {};
  for (const code of FIXED_CODES) if (src.amounts?.[code] != null) amounts[code] = src.amounts[code];
  return { ...entryView({}), amounts, annuel: { ...(src.annuel || {}) }, modes: { ...(src.modes || {}) },
    tarifKm: src.tarifKm || 0, prixLitre: src.prixLitre || 0, fromPrevious: prev ? prev.month : null };
}

export function buildRouter() {
  const r = Router();

  // ---------- Auth ----------
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez dans 15 minutes' } });
  r.post('/auth/login', loginLimiter, wrap(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.actif === false || !(await check(password, user.passwordHash))) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    res.json({ token: signToken(user), user: publicUser(user) });
  }));
  r.get('/schema', (_req, res) => res.json(PLAN));
  r.use(requireAuth);
  r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
  r.post('/auth/password', wrap(async (req, res) => {
    const { actuel, nouveau } = z.object({ actuel: z.string(), nouveau: z.string().min(8, 'Minimum 8 caractères') }).parse(req.body);
    if (!(await check(actuel, req.user.passwordHash))) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    req.user.passwordHash = await hash(nouveau); await req.user.save(); res.json({ ok: true });
  }));

  // ---------- Paramètres ----------
  r.get('/settings', wrap(async (_req, res) => res.json(plain(await getSettings()))));
  r.put('/settings', requireRole(), wrap(async (req, res) => {
    const body = settingsBody.parse(req.body);
    res.json(plain(await Settings.findOneAndUpdate({ key: 'main' }, body, { new: true, upsert: true })));
  }));

  // ---------- Camions ----------
  r.get('/trucks', wrap(async (req, res) => {
    const filter = req.query.tous === '1' ? {} : { actif: true };
    res.json((await Truck.find(filter).sort({ immatriculation: 1 })).map(plain));
  }));
  r.post('/trucks', requireRole(), wrap(async (req, res) => res.status(201).json(plain(await Truck.create(truckBody.parse(req.body))))));
  r.get('/trucks/:id', checkTruckId, wrap(async (req, res) => {
    const t = await Truck.findById(req.params.id); return t ? res.json(plain(t)) : res.status(404).json({ error: 'Camion introuvable' });
  }));
  r.put('/trucks/:id', requireRole(), checkTruckId, wrap(async (req, res) => {
    const t = await Truck.findByIdAndUpdate(req.params.id, truckBody.parse(req.body), { new: true, runValidators: true });
    return t ? res.json(plain(t)) : res.status(404).json({ error: 'Camion introuvable' });
  }));
  r.delete('/trucks/:id', requireRole(), checkTruckId, wrap(async (req, res) => {
    if (req.query.definitif === '1') {
      const t = await Truck.findByIdAndDelete(req.params.id);
      if (!t) return res.status(404).json({ error: 'Camion introuvable' });
      await Entry.deleteMany({ truck: t._id }); await Operation.deleteMany({ truck: t._id }); return res.json({ ok: true, supprime: true });
    }
    const t = await Truck.findByIdAndUpdate(req.params.id, { actif: false }, { new: true });
    return t ? res.json({ ok: true, archive: true }) : res.status(404).json({ error: 'Camion introuvable' });
  }));

  // ---------- Saisies mensuelles ----------
  r.get('/entries/:truckId/:month', checkTruckId, checkMonth, wrap(async (req, res) => {
    const truck = await Truck.findById(req.params.truckId);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const settings = plain(await getSettings());
    const e = await Entry.findOne({ truck: truck._id, month: req.params.month });
    const entry = e ? entryView(plain(e)) : await buildTemplate(truck, req.params.month);
    const ops = (await opsIndex({ truck: truck._id, month: req.params.month })).get(`${req.params.month}|${truck._id}`) || { totals: {}, km: 0, n: 0 };
    res.json({ truck: plain(truck), month: req.params.month, exists: !!e, entry, ops, calc: calcEntry({ ...entry, ops }, settings), updatedAt: e?.updatedAt || null });
  }));
  r.get('/entries/:truckId/:month/modele', checkTruckId, checkMonth, wrap(async (req, res) => {
    const truck = await Truck.findById(req.params.truckId);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    res.json(await buildTemplate(truck, req.params.month));
  }));
  r.put('/entries/:truckId/:month', requireRole('saisie'), checkTruckId, checkMonth, wrap(async (req, res) => {
    const truck = await Truck.findById(req.params.truckId);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const body = entryBody.parse(req.body);
    const e = await Entry.findOneAndUpdate({ truck: truck._id, month: req.params.month }, { $set: body },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true });
    const settings = plain(await getSettings());
    const ops = (await opsIndex({ truck: truck._id, month: req.params.month })).get(`${req.params.month}|${truck._id}`) || { totals: {}, km: 0, n: 0 };
    res.json({ exists: true, entry: entryView(plain(e)), ops, calc: calcEntry({ ...plain(e), ops }, settings), updatedAt: e.updatedAt });
  }));
  r.delete('/entries/:truckId/:month', requireRole('saisie'), checkTruckId, checkMonth, wrap(async (req, res) => {
    await Entry.deleteOne({ truck: req.params.truckId, month: req.params.month }); res.json({ ok: true });
  }));

  // ---------- Rapports ----------
  r.get('/reports/dashboard', checkMonth, wrap(async (req, res) => {
    const month = req.query.month, prev = prevMonth(month), from = addMonths(month, -11);
    const settings = plain(await getSettings());
    const trucks = (await Truck.find({ actif: true }).sort({ immatriculation: 1 })).map(plain);
    const entries = (await Entry.find({ month: { $gte: from, $lte: month } })).map(plain);
    const active = new Set(trucks.map((t) => String(t._id)));
    const sum = (list) => list.reduce((a, c) => ({ A: a.A + c.A, B: a.B + c.B, brut: a.brut + c.brut, impot: a.impot + c.impot, net: a.net + c.net, km: a.km + c.km,
      variables: a.variables + c.sousTotaux.variables, fixes: a.fixes + c.sousTotaux.fixes, amortissements: a.amortissements + c.sousTotaux.amortissements }),
      { A: 0, B: 0, brut: 0, impot: 0, net: 0, km: 0, variables: 0, fixes: 0, amortissements: 0 });
    const fin = (t) => ({ ...t, A: +t.A.toFixed(2), B: +t.B.toFixed(2), brut: +t.brut.toFixed(2), impot: +t.impot.toFixed(2), net: +t.net.toFixed(2),
      marge: t.A ? +((t.net / t.A) * 100).toFixed(2) : 0, coutKm: t.km ? +(t.B / t.km).toFixed(2) : 0 });
    const idx = await opsIndex({ month: { $gte: from, $lte: month } });
    const emap = new Map(entries.map((e) => [`${e.month}|${e.truck}`, e]));
    const calcs = new Map([...new Set([...emap.keys(), ...idx.keys()])].map((k) => [k, calcEntry({ ...(emap.get(k) || {}), ops: idx.get(k) }, settings)]));
    const monthCalcs = (m) => trucks.map((t) => calcs.get(`${m}|${t._id}`)).filter(Boolean);
    const rows = trucks.map((t) => { const c = calcs.get(`${month}|${t._id}`); return { truck: t, saisi: emap.has(`${month}|${t._id}`), calc: c || calcEntry({}, settings) }; });
    const trend = [];
    for (let i = 0; i < 12; i++) { const m = addMonths(from, i); const t = fin(sum(monthCalcs(m))); trend.push({ month: m, A: t.A, B: t.B, net: t.net, brut: t.brut }); }
    const comptes = [...PLAN.produits.map((p) => p.code), ...PLAN.charges.flatMap((g) => g.comptes.map((c) => c.code))];
    const parCompte = Object.fromEntries(comptes.map((code) => [code, +monthCalcs(month).reduce((s, c) => s + c.lignes[code], 0).toFixed(2)]));
    res.json({ month, previousMonth: prev, totals: fin(sum(monthCalcs(month))), previousTotals: fin(sum(monthCalcs(prev))),
      trucks: rows, trend, parCompte, nbSaisis: rows.filter((x) => x.saisi).length, nbCamions: trucks.length,
      orphan: entries.some((e) => !active.has(String(e.truck)) && e.month === month) });
  }));

  r.get('/reports/annual', wrap(async (req, res) => {
    const year = String(req.query.year || '');
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Année invalide' });
    const settings = plain(await getSettings());
    const trucks = (await Truck.find({}).sort({ immatriculation: 1 })).map(plain);
    const entries = (await Entry.find({ month: { $gte: `${year}-01`, $lte: `${year}-12` } })).map(plain);
    const oidx = await opsIndex({ month: { $gte: `${year}-01`, $lte: `${year}-12` } });
    const emap = new Map(entries.map((e) => [`${e.month}|${e.truck}`, e]));
    const idx = new Map([...new Set([...emap.keys(), ...oidx.keys()])].map((k) => [k, calcEntry({ ...(emap.get(k) || {}), ops: oidx.get(k) }, settings)]));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const rows = trucks.map((t) => {
      const cells = months.map((m) => { const c = idx.get(`${m}|${t._id}`); return c ? { A: c.A, B: c.B, net: c.net } : null; });
      const tot = cells.reduce((a, c) => (c ? { A: a.A + c.A, B: a.B + c.B, net: a.net + c.net } : a), { A: 0, B: 0, net: 0 });
      return { truck: t, cells, total: { A: +tot.A.toFixed(2), B: +tot.B.toFixed(2), net: +tot.net.toFixed(2) } };
    }).filter((x) => x.truck.actif || x.cells.some(Boolean));
    const colTotals = months.map((_, i) => +rows.reduce((s, x) => s + (x.cells[i]?.net || 0), 0).toFixed(2));
    res.json({ year, months, rows, colTotals, grand: +colTotals.reduce((a, b) => a + b, 0).toFixed(2) });
  }));

  // ---------- Exports Excel ----------
  const sendXlsx = async (res, wb, name) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await wb.xlsx.write(res); res.end();
  };
  r.get('/export/month/:month', checkMonth, wrap(async (req, res) => {
    const settings = plain(await getSettings());
    const trucks = (await Truck.find({ actif: true }).sort({ immatriculation: 1 })).map(plain);
    const entries = new Map((await Entry.find({ month: req.params.month })).map((e) => [String(e.truck), plain(e)]));
    const oidx = await opsIndex({ month: req.params.month });
    const rows = trucks.map((truck) => ({ truck, entry: { ...(entries.get(String(truck._id)) || {}), ops: oidx.get(`${req.params.month}|${truck._id}`) } }));
    await sendXlsx(res, await monthWorkbook(req.params.month, rows, settings, settings.societe), `flotte-${req.params.month}.xlsx`);
  }));
  r.get('/export/entry/:truckId/:month', checkTruckId, checkMonth, wrap(async (req, res) => {
    const truck = await Truck.findById(req.params.truckId);
    if (!truck) return res.status(404).json({ error: 'Camion introuvable' });
    const e = await Entry.findOne({ truck: truck._id, month: req.params.month });
    const ops = (await opsIndex({ truck: truck._id, month: req.params.month })).get(`${req.params.month}|${truck._id}`);
    await sendXlsx(res, await entryWorkbook(plain(truck), req.params.month, { ...(e ? plain(e) : {}), ops }, plain(await getSettings())), `${truck.immatriculation}-${req.params.month}.xlsx`);
  }));
  mountOps(r);
  mountAdmin(r);
  return r;
}
