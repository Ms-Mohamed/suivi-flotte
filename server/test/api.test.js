import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { boot, close } from './helpers.js';

let app, H;
before(async () => { const b = await boot(); app = b.app; H = { Authorization: `Bearer ${b.token}` }; });
after(close);

test('routes protégées sans token → 401 ; login invalide → 401', async () => {
  assert.equal((await request(app).get('/api/trucks')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'm@test.ma', password: 'x' })).status, 401);
});

let truckId;
test('création camion + doublon d’immatriculation → 409', async () => {
  const r = await request(app).post('/api/trucks').set(H).send({ immatriculation: '111-A-1', marque: 'Volvo', chauffeur: 'Ali',
    defauts: { amounts: { 61310000: 18000, 61340000: 4000 }, annuel: { 61610000: 9960 }, tarifKm: 10, prixLitre: 11 } });
  assert.equal(r.status, 201); truckId = r.body._id;
  assert.equal((await request(app).post('/api/trucks').set(H).send({ immatriculation: '111-A-1' })).status, 409);
});

test('saisie vide = modèle prérempli depuis les valeurs par défaut du camion', async () => {
  const r = await request(app).get(`/api/entries/${truckId}/2026-08`).set(H);
  assert.equal(r.status, 200); assert.equal(r.body.exists, false);
  assert.equal(r.body.entry.amounts['61310000'], 18000); assert.equal(r.body.entry.tarifKm, 10);
  assert.equal(r.body.calc.lignes['61610000'], 830);
});

test('PUT calcule exactement comme le document : cas chiffré', async () => {
  const body = { km: 10000, tarifKm: 10, litres: 3300, prixLitre: 11, amounts: { 71280000: 1000, 71880000: 500, 61222000: 4000, 61330000: 6000,
    61420000: 5000, 61430000: 3000, 61310000: 18000, 61340000: 4000, 61455000: 300, 61710000: 5500, 61740000: 1300 },
    annuel: { 61610000: 9960, 61900000: 108000 }, impot: { mode: 'auto', montant: 0 } };
  const r = await request(app).put(`/api/entries/${truckId}/2026-08`).set(H).send(body);
  assert.equal(r.status, 200); assert.equal(r.body.calc.A, 101500); assert.equal(r.body.calc.B, 93230);
  assert.equal(r.body.calc.brut, 8270); assert.equal(r.body.calc.impot, 1654); assert.equal(r.body.calc.net, 6616);
  // second PUT = mise à jour, pas de doublon
  await request(app).put(`/api/entries/${truckId}/2026-08`).set(H).send({ ...body, km: 11000 });
  const g = await request(app).get(`/api/entries/${truckId}/2026-08`).set(H);
  assert.equal(g.body.exists, true); assert.equal(g.body.calc.lignes['71210000'], 110000);
});

test('mois suivant : charges fixes reprises du mois précédent, variables remises à zéro', async () => {
  const r = await request(app).get(`/api/entries/${truckId}/2026-09`).set(H);
  assert.equal(r.body.exists, false); assert.equal(r.body.entry.amounts['61310000'], 18000);
  assert.equal(r.body.entry.amounts['61222000'], undefined); assert.equal(r.body.entry.km, 0);
});

test('validation : compte inconnu, montant négatif, mois invalide, id invalide', async () => {
  assert.equal((await request(app).put(`/api/entries/${truckId}/2026-08`).set(H).send({ amounts: { 99999999: 5 } })).status, 400);
  assert.equal((await request(app).put(`/api/entries/${truckId}/2026-08`).set(H).send({ km: -5 })).status, 400);
  assert.equal((await request(app).get(`/api/entries/${truckId}/2026-13`).set(H)).status, 400);
  assert.equal((await request(app).get('/api/entries/abc/2026-08').set(H)).status, 400);
});

test('tableau de bord : totaux, comparaison mois précédent, tendance 12 mois', async () => {
  const r = await request(app).get('/api/reports/dashboard?month=2026-08').set(H);
  assert.equal(r.status, 200); assert.equal(r.body.trend.length, 12); assert.equal(r.body.nbSaisis, 1);
  assert.equal(r.body.totals.A, 110000 + 1500); assert.equal(r.body.previousTotals.A, 0);
  assert.equal(r.body.parCompte['71210000'], 110000);
});

test('rapport annuel', async () => {
  const r = await request(app).get('/api/reports/annual?year=2026').set(H);
  assert.equal(r.body.rows.length, 1); assert.equal(r.body.rows[0].cells[7].A, 111500); assert.equal(r.body.rows[0].cells[0], null);
});

test('paramètres : le taux d’impôt modifie le résultat net', async () => {
  await request(app).put('/api/settings').set(H).send({ societe: 'Test SARL', tauxIS: 10, cotisationMinimale: 0.25, cotisationMinimaleActive: false });
  const r = await request(app).get(`/api/entries/${truckId}/2026-08`).set(H);
  assert.equal(r.body.calc.impot, +(r.body.calc.brut * 0.1).toFixed(2));
});

test('export Excel mensuel et par camion', async () => {
  const a = await request(app).get('/api/export/month/2026-08').set(H).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(a.status, 200); assert.equal(a.body.slice(0, 2).toString(), 'PK');
  const b = await request(app).get(`/api/export/entry/${truckId}/2026-08`).set(H).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(b.status, 200); assert.equal(b.body.slice(0, 2).toString(), 'PK');
});

test('archivage puis suppression définitive (avec saisies)', async () => {
  await request(app).delete(`/api/trucks/${truckId}`).set(H);
  assert.equal((await request(app).get('/api/trucks').set(H)).body.length, 0);
  assert.equal((await request(app).get('/api/trucks?tous=1').set(H)).body.length, 1);
  await request(app).delete(`/api/trucks/${truckId}?definitif=1`).set(H);
  assert.equal((await request(app).get('/api/trucks?tous=1').set(H)).body.length, 0);
});

test('changement de mot de passe', async () => {
  assert.equal((await request(app).post('/api/auth/password').set(H).send({ actuel: 'faux', nouveau: 'nouveau-mdp-1' })).status, 400);
  assert.equal((await request(app).post('/api/auth/password').set(H).send({ actuel: 'motdepasse1', nouveau: 'nouveau-mdp-1' })).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'm@test.ma', password: 'nouveau-mdp-1' })).status, 200);
});
