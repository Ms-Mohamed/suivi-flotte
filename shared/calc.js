// Logique de calcul UNIQUE, partagée par l'API (Node) et l'interface (React).
// Elle reproduit exactement le document « Situation camion » :
//   Total A = somme des comptes 71 ; Total B = variables + fixes + amortissements
//   Résultat brut = A − B ; Résultat net = Brut − Impôt (T)
import schema from './plan_comptable.json' with { type: 'json' };

export const PLAN = schema;
export const CODE_VENTES = '71210000';     // Km chargés × Tarif au km (ou total factures)
export const CODE_GAZOLE = '61221000';     // Volume consommé × Prix moyen du litre
export const CODES_ANNUELS = ['61610000', '61900000']; // Taxe annuelle / 12, Dotation annuelle / 12

export const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : v;
  return Number.isFinite(n) ? n : 0;
};
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const DEFAULT_SETTINGS = { tauxIS: 20, cotisationMinimale: 0.25, cotisationMinimaleActive: true };

/** Montant saisi dans la fiche mensuelle (hors opérations datées), selon le mode choisi. */
export function montantBase(entry, code) {
  const amounts = entry.amounts || {};
  const modes = entry.modes || {};
  if (code === CODE_VENTES && modes[code] !== 'factures') return r2(num(entry.km) * num(entry.tarifKm));
  if (code === CODE_GAZOLE && modes[code] !== 'montant') return r2(num(entry.litres) * num(entry.prixLitre));
  if (CODES_ANNUELS.includes(code) && modes[code] !== 'mensuel') return r2(num((entry.annuel || {})[code]) / 12);
  return r2(num(amounts[code]));
}

/** Total des opérations datées du mois pour un compte (entry.ops = { totals: {code: montant}, km, n }). */
export const montantOps = (entry, code) => r2(num(entry.ops?.totals?.[code]));

/** Montant mensuel d'un compte = saisie de la fiche + opérations datées. */
export function montantCompte(entry, code) {
  return r2(montantBase(entry, code) + montantOps(entry, code));
}

export function calcEntry(entry = {}, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const lignes = {};
  let A = 0;
  for (const p of PLAN.produits) { lignes[p.code] = montantCompte(entry, p.code); A += lignes[p.code]; }
  const sous = {};
  let B = 0;
  for (const g of PLAN.charges) {
    sous[g.key] = 0;
    for (const c of g.comptes) { lignes[c.code] = montantCompte(entry, c.code); sous[g.key] += lignes[c.code]; }
    sous[g.key] = r2(sous[g.key]); B += sous[g.key];
  }
  A = r2(A); B = r2(B);
  const brut = r2(A - B);
  const is = brut > 0 ? r2((brut * num(s.tauxIS)) / 100) : 0;
  const cm = s.cotisationMinimaleActive ? r2((A * num(s.cotisationMinimale)) / 100) : 0;
  const impotAuto = r2(Math.max(is, cm));
  const manuel = entry.impot?.mode === 'manuel';
  const impot = manuel ? r2(num(entry.impot.montant)) : impotAuto;
  const net = r2(brut - impot);
  // Les km des opérations s'ajoutent aux km de la fiche pour les ratios (ils ne servent jamais au calcul « km × tarif »).
  const km = r2(num(entry.km) + num(entry.ops?.km)), litres = num(entry.litres);
  return {
    lignes,
    opsLignes: Object.fromEntries(Object.keys(lignes).map((k) => [k, montantOps(entry, k)])),
    nbOps: num(entry.ops?.n), A, B, sousTotaux: sous, brut, impot, impotAuto, impotMode: manuel ? 'manuel' : 'auto', net,
    marge: A ? r2((net / A) * 100) : 0,
    coutKm: km ? r2(B / km) : 0,
    margeKm: km ? r2(net / km) : 0,
    conso: km ? r2((litres / km) * 100) : 0,
    km,
  };
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); };
export const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
export const currentMonth = () => new Date().toISOString().slice(0, 7);
