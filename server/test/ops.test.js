import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { boot, close } from './helpers.js';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
const tmpBk = path.join(os.tmpdir(), `sf-bk-ops-${Date.now()}`);
process.env.BACKUP_DIR = tmpBk;

let app, A, saisie, lecture, t1, t2;
const H = (t) => ({ Authorization: `Bearer ${t}` });
before(async () => {
  const b = await boot(); app = b.app; A = H(b.token);
  for (const [email, role] of [['s@t.ma', 'saisie'], ['l@t.ma', 'lecture']]) await request(app).post('/api/users').set(A).send({ email, nom: role, role, password: 'motdepasse-12' });
  saisie = H((await request(app).post('/api/auth/login').send({ email: 's@t.ma', password: 'motdepasse-12' })).body.token);
  lecture = H((await request(app).post('/api/auth/login').send({ email: 'l@t.ma', password: 'motdepasse-12' })).body.token);
  t1 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'T1-A-1' })).body._id;
  t2 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'T2-B-2' })).body._id;
});
after(async () => { await close(); await fs.rm(tmpBk, { recursive: true, force: true }); });

const lot = (o = {}) => ({ truck: t1, date: '2026-05-04', voyage: 'Tanger–Casa', km: 340,
  lignes: [{ code: '71210000', montant: 5000 }, { code: '61221000', montant: 1200 }, { code: '61420000', montant: 180 }], ...o });
let ids;

test('un voyage = plusieurs lignes ; km portés par la première ligne', async () => {
  const r = await request(app).post('/api/operations').set(saisie).send(lot());
  assert.equal(r.status, 201); assert.equal(r.body.items.length, 3);
  assert.deepEqual(r.body.items.map((x) => x.km), [340, 0, 0]);
  assert.equal(r.body.items[0].type, 'produit'); assert.equal(r.body.items[1].type, 'charge');
  assert.equal(r.body.items[0].month, '2026-05'); ids = r.body.items.map((x) => x.id);
});

test('validations : date impossible, compte inconnu, montant 0, camion inconnu, lecture refusée', async () => {
  assert.equal((await request(app).post('/api/operations').set(A).send(lot({ date: '2026-02-30' }))).status, 400);
  assert.equal((await request(app).post('/api/operations').set(A).send(lot({ lignes: [{ code: '99999999', montant: 5 }] }))).status, 400);
  assert.equal((await request(app).post('/api/operations').set(A).send(lot({ lignes: [{ code: '61221000', montant: 0 }] }))).status, 400);
  assert.equal((await request(app).post('/api/operations').set(A).send(lot({ lignes: [] }))).status, 400);
  assert.equal((await request(app).post('/api/operations').set(A).send(lot({ truck: '64b000000000000000000000' }))).status, 404);
  assert.equal((await request(app).post('/api/operations').set(lecture).send(lot())).status, 403);
  assert.equal((await request(app).get('/api/operations').set(lecture)).status, 200);
});

test('la fiche mensuelle = saisie mensuelle + opérations (ventes en mode km×tarif incluses)', async () => {
  await request(app).put(`/api/entries/${t1}/2026-05`).set(A).send({ km: 1000, tarifKm: 10, amounts: { '61221000': 0, '61330000': 400 }, modes: { '61221000': 'montant' } });
  const r = await request(app).get(`/api/entries/${t1}/2026-05`).set(A);
  assert.equal(r.body.calc.lignes['71210000'], 10000 + 5000);
  assert.equal(r.body.calc.lignes['61221000'], 1200);
  assert.equal(r.body.calc.lignes['61330000'], 400);
  assert.equal(r.body.calc.A, 15000); assert.equal(r.body.calc.B, 1200 + 180 + 400);
  assert.equal(r.body.calc.opsLignes['71210000'], 5000); assert.equal(r.body.ops.n, 3);
  assert.equal(r.body.calc.km, 1340);          // km fiche + km opérations (ratios)
  assert.equal(r.body.calc.net > 0, true);
  const put = await request(app).put(`/api/entries/${t1}/2026-05`).set(A).send({ km: 1000, tarifKm: 10, amounts: { '61330000': 400 } });
  assert.equal(put.body.calc.lignes['71210000'], 15000);   // la réponse du PUT inclut aussi les opérations
});

test('mois avec opérations mais sans fiche : visible au tableau de bord et au rapport annuel', async () => {
  await request(app).post('/api/operations').set(A).send(lot({ truck: t2, date: '2026-06-10', km: 0, lignes: [{ code: '71210000', montant: 2000 }] }));
  const d = (await request(app).get('/api/reports/dashboard?month=2026-06').set(A)).body;
  const row = d.trucks.find((x) => x.truck._id === t2);
  assert.equal(row.saisi, false); assert.equal(row.calc.A, 2000); assert.equal(d.totals.A, 2000);
  const y = (await request(app).get('/api/reports/annual?year=2026').set(A)).body;
  assert.equal(y.rows.find((x) => x.truck._id === t2).cells[5].A, 2000);
});

test('liste : filtres camion / dates / type / texte, totaux, pagination', async () => {
  const all = (await request(app).get('/api/operations').set(A)).body;
  assert.equal(all.total, 4);
  const one = (await request(app).get(`/api/operations?truck=${t1}&from=2026-05-01&to=2026-05-31`).set(A)).body;
  assert.equal(one.total, 3); assert.deepEqual(one.totaux, { produits: 5000, charges: 1380, net: 3620, km: 340, n: 3 });
  assert.equal((await request(app).get(`/api/operations?truck=${t1}&type=charge`).set(A)).body.total, 2);
  assert.equal((await request(app).get('/api/operations?q=casa').set(A)).body.total, 4);
  assert.equal((await request(app).get('/api/operations?limit=2&page=2').set(A)).body.items.length, 2);
  assert.equal((await request(app).get('/api/operations?from=2026-13-40').set(A)).status, 400);
});

test('modification : historique conservé, la fiche suit ; suppression douce et restauration', async () => {
  const e = await request(app).put(`/api/operations/${ids[1]}`).set(saisie).send({ truck: t1, date: '2026-05-05', code: '61221000', montant: 1500, km: 0, voyage: 'Tanger–Casa', note: 'plein corrigé' });
  assert.equal(e.status, 200); assert.equal(e.body.montant, 1500); assert.equal(e.body.nbModifs, 1);
  const det = (await request(app).get(`/api/operations/${ids[1]}`).set(A)).body;
  assert.equal(det.historique[0].action, 'modification'); assert.equal(det.historique[0].avant.montant, 1200); assert.equal(det.historique[0].par, 'saisie');
  assert.equal((await request(app).get(`/api/entries/${t1}/2026-05`).set(A)).body.calc.lignes['61221000'], 1500);
  assert.equal((await request(app).put(`/api/operations/${ids[1]}`).set(lecture).send({})).status, 403);

  assert.equal((await request(app).delete(`/api/operations/${ids[1]}`).set(saisie)).status, 200);
  assert.equal((await request(app).get(`/api/entries/${t1}/2026-05`).set(A)).body.calc.lignes['61221000'], 0);
  assert.equal((await request(app).get('/api/operations?supprimes=only').set(A)).body.total, 1);
  assert.equal((await request(app).get('/api/operations').set(A)).body.total, 3);
  await request(app).post(`/api/operations/${ids[1]}/restaurer`).set(saisie);
  assert.equal((await request(app).get(`/api/entries/${t1}/2026-05`).set(A)).body.calc.lignes['61221000'], 1500);
  const h = (await request(app).get(`/api/operations/${ids[1]}`).set(A)).body.historique.map((x) => x.action);
  assert.deepEqual(h, ['restauration', 'suppression', 'modification', 'creation']);
});

test('tableau hebdomadaire : semaine ISO du lundi au dimanche, par camion et pour la flotte', async () => {
  await request(app).post('/api/operations').set(A).send(lot({ date: '2026-05-10', km: 0, lignes: [{ code: '71210000', montant: 100 }] })); // dimanche
  await request(app).post('/api/operations').set(A).send(lot({ date: '2026-05-11', km: 0, lignes: [{ code: '61420000', montant: 70 }] })); // lundi suivant
  const w = (await request(app).get('/api/reports/semaines?date=2026-05-07&nb=3').set(A)).body;
  assert.equal(w.semaine.debut, '2026-05-04'); assert.equal(w.semaine.fin, '2026-05-10'); assert.equal(w.semaine.semaine, 19);
  assert.deepEqual(w.starts, ['2026-04-20', '2026-04-27', '2026-05-04']);
  const cur = w.courante.find((x) => x.truck._id === t1);
  assert.equal(cur.A, 5100); assert.equal(cur.B, 1500 + 180); assert.equal(cur.net, 5100 - 1680); assert.equal(cur.n, 4);
  assert.equal(w.flotte[2].A, 5100);                       // la ligne du lundi 11 mai n'est pas dans cette semaine
  assert.equal((await request(app).get('/api/reports/semaines?date=nimporte').set(A)).status, 400);
});

test('historique d’un camion : mois, cumul, meilleur/pire ; export Excel du journal', async () => {
  const h = (await request(app).get(`/api/trucks/${t1}/historique`).set(A)).body;
  assert.equal(h.mois.length, 1); assert.equal(h.mois[0].month, '2026-05'); assert.equal(h.mois[0].nbOps, 5);
  assert.equal(h.resume.total, h.mois[0].net); assert.equal(h.resume.meilleur.month, '2026-05');
  const x = await request(app).get(`/api/export/operations?truck=${t1}`).set(A).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(x.status, 200); assert.equal(x.body.slice(0, 2).toString(), 'PK');
  assert.equal((await request(app).get('/api/trucks/zzz/historique').set(A)).status, 400);
});

test('sauvegarde / restauration : les opérations (et leur historique) reviennent', async () => {
  const before = (await request(app).get('/api/operations?supprimes=1&limit=500').set(A)).body.total;
  const b = (await request(app).post('/api/backups').set(A)).body;
  assert.equal(b.counts.operations, before);
  await request(app).delete(`/api/operations/${ids[0]}`).set(A);
  const r = await request(app).post(`/api/backups/${b.name}/restaurer`).set(A).send({ confirmation: 'RESTAURER' });
  assert.equal(r.status, 200); assert.equal(r.body.operations, before);
  assert.equal((await request(app).get('/api/operations').set(A)).body.items.some((x) => x.id === ids[0]), true);
  const det = (await request(app).get(`/api/operations/${ids[1]}`).set(A)).body;
  assert.equal(det.historique.length, 4); assert.ok(det.historique[0].at);
});

test('suppression définitive d’un camion supprime aussi ses opérations', async () => {
  await request(app).delete(`/api/trucks/${t2}?definitif=1`).set(A);
  assert.equal((await request(app).get(`/api/operations?truck=${t2}`).set(A)).body.total, 0);
});
