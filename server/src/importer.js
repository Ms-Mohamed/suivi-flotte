import ExcelJS from 'exceljs';
import { PLAN, calcEntry, CODE_VENTES, CODE_GAZOLE, CODES_ANNUELS, MONTH_RE } from '../../shared/calc.js';
import { Truck, Entry } from './models.js';

const ACCOUNTS = [...PLAN.produits, ...PLAN.charges.flatMap((g) => g.comptes)];
const KNOWN = new Set(ACCOUNTS.map((a) => a.code));
const MAX_ROWS = 5000;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[\s_.]+/g, '').replace(/[–—]/g, '-');

export async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Saisies', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const heads = ['Immatriculation', 'Mois (AAAA-MM)', 'Km chargés', 'Tarif au km', 'Litres de gazole', 'Prix du litre'];
  for (const a of ACCOUNTS) {
    const note = a.code === CODE_VENTES ? ' (total factures, si pas de km × tarif)' : a.code === CODE_GAZOLE ? ' (montant, si pas de litres × prix)' : CODES_ANNUELS.includes(a.code) ? ' (annuel)' : '';
    heads.push(`${a.code} - ${a.label}${note}`);
  }
  const hr = ws.addRow(heads);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.alignment = { wrapText: true, vertical: 'middle' }; hr.height = 62;
  hr.eachCell((c, i) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i <= 6 ? 'FF1F3A5F' : PLAN.produits.some((p) => heads[i - 1].startsWith(p.code)) ? 'FF0E7C5B' : 'FF2F5BEA' } }; });
  ws.columns = heads.map((h, i) => ({ width: i === 0 ? 18 : i === 1 ? 16 : i < 6 ? 13 : 24 }));
  ws.getColumn(2).numFmt = '@';
  const help = wb.addWorksheet('Aide');
  help.columns = [{ width: 110 }];
  [
    'COMMENT REMPLIR LE FICHIER',
    '• Une ligne = un camion pour un mois. Remplissez l’onglet « Saisies » (ne changez pas les titres de colonnes).',
    '• Immatriculation : exactement comme dans l’application (les camions inconnus peuvent être créés automatiquement à l’import).',
    '• Mois : AAAA-MM (ex. 2026-03). Les formats 03/2026 ou une vraie date Excel sont aussi acceptés.',
    '• Ventes : renseignez Km chargés ET Tarif au km (calcul automatique), OU le total des factures dans la colonne 71210000.',
    '• Gazole : renseignez Litres ET Prix du litre, OU le montant total dans la colonne 61221000.',
    '• Taxe à l’essieu (61610000) et amortissement (61900000) : montant ANNUEL, l’application divise par 12.',
    '• Tous les autres comptes : montant du mois en DHS. Cellule vide = 0. Les montants négatifs sont refusés.',
    '• Vous pouvez supprimer les colonnes de comptes dont vous n’avez pas besoin.',
    '',
    'EXEMPLE (à recopier dans « Saisies »)',
    '12345-A-1 | 2026-03 | 10000 | 10 | 3300 | 11 | 71280000: 1000 | 61222000: 4000 | 61310000: 18000 | 61610000 (annuel): 9960 …',
    '',
    'COMPTES',
    ...ACCOUNTS.map((a) => `${a.code}  ${a.label}  —  ${a.mode}`),
  ].forEach((t, i) => { const r = help.addRow([t]); if (t === t.toUpperCase() && t) r.font = { bold: true }; r.alignment = { wrapText: true }; if (i === 0) r.font = { bold: true, size: 13 }; });
  return wb;
}

function cellValue(c) {
  let v = c?.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : null);
  return v === undefined || v === '' ? null : v;
}
const toNum = (v) => {
  if (v == null) return { n: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v } : { err: 'nombre invalide' };
  const s = String(v).replace(/dhs?|mad|\s/gi, '').replace(',', '.');
  if (s === '') return { n: null };
  const n = Number(s);
  return Number.isFinite(n) ? { n } : { err: `« ${v} » n'est pas un nombre` };
};
function toMonth(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Lit le classeur et renvoie des lignes normalisées (sans accès base de données). */
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw bad('Fichier Excel (.xlsx) illisible'); }
  const ws = wb.getWorksheet('Saisies') || wb.worksheets[0];
  if (!ws) throw bad('Le classeur est vide');
  const cols = { plate: null, month: null, km: null, tarif: null, litres: null, prix: null, accounts: [] };
  ws.getRow(1).eachCell((c, i) => {
    const h = String(cellValue(c) ?? ''); const n = norm(h);
    const code = h.match(/\b(\d{8})\b/)?.[1];
    if (code && KNOWN.has(code)) { cols.accounts.push({ i, code, annual: /annuel/i.test(h) }); return; }
    if (/^(immat|camion|plaque|vehicule)/.test(n)) cols.plate ??= i;
    else if (/^(mois|periode|month)/.test(n)) cols.month ??= i;
    else if (n.startsWith('km')) cols.km ??= i;
    else if (n.startsWith('tarif')) cols.tarif ??= i;
    else if (/^(litres|gazole|volume)/.test(n)) cols.litres ??= i;
    else if (n.startsWith('prix')) cols.prix ??= i;
  });
  if (!cols.plate || !cols.month) throw bad('Colonnes « Immatriculation » et « Mois » introuvables (ligne 1). Téléchargez le modèle.');
  const rows = []; const seen = new Set();
  if (ws.rowCount - 1 > MAX_ROWS) throw bad(`Trop de lignes (maximum ${MAX_ROWS})`);
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (i) => (i ? cellValue(row.getCell(i)) : null);
    const cells = [cols.plate, cols.month, cols.km, cols.tarif, cols.litres, cols.prix, ...cols.accounts.map((a) => a.i)].map(get);
    if (cells.every((v) => v == null)) continue;
    const errors = [];
    const plate = String(get(cols.plate) ?? '').trim();
    const month = toMonth(get(cols.month));
    if (!plate) errors.push('immatriculation manquante');
    if (!month || !MONTH_RE.test(month)) errors.push('mois invalide (attendu AAAA-MM)');
    const num = (i, label) => { const { n, err } = toNum(get(i)); if (err) errors.push(`${label} : ${err}`); else if (n != null && (n < 0 || n > 1e9)) errors.push(`${label} : valeur refusée (${n})`); return err || n == null || n < 0 || n > 1e9 ? 0 : n; };
    const entry = { km: num(cols.km, 'Km'), tarifKm: num(cols.tarif, 'Tarif'), litres: num(cols.litres, 'Litres'), prixLitre: num(cols.prix, 'Prix du litre'), amounts: {}, annuel: {}, modes: {}, impot: { mode: 'auto', montant: 0 }, notes: '' };
    for (const a of cols.accounts) {
      const v = num(a.i, a.code); if (!v) continue;
      if (CODES_ANNUELS.includes(a.code)) { if (a.annual) entry.annuel[a.code] = v; else { entry.amounts[a.code] = v; entry.modes[a.code] = 'mensuel'; } }
      else if (a.code === CODE_VENTES) { if (!(entry.km > 0 && entry.tarifKm > 0)) { entry.amounts[a.code] = v; entry.modes[a.code] = 'factures'; } }
      else if (a.code === CODE_GAZOLE) { if (!(entry.litres > 0 && entry.prixLitre > 0)) { entry.amounts[a.code] = v; entry.modes[a.code] = 'montant'; } }
      else entry.amounts[a.code] = v;
    }
    const key = `${plateKey(plate)}|${month}`;
    if (!errors.length) { if (seen.has(key)) errors.push('doublon dans le fichier (même camion et même mois)'); seen.add(key); }
    rows.push({ line: r, plate, month, entry, errors });
  }
  if (!rows.length) throw bad('Aucune ligne de données trouvée');
  return rows;
}

/** Compare aux données existantes ; si dryRun=false, écrit réellement. */
export async function runImport(rows, { creerCamions = false, ecraser = false, settings, dryRun = true }) {
  const trucks = await Truck.find({});
  const byPlate = new Map(trucks.map((t) => [plateKey(t.immatriculation), t]));
  const created = new Map();
  const out = []; const stats = { importes: 0, ignores: 0, erreurs: 0, camionsCrees: [] };
  for (const r of rows) {
    const res = { line: r.line, immatriculation: r.plate, month: r.month, messages: [...r.errors], statut: 'erreur' };
    if (!r.errors.length) {
      const k = plateKey(r.plate);
      let truck = byPlate.get(k) || created.get(k);
      if (!truck && creerCamions) {
        if (dryRun) truck = { _id: null, immatriculation: r.plate, nouveau: true };
        else { truck = await Truck.create({ immatriculation: r.plate.trim() }); }
        created.set(k, truck); stats.camionsCrees.push(r.plate);
      }
      if (!truck) res.messages.push('camion inconnu (cochez « créer les camions manquants » ou ajoutez-le avant)');
      else {
        const existing = truck._id ? await Entry.findOne({ truck: truck._id, month: r.month }) : null;
        const c = calcEntry(r.entry, settings);
        Object.assign(res, { A: c.A, B: c.B, net: c.net, camionNouveau: !!truck.nouveau || created.has(k) });
        if (existing && !ecraser) { res.statut = 'ignore'; res.messages.push('mois déjà saisi (conservé)'); }
        else {
          res.statut = existing ? 'remplace' : 'nouveau';
          if (!dryRun) {
            const set = { km: r.entry.km, tarifKm: r.entry.tarifKm, litres: r.entry.litres, prixLitre: r.entry.prixLitre, amounts: r.entry.amounts, annuel: r.entry.annuel, modes: r.entry.modes };
            if (!existing) { set.impot = r.entry.impot; set.notes = 'Importé depuis Excel'; }
            await Entry.findOneAndUpdate({ truck: truck._id, month: r.month }, { $set: set }, { upsert: true, setDefaultsOnInsert: true });
          }
        }
      }
    }
    if (res.statut === 'erreur') stats.erreurs++; else if (res.statut === 'ignore') stats.ignores++; else stats.importes++;
    out.push(res);
  }
  return { rows: out, resume: { total: out.length, ...stats } };
}
