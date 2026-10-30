import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { boot, close } from './helpers.js';

let app, A, b1, b2;
const H = (t) => ({ Authorization: `Bearer ${t}` });
before(async () => {
  const b = await boot(); app = b.app; A = H(b.token);
  b1 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'B-1' })).body._id;
  b2 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'B-2' })).body._id;
});
after(close);
const settings = (dateBascule) => request(app).put('/api/settings').set(A).send({ societe: 'Test', tauxIS: 20, cotisationMinimale: 0.25, cotisationMinimaleActive: true, dateBascule });
const op = (truck, date, lignes, extra = {}) => request(app).post('/api/operations').set(A).send({ truck, date, lignes, ...extra });

test('paramètre : mois de bascule validé, enregistré, effaçable', async () => {
  assert.equal((await settings('2026-13')).status, 400);
  assert.equal((await settings('novembre')).status, 400);
  assert.equal((await settings('2026-11')).body.dateBascule, '2026-11');
  assert.equal((await request(app).get('/api/settings').set(A)).body.dateBascule, '2026-11');
  assert.equal((await settings('')).body.dateBascule, '');
});

test('avant la bascule : alerte de double comptage si le compte a déjà un montant dans la fiche du mois', async () => {
  await request(app).put(`/api/entries/${b1}/2026-05`).set(A).send({ km: 1000, tarifKm: 10, amounts: { '61330000': 400, '61310000': 3100 } });
  const r = await op(b1, '2026-05-04', [{ code: '61330000', montant: 150 }, { code: '61420000', montant: 80 }]);
  assert.equal(r.status, 201);
  assert.equal(r.body.avertissements.length, 1);
  assert.deepEqual(r.body.avertissements[0], { code: '61330000', compte: 'Maintenance & Réparations', month: '2026-05', montantFiche: 400 });
  assert.deepEqual((await op(b1, '2026-07-04', [{ code: '61330000', montant: 10 }])).body.avertissements, []); // pas de fiche en juillet
});

test('mode opérations : à partir du mois de bascule, produits et charges variables viennent des opérations seulement', async () => {
  await settings('2026-11');
  await request(app).put(`/api/entries/${b1}/2026-11`).set(A).send({ km: 1000, tarifKm: 10, litres: 100, prixLitre: 10, amounts: { '61330000': 500, '61310000': 2000 } });
  const r = await op(b1, '2026-11-03', [{ code: '71210000', montant: 3000 }, { code: '61221000', montant: 400 }], { km: 120 });
  assert.deepEqual(r.body.avertissements, []);       // plus de risque de double comptage sur ces comptes
  const e = (await request(app).get(`/api/entries/${b1}/2026-11`).set(A)).body;
  assert.equal(e.calc.opsMode, true);
  assert.equal(e.calc.A, 3000);                      // km × tarif (10 000) ignoré
  assert.equal(e.calc.lignes['61330000'], 0);        // maintenance saisie à la main ignorée
  assert.equal(e.calc.lignes['61221000'], 400);
  assert.equal(e.calc.B, 400 + 2000);                // + charge fixe saisie dans la fiche
  assert.equal(e.calc.km, 120);
  const mai = (await request(app).get(`/api/entries/${b1}/2026-05`).set(A)).body.calc;
  assert.equal(mai.opsMode, false); assert.equal(mai.A, 10000);   // les mois antérieurs ne changent pas
  assert.equal((await request(app).get('/api/reports/dashboard?month=2026-11').set(A)).body.totals.A, 3000);
  // une charge fixe saisie en opération reste additionnée à la fiche : alerte si la fiche a déjà un montant
  const w = await op(b1, '2026-11-05', [{ code: '61310000', montant: 50 }]);
  assert.equal(w.body.avertissements[0].code, '61310000');
});

test('import Excel : alerte sur un mois en mode opérations', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Saisies');
  ws.addRow(['Immatriculation', 'Mois (AAAA-MM)', 'Km chargés', 'Tarif au km', 'Litres de gazole', 'Prix du litre']); ws.addRow(['B-2', '2026-12', 100, 10, 10, 10]);
  const r = await request(app).post('/api/import/apercu').set(A).set({ 'Content-Type': 'application/octet-stream' }).send(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(r.status, 200);
  assert.match(JSON.stringify(r.body), /mode opérations/);
});

test('semaine : charges fixes réparties au jour le jour', async () => {
  await settings('');
  // B-1 : charge fixe 3 100 DHS en mai (31 jours) = 100 DHS/jour ; semaine du 4 au 10 mai = 700 DHS
  await op(b1, '2026-05-06', [{ code: '71210000', montant: 1000 }]);
  const w = (await request(app).get('/api/reports/semaines?date=2026-05-07&nb=2').set(A)).body;
  const c = w.courante.find((x) => x.truck._id === b1);
  assert.equal(c.F, 700); assert.equal(c.A, 1000); assert.equal(c.B, 150 + 80); assert.equal(c.net, 1000 - 230);
  assert.equal(c.netComplet, 1000 - 230 - 700); assert.equal(c.fixesManquantes, false);
  assert.equal(w.flotte[1].F, 700);
  // la semaine du 1er au 7 juin : pas de fiche de juin → charges fixes absentes, signalé
  await op(b1, '2026-06-02', [{ code: '71210000', montant: 500 }]);
  const j = (await request(app).get('/api/reports/semaines?date=2026-06-02&nb=1').set(A)).body.courante.find((x) => x.truck._id === b1);
  assert.equal(j.F, 0); assert.equal(j.fixesManquantes, true); assert.equal(j.netComplet, 500);
  // B-2 sans aucune donnée : pas de ligne bruitée
  assert.equal((await request(app).get('/api/reports/semaines?date=2026-05-07&nb=1').set(A)).body.courante.find((x) => x.truck._id === b2).F, 0);
});

test('rapport global : totaux, camions, fiches manquantes, précédente, export', async () => {
  await request(app).put(`/api/entries/${b1}/2026-06`).set(A).send({ amounts: { '71210000': 8000, '61310000': 3000 }, modes: { '71210000': 'factures' } });
  const rep = (await request(app).get('/api/reports/global?from=2026-05&to=2026-06').set(A)).body;
  // mai : A = 10 000 + 150 + 80 (opérations)… on vérifie plutôt la cohérence avec le tableau de bord mois par mois
  const dm = async (m) => (await request(app).get(`/api/reports/dashboard?month=${m}`).set(A)).body.totals;
  const [m5, m6] = [await dm('2026-05'), await dm('2026-06')];
  assert.equal(rep.totaux.A, +(m5.A + m6.A).toFixed(2)); assert.equal(rep.totaux.B, +(m5.B + m6.B).toFixed(2));
  assert.equal(rep.totaux.net, +(m5.net + m6.net).toFixed(2));
  assert.equal(rep.trend.length, 2); assert.equal(rep.trend[0].month, '2026-05');
  const row = rep.camions.find((x) => x.truck._id === b1);
  assert.equal(row.net, rep.totaux.net); assert.equal(row.saisis, 2); assert.equal(rep.camions.length, 2);
  assert.equal(rep.fichesManquantes.total, 2);         // B-2 : ni mai ni juin
  assert.equal(rep.precedente.to, '2026-04'); assert.equal(rep.totauxPrecedents.A, 0);
  assert.equal(rep.produits.reduce((s, x) => s + x.montant, 0).toFixed(2), rep.totaux.A.toFixed(2));
  assert.equal(rep.charges.reduce((s, x) => s + x.montant, 0).toFixed(2), rep.totaux.B.toFixed(2));
  assert.equal(rep.operations.lignes > 0, true);
  assert.equal((await request(app).get('/api/reports/global?from=2026-07&to=2026-05').set(A)).status, 400);
  assert.equal((await request(app).get('/api/reports/global?from=2020-01&to=2026-05').set(A)).status, 400);   // > 60 mois
  const x = await request(app).get('/api/export/rapport?from=2026-05&to=2026-06').set(A).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(x.status, 200); assert.equal(x.body.slice(0, 2).toString(), 'PK');
});
