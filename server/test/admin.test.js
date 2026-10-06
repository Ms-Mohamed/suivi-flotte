import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { boot, close } from './helpers.js';
import { User, Truck, Entry } from '../src/models.js';
import { ensureAdmin } from '../src/auth.js';

let app, A; // A = en-têtes admin
const tmp = path.join(os.tmpdir(), `sf-backups-${Date.now()}`);
process.env.BACKUP_DIR = tmp;
const login = async (email, password) => (await request(app).post('/api/auth/login').send({ email, password }));
const H = (t) => ({ Authorization: `Bearer ${t}` });
const bin = (b) => ({ 'Content-Type': 'application/octet-stream', ...b });

before(async () => { const b = await boot(); app = b.app; A = H(b.token); });
after(async () => { await close(); await fs.rm(tmp, { recursive: true, force: true }); });

let saisie, lecture, truckId;
test('migration : l’ancien rôle « manager » devient « admin »', async () => {
  await User.collection.insertOne({ email: 'old@test.ma', passwordHash: 'x', role: 'manager', createdAt: new Date(), updatedAt: new Date() });
  await ensureAdmin();
  assert.equal((await User.findOne({ email: 'old@test.ma' })).role, 'admin');
  await User.deleteOne({ email: 'old@test.ma' });
});

test('admin crée un compte saisie et un compte lecture ; mot de passe court refusé ; doublon refusé', async () => {
  assert.equal((await request(app).post('/api/users').set(A).send({ email: 'x@t.ma', nom: 'X', role: 'saisie', password: 'court' })).status, 400);
  const r1 = await request(app).post('/api/users').set(A).send({ email: 'saisie@t.ma', nom: 'Dispatcher', role: 'saisie', password: 'motdepasse-saisie' });
  assert.equal(r1.status, 201); assert.equal(r1.body.role, 'saisie'); assert.equal(r1.body.passwordHash, undefined);
  assert.equal((await request(app).post('/api/users').set(A).send({ email: 'saisie@t.ma', nom: 'D2', role: 'saisie', password: 'motdepasse-saisie' })).status, 409);
  await request(app).post('/api/users').set(A).send({ email: 'lecture@t.ma', nom: 'Direction', role: 'lecture', password: 'motdepasse-lecture' });
  saisie = H((await login('saisie@t.ma', 'motdepasse-saisie')).body.token);
  lecture = H((await login('lecture@t.ma', 'motdepasse-lecture')).body.token);
  assert.ok(saisie.Authorization.length > 20 && lecture.Authorization.length > 20);
  truckId = (await request(app).post('/api/trucks').set(A).send({ immatriculation: '777-A-1' })).body._id;
});

test('rôle saisie : peut saisir et importer, ne peut pas gérer camions, paramètres, utilisateurs, sauvegardes', async () => {
  assert.equal((await request(app).put(`/api/entries/${truckId}/2026-05`).set(saisie).send({ km: 1000, tarifKm: 10 })).status, 200);
  assert.equal((await request(app).get('/api/import/modele').set(saisie)).status, 200);
  assert.equal((await request(app).post('/api/trucks').set(saisie).send({ immatriculation: 'Z-1' })).status, 403);
  assert.equal((await request(app).delete(`/api/trucks/${truckId}`).set(saisie)).status, 403);
  assert.equal((await request(app).put('/api/settings').set(saisie).send({ societe: 'X', tauxIS: 1, cotisationMinimale: 1, cotisationMinimaleActive: false })).status, 403);
  assert.equal((await request(app).get('/api/users').set(saisie)).status, 403);
  assert.equal((await request(app).get('/api/backups').set(saisie)).status, 403);
  assert.equal((await request(app).get('/api/reports/dashboard?month=2026-05').set(saisie)).status, 200);
});

test('rôle lecture : consulte et exporte, ne modifie rien', async () => {
  assert.equal((await request(app).get(`/api/entries/${truckId}/2026-05`).set(lecture)).status, 200);
  assert.equal((await request(app).get('/api/export/month/2026-05').set(lecture)).status, 200);
  assert.equal((await request(app).put(`/api/entries/${truckId}/2026-05`).set(lecture).send({ km: 5 })).status, 403);
  assert.equal((await request(app).delete(`/api/entries/${truckId}/2026-05`).set(lecture)).status, 403);
  assert.equal((await request(app).post('/api/import/valider').set(lecture).set(bin({})).send(Buffer.from('x'))).status, 403);
});

test('compte désactivé : connexion refusée et session existante invalidée ; dernier admin protégé', async () => {
  const list = (await request(app).get('/api/users').set(A)).body;
  const sid = list.find((u) => u.email === 'saisie@t.ma').id;
  assert.equal((await request(app).put(`/api/users/${sid}`).set(A).send({ nom: 'Dispatcher', role: 'saisie', actif: false })).status, 200);
  assert.equal((await login('saisie@t.ma', 'motdepasse-saisie')).status, 401);
  assert.equal((await request(app).get('/api/trucks').set(saisie)).status, 401);
  const admin = list.find((u) => u.role === 'admin');
  assert.equal((await request(app).put(`/api/users/${admin.id}`).set(A).send({ nom: 'G', role: 'lecture', actif: true })).status, 400);
  assert.equal((await request(app).delete(`/api/users/${admin.id}`).set(A)).status, 400);
});

test('sauvegarde : création, liste, téléchargement, noms invalides refusés', async () => {
  const c = await request(app).post('/api/backups').set(A);
  assert.equal(c.status, 201); assert.ok(c.body.counts.camions >= 1);
  const l = await request(app).get('/api/backups').set(A);
  assert.ok(l.body.fichiers.some((f) => f.name === c.body.name));
  const d = await request(app).get(`/api/backups/${c.body.name}`).set(A).buffer().parse((res, cb) => { const a = []; res.on('data', (x) => a.push(x)); res.on('end', () => cb(null, Buffer.concat(a))); });
  assert.equal(d.status, 200); assert.equal(d.body[0], 0x1f);                // en-tête gzip
  assert.equal((await request(app).get('/api/backups/..%2F..%2Fetc%2Fpasswd').set(A)).status, 400);
  assert.equal((await request(app).get('/api/backups/evil.json.gz').set(A)).status, 400);
});

test('restauration : confirmation obligatoire, rétablit les données, crée une sauvegarde de sécurité', async () => {
  const b = (await request(app).post('/api/backups').set(A)).body;
  await request(app).delete(`/api/trucks/${truckId}?definitif=1`).set(A);
  assert.equal(await Truck.countDocuments(), 0); assert.equal(await Entry.countDocuments(), 0);
  assert.equal((await request(app).post(`/api/backups/${b.name}/restaurer`).set(A).send({})).status, 400);
  const r = await request(app).post(`/api/backups/${b.name}/restaurer`).set(A).send({ confirmation: 'RESTAURER' });
  assert.equal(r.status, 200); assert.equal(r.body.camions, 1); assert.equal(r.body.saisies, 1);
  assert.match(r.body.sauvegardeDeSecurite, /avant-restauration/);
  const e = await request(app).get(`/api/entries/${truckId}/2026-05`).set(A);       // mêmes identifiants qu'avant
  assert.equal(e.body.exists, true); assert.equal(e.body.calc.A, 10000);
});

test('import d’une sauvegarde : fichier invalide refusé, fichier valide accepté puis restaurable', async () => {
  assert.equal((await request(app).post('/api/backups/importer').set(A).set(bin({})).send(Buffer.from('pas une sauvegarde'))).status, 400);
  const name = (await request(app).post('/api/backups').set(A)).body.name;
  const file = await fs.readFile(path.join(tmp, name));
  const up = await request(app).post('/api/backups/importer').set(A).set(bin({})).send(file);
  assert.equal(up.status, 201); assert.match(up.body.name, /-import\.json\.gz$/);
});

const sheet = async (rows, headers) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Saisies');
  ws.addRow(headers || ['Immatriculation', 'Mois (AAAA-MM)', 'Km chargés', 'Tarif au km', 'Litres de gazole', 'Prix du litre', '71280000 - Surcharges Carburant (Indexation)', '61222000 - Pneumatiques', '61310000 - Loyer Crédit-Bail / LLD', '61610000 - Taxe à l\'Essieu & Vignettes (annuel)']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const post = (p, buf, q = '') => request(app).post(`/api/import/${p}${q}`).set(A).set(bin({})).send(buf);

test('import Excel : aperçu valide les lignes sans rien écrire', async () => {
  const buf = await sheet([
    ['888-B-2', '2026-03', 10000, 10, 3300, 11, 1000, 4000, 18000, 9960],   // OK : camion à créer
    ['777-A-1', '03/2026', '8 000', '9,5', 2500, 11, 0, 0, 0, 0],             // OK : camion existant, formats français
    ['777-A-1', '2026-13', 1, 1, 1, 1, 0, 0, 0, 0],                           // mois invalide
    ['888-B-2', '2026-03', 1, 1, 1, 1, 0, 0, 0, 0],                           // doublon dans le fichier
    ['999-Z-9', '2026-03', -5, 1, 1, 1, 0, 0, 0, 0],                          // négatif refusé
    [],
  ]);
  const r = await post('apercu', buf, '?creerCamions=1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x) => x.statut), ['nouveau', 'nouveau', 'erreur', 'erreur', 'erreur']);
  assert.equal(r.body.rows[0].A, 100000 + 1000); assert.equal(r.body.rows[0].B, 36300 + 4000 + 18000 + 830);
  assert.equal(r.body.rows[1].A, 76000);
  assert.deepEqual(r.body.resume.camionsCrees, ['888-B-2']);
  assert.equal(await Truck.countDocuments({ immatriculation: '888-B-2' }), 0);     // rien n'a été écrit
  const sansCreation = await post('apercu', buf);
  assert.match(sansCreation.body.rows[0].messages.join(' '), /camion inconnu/);
});

test('import Excel : validation écrit, ignore les mois existants, écrase sur demande', async () => {
  const buf = await sheet([['888-B-2', '2026-03', 10000, 10, 3300, 11, 1000, 4000, 18000, 9960]]);
  const r = await post('valider', buf, '?creerCamions=1');
  assert.equal(r.body.resume.importes, 1); assert.equal(r.body.resume.camionsCrees.length, 1);
  const t = await Truck.findOne({ immatriculation: '888-B-2' });
  const e = await request(app).get(`/api/entries/${t._id}/2026-03`).set(A);
  assert.equal(e.body.exists, true); assert.equal(e.body.calc.A, 101000); assert.equal(e.body.calc.B, 59130);
  assert.equal(e.body.entry.annuel['61610000'], 9960);
  const again = await post('valider', buf);
  assert.equal(again.body.resume.ignores, 1);
  const changed = await sheet([['888-B-2', '2026-03', 12000, 10, 3300, 11, 1000, 4000, 18000, 9960]]);
  assert.equal((await post('valider', changed, '?ecraser=1')).body.resume.importes, 1);
  assert.equal((await request(app).get(`/api/entries/${t._id}/2026-03`).set(A)).body.calc.lignes['71210000'], 120000);
});

test('import Excel : modèle téléchargeable et relisible ; fichier invalide et colonnes manquantes → 400', async () => {
  const m = await request(app).get('/api/import/modele').set(A).buffer().parse((res, cb) => { const a = []; res.on('data', (x) => a.push(x)); res.on('end', () => cb(null, Buffer.concat(a))); });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(m.body);
  const headers = []; wb.getWorksheet('Saisies').getRow(1).eachCell((c) => headers.push(c.value));
  assert.equal(headers.length, 6 + 15); assert.ok(wb.getWorksheet('Aide'));
  const empty = await post('apercu', Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(empty.status, 400); assert.match(empty.body.error, /Aucune ligne/);
  assert.equal((await post('apercu', Buffer.from('ceci n’est pas un xlsx'))).status, 400);
  assert.equal((await post('apercu', await sheet([['a', 1]], ['Foo', 'Bar']))).status, 400);
});
