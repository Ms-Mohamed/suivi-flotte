import { z } from 'zod';
import { requireRole } from '../auth.js';
import { r2 } from '../../../shared/doc.js';
import { mountCrud } from './crud.js';
import { wrap, httpError, today, zDate, zId, zIdOpt, zMoney, zAmount, zText, zMode } from './util.js';
import { SousTraitant, VehiculeST, Mission, PaiementST, Caisse } from './models.js';
import { syncCaisse } from './commercial.js';

const tiersBody = z.object({ nom: z.string().trim().min(1, 'Le nom est obligatoire').max(120), ice: zText(30), if: zText(30), rc: zText(30), adresse: zText(200), ville: zText(60), telephone: zText(40), email: zText(120), contact: zText(80), notes: zText(1000), actif: z.boolean().default(true) });
const paidByMission = async (ids) => { const m = new Map(); for (const p of await PaiementST.find({ mission: { $in: ids } }).lean()) m.set(String(p.mission), (m.get(String(p.mission)) || 0) + p.montant); return m; };

export function mountSousTraitance(r) {
  mountCrud(r, { path: '/sous-traitants', Model: SousTraitant, body: tiersBody, sort: { nom: 1 }, filters: ['actif'], search: ['nom', 'ice', 'ville', 'telephone', 'email', 'contact'],
    onDelete: async (d) => { if (await Mission.exists({ sousTraitant: d._id }) || await VehiculeST.exists({ sousTraitant: d._id })) throw httpError(409, 'Ce sous-traitant a des missions ou des véhicules : désactivez-le'); } });

  r.get('/sous-traitants-soldes', wrap(async (_req, res) => {
    const [sts, missions, pays] = await Promise.all([SousTraitant.find({}).sort({ nom: 1 }).lean(), Mission.find({ type: 'soustraite', statut: 'terminee' }).lean(), PaiementST.find({}).lean()]);
    const items = sts.map((s) => { const ms = missions.filter((m) => String(m.sousTraitant) === String(s._id)); const du = ms.reduce((a, m) => a + m.coutST, 0); const paye = pays.filter((p) => String(p.sousTraitant) === String(s._id)).reduce((a, p) => a + p.montant, 0);
      return { id: String(s._id), nom: s.nom, missions: ms.length, tonnage: r2(ms.reduce((a, m) => a + m.tonnage, 0)), du: r2(du), paye: r2(paye), reste: r2(du - paye) }; });
    res.json({ items, totaux: { du: r2(items.reduce((a, x) => a + x.du, 0)), paye: r2(items.reduce((a, x) => a + x.paye, 0)), reste: r2(items.reduce((a, x) => a + x.reste, 0)) } });
  }));

  mountCrud(r, { path: '/vehicules-st', Model: VehiculeST, body: z.object({ sousTraitant: zId, immatriculation: z.string().trim().min(1, 'Immatriculation obligatoire').max(30), type: zText(40), capaciteTonnes: zMoney, chauffeur: zText(80), telephone: zText(40), actif: z.boolean().default(true) }),
    populate: [{ path: 'sousTraitant', select: 'nom' }], sort: { immatriculation: 1 }, filters: ['sousTraitant', 'actif'], refFilters: ['sousTraitant'], search: ['immatriculation', 'type', 'chauffeur', 'sousTraitant.nom'],
    onDelete: async (d) => { if (await Mission.exists({ vehiculeST: d._id })) throw httpError(409, 'Ce véhicule est utilisé par des missions : désactivez-le'); } });

  // Opérations de sous-traitance = missions sous-traitées, avec ce qui est déjà payé
  r.get('/st/operations', wrap(async (req, res) => {
    const q = { type: 'soustraite', statut: { $ne: 'annulee' } };
    if (req.query.sousTraitant) q.sousTraitant = req.query.sousTraitant;
    if (req.query.statut) q.statut = req.query.statut;
    if (req.query.from || req.query.to) { q.dateMission = {}; if (req.query.from) q.dateMission.$gte = req.query.from; if (req.query.to) q.dateMission.$lte = req.query.to; }
    const ms = await Mission.find(q).populate('client', 'nom').populate('sousTraitant', 'nom').populate('vehiculeST', 'immatriculation').sort({ dateMission: -1 }).lean();
    const paid = await paidByMission(ms.map((m) => m._id));
    const items = ms.map((m) => ({ id: String(m._id), ref: m.ref, date: m.dateMission, client: m.client?.nom || '', sousTraitant: m.sousTraitant?.nom || '', vehicule: m.vehiculeST?.immatriculation || '', trajet: `${m.villeCharge} → ${m.villeDecharge}`, tonnage: m.tonnage, revenu: m.totalHT, cout: m.coutST, marge: r2(m.totalHT - m.coutST - m.charges.reduce((s, c) => s + c.montant, 0)), paye: r2(paid.get(String(m._id)) || 0), reste: r2(m.coutST - (paid.get(String(m._id)) || 0)), statut: m.statut }));
    const s = (k) => r2(items.reduce((a, x) => a + x[k], 0));
    res.json({ items, totaux: { nb: items.length, tonnage: s('tonnage'), revenu: s('revenu'), cout: s('cout'), marge: s('marge'), paye: s('paye'), reste: s('reste') } });
  }));

  r.get('/st/tonnage', wrap(async (req, res) => {
    const from = req.query.from || `${today().slice(0, 4)}-01-01`, to = req.query.to || today();
    const q = { type: 'soustraite', statut: { $nin: ['annulee', 'brouillon'] }, dateMission: { $gte: from, $lte: to } }; if (req.query.sousTraitant) q.sousTraitant = req.query.sousTraitant;
    const ms = await Mission.find(q).populate('sousTraitant', 'nom').populate('vehiculeST', 'immatriculation').lean();
    const paid = await paidByMission(ms.map((m) => m._id));
    const g = new Map();
    for (const m of ms) { const k = `${m.sousTraitant?._id}|${m.vehiculeST?._id || ''}`; const c = g.get(k) || { sousTraitant: m.sousTraitant?.nom || '—', matricule: m.vehiculeST?.immatriculation || 'Non renseigné', missions: 0, tonnage: 0, montant: 0, paye: 0 };
      c.missions++; c.tonnage += m.tonnage; c.montant += m.coutST; c.paye += paid.get(String(m._id)) || 0; g.set(k, c); }
    const items = [...g.values()].map((c) => ({ ...c, tonnage: r2(c.tonnage), montant: r2(c.montant), paye: r2(c.paye), reste: r2(c.montant - c.paye) })).sort((a, b) => b.tonnage - a.tonnage);
    const s = (k) => r2(items.reduce((a, x) => a + x[k], 0));
    res.json({ from, to, items, totaux: { tonnage: s('tonnage'), missions: items.reduce((a, x) => a + x.missions, 0), montant: s('montant'), paye: s('paye'), reste: s('reste'), sousTraitants: new Set(items.map((x) => x.sousTraitant)).size, vehicules: items.length } });
  }));

  const payBody = z.object({ sousTraitant: zId, mission: zIdOpt, date: zDate, montant: zAmount, mode: zMode, reference: zText(60), observation: zText(300) });
  mountCrud(r, { path: '/paiements-st', Model: PaiementST, body: payBody, populate: [{ path: 'sousTraitant', select: 'nom' }, { path: 'mission', select: 'ref coutST villeCharge villeDecharge' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['sousTraitant', 'mission', 'mode'], refFilters: ['sousTraitant', 'mission'],
    search: ['reference', 'sousTraitant.nom', 'mission.ref', 'observation'],
    pre: async (b, req, ex) => {
      if (!(await SousTraitant.exists({ _id: b.sousTraitant }))) throw httpError(404, 'Sous-traitant introuvable');
      if (b.mission) { const m = await Mission.findById(b.mission).lean(); if (!m || m.type !== 'soustraite') throw httpError(404, 'Mission sous-traitée introuvable'); if (String(m.sousTraitant) !== String(b.sousTraitant)) throw httpError(400, "Cette mission est confiée à un autre sous-traitant");
        const paid = (await paidByMission([m._id])).get(String(m._id)) || 0; const reste = m.coutST - paid + (ex && String(ex.mission) === String(b.mission) ? ex.montant : 0);
        if (b.montant > reste + 0.005) throw httpError(400, `Le paiement dépasse le reste dû pour cette mission (${r2(reste)} DHS)`); }
    },
    post: (d) => syncCaisse('paiement_st', d._id, { date: d.date, sens: 'sortie', libelle: `Sous-traitant ${d.reference || ''}`.trim(), montant: d.montant, mode: d.mode }), onDelete: (d) => Caisse.deleteMany({ source: 'paiement_st', refId: String(d._id) }),
    summary: (docs) => ({ kpis: { nb: docs.length, total: r2(docs.reduce((s, p) => s + p.montant, 0)) } }) });
}
