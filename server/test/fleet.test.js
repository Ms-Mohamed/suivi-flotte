import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { boot, close } from './helpers.js';
import { analyserPleins, etatPlan } from '../src/fleetRoutes.js';

let app, A, t1, t2;
const H = (t) => ({ Authorization: `Bearer ${t}` });
before(async () => {
  const b = await boot(); app = b.app; A = H(b.token);
  t1 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'G-1', consoTheorique: 30 })).body._id;
  t2 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'G-2' })).body._id;
});
after(close);
const plein = (truck, date, kmCompteur, litres, extra = {}) => request(app).post('/api/carburant').set(A).send({ truck, date, kmCompteur, litres, prixLitre: 10, ...extra });
const list = (qs = '') => request(app).get(`/api/carburant${qs}`).set(A).then((r) => r.body);

test('camion : consommation théorique enregistrée', async () => {
  const t = (await request(app).get('/api/trucks').set(A)).body.find((x) => x._id === t1);
  assert.equal(t.consoTheorique, 30);
  assert.equal((await request(app).post('/api/trucks').set(A).send({ immatriculation: 'X', consoTheorique: -1 })).status, 400);
});

test('plein : validations', async () => {
  assert.equal((await plein(t1, '2026-05-01', 0, 100)).status, 400);                       // km obligatoire
  assert.equal((await plein(t1, '2026-05-01', 1000, 0)).status, 400);                      // litres > 0
  assert.equal((await plein(t1, '2026-05-01', 1000, 100, { prixLitre: 0 })).status, 400);  // prix ou montant
  assert.equal((await plein(t1, '2026-02-30', 1000, 100)).status, 400);                    // date invalide
  assert.equal((await plein('zzz', '2026-05-01', 1000, 100)).status, 400);
  assert.equal((await plein('64b000000000000000000000', '2026-05-01', 1000, 100)).status, 404);
  const ok = await plein(t1, '2026-05-01', 10000, 300, { prixLitre: 0, montant: 3000 });   // prix déduit du montant
  assert.equal(ok.status, 201); assert.equal(ok.body.montant, 3000);
  assert.equal(ok.body.meta.prixLitre, 10); assert.equal(ok.body.kind, 'plein');
});

test('analyse plein à plein : normal, surconsommation, suspect, premier plein', async () => {
  await plein(t1, '2026-05-05', 10500, 150);                  // 500 km, 150 L = 30 L/100 → normal
  await plein(t1, '2026-05-10', 11000, 200);                  // 500 km, 200 L = 40 L/100 → surconsommation
  await plein(t1, '2026-05-12', 11100, 10);                   // 100 km, 10 L = 10 L/100 → suspect
  const r = await list(`?truck=${t1}`);
  const by = Object.fromEntries(r.items.map((x) => [x.date, x]));
  assert.equal(by['2026-05-01'].statutConso, 'incomplet');
  assert.equal(by['2026-05-05'].statutConso, 'normal'); assert.equal(by['2026-05-05'].conso, 30);
  const s = by['2026-05-10'];
  assert.equal(s.statutConso, 'surconsommation'); assert.equal(s.conso, 40); assert.equal(s.ecart, 10);
  assert.equal(s.surplusLitres, 50); assert.equal(s.surplusDh, 500);
  assert.equal(by['2026-05-12'].statutConso, 'suspect');
  assert.equal(r.kpis.nbPleins, 4); assert.equal(r.kpis.nbSurconsommation, 1); assert.equal(r.kpis.nbSuspects, 1);
  assert.equal(r.kpis.surplusDh, 500);
  assert.equal(r.kpis.kmAnalyses, 1100); assert.equal(r.kpis.consoMoyenne, 32.73);   // (150+200+10) / 1100
  const f1 = await list('?statut=surconsommation');
  assert.equal(f1.items.length, 1); assert.equal(f1.total, 1);
  assert.equal(f1.kpis.nbPleins, 4);                                        // les indicateurs ne dépendent pas du filtre de statut
  assert.equal((await list(`?from=2026-05-06&to=2026-05-31`)).total, 2);
});

test('sans consommation théorique : calculée mais non jugée ; km incohérent : incomplet', async () => {
  await plein(t2, '2026-05-01', 5000, 100); await plein(t2, '2026-05-08', 5400, 120);
  await plein(t2, '2026-05-09', 5300, 50);                    // km en arrière
  const r = (await list(`?truck=${t2}`)).items;
  const f = Object.fromEntries(r.map((x) => [x.date, x]));
  assert.equal(f['2026-05-08'].statutConso, 'sans_reference'); assert.equal(f['2026-05-08'].conso, 30);
  assert.equal(f['2026-05-09'].statutConso, 'incomplet'); assert.match(f['2026-05-09'].raison, /inférieur/);
});

test('seuil de signalement configurable', async () => {
  const set = (seuilSurconso) => request(app).put('/api/settings').set(A).send({ societe: 'T', tauxIS: 20, cotisationMinimale: 0.25, cotisationMinimaleActive: true, dateBascule: '', seuilSurconso });
  assert.equal((await set(120)).status, 200);
  assert.equal((await list(`?truck=${t1}`)).kpis.nbSurconsommation, 0);     // 40 L/100 n'est plus > +120 %
  await set(10);
  assert.equal((await list(`?truck=${t1}`)).kpis.nbSurconsommation, 1);
});

test('les pleins alimentent le résultat du camion (compte gazole) et se corrigent avec historique', async () => {
  const month = (await request(app).get(`/api/entries/${t1}/2026-05`).set(A)).body;
  assert.equal(month.calc.lignes['61221000'], 3000 + 1500 + 2000 + 100);
  const row = (await list(`?truck=${t1}`)).items.find((x) => x.date === '2026-05-12');
  // le journal générique refuse de modifier un plein
  const j = await request(app).put(`/api/operations/${row.id}`).set(A).send({ truck: t1, date: '2026-05-12', code: '61221000', montant: 1, km: 0 });
  assert.equal(j.status, 409);
  const e = await request(app).put(`/api/carburant/${row.id}`).set(A).send({ truck: t1, date: '2026-05-12', kmCompteur: 11100, litres: 30, prixLitre: 12 });
  assert.equal(e.status, 200);
  const d = (await request(app).get(`/api/operations/${row.id}`).set(A)).body;
  assert.equal(d.montant, 360); assert.equal(d.meta.litres, 30); assert.equal(d.historique[0].action, 'modification'); assert.equal(d.historique[0].avant.montant, 100);
  assert.equal((await list(`?truck=${t1}`)).items.find((x) => x.id === row.id).statutConso, 'normal'); // 30 L / 100 km
  await request(app).delete(`/api/operations/${row.id}`).set(A);
  assert.equal((await list(`?truck=${t1}`)).kpis.nbPleins, 3);
});

test('maintenance : intervention, compte pneus/maintenance, KPIs', async () => {
  const mk = (b) => request(app).post('/api/entretien').set(A).send({ truck: t1, ...b });
  assert.equal((await mk({ date: '2026-05-02', montant: 0 })).status, 400);
  assert.equal((await mk({ date: '2026-05-02', montant: 100, categorie: 'inconnue' })).status, 400);
  const v = await mk({ date: '2026-05-02', type: 'preventive', categorie: 'vidange', garage: 'Garage Atlas', kmCompteur: 10200, montant: 1200 });
  assert.equal(v.status, 201); assert.equal(v.body.code, '61330000'); assert.equal(v.body.garage, 'Garage Atlas');
  const p = await mk({ date: '2026-05-20', type: 'curative', categorie: 'pneus', kmCompteur: 11200, montant: 4000 });
  assert.equal(p.body.code, '61222000');
  const r = (await request(app).get('/api/entretien?from=2026-05-01&to=2026-05-31').set(A)).body;
  assert.equal(r.kpis.nb, 2); assert.equal(r.kpis.cout, 5200); assert.equal(r.kpis.preventives, 1); assert.equal(r.kpis.coutCuratif, 4000);
  assert.equal(r.parCategorie[0].categorie, 'pneus'); assert.equal(r.parMois[0].mois, '2026-05'); assert.equal(r.parCamion[0].cout, 5200);
  const e = (await request(app).get(`/api/entries/${t1}/2026-05`).set(A)).body.calc.lignes;
  assert.equal(e['61330000'], 1200); assert.equal(e['61222000'], 4000);
  // modification via la page Maintenance, refus via le journal
  const upd = await request(app).put(`/api/entretien/${v.body.id}`).set(A).send({ truck: t1, date: '2026-05-02', type: 'preventive', categorie: 'vidange', kmCompteur: 10200, montant: 1300 });
  assert.equal(upd.status, 200);
  assert.equal((await request(app).get('/api/entretien?type=preventive').set(A)).body.kpis.cout, 1300);
  assert.equal((await request(app).put(`/api/operations/${v.body.id}`).set(A).send({ truck: t1, date: '2026-05-02', code: '61330000', montant: 5, km: 0 })).status, 409);
  assert.equal((await request(app).put(`/api/carburant/${v.body.id}`).set(A).send({ truck: t1, date: '2026-05-02', kmCompteur: 1, litres: 1, prixLitre: 1 })).status, 404);
});

test('plans d\'entretien : calcul des échéances et mise à jour automatique', async () => {
  const bad = await request(app).post('/api/entretien/plans').set(A).send({ truck: t1, libelle: 'Vidange', categorie: 'vidange' });
  assert.equal(bad.status, 400);                                            // aucun intervalle
  const pl = await request(app).post('/api/entretien/plans').set(A).send({ truck: t1, libelle: 'Vidange', categorie: 'vidange', intervalleKm: 5000, intervalleJours: 90, dernierKm: 5000, dernierDate: '2026-01-01' });
  assert.equal(pl.status, 201);
  let items = (await request(app).get('/api/entretien/plans').set(A)).body.items;
  assert.equal(items[0].statut, 'en_retard'); assert.equal(items[0].prochainKm, 10000);
  // une nouvelle vidange remet le plan à jour (km compteur = 12000)
  await request(app).post('/api/entretien').set(A).send({ truck: t1, date: new Date().toISOString().slice(0, 10), categorie: 'vidange', kmCompteur: 12000, montant: 900 });
  items = (await request(app).get('/api/entretien/plans').set(A)).body.items;
  assert.equal(items[0].dernierKm, 12000); assert.equal(items[0].statut, 'ok'); assert.equal(items[0].kmRestants, 5000);
  assert.equal((await request(app).put(`/api/entretien/plans/${items[0].id}`).set(A).send({ truck: t1, libelle: 'Vidange', categorie: 'vidange', intervalleKm: 1000, intervalleJours: 0, dernierKm: 11200, dernierDate: '' })).status, 200);
  assert.equal((await request(app).get('/api/entretien/plans').set(A)).body.items[0].statut, 'bientot');   // 200 km restants
  assert.equal((await request(app).delete(`/api/entretien/plans/${items[0].id}`).set(A)).status, 200);
  assert.equal((await request(app).get('/api/entretien/plans').set(A)).body.items.length, 0);
});

test('km actuel = relevé le plus récent : une faute de frappe supprimée ne fausse plus les plans', async () => {
  const pl = (await request(app).post('/api/entretien/plans').set(A).send({ truck: t2, libelle: 'Test km', categorie: 'autre', intervalleKm: 1000, dernierKm: 5000 })).body.id;
  const bad = await plein(t2, '2026-06-20', 999999, 50);
  let p = (await request(app).get('/api/entretien/plans').set(A)).body.items.find((x) => x.id === pl);
  assert.equal(p.kmActuel, 999999); assert.equal(p.statut, 'en_retard');
  await request(app).delete(`/api/operations/${bad.body.id}`).set(A);
  p = (await request(app).get('/api/entretien/plans').set(A)).body.items.find((x) => x.id === pl);
  assert.equal(p.kmActuel, 5300);                                           // relevé le plus récent restant (plein du 09/05)
  await request(app).delete(`/api/entretien/plans/${pl}`).set(A);
});

test('etatPlan / analyserPleins : cas limites (fonctions pures)', () => {
  assert.equal(etatPlan({ intervalleKm: 0, intervalleJours: 0, dernierKm: 0, dernierDate: '' }, 0).statut, 'sans_historique');
  assert.equal(etatPlan({ intervalleKm: 5000, intervalleJours: 0, dernierKm: 1000, dernierDate: '' }, 0).statut, 'sans_historique'); // km actuel inconnu
  assert.equal(etatPlan({ intervalleKm: 5000, intervalleJours: 0, dernierKm: 1000, dernierDate: '' }, 5999).statut, 'bientot');
  assert.equal(etatPlan({ intervalleKm: 5000, intervalleJours: 0, dernierKm: 1000, dernierDate: '' }, 6001).statut, 'en_retard');
  assert.deepEqual(analyserPleins([], new Map(), 10), []);
});

test('sauvegarde / restauration : pleins, interventions (meta) et plans reviennent', async () => {
  await request(app).post('/api/entretien/plans').set(A).send({ truck: t2, libelle: 'Freins', categorie: 'freins', intervalleJours: 60, dernierDate: '2026-04-01' });
  const b = (await request(app).post('/api/backups').set(A)).body;
  assert.equal(b.counts.plans, 1);
  await request(app).delete(`/api/entretien/plans/${(await request(app).get('/api/entretien/plans').set(A)).body.items[0].id}`).set(A);
  const before = (await list()).kpis.nbPleins;
  const r = await request(app).post(`/api/backups/${b.name}/restaurer`).set(A).send({ confirmation: 'RESTAURER' });
  assert.equal(r.status, 200);
  assert.equal((await request(app).get('/api/entretien/plans').set(A)).body.items.length, 1);
  assert.equal((await list()).kpis.nbPleins, before);
  assert.ok((await list(`?truck=${t1}`)).items.some((x) => x.litres > 0 && x.source));
});

test('rôle lecture : consultation seulement', async () => {
  const { User } = await import('../src/models.js'); const { hash } = await import('../src/auth.js');
  await User.create({ email: 'l@test.ma', role: 'lecture', passwordHash: await hash('motdepasse1') });
  const tok = (await request(app).post('/api/auth/login').send({ email: 'l@test.ma', password: 'motdepasse1' })).body.token;
  assert.equal((await request(app).get('/api/carburant').set(H(tok))).status, 200);
  assert.equal((await request(app).get('/api/entretien').set(H(tok))).status, 200);
  assert.equal((await plein(t1, '2026-06-01', 20000, 100).set(H(tok))).status, 403);
  assert.equal((await request(app).post('/api/entretien').set(H(tok)).send({ truck: t1, date: '2026-06-01', montant: 10 })).status, 403);
  assert.equal((await request(app).post('/api/entretien/plans').set(H(tok)).send({ truck: t1, libelle: 'x', intervalleKm: 1 })).status, 403);
});
