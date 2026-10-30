import { z } from 'zod';
import { requireRole } from '../auth.js';
import { getSettings, Settings } from '../models.js';
import { r2 } from '../../../shared/doc.js';
import { mountCrud } from './crud.js';
import { wrap, plain, who, httpError, isId, today, zDate, zDateOpt, zId, zMoney, zAmount, zText, zMode } from './util.js';
import { Employe, Contrat, Pointage, Avance, PrimeRetenue, Bulletin, Caisse, nextSeq } from './models.js';
import { syncCaisse } from './commercial.js';
import { addDays } from '../ops.js';

export const PAIE_DEFAUTS = { cnssTaux: 4.48, amoTaux: 2.26, plafondCnss: 6000, majorationHS: 25, joursMois: 26, heuresMois: 191 };
export const paieConfig = async () => { const s = plain(await getSettings()); return { ...PAIE_DEFAUTS, ...(s.paie || {}) }; };
const monthEnd = (p) => `${p}-31`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
const PAID_ABSENCE = ['conge', 'maladie', 'ferie'];

/** Calcul du bulletin d'un employé pour une période (AAAA-MM). Fonction pure sur les données fournies, testable. */
export function calcBulletin(emp, { pointages = [], primes = [], retenues = [], avances = [], ir = 0 }, cfg = PAIE_DEFAUTS) {
  const jours = pointages.filter((p) => p.type === 'present' || PAID_ABSENCE.includes(p.type)).length;
  const presents = pointages.filter((p) => p.type === 'present');
  const absences = pointages.filter((p) => p.type === 'absent').length;
  const heuresSup = r2(pointages.filter((p) => p.type === 'heures_sup').reduce((s, p) => s + (p.heures || 0), 0));
  const heures = r2(presents.reduce((s, p) => s + (p.heures || 8), 0));
  let base = 0, retenueAbsences = 0, montantHS = 0;
  const tauxHoraire = emp.typeSalaire === 'mensuel' ? emp.salaireBase / cfg.heuresMois : emp.typeSalaire === 'journalier' ? emp.salaireBase / 8 : emp.salaireBase;
  if (emp.typeSalaire === 'mensuel') { base = emp.salaireBase; retenueAbsences = r2((absences * emp.salaireBase) / cfg.joursMois); }
  else if (emp.typeSalaire === 'journalier') base = r2(emp.salaireBase * jours);
  else base = r2(emp.salaireBase * heures);
  montantHS = r2(heuresSup * tauxHoraire * (1 + cfg.majorationHS / 100));
  const sumP = r2(primes.reduce((s, p) => s + p.montant, 0)), sumR = r2(retenues.reduce((s, p) => s + p.montant, 0));
  const avancesDetail = avances.filter((a) => a.solde > 0 && a.remboursementMensuel > 0).map((a) => ({ id: String(a._id), montant: r2(Math.min(a.remboursementMensuel, a.solde)) }));
  const sumA = r2(avancesDetail.reduce((s, a) => s + a.montant, 0));
  const brut = r2(base - retenueAbsences + montantHS + sumP);
  const cnss = emp.soumisCnss ? r2((Math.min(brut, cfg.plafondCnss) * cfg.cnssTaux) / 100) : 0;
  const amo = emp.soumisCnss ? r2((brut * cfg.amoTaux) / 100) : 0;
  const net = r2(brut - cnss - amo - ir - sumR - sumA);
  return { base: r2(base), joursTravailles: jours, heures, heuresSup, montantHeuresSup: montantHS, absences, retenueAbsences, primes: sumP, retenues: sumR, avances: sumA, brut, cnss, amo, ir: r2(ir), net, detail: { avancesDetail } };
}

async function periodeVerrouillee(employe, date) {
  return !!(await Bulletin.exists({ employe, periode: date.slice(0, 7), statut: { $ne: 'brouillon' } }));
}
const empPop = { path: 'employe', select: 'nom matricule poste' };

export function mountRH(r) {
  // --- Employés ---
  const empBody = z.object({
    matricule: zText(20), nom: z.string().trim().min(1, 'Le nom est obligatoire').max(120), cin: zText(20), cnss: zText(20), poste: zText(60), departement: zText(60), telephone: zText(40), email: zText(120), adresse: zText(200),
    dateNaissance: zDateOpt, dateEmbauche: zDateOpt, typeContrat: z.enum(['CDI', 'CDD', 'ANAPEC', 'Stage', 'Journalier', 'Autre']).default('CDI'), dateDebutContrat: zDateOpt, dateFinContrat: zDateOpt,
    typeSalaire: z.enum(['mensuel', 'journalier', 'horaire']).default('mensuel'), salaireBase: zMoney, soumisCnss: z.boolean().default(true), truck: z.preprocess((v) => (v === '' ? null : v), z.string().refine(isId).nullable()).default(null),
    statut: z.enum(['actif', 'inactif']).default('actif'), observation: zText(500),
  });
  mountCrud(r, { path: '/rh/employes', Model: Employe, body: empBody, populate: [{ path: 'truck', select: 'immatriculation' }], sort: { nom: 1 }, filters: ['statut', 'poste', 'typeContrat'], search: ['matricule', 'nom', 'cin', 'poste', 'telephone', 'departement'], write: 'admin', read: 'admin',
    pre: async (b, req, ex) => {
      if (!b.matricule) b.matricule = ex?.matricule || `E${String(await nextSeq('EMP')).padStart(3, '0')}`;
      if (await Employe.exists({ matricule: b.matricule, ...(ex ? { _id: { $ne: ex._id } } : {}) })) throw httpError(409, `Le matricule ${b.matricule} existe déjà`);
    },
    onDelete: async (d) => { if (await Bulletin.exists({ employe: d._id }) || await Pointage.exists({ employe: d._id })) throw httpError(409, 'Cet employé a un historique (paie, pointage) : passez-le en inactif'); await Promise.all([Contrat.deleteMany({ employe: d._id }), Avance.deleteMany({ employe: d._id }), PrimeRetenue.deleteMany({ employe: d._id })]); },
    summary: (docs) => ({ kpis: { total: docs.length, actifs: docs.filter((e) => e.statut === 'actif').length, masseSalariale: r2(docs.filter((e) => e.statut === 'actif' && e.typeSalaire === 'mensuel').reduce((s, e) => s + e.salaireBase, 0)) } }) });

  // --- Contrats ---
  const contratBody = z.object({ employe: zId, type: z.enum(['CDI', 'CDD', 'ANAPEC', 'Stage', 'Journalier', 'Autre']).default('CDI'), dateDebut: zDate, dateFin: zDateOpt, salaireBase: zMoney, poste: zText(60), statut: z.enum(['actif', 'termine']).default('actif'), observation: zText(500) })
    .superRefine((b, ctx) => { if (b.dateFin && b.dateFin < b.dateDebut) ctx.addIssue({ code: 'custom', path: ['dateFin'], message: 'La fin précède le début' }); if (b.type === 'CDD' && !b.dateFin) ctx.addIssue({ code: 'custom', path: ['dateFin'], message: 'Un CDD a une date de fin' }); });
  mountCrud(r, { path: '/rh/contrats', Model: Contrat, body: contratBody, populate: [empPop], sort: { dateDebut: -1 }, filters: ['employe', 'statut', 'type'], refFilters: ['employe'], search: ['employe.nom', 'employe.matricule', 'type', 'poste'], write: 'admin', read: 'admin',
    pre: async (b) => { if (!(await Employe.exists({ _id: b.employe }))) throw httpError(404, 'Employé introuvable'); },
    post: async (d) => { if (d.statut === 'actif') { await Contrat.updateMany({ employe: d.employe, _id: { $ne: d._id }, statut: 'actif' }, { $set: { statut: 'termine' } });
      await Employe.updateOne({ _id: d.employe }, { $set: { typeContrat: d.type, dateDebutContrat: d.dateDebut, dateFinContrat: d.dateFin, ...(d.salaireBase ? { salaireBase: d.salaireBase } : {}), ...(d.poste ? { poste: d.poste } : {}) } }); } } });

  r.get('/rh/alertes', requireRole(), wrap(async (_req, res) => {
    const t = today();
    const emps = await Employe.find({ statut: 'actif', dateFinContrat: { $ne: '' } }).lean();
    const rows = emps.map((e) => { const j = daysBetween(t, e.dateFinContrat); return { id: String(e._id), nom: e.nom, matricule: e.matricule, poste: e.poste, typeContrat: e.typeContrat, dateFin: e.dateFinContrat, jours: j, statut: j < 0 ? 'expire' : j <= 7 ? 'j7' : j <= 15 ? 'j15' : j <= 30 ? 'j30' : 'ok' }; })
      .filter((x) => x.statut !== 'ok').sort((a, b) => a.jours - b.jours);
    const c = (s) => rows.filter((x) => x.statut === s).length;
    res.json({ kpis: { expire: c('expire'), j7: c('j7'), j15: c('j15'), j30: c('j30'), total: rows.length }, items: rows });
  }));

  // --- Pointage ---
  const pointBody = z.object({ employe: zId, date: zDate, type: z.enum(['present', 'absent', 'conge', 'maladie', 'ferie', 'heures_sup']).default('present'), heures: zMoney, observation: zText(200) });
  mountCrud(r, { path: '/rh/pointage', Model: Pointage, body: pointBody, populate: [empPop], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['employe', 'type'], refFilters: ['employe'], search: ['employe.nom', 'employe.matricule', 'observation'], write: 'admin', read: 'admin',
    lock: async (d) => ((await periodeVerrouillee(d.employe, d.date)) ? 'Paie de la période validée : annulez la validation pour modifier le pointage' : null),
    canDelete: async (d) => ((await periodeVerrouillee(d.employe, d.date)) ? 'Paie de la période validée' : null),
    pre: async (b, req, ex) => {
      if (!(await Employe.exists({ _id: b.employe }))) throw httpError(404, 'Employé introuvable');
      if (await periodeVerrouillee(b.employe, b.date)) throw httpError(409, 'Paie de la période validée');
      if (b.type === 'heures_sup' && !(b.heures > 0)) throw httpError(400, "Indiquez le nombre d'heures supplémentaires");
      if (await Pointage.exists({ employe: b.employe, date: b.date, type: b.type, ...(ex ? { _id: { $ne: ex._id } } : {}) })) throw httpError(409, 'Un pointage de ce type existe déjà pour cet employé ce jour-là');
    },
    summary: (docs) => { const c = (t) => docs.filter((d) => d.type === t).length; return { kpis: { present: c('present'), absent: c('absent'), conge: c('conge'), maladie: c('maladie'), ferie: c('ferie'), heuresSup: r2(docs.filter((d) => d.type === 'heures_sup').reduce((s, d) => s + d.heures, 0)) } }; } });
  r.post('/rh/pointage/lot', requireRole(), wrap(async (req, res) => {
    const b = z.object({ date: zDate, type: z.enum(['present', 'absent', 'conge', 'maladie', 'ferie']).default('present'), employes: z.array(zId).min(1).max(500) }).parse(req.body);
    let n = 0;
    for (const e of b.employes) { if (await periodeVerrouillee(e, b.date)) continue; if (await Pointage.exists({ employe: e, date: b.date, type: b.type })) continue; await Pointage.create({ employe: e, date: b.date, type: b.type }); n++; }
    res.status(201).json({ ok: true, crees: n, ignores: b.employes.length - n });
  }));

  // --- Avances ---
  const avBody = z.object({ employe: zId, date: zDate, montant: zAmount, motif: zText(200), remboursementMensuel: zMoney });
  mountCrud(r, { path: '/rh/avances', Model: Avance, body: avBody, populate: [empPop], sort: { date: -1 }, dateField: 'date', filters: ['employe', 'statut'], refFilters: ['employe'], search: ['employe.nom', 'employe.matricule', 'motif'], write: 'admin', read: 'admin',
    pre: async (b, req, ex) => {
      if (!(await Employe.exists({ _id: b.employe }))) throw httpError(404, 'Employé introuvable');
      if (b.remboursementMensuel > b.montant) throw httpError(400, 'Le remboursement mensuel dépasse le montant de l\'avance');
      const rembourse = ex ? ex.montant - ex.solde : 0; if (b.montant < rembourse - 0.005) throw httpError(400, `Montant inférieur à ce qui a déjà été remboursé (${r2(rembourse)} DHS)`);
      b.solde = r2(b.montant - rembourse); b.statut = b.solde <= 0.005 ? 'soldee' : 'en_cours';
    },
    canDelete: (d) => (d.montant - d.solde > 0.005 ? 'Cette avance est en cours de remboursement' : null),
    summary: (docs) => ({ kpis: { nb: docs.length, total: r2(docs.reduce((s, a) => s + a.montant, 0)), solde: r2(docs.reduce((s, a) => s + a.solde, 0)), enCours: docs.filter((a) => a.statut === 'en_cours').length } }) });

  // --- Primes / retenues ---
  const prBody = z.object({ employe: zId, date: zDate, type: z.enum(['prime', 'retenue']), libelle: z.string().trim().min(1, 'Libellé obligatoire').max(200), montant: zAmount });
  mountCrud(r, { path: '/rh/primes', Model: PrimeRetenue, body: prBody, populate: [empPop], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['employe', 'type', 'source'], refFilters: ['employe'], search: ['employe.nom', 'employe.matricule', 'libelle'], write: 'admin', read: 'admin',
    lock: async (d) => (d.source !== 'manuel' ? 'Créée depuis le Gasoil : retirez le transfert depuis la page Gasoil' : (await periodeVerrouillee(d.employe, d.date)) ? 'Paie de la période validée' : null),
    canDelete: async (d) => (d.source !== 'manuel' ? 'Créée depuis le Gasoil : retirez le transfert depuis la page Gasoil' : (await periodeVerrouillee(d.employe, d.date)) ? 'Paie de la période validée' : null),
    pre: async (b, req, ex) => { if (!(await Employe.exists({ _id: b.employe }))) throw httpError(404, 'Employé introuvable'); if (await periodeVerrouillee(b.employe, b.date)) throw httpError(409, 'Paie de la période validée'); if (!ex) b.source = 'manuel'; },
    summary: (docs) => ({ kpis: { primes: r2(docs.filter((d) => d.type === 'prime').reduce((s, d) => s + d.montant, 0)), retenues: r2(docs.filter((d) => d.type === 'retenue').reduce((s, d) => s + d.montant, 0)), nb: docs.length } }) });

  // --- Paie ---
  const admin = requireRole();
  r.get('/rh/paie/config', admin, wrap(async (_req, res) => res.json(await paieConfig())));
  r.put('/rh/paie/config', admin, wrap(async (req, res) => {
    const b = z.object({ cnssTaux: z.number().min(0).max(30), amoTaux: z.number().min(0).max(30), plafondCnss: z.number().min(0).max(1e6), majorationHS: z.number().min(0).max(200), joursMois: z.number().min(20).max(31), heuresMois: z.number().min(100).max(260) }).parse(req.body);
    await Settings.updateOne({ key: 'main' }, { $set: { paie: b } }); res.json(b);
  }));
  const PERIODE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');

  r.get('/rh/paie', admin, wrap(async (req, res) => {
    const periode = PERIODE.parse(req.query.periode || today().slice(0, 7));
    const list = await Bulletin.find({ periode }).populate('employe', 'nom matricule poste typeSalaire').lean();
    list.sort((a, b) => (a.employe?.nom || '').localeCompare(b.employe?.nom || ''));
    const s = (k) => r2(list.reduce((a, b) => a + b[k], 0));
    const statuts = new Set(list.map((b) => b.statut));
    res.json({ periode, items: list, statut: !list.length ? 'vide' : statuts.size === 1 ? [...statuts][0] : statuts.has('brouillon') ? 'brouillon' : 'validee',
      totaux: { brut: s('brut'), cnss: s('cnss'), amo: s('amo'), ir: s('ir'), net: s('net'), retenues: s('retenues'), avances: s('avances'), primes: s('primes'), nb: list.length, payes: list.filter((b) => b.statut === 'payee').length } });
  }));

  r.post('/rh/paie/generer', admin, wrap(async (req, res) => {
    const { periode } = z.object({ periode: PERIODE }).parse(req.body);
    const cfg = await paieConfig();
    const emps = await Employe.find({ statut: 'actif' }).lean();
    let crees = 0, maj = 0, ignores = 0;
    for (const e of emps) {
      if (e.dateEmbauche && e.dateEmbauche > monthEnd(periode)) { ignores++; continue; }
      const ex = await Bulletin.findOne({ employe: e._id, periode });
      if (ex && ex.statut !== 'brouillon') { ignores++; continue; }
      const [pointages, pr, avances] = await Promise.all([Pointage.find({ employe: e._id, date: { $gte: `${periode}-01`, $lte: monthEnd(periode) } }).lean(), PrimeRetenue.find({ employe: e._id, date: { $gte: `${periode}-01`, $lte: monthEnd(periode) } }).lean(), Avance.find({ employe: e._id, statut: 'en_cours', date: { $lte: monthEnd(periode) } }).lean()]);
      const calc = calcBulletin(e, { pointages, primes: pr.filter((p) => p.type === 'prime'), retenues: pr.filter((p) => p.type === 'retenue'), avances, ir: ex?.ir || 0 }, cfg);
      if (ex) { ex.set(calc); await ex.save(); maj++; } else { await Bulletin.create({ employe: e._id, periode, ...calc }); crees++; }
    }
    res.json({ ok: true, crees, majs: maj, ignores });
  }));

  r.put('/rh/paie/bulletins/:id', admin, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const b = z.object({ ir: zMoney }).parse(req.body);
    const bu = await Bulletin.findById(req.params.id); if (!bu) throw httpError(404, 'Bulletin introuvable');
    if (bu.statut !== 'brouillon') throw httpError(409, 'Bulletin validé : annulez la validation pour le modifier');
    bu.ir = b.ir; bu.net = r2(bu.brut - bu.cnss - bu.amo - bu.ir - bu.retenues - bu.avances); await bu.save(); res.json(plain(bu));
  }));
  r.get('/rh/paie/bulletins/:id', admin, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const bu = await Bulletin.findById(req.params.id).populate('employe').lean(); if (!bu) throw httpError(404, 'Bulletin introuvable');
    const [pr, cfg] = await Promise.all([PrimeRetenue.find({ employe: bu.employe._id, date: { $gte: `${bu.periode}-01`, $lte: monthEnd(bu.periode) } }).lean(), paieConfig()]);
    res.json({ ...bu, primesDetail: pr, config: cfg });
  }));

  r.post('/rh/paie/valider', admin, wrap(async (req, res) => {
    const { periode } = z.object({ periode: PERIODE }).parse(req.body);
    const list = await Bulletin.find({ periode, statut: 'brouillon' }); if (!list.length) throw httpError(409, 'Aucun bulletin à valider : générez la paie d\'abord');
    for (const bu of list) {
      for (const a of bu.detail?.avancesDetail || []) { const av = await Avance.findById(a.id); if (av) { av.solde = r2(Math.max(0, av.solde - a.montant)); av.statut = av.solde <= 0.005 ? 'soldee' : 'en_cours'; await av.save(); } }
      bu.statut = 'validee'; await bu.save();
    }
    res.json({ ok: true, valides: list.length });
  }));
  r.post('/rh/paie/devalider', admin, wrap(async (req, res) => {
    const { periode } = z.object({ periode: PERIODE }).parse(req.body);
    if (await Bulletin.exists({ periode, statut: 'payee' })) throw httpError(409, 'Des bulletins sont déjà payés : impossible d\'annuler la validation');
    const list = await Bulletin.find({ periode, statut: 'validee' }); if (!list.length) throw httpError(409, 'Aucun bulletin validé pour cette période');
    for (const bu of list) { for (const a of bu.detail?.avancesDetail || []) { const av = await Avance.findById(a.id); if (av) { av.solde = r2(Math.min(av.montant, av.solde + a.montant)); av.statut = 'en_cours'; await av.save(); } } bu.statut = 'brouillon'; await bu.save(); }
    res.json({ ok: true, rouverts: list.length });
  }));
  r.post('/rh/paie/bulletins/:id/payer', admin, wrap(async (req, res) => {
    if (!isId(req.params.id)) throw httpError(400, 'Identifiant invalide');
    const b = z.object({ date: zDate.default(today()), mode: zMode.default('virement') }).parse(req.body);
    const bu = await Bulletin.findById(req.params.id).populate('employe', 'nom matricule'); if (!bu) throw httpError(404, 'Bulletin introuvable');
    if (bu.statut !== 'validee') throw httpError(409, bu.statut === 'payee' ? 'Déjà payé' : 'Validez la paie avant de payer');
    bu.statut = 'payee'; bu.datePaiement = b.date; bu.modePaiement = b.mode; await bu.save();
    await syncCaisse('paie', bu._id, { date: b.date, sens: 'sortie', libelle: `Salaire ${bu.periode} — ${bu.employe?.nom || ''}`, montant: bu.net, mode: b.mode });
    res.json({ ok: true });
  }));
  r.post('/rh/paie/bulletins/:id/annuler-paiement', admin, wrap(async (req, res) => {
    const bu = await Bulletin.findById(req.params.id); if (!bu || bu.statut !== 'payee') throw httpError(409, 'Bulletin non payé');
    bu.statut = 'validee'; bu.datePaiement = ''; bu.modePaiement = ''; await bu.save(); await Caisse.deleteMany({ source: 'paie', refId: String(bu._id) }); res.json({ ok: true });
  }));
}
