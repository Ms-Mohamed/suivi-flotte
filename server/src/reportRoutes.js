import { Truck, Entry, Operation, getSettings } from './models.js';
import { PLAN, calcEntry, r2, MONTH_RE, addMonths, currentMonth, isOpsMonth } from '../../shared/calc.js';
import { opsIndex } from './ops.js';
import { rapportWorkbook } from './exporter.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const plain = (d) => (d?.toObject ? d.toObject({ minimize: false }) : d);
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const LABELS = Object.fromEntries([
  ...PLAN.produits.map((p) => [p.code, { label: p.label, groupe: 'produits' }]),
  ...PLAN.charges.flatMap((g) => g.comptes.map((c) => [c.code, { label: c.label, groupe: g.key }])),
]);
const monthsBetween = (from, to) => { const l = []; for (let m = from; m <= to; m = addMonths(m, 1)) l.push(m); return l; };
const zero = () => ({ A: 0, B: 0, brut: 0, impot: 0, net: 0, km: 0, variables: 0, fixes: 0, amortissements: 0, mois: 0, saisis: 0, moisPerte: 0, nbOps: 0 });
const add = (t, c) => { for (const k of ['A', 'B', 'brut', 'impot', 'net', 'km']) t[k] += c[k]; for (const g of ['variables', 'fixes', 'amortissements']) t[g] += c.sousTotaux[g]; t.nbOps += c.nbOps; };
const fin = (t) => ({ ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
  marge: t.A ? r2((t.net / t.A) * 100) : 0, coutKm: t.km ? r2(t.B / t.km) : 0, resultatKm: t.km ? r2(t.net / t.km) : 0 });

async function build(from, to) {
  if (!MONTH_RE.test(from || '') || !MONTH_RE.test(to || '')) throw bad('Période invalide (AAAA-MM)');
  if (from > to) throw bad('La date de début est après la date de fin');
  const months = monthsBetween(from, to);
  if (months.length > 60) throw bad('Période trop longue (60 mois maximum)');
  const prevTo = addMonths(from, -1), prevFrom = addMonths(from, -months.length);
  const settings = plain(await getSettings());
  const trucks = (await Truck.find({}).sort({ immatriculation: 1 }).lean()).map((t) => ({ ...t, _id: String(t._id) }));
  const entries = await Entry.find({ month: { $gte: prevFrom, $lte: to } }).lean();
  const emap = new Map(entries.map((e) => [`${e.month}|${e.truck}`, e]));
  const idx = await opsIndex({ month: { $gte: prevFrom, $lte: to } });
  const calcOf = (m, tid) => {
    const k = `${m}|${tid}`;
    return emap.has(k) || idx.has(k) ? calcEntry({ ...(emap.get(k) || {}), month: m, ops: idx.get(k) }, settings) : null;
  };

  // par camion et totaux sur la période
  const tot = zero(), parMois = new Map(months.map((m) => [m, zero()])), parCompte = {};
  const rows = trucks.map((t) => {
    const x = zero();
    for (const m of months) {
      const c = calcOf(m, t._id); if (!c) continue;
      add(x, c); add(tot, c); add(parMois.get(m), c); x.mois += 1; parMois.get(m).mois += 1;
      if (emap.has(`${m}|${t._id}`)) x.saisis += 1;
      if (c.net < 0) x.moisPerte += 1;
      for (const [code, v] of Object.entries(c.lignes)) parCompte[code] = (parCompte[code] || 0) + v;
    }
    return { truck: { _id: t._id, immatriculation: t.immatriculation, marque: t.marque, modele: t.modele, chauffeur: t.chauffeur, actif: t.actif }, ...fin(x), attendus: months.length };
  }).filter((r) => r.truck.actif || r.mois > 0).sort((a, b) => b.net - a.net);

  // période précédente (même durée)
  const prev = zero();
  for (const m of monthsBetween(prevFrom, prevTo)) for (const t of trucks) { const c = calcOf(m, t._id); if (c) add(prev, c); }

  // fiches mensuelles manquantes (mois échus, camions actifs) : les charges fixes n'y sont pas saisies
  const now = currentMonth(); const manquantes = [];
  for (const t of trucks.filter((x) => x.actif)) for (const m of months) if (m <= now && !emap.has(`${m}|${t._id}`)) manquantes.push({ truck: t.immatriculation, month: m });

  const postes = (g) => Object.entries(parCompte).filter(([c]) => (g === 'produits' ? LABELS[c].groupe === 'produits' : LABELS[c].groupe !== 'produits'))
    .map(([code, v]) => ({ code, label: LABELS[code].label, groupe: LABELS[code].groupe, montant: r2(v) })).filter((x) => x.montant !== 0).sort((a, b) => b.montant - a.montant);
  const trend = months.map((m) => ({ month: m, ...fin(parMois.get(m)) }));
  const actifs = trend.filter((x) => x.mois > 0);

  // opérations de la période : volume et trajets
  const ops = await Operation.find({ supprime: { $ne: true }, month: { $gte: from, $lte: to } }).lean();
  const trajets = new Map(); let opsA = 0, opsB = 0, opsKm = 0;
  for (const o of ops) {
    const prod = LABELS[o.code]?.groupe === 'produits';
    if (prod) opsA += o.montant; else opsB += o.montant; opsKm += o.km || 0;
    const key = (o.voyage || '').trim(); if (!key) continue;
    const t = trajets.get(key) || { voyage: key, lignes: 0, produits: 0, charges: 0, km: 0 };
    t.lignes += 1; t.km += o.km || 0; if (prod) t.produits += o.montant; else t.charges += o.montant; trajets.set(key, t);
  }
  const trajetsList = [...trajets.values()].map((t) => ({ ...t, produits: r2(t.produits), charges: r2(t.charges), net: r2(t.produits - t.charges), km: r2(t.km) })).sort((a, b) => b.net - a.net);

  return {
    from, to, nbMois: months.length, precedente: { from: prevFrom, to: prevTo }, genereLe: new Date().toISOString(),
    parametres: { societe: settings.societe, tauxIS: settings.tauxIS, cotisationMinimale: settings.cotisationMinimale, cotisationMinimaleActive: settings.cotisationMinimaleActive, dateBascule: settings.dateBascule || '',
      moisEnModeOperations: months.filter((m) => isOpsMonth(m, settings)).length },
    totaux: fin(tot), totauxPrecedents: fin(prev), camions: rows, trend,
    meilleurMois: actifs.length ? actifs.reduce((a, x) => (x.net > a.net ? x : a)) : null, pireMois: actifs.length ? actifs.reduce((a, x) => (x.net < a.net ? x : a)) : null,
    groupes: { variables: r2(tot.variables), fixes: r2(tot.fixes), amortissements: r2(tot.amortissements) },
    produits: postes('produits'), charges: postes('charges'),
    enPerte: rows.filter((r) => r.net < 0).map((r) => ({ _id: r.truck._id, immatriculation: r.truck.immatriculation, net: r.net })),
    fichesManquantes: { total: manquantes.length, exemples: manquantes.slice(0, 12) },
    operations: { lignes: ops.length, km: r2(opsKm), produits: r2(opsA), charges: r2(opsB), meilleursTrajets: trajetsList.slice(0, 8), pireTrajets: trajetsList.filter((t) => t.net < 0).slice(-3).reverse(), nbTrajets: trajetsList.length },
  };
}

export function mountReports(r) {
  const range = (req) => {
    const to = req.query.to || currentMonth();
    const from = req.query.from || `${to.slice(0, 4)}-01`;
    return [from, to];
  };
  r.get('/reports/global', wrap(async (req, res) => res.json(await build(...range(req)))));
  r.get('/export/rapport', wrap(async (req, res) => {
    const rep = await build(...range(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rapport-${rep.from}_${rep.to}.xlsx"`);
    await (await rapportWorkbook(rep)).xlsx.write(res); res.end();
  }));
}
