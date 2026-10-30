// Calculs communs aux documents commerciaux (devis, BL, factures, avoirs, achats) — utilisés par l'API et l'interface.
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : 0; };
export const TVA_TAUX = [0, 7, 10, 14, 20];

/**
 * lignes : [{ designation, qte, pu, tva }]   remisePct : remise globale en % sur le HT
 * fraisSupp : [{ libelle, montant, tva }]    (montants HT)
 * Retourne les totaux arrondis ; la TVA est calculée par taux sur la base remisée.
 */
export function calcDoc({ lignes = [], remisePct = 0, fraisSupp = [] } = {}) {
  const k = 1 - Math.min(100, Math.max(0, num(remisePct))) / 100;
  const groups = new Map();
  let brut = 0;
  const add = (ht, tva) => { brut += ht; const t = num(tva); groups.set(t, (groups.get(t) || 0) + ht); };
  const lines = lignes.map((l) => { const ht = r2(num(l.qte) * num(l.pu)); add(ht, l.tva); return { ...l, totalHT: ht, totalTTC: r2(ht * k * (1 + num(l.tva) / 100)) }; });
  for (const f of fraisSupp) add(r2(num(f.montant)), f.tva);
  const parTaux = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([taux, base]) => {
    const b = r2(base * k); return { taux, base: b, tva: r2((b * taux) / 100) };
  });
  const totalBrutHT = r2(brut);
  const totalHT = r2(parTaux.reduce((s, g) => s + g.base, 0));
  const totalTVA = r2(parTaux.reduce((s, g) => s + g.tva, 0));
  return { lines, totalBrutHT, remise: r2(totalBrutHT - totalHT), totalHT, totalTVA, totalTTC: r2(totalHT + totalTVA), parTaux };
}

/** Montant d'une mission : tonnage × prix unitaire (ou forfait) + frais. */
export function calcMission(m = {}) {
  const base = m.mode === 'forfait' ? num(m.prixForfait) : num(m.tonnage) * num(m.prixUnitaire);
  const frais = num(m.fraisChargement) + num(m.fraisDechargement) + num(m.fraisImmobilisation);
  const ht = r2(base + frais);
  const tva = r2((ht * num(m.tva)) / 100);
  return { base: r2(base), frais: r2(frais), totalHT: ht, totalTVA: tva, totalTTC: r2(ht + tva) };
}

/** Statut de règlement d'un document : payee | partielle | impayee | en_retard. */
export function statutReglement({ totalTTC = 0, paye = 0, avoirs = 0, echeance = '', today = new Date().toISOString().slice(0, 10) }) {
  const reste = r2(num(totalTTC) - num(paye) - num(avoirs));
  if (num(totalTTC) > 0 && reste <= 0.005) return { reste: 0, statut: 'payee' };
  const base = num(paye) > 0 ? 'partielle' : 'impayee';
  return { reste, statut: echeance && echeance < today ? 'en_retard' : base };
}
