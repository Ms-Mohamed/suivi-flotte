import { Operation } from './models.js';

/** Totaux des opérations datées (hors supprimées), par « mois|camion » : { totals: {code: montant}, km, n }. */
export async function opsIndex(filter = {}) {
  const docs = await Operation.find({ ...filter, supprime: { $ne: true } }).lean();
  const idx = new Map();
  for (const o of docs) {
    const k = `${o.month}|${o.truck}`;
    const cur = idx.get(k) || { totals: {}, km: 0, n: 0 };
    cur.totals[o.code] = Math.round(((cur.totals[o.code] || 0) + o.montant) * 100) / 100;
    cur.km += o.km || 0; cur.n += 1;
    idx.set(k, cur);
  }
  return idx;
}

export const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Lundi de la semaine (ISO) contenant la date. */
export const mondayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); };
export const isoWeek = (s) => {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear(); const w1 = new Date(Date.UTC(y, 0, 4));
  return { annee: y, semaine: 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7) };
};
