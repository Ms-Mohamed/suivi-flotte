// Données de démonstration des modules commerciaux, sous-traitance, achats, RH et flotte étendue.
import { Truck, Operation } from './models.js';
import { BIZ_MODELS, Client, Fournisseur, SousTraitant, VehiculeST, Article, Mission, Location, DocumentVehicule, Panne, Piece, MouvementPiece, Devis, BonLivraison, Facture, Avoir, Paiement, Caisse, Depense, Achat, PaiementFournisseur, PaiementST, Employe, Contrat, Pointage, Avance, PrimeRetenue, nextNumber, nextSeq } from './biz/models.js';
import { calcDoc, calcMission, r2 } from '../../shared/doc.js';
import { applyTotals, recomputeFacture, syncCaisse, syncMission, lignesDepuisMission } from './biz/commercial.js';
import { syncLocation } from './biz/fleetExtra.js';
import { recomputeAchat } from './biz/achats.js';

const iso = (d) => d.toISOString().slice(0, 10);
const ago = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const yr = (s) => Number(s.slice(0, 4));

export async function seedBiz() {
  for (const M of Object.values(BIZ_MODELS)) await M.deleteMany({});
  await Operation.deleteMany({ 'meta.missionId': { $exists: true } }); await Operation.deleteMany({ 'meta.locationId': { $exists: true } });
  const trucks = await Truck.find({}).sort({ immatriculation: 1 });
  const T = (i) => trucks[i % trucks.length];

  // ----- Tiers -----
  const clients = await Client.insertMany([
    { nom: 'Atlas Matériaux SARL', ice: '001234567000012', adresse: '12 zone industrielle Gzenaya', ville: 'Tanger', telephone: '0539 30 00 01', email: 'compta@atlas-materiaux.example', delaiPaiement: 30 },
    { nom: 'Détroit Agro', ice: '002345678000034', adresse: 'Route de Tétouan km 7', ville: 'Tanger', telephone: '0539 30 00 02', email: 'achats@detroit-agro.example', delaiPaiement: 30 },
    { nom: 'Océan Ciments', ice: '003456789000056', adresse: 'Bd Zerktouni 88', ville: 'Casablanca', telephone: '0522 40 00 03', email: 'logistique@ocean-ciments.example', delaiPaiement: 45 },
    { nom: 'Rif Logistique', ice: '004567890000078', adresse: 'Avenue Mohammed VI', ville: 'Tétouan', telephone: '0539 50 00 04', email: 'exploitation@rif-logistique.example', delaiPaiement: 30 },
  ]);
  const fournisseurs = await Fournisseur.insertMany([
    { nom: 'Détroit Carburants', ice: '005678901000090', ville: 'Tanger', telephone: '0539 31 10 10', delaiPaiement: 15 },
    { nom: 'Pneus Maghreb', ice: '006789012000011', ville: 'Casablanca', telephone: '0522 41 20 20', delaiPaiement: 30 },
    { nom: 'Pièces Auto Tanger', ice: '007890123000022', ville: 'Tanger', telephone: '0539 32 30 30', delaiPaiement: 30 },
  ]);
  const sts = await SousTraitant.insertMany([
    { nom: 'Transports Chaouia', ice: '008901234000033', ville: 'Settat', telephone: '0523 40 50 50', contact: 'M. Bennani' },
    { nom: 'Gharb Transit', ice: '009012345000044', ville: 'Kénitra', telephone: '0537 37 60 60', contact: 'M. El Fassi' },
  ]);
  const vst = await VehiculeST.insertMany([
    { sousTraitant: sts[0]._id, immatriculation: '45612-C-5', type: 'Semi-remorque', capaciteTonnes: 32, chauffeur: 'Mustapha' }, { sousTraitant: sts[0]._id, immatriculation: '45899-C-5', type: 'Benne', capaciteTonnes: 28, chauffeur: 'Abdelali' },
    { sousTraitant: sts[1]._id, immatriculation: '70210-B-8', type: 'Semi-remorque', capaciteTonnes: 30, chauffeur: 'Larbi' },
  ]);
  await Article.insertMany([
    { reference: 'PN-315', designation: 'Pneu 315/80 R22.5', categorie: 'Pneumatiques', unite: 'u', prixAchat: 3100, tva: 20 }, { reference: 'FH-01', designation: 'Filtre à huile', categorie: 'Pièces', unite: 'u', prixAchat: 180, tva: 20 },
    { reference: 'GZ', designation: 'Gazole en vrac', categorie: 'Carburant', unite: 'L', prixAchat: 10.4, tva: 10 }, { reference: 'SRV-VID', designation: 'Main d\'œuvre vidange', categorie: 'Services', unite: 'h', prixAchat: 250, tva: 20 },
  ]);

  // ----- Employés -----
  const noms = ['Karim Benali', 'Youssef Amrani', 'Said Idrissi', 'Hamid Tazi', 'Rachid Alaoui'];
  const emps = [];
  for (const [i, nom] of noms.entries()) {
    const e = await Employe.create({ matricule: `E${String(await nextSeq('EMP')).padStart(3, '0')}`, nom, cin: `K${912340 + i}`, cnss: `1${20300 + i * 17}`, poste: 'Chauffeur', departement: 'Exploitation', telephone: `06 61 00 0${i}`,
      dateEmbauche: `${2018 + (i % 4)}-0${1 + i}-15`, typeContrat: 'CDI', dateDebutContrat: `${2018 + (i % 4)}-0${1 + i}-15`, typeSalaire: 'mensuel', salaireBase: 3500 + i * 150, truck: T(i)._id });
    emps.push(e);
  }
  const meca = await Employe.create({ matricule: `E${String(await nextSeq('EMP')).padStart(3, '0')}`, nom: 'Abdelkader Ziani', cin: 'K774411', poste: 'Mécanicien', departement: 'Atelier', typeContrat: 'CDD', dateDebutContrat: ago(150), dateFinContrat: ago(-18), dateEmbauche: ago(150), typeSalaire: 'mensuel', salaireBase: 4200 });
  const jr = await Employe.create({ matricule: `E${String(await nextSeq('EMP')).padStart(3, '0')}`, nom: 'Mohamed Ouali', cin: 'K551200', poste: 'Aide-chauffeur', departement: 'Exploitation', typeContrat: 'Journalier', dateDebutContrat: ago(60), dateEmbauche: ago(60), typeSalaire: 'journalier', salaireBase: 140 });
  for (const e of [...emps, meca, jr]) await Contrat.create({ employe: e._id, type: e.typeContrat, dateDebut: e.dateDebutContrat, dateFin: e.dateFinContrat, salaireBase: e.salaireBase, poste: e.poste, statut: 'actif' });
  // Pointage du mois en cours (jours ouvrés écoulés)
  const now = new Date(); const m0 = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const pts = [];
  for (let d = m0; d <= ago(0); d = iso(new Date(new Date(`${d}T00:00:00Z`).getTime() + 864e5))) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd === 0) continue;
    for (const [k, e] of [...emps, meca].entries()) pts.push({ employe: e._id, date: d, type: k === 4 && d === m0.slice(0, 8) + '03' ? 'absent' : 'present' });
  }
  if (pts.length) await Pointage.insertMany(pts);
  await Pointage.create({ employe: emps[0]._id, date: m0, type: 'heures_sup', heures: 3 });
  await Avance.create({ employe: emps[2]._id, date: ago(20), montant: 3000, motif: 'Avance exceptionnelle', remboursementMensuel: 500, solde: 3000 });
  await PrimeRetenue.create({ employe: emps[0]._id, date: ago(3), type: 'prime', libelle: 'Prime de ponctualité', montant: 400, source: 'manuel' });

  // ----- Documents véhicules -----
  const docs = [];
  const plan = [[0, [120, 200, 300]], [1, [12, 150, 220]], [2, [-5, 90, 180]], [3, [60, 8, 310]], [4, [100, 140, 25]]];
  for (const [i, exp] of plan) {
    const t = T(i);
    docs.push({ truck: t._id, type: 'assurance', numero: `ASS-${2400 + i}`, dateEmission: ago(365 - exp[0]), dateExpiration: ago(-exp[0]) });
    docs.push({ truck: t._id, type: 'visite_technique', numero: `VT-${880 + i}`, dateEmission: ago(180 - exp[1]), dateExpiration: ago(-exp[1]) });
    docs.push({ truck: t._id, type: 'vignette', numero: `VG-${i + 1}`, dateEmission: ago(365 - exp[2]), dateExpiration: ago(-exp[2]) });
    docs.push({ truck: t._id, type: 'carte_grise', numero: `CG-${77000 + i}`, dateEmission: ago(1500 + i * 40) });
  }
  docs.push({ truck: T(3)._id, type: 'visite_technique', numero: 'VT-ancienne', dateEmission: ago(540), dateExpiration: ago(172) });   // ancien document masqué par le renouvellement
  await DocumentVehicule.insertMany(docs);

  // ----- Pannes & pièces -----
  await Panne.create({ ref: await nextNumber('P', yr(ago(40))), truck: T(3)._id, date: ago(40), description: 'Fuite du circuit de refroidissement', gravite: 'majeure', statut: 'resolue', immobilise: false, dateResolution: ago(38), cout: 3200, chauffeur: 'Hamid Tazi', lieu: 'Autoroute Tanger–Rabat' });
  await Panne.create({ ref: await nextNumber('P', yr(ago(1))), truck: T(2)._id, date: ago(1), description: 'Boîte de vitesses — bruit anormal', gravite: 'critique', statut: 'en_cours', immobilise: true, chauffeur: 'Said Idrissi', lieu: 'Dépôt Tanger' });
  const pieces = await Piece.insertMany([
    { reference: 'FH-01', designation: 'Filtre à huile', categorie: 'Filtration', seuil: 5, prixUnitaire: 180, emplacement: 'Rayon A1' }, { reference: 'PL-AV', designation: 'Plaquettes de frein avant', categorie: 'Freinage', seuil: 6, prixUnitaire: 640, emplacement: 'Rayon B2' },
    { reference: 'PN-315', designation: 'Pneu 315/80 R22.5', categorie: 'Pneumatiques', seuil: 2, prixUnitaire: 3100, emplacement: 'Parc' }, { reference: 'CR-90', designation: 'Courroie d\'alternateur', categorie: 'Moteur', seuil: 2, prixUnitaire: 220, emplacement: 'Rayon A3' },
  ]);
  await MouvementPiece.insertMany([
    { piece: pieces[0]._id, date: ago(50), type: 'entree', qte: 20, prixUnitaire: 175 }, { piece: pieces[0]._id, date: ago(30), type: 'sortie', qte: 8, truck: T(0)._id, prixUnitaire: 175 },
    { piece: pieces[1]._id, date: ago(45), type: 'entree', qte: 8, prixUnitaire: 640 }, { piece: pieces[1]._id, date: ago(20), type: 'sortie', qte: 5, truck: T(3)._id, prixUnitaire: 640 },
    { piece: pieces[2]._id, date: ago(40), type: 'entree', qte: 8, prixUnitaire: 3100 }, { piece: pieces[2]._id, date: ago(15), type: 'sortie', qte: 2, truck: T(1)._id, prixUnitaire: 3100 },
    { piece: pieces[3]._id, date: ago(35), type: 'entree', qte: 4, prixUnitaire: 220 },
  ]);

  // ----- Missions -----
  const [atlas, agro, ocean, rif] = clients;
  const mk = async (o) => {
    const m = { type: 'interne', mode: 'tonnage', tva: 20, fraisChargement: 0, fraisDechargement: 0, fraisImmobilisation: 0, charges: [], prixForfait: 0, prixUnitaire: 0, tonnage: 0, distance: 0, modeST: 'tonnage', prixUnitaireST: 0, coutST: 0, ...o };
    m.dateChargement = m.dateChargement || m.dateMission; m.dateDechargement = m.dateDechargement || m.dateMission;
    const c = calcMission(m); m.totalHT = c.totalHT; m.totalTTC = c.totalTTC;
    if (m.type === 'soustraite') m.coutST = m.modeST === 'forfait' ? m.coutST : r2(m.tonnage * m.prixUnitaireST);
    m.coutTotal = r2(m.coutST + m.charges.reduce((s, x) => s + x.montant, 0));
    m.ref = await nextNumber('M', yr(m.dateMission));
    const doc = await Mission.create(m); await syncMission(doc.toObject()); return doc;
  };
  const TOLL = '61420000', ROAD = '61430000';
  const ms = [];
  ms.push(await mk({ client: atlas._id, villeCharge: 'Tanger', villeDecharge: 'Casablanca', marchandise: 'Ciment en sacs', numeroBL: 'BL-A-4410', dateMission: ago(40), tonnage: 28, distance: 340, prixUnitaire: 95, truck: T(0)._id, chauffeur: emps[0]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 180, note: 'Autoroute' }, { code: ROAD, montant: 250, note: 'Indemnités' }] }));
  ms.push(await mk({ client: agro._id, villeCharge: 'Tanger', villeDecharge: 'Fès', marchandise: 'Engrais', numeroBL: 'DA-1182', dateMission: ago(35), tonnage: 30, distance: 300, prixUnitaire: 70, truck: T(1)._id, chauffeur: emps[1]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 140, note: '' }] }));
  ms.push(await mk({ client: ocean._id, villeCharge: 'Casablanca', villeDecharge: 'Agadir', marchandise: 'Clinker', numeroBL: 'OC-7731', dateMission: ago(28), tonnage: 32, distance: 510, prixUnitaire: 120, fraisChargement: 300, truck: T(2)._id, chauffeur: emps[2]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 220, note: '' }, { code: ROAD, montant: 300, note: '' }] }));
  ms.push(await mk({ client: rif._id, villeCharge: 'Tanger', villeDecharge: 'Rabat', marchandise: 'Palettes mixtes', numeroBL: 'RL-905', dateMission: ago(21), mode: 'forfait', prixForfait: 9500, tonnage: 24, distance: 250, truck: T(3)._id, chauffeur: emps[3]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 120, note: '' }] }));
  ms.push(await mk({ client: atlas._id, villeCharge: 'Tanger', villeDecharge: 'Marrakech', marchandise: 'Carreaux', numeroBL: 'BL-A-4457', dateMission: ago(15), tonnage: 26, distance: 580, prixUnitaire: 98, truck: T(0)._id, chauffeur: emps[0]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 260, note: '' }, { code: ROAD, montant: 320, note: '' }] }));
  ms.push(await mk({ client: agro._id, villeCharge: 'Fès', villeDecharge: 'Oujda', marchandise: 'Semences', numeroBL: 'DA-1230', dateMission: ago(12), tonnage: 29, distance: 330, prixUnitaire: 72, truck: T(4)._id, chauffeur: emps[4]._id, statut: 'terminee', charges: [{ code: TOLL, montant: 90, note: '' }] }));
  ms.push(await mk({ type: 'soustraite', client: ocean._id, villeCharge: 'Tanger', villeDecharge: 'Agadir', marchandise: 'Ciment', numeroBL: 'OC-7790', dateMission: ago(18), tonnage: 30, distance: 830, prixUnitaire: 140, sousTraitant: sts[0]._id, vehiculeST: vst[0]._id, prixUnitaireST: 95, statut: 'terminee' }));
  ms.push(await mk({ type: 'soustraite', client: rif._id, villeCharge: 'Tanger', villeDecharge: 'Kénitra', marchandise: 'Briques', numeroBL: 'RL-931', dateMission: ago(9), tonnage: 25, distance: 200, prixUnitaire: 85, sousTraitant: sts[1]._id, vehiculeST: vst[2]._id, prixUnitaireST: 62, statut: 'terminee' }));
  await mk({ client: agro._id, villeCharge: 'Tanger', villeDecharge: 'Meknès', marchandise: 'Aliments du bétail', dateMission: ago(1), dateDechargement: ago(-1), tonnage: 27, distance: 290, prixUnitaire: 68, truck: T(1)._id, chauffeur: emps[1]._id, statut: 'en_cours' });
  await mk({ client: atlas._id, villeCharge: 'Tanger', villeDecharge: 'Oujda', marchandise: 'Béton préfabriqué', dateMission: ago(-3), tonnage: 30, distance: 620, prixUnitaire: 105, truck: T(0)._id, chauffeur: emps[0]._id, statut: 'planifiee' });
  await mk({ type: 'soustraite', client: atlas._id, villeCharge: 'Tanger', villeDecharge: 'Laâyoune', marchandise: 'Matériaux', dateMission: ago(-5), tonnage: 28, distance: 1500, prixUnitaire: 210, sousTraitant: sts[0]._id, vehiculeST: vst[1]._id, prixUnitaireST: 150, statut: 'planifiee' });

  // ----- Bons de livraison -----
  for (const m of [ms[0], ms[2], ms[5]]) await BonLivraison.create({ numero: await nextNumber('BL', yr(m.dateMission)), client: m.client, mission: m._id, date: m.dateDechargement, lieuLivraison: m.villeDecharge, camion: (await Truck.findById(m.truck))?.immatriculation || '', chauffeur: '', statut: 'signe', lignes: [{ designation: m.marchandise, qte: m.tonnage, unite: 't', pu: 0, tva: 0 }] });

  // ----- Locations -----
  const loc = async (o) => { const l = { mode: 'jour', tva: 20, heures: 0, ...o }; l.dateFin = l.dateFin || l.dateDebut; const j = Math.round((new Date(`${l.dateFin}T00:00:00Z`) - new Date(`${l.dateDebut}T00:00:00Z`)) / 864e5) + 1; l.nbJours = j; l.heures = j * 8; l.totalHT = r2(j * l.prix); l.totalTTC = r2(l.totalHT * (1 + l.tva / 100)); l.ref = await nextNumber('L', yr(l.dateDebut)); const d = await Location.create(l); await syncLocation(d.toObject()); return d; };
  const locTerminee = await loc({ client: rif._id, truck: T(4)._id, chauffeur: emps[4]._id, dateDebut: ago(26), dateFin: ago(24), prix: 2800, statut: 'terminee' });
  await loc({ client: atlas._id, truck: T(1)._id, dateDebut: ago(-10), dateFin: ago(-8), prix: 3000, statut: 'planifiee' });

  // ----- Facturation -----
  const lastFacture = async (client, missions, locations, { date, statut = 'emise' }) => {
    const lignes = missions.flatMap((m) => lignesDepuisMission(m.toObject())); for (const l of locations) lignes.push({ designation: `Location ${l.ref}`, qte: 1, pu: l.totalHT, tva: l.tva, unite: 'forfait', locationId: String(l._id) });
    const b = { client: client._id, clientSnap: { nom: client.nom, ice: client.ice, adresse: client.adresse, ville: client.ville }, date, lignes, fraisSupp: [], remisePct: 0, missions: missions.map((m) => m._id), locations: locations.map((l) => l._id), statut, modePaiement: 'virement' };
    applyTotals(b); b.reste = b.totalTTC; const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + client.delaiPaiement); b.echeance = iso(d);
    if (statut === 'emise') b.numero = await nextNumber('F', yr(date));
    const f = await Facture.create(b);
    await Mission.updateMany({ _id: { $in: f.missions } }, { $set: { facture: f._id } }); await Location.updateMany({ _id: { $in: f.locations } }, { $set: { facture: f._id } });
    return f;
  };
  const pay = async (f, montant, date, mode, reference = '') => { const p = await Paiement.create({ facture: f._id, client: f.client, date, montant, mode, reference }); await syncCaisse('paiement_client', p._id, { date, sens: 'entree', libelle: `Règlement ${f.numero}`, montant, mode }); await recomputeFacture(f._id); return p; };
  const f1 = await lastFacture(atlas, [ms[0]], [], { date: ago(36) }); await pay(f1, f1.totalTTC, ago(20), 'virement', 'VIR-20418');
  const f2 = await lastFacture(agro, [ms[1]], [], { date: ago(34) }); await pay(f2, r2(f2.totalTTC / 2), ago(10), 'cheque', 'CHQ-6620');
  await Avoir.create({ numero: await nextNumber('AV', yr(ago(8))), facture: f2._id, client: agro._id, date: ago(8), motif: 'Remise commerciale sur le prix à la tonne', lignes: [{ designation: 'Remise commerciale', qte: 1, pu: 500, tva: 20, unite: 'forfait' }], totalHT: 500, totalTVA: 100, totalTTC: 600, totalBrutHT: 500 });
  await recomputeFacture(f2._id);
  await lastFacture(rif, [], [locTerminee], { date: ago(20) });
  const f3 = await lastFacture(ocean, [ms[2], ms[6]], [], { date: ago(14) }); await pay(f3, 2000, ago(6), 'especes', 'Reçu 114');
  await lastFacture(atlas, [ms[4]], [], { date: ago(2), statut: 'brouillon' });

  // ----- Devis -----
  const devis = async (client, statut, lignes) => { const b = { numero: await nextNumber('D', yr(ago(5))), client: client._id, date: ago(5), validite: ago(-25), statut, lignes, fraisSupp: [], remisePct: 0 }; applyTotals(b); return Devis.create(b); };
  await devis(atlas, 'envoye', [{ designation: 'Transport Tanger–Agadir, 28 t', qte: 28, pu: 150, tva: 20, unite: 't' }]);
  await devis(rif, 'accepte', [{ designation: 'Location camion 5 jours', qte: 5, pu: 2800, tva: 20, unite: 'jour' }]);

  // ----- Sous-traitance : paiements -----
  const p1 = await PaiementST.create({ sousTraitant: sts[0]._id, mission: ms[6]._id, date: ago(8), montant: 1500, mode: 'especes', reference: 'ST-01' }); await syncCaisse('paiement_st', p1._id, { date: ago(8), sens: 'sortie', libelle: 'Sous-traitant ST-01', montant: 1500, mode: 'especes' });
  await PaiementST.create({ sousTraitant: sts[1]._id, mission: ms[7]._id, date: ago(3), montant: 1000, mode: 'virement', reference: 'VIR-ST-77' });

  // ----- Achats -----
  const achat = async (fr, date, lignes, num, payer) => {
    const b = { numero: await nextNumber('ACH', yr(date)), numeroFournisseur: num, fournisseur: fr._id, date, statut: 'validee', lignes, fraisSupp: [], remisePct: 0 }; applyTotals(b); const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + fr.delaiPaiement); b.echeance = iso(d); b.reste = b.totalTTC;
    const a = await Achat.create(b);
    if (payer) { const p = await PaiementFournisseur.create({ achat: a._id, fournisseur: fr._id, date: payer[1], montant: payer[0] === 'tout' ? a.totalTTC : payer[0], mode: payer[2], reference: payer[3] || '' }); await syncCaisse('paiement_fournisseur', p._id, { date: payer[1], sens: 'sortie', libelle: `Achat ${a.numero}`, montant: p.montant, mode: payer[2] }); }
    await recomputeAchat(a._id); return a;
  };
  await achat(fournisseurs[0], ago(25), [{ designation: 'Gazole en vrac', qte: 5000, pu: 10.4, tva: 10, unite: 'L' }], 'FC-2210', ['tout', ago(10), 'virement', 'VIR-901']);
  await achat(fournisseurs[1], ago(40), [{ designation: 'Pneu 315/80 R22.5', qte: 8, pu: 3100, tva: 20, unite: 'u' }], 'PM-0412', [10000, ago(22), 'cheque', 'CHQ-6601']);
  await achat(fournisseurs[2], ago(5), [{ designation: 'Plaquettes de frein avant', qte: 8, pu: 640, tva: 20, unite: 'u' }, { designation: 'Filtre à huile', qte: 10, pu: 180, tva: 20, unite: 'u' }], 'PAT-8890', null);

  // ----- Dépenses & caisse -----
  const dep = async (date, categorie, libelle, montant, mode, extra = {}) => { const d = await Depense.create({ date, categorie, libelle, montant, mode, ...extra }); await syncCaisse('depense', d._id, { date, sens: 'sortie', libelle, montant, mode }); };
  await dep(ago(18), 'Loyer', 'Loyer du dépôt — mois en cours', 6500, 'virement');
  await dep(ago(9), 'Fournitures de bureau', 'Papeterie et toners', 420, 'especes');
  await dep(ago(4), 'Péages', 'Rechargement carte télépéage', 1500, 'especes', { truck: T(0)._id });
  await Caisse.create({ date: ago(30), sens: 'entree', libelle: 'Apport en caisse', categorie: 'Apport', montant: 10000, source: 'manuel' });
  return { clients: clients.length, missions: ms.length + 3 };
}
