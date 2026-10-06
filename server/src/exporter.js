import ExcelJS from 'exceljs';
import { PLAN, calcEntry } from '../../shared/calc.js';

const MAD = '#,##0.00" DHS"';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const head = (row) => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = fill('FF1F3A5F'); };
const bold = (row, bg) => { row.font = { bold: true }; if (bg) row.fill = fill(bg); };

/** Feuille « Situation camion » : même structure que le document Word. */
export function addStatementSheet(wb, name, truck, month, entry, settings) {
  const c = calcEntry(entry, settings);
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = [{ width: 14 }, { width: 38 }, { width: 58 }, { width: 20 }];
  ws.addRow([`Situation camion ${truck.immatriculation} — ${month}`]).font = { bold: true, size: 14 };
  ws.addRow([`${truck.marque} ${truck.modele}`.trim(), truck.chauffeur ? `Chauffeur : ${truck.chauffeur}` : '']);
  ws.addRow([]);
  ws.addRow(['1. Structure du Compte de Produits & Charges Mensuel']).font = { bold: true, size: 12 };
  ws.addRow(["A. Produits Mensuels (Chiffre d'Affaires)"]).font = { bold: true };
  head(ws.addRow(['N° Compte', 'Postes de Produits', 'Mode de Calcul Mensuel', 'Montant (DHS)']));
  for (const p of PLAN.produits) { const r = ws.addRow([p.code, p.label, p.mode, c.lignes[p.code]]); r.getCell(4).numFmt = MAD; }
  let r = ws.addRow(['TOTAL A', PLAN.totaux.A, '', c.A]); bold(r, 'FFE8EEF7'); r.getCell(4).numFmt = MAD;
  ws.addRow([]);
  ws.addRow(['B. Charges Mensuelles']).font = { bold: true };
  head(ws.addRow(['N° Compte', 'Postes de Charges', 'Nature / Fréquence', 'Montant (DHS)']));
  for (const g of PLAN.charges) {
    r = ws.addRow([g.titre, '', g.note, c.sousTotaux[g.key]]); bold(r, 'FFF2F4F7'); r.getCell(4).numFmt = MAD;
    for (const a of g.comptes) { r = ws.addRow([a.code, a.label, a.mode, c.lignes[a.code]]); r.getCell(4).numFmt = MAD; }
  }
  r = ws.addRow(['TOTAL B', PLAN.totaux.B, '', c.B]); bold(r, 'FFE8EEF7'); r.getCell(4).numFmt = MAD;
  ws.addRow([]);
  ws.addRow(['2. Calcul du Résultat Mensuel']).font = { bold: true, size: 12 };
  head(ws.addRow(['Étape de Calcul', '', 'Formule', 'Montant (DHS)']));
  const lines = [
    ['Total Produits (A)', PLAN.resultat[0].formule, c.A], ['Total Charges (B)', PLAN.resultat[1].formule, c.B],
    ['RÉSULTAT BRUT MENSUEL', 'A - B', c.brut],
    ['Impôt / Taxe sur résultat', `${PLAN.resultat[3].formule} — ${c.impotMode === 'manuel' ? 'saisi manuellement' : 'calcul automatique'}`, c.impot],
    ['RÉSULTAT NET MENSUEL', 'A - B - T', c.net],
  ];
  for (const [a, f, m] of lines) { r = ws.addRow([a, '', f, m]); r.getCell(4).numFmt = MAD; if (/RÉSULTAT/.test(a)) bold(r, 'FFE8EEF7'); }
  return c;
}

export async function monthWorkbook(month, rows, settings, societe) {
  const wb = new ExcelJS.Workbook(); wb.creator = societe;
  const ws = wb.addWorksheet('Synthèse flotte');
  ws.columns = [{ width: 16 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }];
  ws.addRow([`${societe} — Synthèse flotte ${month}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  head(ws.addRow(['Camion', 'Modèle', 'Chauffeur', 'Km', 'Produits (A)', 'Charges (B)', 'Résultat brut', 'Impôt (T)', 'Résultat net', 'Marge %']));
  const tot = { km: 0, A: 0, B: 0, brut: 0, impot: 0, net: 0 };
  for (const { truck, entry } of rows) {
    const c = calcEntry(entry, settings);
    for (const k of Object.keys(tot)) tot[k] += c[k];
    const r = ws.addRow([truck.immatriculation, `${truck.marque} ${truck.modele}`.trim(), truck.chauffeur, c.km, c.A, c.B, c.brut, c.impot, c.net, c.marge / 100]);
    [5, 6, 7, 8, 9].forEach((i) => (r.getCell(i).numFmt = MAD)); r.getCell(10).numFmt = '0.00%';
  }
  const r = ws.addRow(['TOTAL FLOTTE', '', '', tot.km, tot.A, tot.B, tot.brut, tot.impot, tot.net, tot.A ? tot.net / tot.A : 0]);
  bold(r, 'FFE8EEF7'); [5, 6, 7, 8, 9].forEach((i) => (r.getCell(i).numFmt = MAD)); r.getCell(10).numFmt = '0.00%';
  for (const { truck, entry } of rows) addStatementSheet(wb, truck.immatriculation, truck, month, entry, settings);
  return wb;
}

export async function entryWorkbook(truck, month, entry, settings) {
  const wb = new ExcelJS.Workbook();
  addStatementSheet(wb, 'Situation camion', truck, month, entry, settings);
  return wb;
}

/** Journal des opérations datées (une ligne par opération). */
export async function operationsWorkbook(items, societe) {
  const wb = new ExcelJS.Workbook(); wb.creator = societe;
  const ws = wb.addWorksheet('Opérations');
  ws.columns = [{ width: 12 }, { width: 16 }, { width: 14 }, { width: 38 }, { width: 14 }, { width: 18 }, { width: 10 }, { width: 24 }, { width: 40 }];
  head(ws.addRow(['Date', 'Camion', 'N° compte', 'Poste', 'Type', 'Montant (DHS)', 'Km', 'Voyage', 'Note']));
  for (const o of items) {
    const r = ws.addRow([o.date, o.truck.immatriculation || '', o.code, o.compte, o.type === 'produit' ? 'Produit' : 'Charge', o.montant, o.km || '', o.voyage, o.note]);
    r.getCell(6).numFmt = MAD;
    if (o.supprime) r.font = { italic: true, color: { argb: 'FF999999' } };
  }
  return wb;
}
