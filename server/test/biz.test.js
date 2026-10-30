import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { boot, close } from './helpers.js';
import { calcBulletin, PAIE_DEFAUTS } from '../src/biz/rh.js';
import { calcDoc, calcMission, statutReglement } from '../../shared/doc.js';

const tmp = path.join(os.tmpdir(), `sf-biz-${Date.now()}`);
process.env.BACKUP_DIR = path.join(tmp, 'bk'); process.env.UPLOAD_DIR = path.join(tmp, 'up');
const today = new Date().toISOString().slice(0, 10);
const addD = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let app, A, L, S, t1, t2, cl, cl2;
const H = (t) => ({ Authorization: `Bearer ${t}` });
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.body)); return r.body; };
before(async () => {
  const b = await boot(); app = b.app; A = H(b.token);
  for (const [email, role] of [['s@t.ma', 'saisie'], ['l@t.ma', 'lecture']]) await request(app).post('/api/users').set(A).send({ email, nom: role, role, password: 'motdepasse-12' });
  S = H((await request(app).post('/api/auth/login').send({ email: 's@t.ma', password: 'motdepasse-12' })).body.token);
  L = H((await request(app).post('/api/auth/login').send({ email: 'l@t.ma', password: 'motdepasse-12' })).body.token);
  t1 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'B1-A-1', type: 'tracteur', capaciteTonnes: 25 })).body._id;
  t2 = (await request(app).post('/api/trucks').set(A).send({ immatriculation: 'B2-A-2' })).body._id;
  cl = ok(await request(app).post('/api/clients').set(S).send({ nom: 'Global Import', ice: '001234567000012', delaiPaiement: 30 }), 201)._id;
  cl2 = ok(await request(app).post('/api/clients').set(S).send({ nom: 'Autre Client' }), 201)._id;
});
after(async () => { await close(); await fs.rm(tmp, { recursive: true, force: true }); });
const post = (p, body, who = A) => request(app).post(`/api/${p}`).set(who).send(body);
const put = (p, body, who = A) => request(app).put(`/api/${p}`).set(who).send(body);
const get = (p, who = A) => request(app).get(`/api/${p}`).set(who);
const del = (p, who = A) => request(app).delete(`/api/${p}`).set(who);

test('calculs partagés : TVA par taux, remise, mission, règlement', () => {
  const d = calcDoc({ lignes: [{ designation: 'a', qte: 2, pu: 100.5, tva: 20 }, { designation: 'b', qte: 1, pu: 50, tva: 10 }], remisePct: 10, fraisSupp: [{ libelle: 'x', montant: 30, tva: 20 }] });
  assert.equal(d.totalBrutHT, 281); assert.equal(d.totalHT, 252.9); assert.equal(d.totalTVA, 46.08); assert.equal(d.totalTTC, 298.98);
  assert.deepEqual(calcMission({ tonnage: 25, prixUnitaire: 100, fraisChargement: 100, tva: 20 }), { base: 2500, frais: 100, totalHT: 2600, totalTVA: 520, totalTTC: 3120 });
  assert.equal(calcMission({ mode: 'forfait', prixForfait: 900, tva: 20 }).totalTTC, 1080);
  assert.deepEqual(statutReglement({ totalTTC: 1200, paye: 200, echeance: '2020-01-01' }), { reste: 1000, statut: 'en_retard' });
  assert.equal(statutReglement({ totalTTC: 1200, paye: 1200 }).statut, 'payee');
});

test('droits : lecture ne crée rien, saisie ne voit pas la RH', async () => {
  assert.equal((await post('clients', { nom: 'X' }, L)).status, 403);
  assert.equal((await get('clients', L)).status, 200);
  assert.equal((await get('rh/employes', S)).status, 403);
  assert.equal((await post('rh/employes', { nom: 'X' }, S)).status, 403);
  assert.equal((await get('rh/paie?periode=2026-05', S)).status, 403);
});

let mission, facture;
test('mission terminée → alimente le résultat du camion ; brouillon/planifiée non', async () => {
  const body = { type: 'interne', client: cl, villeCharge: 'Tanger', villeDecharge: 'Casablanca', dateMission: '2026-05-04', marchandise: 'Textile', tonnage: 25, distance: 340,
    prixUnitaire: 100, fraisChargement: 100, tva: 20, truck: t1, statut: 'planifiee', charges: [{ code: '61420000', montant: 300 }] };
  mission = ok(await post('missions', body, S), 201);
  assert.match(mission.ref, /^M-0001-2026$/); assert.equal(mission.totalHT, 2600); assert.equal(mission.totalTTC, 3120); assert.equal(mission.coutTotal, 300);
  let e = ok(await get(`entries/${t1}/2026-05`)); assert.equal(e.calc.A, 0);
  mission = ok(await put(`missions/${mission._id}`, { ...body, statut: 'terminee' }, S));
  e = ok(await get(`entries/${t1}/2026-05`)); assert.equal(e.calc.A, 2600); assert.equal(e.calc.lignes['61420000'], 300); assert.equal(e.calc.km, 340);
  // modifier le montant met à jour sans doublon
  ok(await put(`missions/${mission._id}`, { ...body, statut: 'terminee', prixUnitaire: 110 }, S));
  e = ok(await get(`entries/${t1}/2026-05`)); assert.equal(e.calc.A, 25 * 110 + 100); assert.equal(e.calc.nbOps, 2);
  // retour à planifiée = plus de produit
  ok(await put(`missions/${mission._id}`, { ...body, statut: 'planifiee' }, S));
  assert.equal(ok(await get(`entries/${t1}/2026-05`)).calc.A, 0);
  ok(await put(`missions/${mission._id}`, { ...body, statut: 'terminee' }, S));
  // les lignes de mission ne se modifient pas depuis le journal
  const ops = ok(await get('operations?limit=50')).items; assert.equal(ops.length, 2);
  assert.equal((await put(`operations/${ops[0].id}`, { truck: t1, date: '2026-05-04', code: '71210000', montant: 5, km: 0, voyage: '', note: '' })).status, 409);
  assert.equal((await del(`operations/${ops[0].id}`)).status, 409);
});

test('validations mission : sous-traité sans sous-traitant, dates, compte inconnu', async () => {
  const base = { client: cl, dateMission: '2026-05-05', tonnage: 10, prixUnitaire: 50 };
  assert.equal((await post('missions', { ...base, type: 'soustraite' }, S)).status, 400);
  assert.equal((await post('missions', { ...base, dateChargement: '2026-05-06', dateDechargement: '2026-05-05' }, S)).status, 400);
  assert.equal((await post('missions', { ...base, charges: [{ code: '71210000', montant: 5 }] }, S)).status, 400);
  assert.equal((await post('missions', { ...base, client: '64b000000000000000000000' }, S)).status < 500, true);
});

test('facturation : depuis missions, émission numérotée, paiements, avoirs, règlement', async () => {
  // non terminée → refusée
  const plan = ok(await post('missions', { client: cl, dateMission: '2026-05-06', tonnage: 1, prixUnitaire: 10, truck: t1 }, S), 201);
  assert.equal((await post('factures/depuis-missions', { client: cl, missionIds: [plan._id], date: today }, S)).status, 400);
  assert.equal((await post('factures/depuis-missions', { client: cl2, missionIds: [mission._id], date: today }, S)).status, 400);   // autre client
  facture = ok(await post('factures/depuis-missions', { client: cl, missionIds: [mission._id], date: today }, S), 201);
  assert.equal(facture.statut, 'brouillon'); assert.equal(facture.numero, ''); assert.equal(facture.lignes.length, 2);
  assert.equal(facture.totalHT, 2600); assert.equal(facture.totalTTC, 3120);
  const tot = facture.totalTTC;
  // la mission est verrouillée et ne peut pas être facturée deux fois
  assert.equal((await put(`missions/${mission._id}`, { client: cl, dateMission: '2026-05-04', statut: 'terminee', tonnage: 25, prixUnitaire: 5, truck: t1 }, S)).status, 409);
  assert.equal((await post('factures/depuis-missions', { client: cl, missionIds: [mission._id], date: today }, S)).status, 409);
  assert.equal((await post(`factures/${facture._id}/emettre`, {}, L)).status, 403);
  facture = ok(await post(`factures/${facture._id}/emettre`, {}, S));
  assert.match(facture.numero, new RegExp(`^F-0001-${today.slice(0, 4)}$`)); assert.equal(facture.statut, 'emise');
  assert.equal((await put(`factures/${facture._id}`, { client: cl, date: today, lignes: [] }, S)).status, 409);       // plus modifiable
  assert.equal((await del(`factures/${facture._id}`, S)).status, 409);
  // paiement partiel en espèces
  const p1 = ok(await post('paiements', { facture: facture._id, date: today, montant: 1000, mode: 'especes', reference: 'REC-1' }, S), 201);
  let f = ok(await get(`factures/${facture._id}`)); assert.equal(f.paye, 1000); assert.equal(f.reste, tot - 1000); assert.equal(f.reglement, 'partielle');
  let caisse = ok(await get('caisse')); assert.equal(caisse.kpis.solde, 1000); assert.equal(caisse.items[0].source, 'paiement_client');
  assert.equal((await put(`caisse/${caisse.items[0]._id}`, { date: today, sens: 'entree', libelle: 'x', montant: 5 }, S)).status, 409);
  assert.equal((await post('paiements', { facture: facture._id, date: today, montant: tot, mode: 'virement' }, S)).status, 400);   // dépasse le reste
  assert.equal((await post(`factures/${facture._id}/annuler`, {}, S)).status, 409);                                              // paiements existants
  // avoir : partiel puis dépassement
  const av = ok(await post('avoirs', { facture: facture._id, date: today, motif: 'Remise commerciale', lignes: [{ designation: 'Remise', qte: 1, pu: 500, tva: 20 }] }, S), 201);
  assert.match(av.numero, /^AV-0001-/); assert.equal(av.totalTTC, 600);
  assert.equal((await post('avoirs', { facture: facture._id, date: today, lignes: [{ designation: 'trop', qte: 1, pu: 5000, tva: 20 }] }, S)).status, 400);
  f = ok(await get(`factures/${facture._id}`)); assert.equal(f.avoirs, 600); assert.equal(f.reste, tot - 1000 - 600);
  // règlement du solde
  ok(await post('paiements', { facture: facture._id, date: today, montant: tot - 1600, mode: 'virement', reference: 'VIR-9' }, S), 201);
  f = ok(await get(`factures/${facture._id}`)); assert.equal(f.reste, 0); assert.equal(f.reglement, 'payee');
  // supprimer un paiement rouvre le reste et retire l'écriture de caisse
  ok(await del(`paiements/${p1._id}`, S));
  f = ok(await get(`factures/${facture._id}`)); assert.equal(f.reste, 1000); assert.equal(f.reglement, 'partielle');
  assert.equal(ok(await get('caisse')).kpis.solde, 0);
  const rel = ok(await get('releve-reglements')); assert.equal(rel.items.length, 1); assert.equal(rel.totaux.reste, 1000); assert.equal(rel.totaux.partielles, 1);
});

test('facture annulée libère les missions ; numéro attribué à l’émission seulement', async () => {
  const m = ok(await post('missions', { client: cl2, dateMission: '2026-05-07', tonnage: 10, prixUnitaire: 100, tva: 20, truck: t2, statut: 'terminee' }, S), 201);
  const f = ok(await post('factures/depuis-missions', { client: cl2, missionIds: [m._id], date: today }, S), 201);
  assert.equal(ok(await get(`missions/${m._id}`)).facture.numero ?? '', '');
  ok(await del(`factures/${f._id}`, S));                                                   // brouillon supprimé : pas de trou de numérotation
  assert.equal(ok(await get(`missions/${m._id}`)).facture, null);
  const f2 = ok(await post('factures/depuis-missions', { client: cl2, missionIds: [m._id], date: today }, S), 201);
  const e = ok(await post(`factures/${f2._id}/emettre`, {}, S)); assert.match(e.numero, /-0002-/);
  ok(await post(`factures/${f2._id}/annuler`, {}, S));
  assert.equal(ok(await get(`missions/${m._id}`)).facture, null);
  assert.equal(ok(await get('factures?reglement=payee')).total, 0);
  // devis → facture
  const d = ok(await post('devis', { client: cl2, date: today, lignes: [{ designation: 'Transport', qte: 2, pu: 1000, tva: 20 }], remisePct: 10 }, S), 201);
  assert.match(d.numero, /^D-0001-/); assert.equal(d.totalHT, 1800); assert.equal(d.totalTTC, 2160);
  const conv = ok(await post(`devis/${d._id}/convertir`, {}, S), 201); assert.equal(conv.totalTTC, 2160);
  assert.equal((await post(`devis/${d._id}/convertir`, {}, S)).status, 409);
  // bon de livraison depuis mission
  const bl = ok(await post(`missions/${m._id}/bl`, {}, S), 201); assert.match(bl.numero, /^BL-0001-/);
  assert.equal((await post(`missions/${m._id}/bl`, {}, S)).status, 409);
});

test('rentabilité : par mission, client et véhicule', async () => {
  const r = ok(await get('rentabilite?from=2026-05-01&to=2026-05-31'));
  const mm = r.parMission.find((x) => x.ref === 'M-0001-2026'); assert.equal(mm.revenu, 2600); assert.equal(mm.cout, 300); assert.equal(mm.marge, 2300);
  const cc = r.parClient.find((x) => x.client === 'Global Import'); assert.equal(cc.revenu, 2600); assert.equal(cc.marge, 2300);
  const vv = r.parVehicule.find((x) => x.immatriculation === 'B1-A-1'); assert.equal(vv.produits, 2600); assert.equal(vv.charges, 300);
});

test('sous-traitance : coût, paiements bornés, rapport tonnage', async () => {
  const st = ok(await post('sous-traitants', { nom: 'STL Alpha' }, S), 201)._id;
  const v = ok(await post('vehicules-st', { sousTraitant: st, immatriculation: '38054-B-3', capaciteTonnes: 28 }, S), 201)._id;
  const m = ok(await post('missions', { type: 'soustraite', client: cl, sousTraitant: st, vehiculeST: v, dateMission: '2026-05-10', tonnage: 20, prixUnitaire: 120, prixUnitaireST: 90, statut: 'terminee', truck: t1 }, S), 201);
  assert.equal(m.coutST, 1800); assert.equal(m.totalHT, 2400); assert.equal(m.truck, null);
  assert.equal(ok(await get('entries/' + t1 + '/2026-05')).calc.A, 2600);               // la sous-traitance n'entre pas dans le résultat d'un camion
  ok(await post('paiements-st', { sousTraitant: st, mission: m._id, date: today, montant: 1000, mode: 'especes' }, S), 201);
  assert.equal((await post('paiements-st', { sousTraitant: st, mission: m._id, date: today, montant: 900 }, S)).status, 400);
  const op = ok(await get('st/operations')); assert.equal(op.items[0].paye, 1000); assert.equal(op.items[0].reste, 800); assert.equal(op.items[0].marge, 600);
  const tn = ok(await get('st/tonnage?from=2026-01-01&to=2026-12-31')); assert.equal(tn.items[0].matricule, '38054-B-3'); assert.equal(tn.totaux.tonnage, 20); assert.equal(tn.totaux.reste, 800);
  const so = ok(await get('sous-traitants-soldes')); assert.equal(so.totaux.du, 1800); assert.equal(so.totaux.reste, 800);
  assert.equal((await del(`sous-traitants/${st}`, S)).status, 409);
});

test('achats : validation, paiement borné, relevé fournisseur', async () => {
  const fo = ok(await post('fournisseurs', { nom: 'Afriquia Pièces', delaiPaiement: 15 }, S), 201)._id;
  const a = ok(await post('achats', { fournisseur: fo, numeroFournisseur: 'FA-889', date: today, lignes: [{ designation: 'Filtre à huile', qte: 4, pu: 250, tva: 20 }] }, S), 201);
  assert.match(a.numero, /^ACH-0001-/); assert.equal(a.totalTTC, 1200); assert.equal(a.echeance, addD(15));
  ok(await post('paiements-fournisseurs', { achat: a._id, date: today, montant: 700, mode: 'especes' }, S), 201);
  assert.equal((await post('paiements-fournisseurs', { achat: a._id, date: today, montant: 600 }, S)).status, 400);
  const rel = ok(await get('releve-achats')); assert.equal(rel.items[0].reste, 500); assert.equal(rel.totaux.partiels, 1);
  assert.equal(ok(await get('caisse')).kpis.solde, -1700);   // -1000 sous-traitant (test précédent) -700 fournisseur
  assert.equal((await put(`achats/${a._id}`, { fournisseur: fo, date: today, lignes: [{ designation: 'x', qte: 1, pu: 100, tva: 20 }] }, S)).status, 400);   // total < déjà payé
  assert.equal((await del(`achats/${a._id}`, S)).status, 409);
});

test('documents véhicules : alertes, disponibilité, fichier (contenu vérifié)', async () => {
  const mk = (type, exp) => post('documents-vehicules', { truck: t1, type, numero: `N-${type}`, dateExpiration: exp }, S);
  const exp = ok(await mk('assurance', addD(-5)), 201);
  ok(await mk('vignette', addD(5)), 201); ok(await mk('visite_technique', addD(12)), 201); ok(await mk('carte_grise', addD(25)), 201); ok(await mk('carte_autorisation', addD(200)), 201);
  let al = ok(await get('alertes-vehicules')); assert.deepEqual([al.kpis.expire, al.kpis.j7, al.kpis.j15, al.kpis.j30], [1, 1, 1, 1]);
  let dispo = ok(await get('disponibilite')); const row = (id) => dispo.items.find((x) => x.truck._id === id);
  assert.equal(row(t1).statut, 'indisponible'); assert.match(row(t1).motif, /Assurance/); assert.equal(row(t2).statut, 'disponible');
  // renouvellement : le nouveau document masque l'ancien
  ok(await mk('assurance', addD(300)), 201);
  al = ok(await get('alertes-vehicules')); assert.equal(al.kpis.expire, 0);
  assert.equal(row(t1) && ok(await get('disponibilite')).items.find((x) => x.truck._id === t1).statut, 'disponible');
  // fichier
  const up = (name, buf) => request(app).post(`/api/documents-vehicules/${exp._id}/fichier`).set(S).set('Content-Type', 'application/octet-stream').set('x-filename', name).send(buf);
  assert.equal((await up('virus.exe', Buffer.from('MZ....'))).status, 400);
  assert.equal((await up('faux.pdf', Buffer.from('pas un pdf'))).status, 400);
  ok(await up('police.pdf', Buffer.from('%PDF-1.4\n%test\n')));
  const dl = await get(`documents-vehicules/${exp._id}/fichier`); assert.equal(dl.status, 200); assert.equal(dl.headers['content-type'], 'application/pdf');
  assert.equal(ok(await get(`documents-vehicules/${exp._id}`)).aFichier, true);
  ok(await del(`documents-vehicules/${exp._id}`, S)); assert.equal((await fs.readdir(process.env.UPLOAD_DIR)).length, 0);   // le fichier part avec le document
});

test('locations : chevauchement refusé, produit alimenté à la fin, rapport heures', async () => {
  const body = { client: cl, truck: t2, dateDebut: '2026-06-01', dateFin: '2026-06-03', mode: 'jour', prix: 2000, tva: 20, statut: 'terminee' };
  const l = ok(await post('locations', body, S), 201);
  assert.equal(l.nbJours, 3); assert.equal(l.heures, 24); assert.equal(l.totalHT, 6000); assert.equal(l.totalTTC, 7200); assert.match(l.ref, /^L-0001-/);
  assert.equal((await post('locations', { ...body, dateDebut: '2026-06-03', dateFin: '2026-06-05' }, S)).status, 409);
  assert.equal(ok(await get(`entries/${t2}/2026-06`)).calc.lignes['71880000'], 6000);
  const rh = ok(await get('rapport-heures?from=2026-01-01&to=2026-12-31&groupBy=camion')); assert.equal(rh.items[0].nom, 'B2-A-2'); assert.equal(rh.totaux.heures, 24);
  const ev = ok(await get('calendrier?month=2026-06')); assert.equal(ev.events.filter((e) => e.kind === 'location').length, 1);
  const f = ok(await post('factures/depuis-missions', { client: cl, locationIds: [l._id], date: today }, S), 201); assert.equal(f.totalHT, 6000);
  assert.equal((await put(`locations/${l._id}`, { ...body, prix: 1 }, S)).status, 409);
});

test('pannes : immobilisation → maintenance ; pièces : stock jamais négatif', async () => {
  const p = ok(await post('pannes', { truck: t2, date: today, description: 'Turbo HS', gravite: 'majeure', immobilise: true }, S), 201);
  assert.match(p.ref, /^P-0001-/);
  assert.equal(ok(await get('disponibilite')).items.find((x) => x.truck._id === t2).statut, 'maintenance');
  const r = ok(await put(`pannes/${p._id}`, { truck: t2, date: today, description: 'Turbo HS', gravite: 'majeure', statut: 'resolue', immobilise: true, cout: 3500 }, S));
  assert.equal(r.immobilise, false); assert.equal(r.dateResolution, today);
  assert.equal(ok(await get('disponibilite')).items.find((x) => x.truck._id === t2).statut, 'disponible');
  const pc = ok(await post('pieces', { designation: 'Filtre gasoil', seuil: 5, prixUnitaire: 80 }, S), 201)._id;
  ok(await post('mouvements-pieces', { piece: pc, date: today, type: 'entree', qte: 10 }, S), 201);
  ok(await post('mouvements-pieces', { piece: pc, date: today, type: 'sortie', qte: 6, truck: t1 }, S), 201);
  assert.equal((await post('mouvements-pieces', { piece: pc, date: today, type: 'sortie', qte: 5 }, S)).status, 409);
  const list = ok(await get('pieces')); assert.equal(list.items[0].stock, 4); assert.equal(list.items[0].alerte, true); assert.equal(list.kpis.alertes, 1); assert.equal(list.items[0].valeur, 320);
  assert.equal((await del(`pieces/${pc}`, S)).status, 409);
});

let emp, plein;
test('calcBulletin : heures sup, absences, CNSS plafonnée, avance, retenue', () => {
  const e = { typeSalaire: 'mensuel', salaireBase: 6000, soumisCnss: true };
  const pts = [...Array(20)].map(() => ({ type: 'present' })).concat([{ type: 'absent' }, { type: 'absent' }, { type: 'heures_sup', heures: 4 }]);
  const b = calcBulletin(e, { pointages: pts, primes: [{ montant: 500 }], retenues: [{ montant: 200 }], avances: [{ _id: 'a1', solde: 3000, remboursementMensuel: 1000 }] }, PAIE_DEFAUTS);
  assert.equal(b.retenueAbsences, 461.54); assert.equal(b.montantHeuresSup, 157.07); assert.equal(b.brut, 6195.53);
  assert.equal(b.cnss, 268.8); assert.equal(b.amo, 140.02); assert.equal(b.avances, 1000); assert.equal(b.net, 4586.71);
  const j = calcBulletin({ typeSalaire: 'journalier', salaireBase: 150, soumisCnss: false }, { pointages: [{ type: 'present' }, { type: 'present' }, { type: 'ferie' }, { type: 'absent' }] });
  assert.equal(j.base, 450); assert.equal(j.net, 450);
  const h = calcBulletin({ typeSalaire: 'horaire', salaireBase: 30, soumisCnss: false }, { pointages: [{ type: 'present', heures: 6 }, { type: 'present' }] });
  assert.equal(h.base, 30 * 14);
  // avance plafonnée au solde restant
  assert.equal(calcBulletin(e, { avances: [{ _id: 'a', solde: 300, remboursementMensuel: 1000 }] }).avances, 300);
});

test('RH + paie : génération, validation (avance déduite), verrouillage, paiement, annulation', async () => {
  emp = ok(await post('rh/employes', { nom: 'Karim Benali', poste: 'Chauffeur', typeContrat: 'CDD', dateFinContrat: addD(10), salaireBase: 6000, truck: t1 }), 201);
  assert.equal(emp.matricule, 'E001');
  assert.equal((await post('rh/employes', { nom: 'Doublon', matricule: 'E001' })).status, 409);
  const e = emp._id;
  for (let d = 1; d <= 20; d++) ok(await post('rh/pointage', { employe: e, date: `2026-05-${String(d).padStart(2, '0')}`, type: 'present' }), 201);
  ok(await post('rh/pointage', { employe: e, date: '2026-05-21', type: 'absent' }), 201); ok(await post('rh/pointage', { employe: e, date: '2026-05-22', type: 'absent' }), 201);
  assert.equal((await post('rh/pointage', { employe: e, date: '2026-05-22', type: 'absent' })).status, 409);
  assert.equal((await post('rh/pointage', { employe: e, date: '2026-05-23', type: 'heures_sup' })).status, 400);
  ok(await post('rh/pointage', { employe: e, date: '2026-05-23', type: 'heures_sup', heures: 4 }), 201);
  ok(await post('rh/primes', { employe: e, date: '2026-05-15', type: 'prime', libelle: 'Prime de rendement', montant: 500 }), 201);
  ok(await post('rh/primes', { employe: e, date: '2026-05-16', type: 'retenue', libelle: 'Amende', montant: 200 }), 201);
  const av = ok(await post('rh/avances', { employe: e, date: '2026-04-10', montant: 3000, motif: 'Rentrée', remboursementMensuel: 1000 }), 201); assert.equal(av.solde, 3000);
  const al = ok(await get('rh/alertes')); assert.equal(al.kpis.j15, 1);
  ok(await post('rh/paie/generer', { periode: '2026-05' }));
  let p = ok(await get('rh/paie?periode=2026-05')); const b = p.items[0];
  assert.equal(b.net, 4586.71); assert.equal(p.statut, 'brouillon');
  ok(await put(`rh/paie/bulletins/${b._id}`, { ir: 100 })); assert.equal(ok(await get('rh/paie?periode=2026-05')).items[0].net, 4486.71);
  ok(await post('rh/paie/generer', { periode: '2026-05' }));                                          // régénérer garde l'IR saisi
  assert.equal(ok(await get('rh/paie?periode=2026-05')).items[0].ir, 100);
  ok(await post('rh/paie/valider', { periode: '2026-05' }));
  assert.equal(ok(await get('rh/avances')).items[0].solde, 2000);
  assert.equal((await post('rh/pointage', { employe: e, date: '2026-05-24', type: 'present' })).status, 409);   // période verrouillée
  assert.equal((await post('rh/primes', { employe: e, date: '2026-05-20', type: 'prime', libelle: 'Tard', montant: 1 })).status, 409);
  assert.equal((await put(`rh/paie/bulletins/${b._id}`, { ir: 0 })).status, 409);
  ok(await post(`rh/paie/bulletins/${b._id}/payer`, { date: today, mode: 'especes' }));
  assert.equal(ok(await get('caisse')).kpis.sorties > 4486, true);
  assert.equal((await post('rh/paie/devalider', { periode: '2026-05' })).status, 409);                    // déjà payé
  ok(await post(`rh/paie/bulletins/${b._id}/annuler-paiement`, {}));
  ok(await post('rh/paie/devalider', { periode: '2026-05' }));
  assert.equal(ok(await get('rh/avances')).items[0].solde, 3000);                                          // l'avance est rendue
  assert.equal((await del(`rh/employes/${e}`)).status, 409);                                               // historique de paie
});

test('gasoil → retenue chauffeur : transfert unique, vu dans la paie, protégé après validation', async () => {
  plein = ok(await post('carburant', { truck: t1, date: '2026-05-12', kmCompteur: 100000, litres: 300, prixLitre: 11, source: 'externe' }, A), 201);
  assert.equal((await post(`carburant/${plein.id}/transfert`, { employe: emp._id, type: 'retenue', montant: 150 }, S)).status, 403);    // admin seulement (impact paie)
  ok(await post(`carburant/${plein.id}/transfert`, { employe: emp._id, type: 'retenue', montant: 150, motif: 'Surconsommation' }), 201);
  assert.equal((await post(`carburant/${plein.id}/transfert`, { employe: emp._id, type: 'retenue', montant: 10 })).status, 409);
  assert.equal(ok(await get('carburant?limit=5')).items[0].transfert.montant, 150);
  ok(await put(`carburant/${plein.id}`, { truck: t1, date: '2026-05-12', kmCompteur: 100000, litres: 300, prixLitre: 11, source: 'externe', station: 'Afriquia' }, A));     // la modification garde le lien
  assert.equal(ok(await get('carburant?limit=5')).items[0].transfert.montant, 150);
  const pr = ok(await get('rh/primes?source=gasoil')); assert.equal(pr.items.length, 1);
  assert.equal((await del(`rh/primes/${pr.items[0]._id}`)).status, 409);                                   // se retire depuis le Gasoil
  ok(await post('rh/paie/generer', { periode: '2026-05' })); assert.equal(ok(await get('rh/paie?periode=2026-05')).items[0].retenues, 350);
  ok(await post('rh/paie/valider', { periode: '2026-05' }));
  assert.equal((await del(`carburant/${plein.id}/transfert`)).status, 409);                                // période validée
  ok(await post('rh/paie/devalider', { periode: '2026-05' }));
  ok(await del(`carburant/${plein.id}/transfert`));
  assert.equal(ok(await get('rh/primes?source=gasoil')).items.length, 0);
  assert.equal(ok(await get('carburant?limit=5')).items[0].transfert, null);
});

test('contrats : le contrat actif met à jour la fiche employé', async () => {
  const c = ok(await post('rh/contrats', { employe: emp._id, type: 'CDI', dateDebut: '2026-06-01', salaireBase: 6500, poste: 'Chef de parc' }), 201);
  assert.equal(c.statut, 'actif');
  const e = ok(await get(`rh/employes/${emp._id}`)); assert.equal(e.typeContrat, 'CDI'); assert.equal(e.salaireBase, 6500); assert.equal(e.poste, 'Chef de parc');
  assert.equal((await post('rh/contrats', { employe: emp._id, type: 'CDD', dateDebut: '2026-06-01' })).status, 400);    // CDD sans fin
});

test('fiche camion : type, capacité, mise en service', async () => {
  const t = ok(await get(`trucks/${t1}`)); assert.equal(t.type, 'tracteur'); assert.equal(t.capaciteTonnes, 25);
  assert.equal((await put(`trucks/${t1}`, { immatriculation: 'B1-A-1', type: 'bateau' })).status, 400);
});

test('sauvegarde / restauration : toutes les données métier et leurs liens reviennent', async () => {
  const before = { missions: ok(await get('missions')).total, factures: ok(await get('factures')).total, employes: ok(await get('rh/employes')).total, caisse: ok(await get('caisse')).kpis.solde, paiements: ok(await get('paiements')).total };
  const name = (await request(app).post('/api/backups').set(A)).body.name;
  assert.ok(name);
  // on casse tout, puis on restaure
  await request(app).post(`/api/backups/${name}/restaurer`).set(A).send({ confirmation: 'RESTAURER' }).expect(200);
  assert.equal(ok(await get('missions')).total, before.missions); assert.equal(ok(await get('factures')).total, before.factures);
  assert.equal(ok(await get('rh/employes')).total, before.employes); assert.equal(ok(await get('caisse')).kpis.solde, before.caisse); assert.equal(ok(await get('paiements')).total, before.paiements);
  const f = ok(await get('factures')).items[0]; assert.ok(f.client.nom);                                                   // la référence client est bien un ObjectId rétabli
  const m = ok(await get('missions?limit=1')).items[0]; assert.ok(m.client.nom);
  assert.equal(ok(await get(`entries/${t1}/2026-05`)).calc.A, 2600);                                                       // opérations de mission restaurées
});

test('coordonnées entreprise : enregistrées, relues, et conservées quand un autre formulaire enregistre sans elles', async () => {
  const base = { societe: 'Test SARL', tauxIS: 20, cotisationMinimale: 0.25, cotisationMinimaleActive: true };
  const s = ok(await put('settings', { ...base, entreprise: { ice: '0012345', rib: '007 780 0001', mentions: 'Pénalités de retard : 1,5 %' } }));
  assert.equal(s.entreprise.ice, '0012345'); assert.equal(s.entreprise.adresse, '');
  ok(await put('settings', base));                                   // sans entreprise : ne l'efface pas
  assert.equal(ok(await request(app).get('/api/settings').set(S)).entreprise.rib, '007 780 0001');
  assert.equal((await put('settings', { ...base, entreprise: { ice: 'x'.repeat(500) } })).status, 400);
});
