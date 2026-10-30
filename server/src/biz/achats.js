import { z } from 'zod';
import { calcDoc, statutReglement, r2 } from '../../../shared/doc.js';
import { mountCrud } from './crud.js';
import { wrap, httpError, isId, today, zDate, zDateOpt, zId, zMoney, zAmount, zText, zTva, zMode, zLignes, zFrais } from './util.js';
import { Fournisseur, Article, Achat, PaiementFournisseur, Caisse, nextNumber } from './models.js';
import { applyTotals, syncCaisse } from './commercial.js';

const tiersBody = z.object({ nom: z.string().trim().min(1, 'Le nom est obligatoire').max(120), ice: zText(30), if: zText(30), rc: zText(30), adresse: zText(200), ville: zText(60), telephone: zText(40), email: zText(120), contact: zText(80), notes: zText(1000), actif: z.boolean().default(true), delaiPaiement: z.number().int().min(0).max(365).default(30) });
export async function recomputeAchat(id) {
  const a = await Achat.findById(id); if (!a) return null;
  a.paye = r2((await PaiementFournisseur.find({ achat: id }).lean()).reduce((s, p) => s + p.montant, 0)); a.reste = r2(a.totalTTC - a.paye); await a.save(); return a;
}
const regl = (a) => (a.statut === 'validee' ? statutReglement({ totalTTC: a.totalTTC, paye: a.paye, echeance: a.echeance }) : { reste: 0, statut: a.statut });
const achatView = (a) => { const s = regl(a); return { ...a, reglement: a.statut === 'validee' ? s.statut : a.statut, reste: a.statut === 'validee' ? s.reste : 0 }; };

export function mountAchats(r) {
  mountCrud(r, { path: '/fournisseurs', Model: Fournisseur, body: tiersBody, sort: { nom: 1 }, filters: ['actif'], search: ['nom', 'ice', 'ville', 'telephone', 'email', 'contact'],
    onDelete: async (d) => { if (await Achat.exists({ fournisseur: d._id })) throw httpError(409, 'Ce fournisseur a des achats : désactivez-le'); } });
  mountCrud(r, { path: '/articles', Model: Article, body: z.object({ reference: zText(40), designation: z.string().trim().min(1, 'Désignation obligatoire').max(200), categorie: zText(60), unite: zText(20), prixAchat: zMoney, tva: zTva, actif: z.boolean().default(true) }),
    sort: { designation: 1 }, filters: ['categorie', 'actif'], search: ['reference', 'designation', 'categorie'] });

  const achatBody = z.object({ fournisseur: zId, numeroFournisseur: zText(60), date: zDate, echeance: zDateOpt, statut: z.enum(['brouillon', 'validee', 'annulee']).default('validee'), lignes: zLignes, fraisSupp: zFrais, remisePct: z.number().min(0).max(100).default(0), observation: zText(500) });
  mountCrud(r, { path: '/achats', Model: Achat, body: achatBody, populate: [{ path: 'fournisseur', select: 'nom ice adresse ville' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['fournisseur', 'statut'], refFilters: ['fournisseur'],
    search: ['numero', 'numeroFournisseur', 'fournisseur.nom', 'observation'], view: achatView, lock: (d) => (d.statut === 'annulee' ? 'Achat annulé' : null),
    postFilter: (docs, q) => (q.reglement ? docs.filter((a) => achatView(a).reglement === q.reglement) : docs),
    pre: async (b, req, ex) => {
      const f = await Fournisseur.findById(b.fournisseur).lean(); if (!f) throw httpError(404, 'Fournisseur introuvable');
      const t = applyTotals(b); if (b.statut !== 'brouillon' && !(t.totalTTC > 0)) throw httpError(400, 'Un achat doit avoir au moins une ligne avec un montant');
      if (!b.echeance) { const d = new Date(`${b.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (f.delaiPaiement ?? 30)); b.echeance = d.toISOString().slice(0, 10); }
      if (ex) { const paye = (await PaiementFournisseur.find({ achat: ex._id }).lean()).reduce((s, p) => s + p.montant, 0); if (t.totalTTC < paye - 0.005) throw httpError(400, `Le total ne peut pas être inférieur aux paiements déjà faits (${r2(paye)} DHS)`); if (b.statut === 'annulee' && paye > 0) throw httpError(409, 'Cet achat a des paiements : supprimez-les d\'abord'); }
      else b.numero = await nextNumber('ACH', Number(b.date.slice(0, 4)));
    }, post: (d) => recomputeAchat(d._id),
    onDelete: async (d) => { if (await PaiementFournisseur.exists({ achat: d._id })) throw httpError(409, 'Cet achat a des paiements : supprimez-les d\'abord'); },
    summary: (docs) => { const v = docs.filter((a) => a.statut === 'validee').map(achatView); return { kpis: { nb: docs.length, ttc: r2(v.reduce((s, a) => s + a.totalTTC, 0)), paye: r2(v.reduce((s, a) => s + a.paye, 0)), reste: r2(v.reduce((s, a) => s + a.reste, 0)), enRetard: v.filter((a) => a.reglement === 'en_retard').length } }; } });

  const payBody = z.object({ achat: zId, date: zDate, montant: zAmount, mode: zMode, reference: zText(60), observation: zText(300) });
  mountCrud(r, { path: '/paiements-fournisseurs', Model: PaiementFournisseur, body: payBody, populate: [{ path: 'fournisseur', select: 'nom' }, { path: 'achat', select: 'numero numeroFournisseur totalTTC' }], sort: { date: -1, createdAt: -1 }, dateField: 'date', filters: ['fournisseur', 'achat', 'mode'], refFilters: ['fournisseur', 'achat'],
    search: ['reference', 'fournisseur.nom', 'achat.numero', 'achat.numeroFournisseur', 'observation'],
    pre: async (b, req, ex) => {
      const a = await recomputeAchat(b.achat); if (!a) throw httpError(404, 'Achat introuvable'); if (a.statut !== 'validee') throw httpError(409, 'Seul un achat validé peut être réglé');
      const reste = a.reste + (ex && String(ex.achat) === String(b.achat) ? ex.montant : 0); if (b.montant > reste + 0.005) throw httpError(400, `Le paiement dépasse le reste à payer (${r2(reste)} DHS)`);
      b.fournisseur = a.fournisseur;
    },
    post: async (d, req, before) => { const a = await recomputeAchat(d.achat); if (before && String(before.achat) !== String(d.achat)) await recomputeAchat(before.achat);
      await syncCaisse('paiement_fournisseur', d._id, { date: d.date, sens: 'sortie', libelle: `Achat ${a?.numero || ''}`, montant: d.montant, mode: d.mode }); },
    onDelete: (d) => Caisse.deleteMany({ source: 'paiement_fournisseur', refId: String(d._id) }), afterDelete: (d) => recomputeAchat(d.achat),
    summary: (docs) => ({ kpis: { nb: docs.length, total: r2(docs.reduce((s, p) => s + p.montant, 0)) } }) });

  r.get('/releve-achats', wrap(async (req, res) => {
    const q = { statut: 'validee' }; if (req.query.fournisseur) { if (!isId(req.query.fournisseur)) throw httpError(400, 'Fournisseur invalide'); q.fournisseur = req.query.fournisseur; }
    if (req.query.from || req.query.to) { q.date = {}; if (req.query.from) q.date.$gte = req.query.from; if (req.query.to) q.date.$lte = req.query.to; }
    let list = (await Achat.find(q).populate('fournisseur', 'nom').sort({ date: -1 }).lean()).map(achatView);
    if (req.query.statut) list = list.filter((a) => a.reglement === req.query.statut);
    const pays = await PaiementFournisseur.find({ achat: { $in: list.map((a) => a._id) } }).sort({ date: -1 }).lean(); const last = new Map(); for (const p of pays) if (!last.has(String(p.achat))) last.set(String(p.achat), p);
    const items = list.map((a) => ({ id: String(a._id), numero: a.numero, numeroFournisseur: a.numeroFournisseur, date: a.date, echeance: a.echeance, fournisseur: a.fournisseur?.nom || '', ttc: a.totalTTC, paye: a.paye, reste: a.reste, reglement: a.reglement, dernierPaiement: last.get(String(a._id))?.date || '', mode: last.get(String(a._id))?.mode || '' }));
    const s = (k) => r2(items.reduce((x, i) => x + i[k], 0));
    res.json({ items, totaux: { achete: s('ttc'), paye: s('paye'), reste: s('reste'), nonPayes: items.filter((x) => x.reglement === 'impayee' || x.reglement === 'en_retard').length, partiels: items.filter((x) => x.reglement === 'partielle').length, payes: items.filter((x) => x.reglement === 'payee').length } });
  }));
}
