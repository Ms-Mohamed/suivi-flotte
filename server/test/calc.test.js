import test from 'node:test';
import assert from 'node:assert/strict';
import { calcEntry, PLAN, prevMonth, addMonths } from '../../shared/calc.js';

// Cas chiffré à la main, selon le document Word.
const entry = {
  km: 10000, tarifKm: 10, litres: 3300, prixLitre: 11,
  amounts: { 71280000: 1000, 71880000: 500, 61222000: 4000, 61330000: 6000, 61420000: 5000, 61430000: 3000,
    61310000: 18000, 61340000: 4000, 61455000: 300, 61710000: 5500, 61740000: 1300 },
  annuel: { 61610000: 9960, 61900000: 108000 },
};
test('structure : 3 comptes produits, 12 comptes charges, comme le fichier Word', () => {
  assert.equal(PLAN.produits.length, 3);
  assert.deepEqual(PLAN.charges.map((g) => g.comptes.length), [5, 6, 1]);
  assert.deepEqual(PLAN.charges.map((g) => g.key), ['variables', 'fixes', 'amortissements']);
});
test('A = 71210000 (km × tarif) + 71280000 + 71880000', () => {
  const c = calcEntry(entry, { tauxIS: 20, cotisationMinimaleActive: false });
  assert.equal(c.lignes['71210000'], 100000);
  assert.equal(c.A, 101500);
});
test('B = variables + fixes + amortissements (gazole = litres × prix ; taxe et dotation ÷ 12)', () => {
  const c = calcEntry(entry, { tauxIS: 20, cotisationMinimaleActive: false });
  assert.equal(c.lignes['61221000'], 36300);
  assert.equal(c.lignes['61610000'], 830);
  assert.equal(c.lignes['61900000'], 9000);
  assert.equal(c.sousTotaux.variables, 36300 + 4000 + 6000 + 5000 + 3000);
  assert.equal(c.sousTotaux.fixes, 18000 + 4000 + 300 + 830 + 5500 + 1300);
  assert.equal(c.sousTotaux.amortissements, 9000);
  assert.equal(c.B, 54300 + 29930 + 9000);
});
test('résultat brut = A − B ; net = brut − impôt', () => {
  const c = calcEntry(entry, { tauxIS: 20, cotisationMinimaleActive: false });
  assert.equal(c.brut, 101500 - 93230);
  assert.equal(c.impot, 1654);        // 20 % de 8 270
  assert.equal(c.net, 8270 - 1654);
});
test('perte : impôt = cotisation minimale (A × taux) si activée, sinon 0', () => {
  const loss = { ...entry, tarifKm: 5 };
  assert.equal(calcEntry(loss, { cotisationMinimaleActive: false }).impot, 0);
  const c = calcEntry(loss, { tauxIS: 20, cotisationMinimale: 0.25, cotisationMinimaleActive: true });
  assert.equal(c.impot, +(c.A * 0.0025).toFixed(2));
  assert.equal(c.net, +(c.brut - c.impot).toFixed(2));
});
test('modes alternatifs : ventes « total factures », gazole « montant », taxe « mensuel »', () => {
  const c = calcEntry({ ...entry, modes: { 71210000: 'factures', 61221000: 'montant', 61610000: 'mensuel' },
    amounts: { ...entry.amounts, 71210000: 90000, 61221000: 30000, 61610000: 700 } }, { cotisationMinimaleActive: false });
  assert.equal(c.lignes['71210000'], 90000); assert.equal(c.lignes['61221000'], 30000); assert.equal(c.lignes['61610000'], 700);
});
test('impôt manuel prioritaire ; entrée vide = tout à 0 ; décimales à virgule acceptées', () => {
  assert.equal(calcEntry({ ...entry, impot: { mode: 'manuel', montant: 1234.5 } }).impot, 1234.5);
  const z = calcEntry({}); assert.equal(z.A, 0); assert.equal(z.B, 0); assert.equal(z.net, 0); assert.equal(z.marge, 0);
  assert.equal(calcEntry({ km: '1000', tarifKm: '9,5' }).lignes['71210000'], 9500);
});
test('arithmétique des mois', () => { assert.equal(prevMonth('2026-01'), '2025-12'); assert.equal(addMonths('2026-11', 3), '2027-02'); });
