// Demo data for the billing, subcontracting, purchasing, HR and extended-fleet modules.
// Every module gets at least 5 distinct cases (statuses, modes, edge cases) so that every page has something to show.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Truck, Operation, Settings, User } from './models.js';
import { hash } from './auth.js';
import { BIZ_MODELS, Client, Fournisseur, SousTraitant, VehiculeST, Article, Mission, Location, DocumentVehicule, Panne, Piece, MouvementPiece, Devis, BonLivraison, Facture, Avoir, Paiement, Caisse, Depense, Achat, PaiementFournisseur, PaiementST, Employe, Contrat, Pointage, Avance, PrimeRetenue, Bulletin, nextNumber, nextSeq } from './biz/models.js';
import { calcMission, r2 } from '../../shared/doc.js';
import { addMonths, currentMonth } from '../../shared/calc.js';
import { applyTotals, recomputeFacture, syncCaisse, syncMission, lignesDepuisMission } from './biz/commercial.js';
import { syncLocation } from './biz/fleetExtra.js';
import { putFile } from './biz/fileStore.js';
import { recomputeAchat } from './biz/achats.js';
import { calcBulletin, paieConfig } from './biz/rh.js';

const iso = (d) => d.toISOString().slice(0, 10);
const ago = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const yr = (s) => Number(s.slice(0, 4));
const plusDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** Small valid PNG used as the "scan" attached to some vehicle documents. */
function scanPng(seed) {
  const W = 320, H = 200; const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const o = y * (W * 3 + 1); raw[o] = 0;
    for (let x = 0; x < W; x++) {
      const border = x < 8 || y < 8 || x >= W - 8 || y >= H - 8; const line = y > 40 && y < H - 30 && (y % 22 < 3) && x > 24 && x < W - 24 - ((y * 7 + seed * 13) % 90);
      const v = border ? 70 : line ? 90 : 244 - ((x + y) % 5);
      raw[o + 1 + x * 3] = v; raw[o + 2 + x * 3] = v + (border ? 40 : 0); raw[o + 3 + x * 3] = v + (border ? 90 : 4);
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function seedBiz() {
  for (const M of Object.values(BIZ_MODELS)) await M.deleteMany({});
  await Operation.deleteMany({ 'meta.missionId': { $exists: true } }); await Operation.deleteMany({ 'meta.locationId': { $exists: true } });
  const trucks = await Truck.find({}).sort({ immatriculation: 1 });
  const T = (i) => trucks[i % trucks.length];
  const P0 = currentMonth(), P1 = addMonths(P0, -1), P2 = addMonths(P0, -2);
  const maxBack = Math.round((new Date(`${ago(0)}T00:00:00Z`) - new Date(`${P2}-01T00:00:00Z`)) / 864e5);
  const back = (n) => ago(Math.min(n, maxBack));   // keep dates inside the "operations" months so the truck P&L picks them up

  // ===== Company details =====
  await Settings.updateOne({ key: 'main' }, { $set: { societe: 'Maghreb Express Maroc (demo)', entreprise: { adresse: 'Gzenaya Industrial Zone, Lot 27', ville: 'Tangier', telephone: '+212 539 30 10 10', email: 'contact@maghreb-express.example', ice: '001234567890123', if: '40123456', rc: '31245 Tangier', patente: '51230987', cnss: '9876543', banque: 'Attijariwafa Bank — Tangier Centre', rib: '007 640 0001234567890123 45', mentions: 'Late payment: penalty of 1.5% per month after the due date. Payment by bank transfer or cheque payable to Maghreb Express Maroc.' } } });

  // ===== Customers (6: different terms / VAT rates / one inactive) =====
  const mkClient = (nom, ice, ville, adresse, tel, email, delai, tva, extra = {}) => ({ nom, ice, ville, adresse, telephone: tel, email, delaiPaiement: delai, tvaDefaut: tva, ...extra });
  const clients = await Client.insertMany([
    mkClient('Atlas Building Materials SARL', '001234567000012', 'Tangier', '12 Gzenaya industrial zone', '0539 30 00 01', 'accounts@atlas-materials.example', 30, 20, { contact: 'Ms. Alaoui', rc: '24510' }),
    mkClient('Strait Agro', '002345678000034', 'Tangier', 'Tetouan road, km 7', '0539 30 00 02', 'purchasing@strait-agro.example', 30, 10, { contact: 'Mr. Bouazza', notes: 'Agricultural goods — 10% VAT' }),
    mkClient('Ocean Cement', '003456789000056', 'Casablanca', '88 Zerktouni Blvd', '0522 40 00 03', 'logistics@ocean-cement.example', 45, 20, { contact: 'Mr. Tahiri' }),
    mkClient('Rif Logistics', '004567890000078', 'Tetouan', 'Avenue Mohammed VI', '0539 50 00 04', 'operations@rif-logistics.example', 60, 20, { contact: 'Ms. Chraibi', notes: 'Large account — 60-day terms' }),
    mkClient('Sahara Fisheries Export', '005678901000090', 'Laayoune', 'Port area, warehouse 4', '0528 89 00 05', 'shipping@sahara-fisheries.example', 15, 0, { contact: 'Mr. Lamine', notes: 'Export — VAT exempt, 15-day terms' }),
    mkClient('Old Quarry Co.', '006789012000011', 'Meknes', 'Route de Fes km 12', '0535 52 00 06', 'info@old-quarry.example', 30, 20, { actif: false, notes: 'Inactive since last year' }),
  ]);
  const [atlas, agro, ocean, rif, sahara] = clients;

  // ===== Suppliers (5) =====
  const fournisseurs = await Fournisseur.insertMany([
    { nom: 'Strait Fuels', ice: '005678901000091', ville: 'Tangier', telephone: '0539 31 10 10', delaiPaiement: 15, contact: 'Mr. Ziani' },
    { nom: 'Maghreb Tyres', ice: '006789012000012', ville: 'Casablanca', telephone: '0522 41 20 20', delaiPaiement: 30, contact: 'Ms. Berrada' },
    { nom: 'Tangier Auto Parts', ice: '007890123000022', ville: 'Tangier', telephone: '0539 32 30 30', delaiPaiement: 30 },
    { nom: 'Atlas Lubricants', ice: '008901234000023', ville: 'Kenitra', telephone: '0537 36 40 40', delaiPaiement: 30 },
    { nom: 'Northern Garage Services', ice: '009012345000024', ville: 'Tangier', telephone: '0539 33 50 50', delaiPaiement: 0, notes: 'Pay on delivery' },
  ]);
  const [fuelSup, tyreSup, partsSup, oilSup, garageSup] = fournisseurs;

  // ===== Subcontractors (5) + vehicles (6, one inactive) =====
  const sts = await SousTraitant.insertMany([
    { nom: 'Chaouia Transport', ice: '008901234000033', ville: 'Settat', telephone: '0523 40 50 50', contact: 'Mr. Bennani' },
    { nom: 'Gharb Transit', ice: '009012345000044', ville: 'Kenitra', telephone: '0537 37 60 60', contact: 'Mr. El Fassi' },
    { nom: 'Souss Haulage', ice: '001122334000055', ville: 'Agadir', telephone: '0528 82 70 70', contact: 'Mr. Aitlahcen' },
    { nom: 'Oriental Freight', ice: '002233445000066', ville: 'Oujda', telephone: '0536 70 80 80', contact: 'Mr. Benali' },
    { nom: 'Doukkala Trucks', ice: '003344556000077', ville: 'El Jadida', telephone: '0523 34 90 90', actif: false, notes: 'Contract ended' },
  ]);
  const vst = await VehiculeST.insertMany([
    { sousTraitant: sts[0]._id, immatriculation: '45612-C-5', type: 'Semi-trailer', capaciteTonnes: 32, chauffeur: 'Mustapha' },
    { sousTraitant: sts[0]._id, immatriculation: '45899-C-5', type: 'Tipper', capaciteTonnes: 28, chauffeur: 'Abdelali' },
    { sousTraitant: sts[1]._id, immatriculation: '70210-B-8', type: 'Semi-trailer', capaciteTonnes: 30, chauffeur: 'Larbi' },
    { sousTraitant: sts[2]._id, immatriculation: '31877-H-9', type: 'Refrigerated', capaciteTonnes: 24, chauffeur: 'Brahim' },
    { sousTraitant: sts[3]._id, immatriculation: '55120-E-1', type: 'Flatbed', capaciteTonnes: 26, chauffeur: 'Nabil' },
    { sousTraitant: sts[4]._id, immatriculation: '12998-F-3', type: 'Tipper', capaciteTonnes: 20, chauffeur: 'Hassan', actif: false },
  ]);

  // ===== Purchasing catalogue (6) =====
  await Article.insertMany([
    { reference: 'PN-315', designation: 'Tyre 315/80 R22.5', categorie: 'Tyres', unite: 'u', prixAchat: 3100, tva: 20 },
    { reference: 'FH-01', designation: 'Oil filter', categorie: 'Parts', unite: 'u', prixAchat: 180, tva: 20 },
    { reference: 'GZ', designation: 'Diesel (bulk)', categorie: 'Fuel', unite: 'L', prixAchat: 10.4, tva: 10 },
    { reference: 'AD-20', designation: 'AdBlue 20 L', categorie: 'Fuel', unite: 'u', prixAchat: 95, tva: 20 },
    { reference: 'SRV-OIL', designation: 'Oil change labour', categorie: 'Services', unite: 'h', prixAchat: 250, tva: 20 },
    { reference: 'LUB-15W40', designation: 'Engine oil 15W40 (208 L drum)', categorie: 'Lubricants', unite: 'u', prixAchat: 4300, tva: 20 },
  ]);

  // ===== Employees (10: every contract type + salary type, one inactive) =====
  const hist = addMonths(P2, -14);
  const E = {}; const empRows = [
    ['Karim Benali', 'Driver', 'Operations', 'CDI', `${hist}-05`, '', 'mensuel', 4200, 'K912340'],
    ['Youssef Amrani', 'Driver', 'Operations', 'CDI', `${hist}-12`, '', 'mensuel', 3900, 'K912341'],
    ['Said Idrissi', 'Driver', 'Operations', 'CDD', plusDays(ago(0), -150), plusDays(ago(0), 21), 'mensuel', 3700, 'K912342'],
    ['Hamid Tazi', 'Driver', 'Operations', 'CDI', `${hist}-20`, '', 'mensuel', 4000, 'K912343'],
    ['Rachid Alaoui', 'Driver', 'Operations', 'ANAPEC', plusDays(ago(0), -120), plusDays(ago(0), 60), 'mensuel', 3000, 'K912344'],
    ['Abdelkader Ziani', 'Mechanic', 'Workshop', 'CDD', plusDays(ago(0), -190), plusDays(ago(0), -9), 'mensuel', 4800, 'K774411'],
    ['Mohamed Ouali', 'Assistant driver', 'Operations', 'Journalier', plusDays(ago(0), -110), '', 'journalier', 140, 'K551200'],
    ['Salma El Idrissi', 'Dispatcher', 'Administration', 'CDI', `${hist}-02`, '', 'horaire', 32, 'K660012'],
    ['Yassine Moussa', 'Intern (logistics)', 'Administration', 'Stage', `${P1}-01`, plusDays(`${P1}-01`, 120), 'mensuel', 1500, 'K990045'],
    ['Larbi Haddou', 'Driver', 'Operations', 'CDI', `${hist}-08`, '', 'mensuel', 3800, 'K331870', 'inactif'],
  ];
  for (const [i, [nom, poste, dep, tc, debut, fin, ts, sal, cin, statut]] of empRows.entries()) {
    const truck = trucks.find((t) => t.chauffeur === nom);
    E[nom.split(' ')[0]] = await Employe.create({ matricule: `E${String(await nextSeq('EMP')).padStart(3, '0')}`, nom, cin, cnss: `1${20300 + i * 17}`, poste, departement: dep, telephone: `06 61 00 0${i}`, email: `${nom.split(' ')[0].toLowerCase()}@maghreb-express.example`,
      dateNaissance: `${1978 + i}-0${1 + (i % 9)}-1${i % 9}`, dateEmbauche: debut, typeContrat: tc, dateDebutContrat: debut, dateFinContrat: fin, typeSalaire: ts, salaireBase: sal, soumisCnss: tc !== 'Stage', truck: truck?._id || null, statut: statut || 'actif',
      observation: statut === 'inactif' ? 'Resigned' : '' });
  }
  // Contract history: current contracts + earlier ones (terminated) for some employees
  for (const e of Object.values(E)) await Contrat.create({ employe: e._id, type: e.typeContrat, dateDebut: e.dateDebutContrat, dateFin: e.dateFinContrat, salaireBase: e.salaireBase, poste: e.poste, statut: e.statut === 'inactif' ? 'termine' : 'actif' });
  await Contrat.create({ employe: E.Said._id, type: 'CDD', dateDebut: plusDays(ago(0), -330), dateFin: plusDays(ago(0), -151), salaireBase: 3500, poste: 'Driver', statut: 'termine', observation: 'First 6-month contract, renewed' });
  await Contrat.create({ employe: E.Rachid._id, type: 'Stage', dateDebut: plusDays(ago(0), -300), dateFin: plusDays(ago(0), -121), salaireBase: 1500, poste: 'Driver trainee', statut: 'termine', observation: 'Converted to ANAPEC contract' });
  await Contrat.create({ employe: E.Abdelkader._id, type: 'CDD', dateDebut: plusDays(ago(0), -380), dateFin: plusDays(ago(0), -191), salaireBase: 4500, poste: 'Mechanic', statut: 'termine' });

  // ===== Attendance for the last 3 months (all types) =====
  const daysOf = (from, to) => { const out = []; for (let d = from; d <= to; d = plusDays(d, 1)) out.push(d); return out; };
  const pts = [];
  const active = Object.values(E).filter((e) => e.statut === 'actif');
  for (const month of [P2, P1, P0]) {
    const start = `${month}-01`; const end = month === P0 ? ago(0) : `${month}-31`;
    for (const d of daysOf(start, plusDays(end > `${month}-31` ? `${month}-31` : end, 0))) {
      if (d.slice(0, 7) !== month) continue;
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); if (wd === 0) continue;
      const dn = Number(d.slice(8, 10));
      for (const [k, e] of active.entries()) {
        if (e.dateEmbauche > d) continue;
        let type = 'present', heures = e.typeSalaire === 'horaire' ? (dn % 5 === 0 ? 6 : 8) : 0;
        if (dn === 15) type = 'ferie';                                        // public holiday
        else if (e.nom === 'Youssef Amrani' && [4, 5].includes(dn)) type = 'absent';
        else if (e.nom === 'Said Idrissi' && [10, 11, 12].includes(dn)) type = 'conge';
        else if (e.nom === 'Rachid Alaoui' && [18, 19].includes(dn)) type = 'maladie';
        else if (e.nom === 'Hamid Tazi' && dn === 22 && month !== P0) type = 'absent';
        else if (e.nom === 'Mohamed Ouali' && wd === 6) continue;               // day labourer: Mon–Fri only
        pts.push({ employe: e._id, date: d, type, heures: type === 'present' ? heures : 0, observation: type === 'maladie' ? 'Medical certificate provided' : type === 'conge' ? 'Paid leave' : '' });
        if (type === 'present' && ((e.nom === 'Karim Benali' && [3, 17].includes(dn)) || (e.nom === 'Hamid Tazi' && dn === 9) || (e.nom === 'Salma El Idrissi' && dn === 24))) pts.push({ employe: e._id, date: d, type: 'heures_sup', heures: e.nom === 'Karim Benali' ? 3 : 2 });
      }
    }
  }
  await Pointage.insertMany(pts);

  // ===== Salary advances (5: settled, partly repaid, untouched, small, large) =====
  const av = async (e, date, montant, motif, remb) => Avance.create({ employe: e._id, date, montant, motif, remboursementMensuel: remb, solde: montant, statut: 'en_cours' });
  const avSaid = await av(E.Said, `${addMonths(P2, -1)}-10`, 3000, 'Family emergency', 500);
  const avYouss = await av(E.Youssef, `${addMonths(P2, -1)}-12`, 800, 'School supplies', 400);
  const avKarim = await av(E.Karim, `${P1}-05`, 2000, 'Moving house', 250);
  const avRachid = await av(E.Rachid, ago(5), 1500, 'Car repair', 500);
  const avOuali = await av(E.Mohamed, ago(3), 300, 'Weekly advance', 300);

  // ===== Bonuses & deductions (manual ones; fuel-based ones are created below from real fill-ups) =====
  const pr = (e, date, type, libelle, montant) => PrimeRetenue.create({ employe: e._id, date, type, libelle, montant, source: 'manuel' });
  await pr(E.Youssef, `${P2}-14`, 'retenue', 'Traffic fine (speeding)', 180);
  await pr(E.Karim, `${P1}-10`, 'prime', 'Punctuality bonus', 400);
  await pr(E.Salma, `${P1}-20`, 'prime', 'Month-end closing bonus', 250);
  await pr(E.Said, `${P0}-02`, 'prime', 'Safe-driving bonus', 300);
  await pr(E.Abdelkader, `${P0}-04`, 'retenue', 'Workshop tool damage', 150);

  // ===== Vehicle documents (insurance / inspection / road tax / registration / authorisation / licence + scans) =====
  const docs = [];
  const plan = [[0, [120, 200, 300]], [1, [12, 150, 220]], [2, [-5, 90, 180]], [3, [60, 6, 310]], [4, [100, 140, 25]]];   // expiry offsets: valid, ≤15 d, expired, ≤7 d, ≤30 d
  for (const [i, exp] of plan) {
    const t = T(i);
    docs.push({ truck: t._id, type: 'assurance', numero: `INS-${2400 + i}`, dateEmission: ago(365 - exp[0]), dateExpiration: ago(-exp[0]), observation: i === 2 ? 'Renewal pending — call the broker' : '' });
    docs.push({ truck: t._id, type: 'visite_technique', numero: `TI-${880 + i}`, dateEmission: ago(180 - exp[1]), dateExpiration: ago(-exp[1]) });
    docs.push({ truck: t._id, type: 'vignette', numero: `RT-${i + 1}`, dateEmission: ago(365 - exp[2]), dateExpiration: ago(-exp[2]) });
    docs.push({ truck: t._id, type: 'carte_grise', numero: `REG-${77000 + i}`, dateEmission: ago(1500 + i * 40) });
  }
  docs.push({ truck: T(3)._id, type: 'visite_technique', numero: 'TI-previous', dateEmission: ago(540), dateExpiration: ago(172), observation: 'Replaced by the renewed inspection' });   // old document hidden by its renewal
  docs.push({ truck: T(0)._id, type: 'carte_autorisation', numero: 'AUT-5521', dateEmission: ago(300), dateExpiration: ago(-65) });
  docs.push({ truck: T(1)._id, type: 'permis', numero: 'HAZ-0192', dateEmission: ago(400), dateExpiration: ago(-14), observation: 'Hazardous goods approval' });
  docs.push({ truck: T(4)._id, type: 'autre', numero: 'GPS-CERT', dateEmission: ago(200), observation: 'Tachograph calibration certificate' });
  const created = await DocumentVehicule.insertMany(docs);
  for (const [k, d] of created.filter((x) => ['assurance', 'carte_grise'].includes(x.type)).slice(0, 3).entries()) {
    const buf = scanPng(k + 1); const chemin = `${d._id}-${Date.now()}.png`; await putFile(chemin, buf);
    d.fichier = { nom: `${d.type}-${d.numero}.png`, mime: 'image/png', taille: buf.length, chemin }; await d.save();
  }

  // ===== Breakdowns (5: every severity / status / immobilising or not) =====
  const pn = (o) => nextNumber('P', yr(o.date)).then((ref) => Panne.create({ ref, ...o }));
  await pn({ truck: T(2)._id, date: ago(40), description: 'Coolant circuit leak', gravite: 'majeure', statut: 'resolue', immobilise: false, dateResolution: ago(38), cout: 3200, chauffeur: 'Hamid Tazi', lieu: 'Tangier–Rabat motorway', observation: 'Hose and radiator cap replaced' });
  await pn({ truck: T(3)._id, date: ago(1), description: 'Gearbox — abnormal noise', gravite: 'critique', statut: 'en_cours', immobilise: true, chauffeur: 'Said Idrissi', lieu: 'Tangier depot', observation: 'Waiting for the replacement gearbox' });
  await pn({ truck: T(1)._id, date: ago(3), description: 'Air brake pressure leak', gravite: 'majeure', statut: 'ouverte', immobilise: true, chauffeur: 'Karim Benali', lieu: 'Fes — customer yard' });
  await pn({ truck: T(0)._id, date: ago(6), description: 'Cab air conditioning not cooling', gravite: 'mineure', statut: 'ouverte', immobilise: false, chauffeur: 'Rachid Alaoui', lieu: 'Tangier depot' });
  await pn({ truck: T(4)._id, date: ago(18), description: 'Rear light cluster broken', gravite: 'mineure', statut: 'resolue', immobilise: false, dateResolution: ago(17), cout: 150, chauffeur: 'Youssef Amrani', lieu: 'Kenitra' });

  // ===== Spare parts (7) with stock alerts + movements =====
  const pieces = await Piece.insertMany([
    { reference: 'FH-01', designation: 'Oil filter', categorie: 'Filtration', seuil: 5, prixUnitaire: 180, emplacement: 'Shelf A1' },
    { reference: 'PL-AV', designation: 'Front brake pads', categorie: 'Braking', seuil: 6, prixUnitaire: 640, emplacement: 'Shelf B2' },
    { reference: 'PN-315', designation: 'Tyre 315/80 R22.5', categorie: 'Tyres', seuil: 2, prixUnitaire: 3100, emplacement: 'Yard' },
    { reference: 'CR-90', designation: 'Alternator belt', categorie: 'Engine', seuil: 2, prixUnitaire: 220, emplacement: 'Shelf A3' },
    { reference: 'FA-22', designation: 'Air filter', categorie: 'Filtration', seuil: 3, prixUnitaire: 260, emplacement: 'Shelf A2' },
    { reference: 'CL-20', designation: 'Coolant 20 L drum', categorie: 'Fluids', seuil: 4, prixUnitaire: 310, emplacement: 'Shelf C1' },
    { reference: 'BU-24', designation: 'Headlight bulb 24V', categorie: 'Electrical', seuil: 10, prixUnitaire: 45, emplacement: 'Drawer D4', actif: false },
  ]);
  const mv = (p, date, type, qte, prix, truck, observation = '') => ({ piece: pieces[p]._id, date, type, qte, prixUnitaire: prix, truck: truck ? T(truck)._id : null, observation });
  await MouvementPiece.insertMany([
    mv(0, back(55), 'entree', 20, 175, null, 'Initial stock'), mv(0, back(30), 'sortie', 8, 175, 1, 'Service — oil change'),            // 12 in stock (above threshold)
    mv(1, back(50), 'entree', 8, 640, null), mv(1, back(20), 'sortie', 5, 640, 2, 'Brake overhaul'),                                  // 3 in stock → alert
    mv(2, back(45), 'entree', 8, 3100, null, 'Purchase ACH'), mv(2, back(15), 'sortie', 2, 3100, 0, 'Front axle'),                    // 6 in stock
    mv(3, back(40), 'entree', 4, 220, null), mv(3, back(10), 'sortie', 3, 220, 3, 'Replaced on gearbox job'),                          // 1 in stock → alert
    mv(4, back(35), 'entree', 10, 260, null), mv(4, back(25), 'sortie', 10, 260, 4, 'Fleet air-filter change'),                        // 0 in stock → alert
    mv(5, back(33), 'entree', 12, 310, null), mv(5, back(12), 'sortie', 4, 310, 2, 'Coolant top-up after leak'),                       // 8 in stock
    mv(6, back(50), 'entree', 6, 45, null), mv(6, back(8), 'sortie', 2, 45, 0),
  ]);

  // ===== Missions (17: every status, internal / subcontracted, tonnage / flat, fees, loss-making) =====
  const mk = async (o) => {
    const m = { type: 'interne', mode: 'tonnage', tva: o.client ? clients.find((c) => String(c._id) === String(o.client)).tvaDefaut : 20, fraisChargement: 0, fraisDechargement: 0, fraisImmobilisation: 0, charges: [], prixForfait: 0, prixUnitaire: 0, tonnage: 0, distance: 0, modeST: 'tonnage', prixUnitaireST: 0, coutST: 0, ...o };
    m.dateChargement = m.dateChargement || m.dateMission; m.dateDechargement = m.dateDechargement || m.dateMission;
    const c = calcMission(m); m.totalHT = c.totalHT; m.totalTTC = c.totalTTC;
    if (m.type === 'soustraite') m.coutST = m.modeST === 'forfait' ? m.coutST : r2(m.tonnage * m.prixUnitaireST);
    m.coutTotal = r2(m.coutST + m.charges.reduce((s, x) => s + x.montant, 0));
    m.ref = await nextNumber('M', yr(m.dateMission));
    const doc = await Mission.create(m); await syncMission(doc.toObject()); return doc;
  };
  const TOLL = '61420000', ROAD = '61430000';
  const dr = (i) => E[T(i).chauffeur.split(' ')[0]]._id;
  const ms = [];
  ms.push(await mk({ client: atlas._id, villeCharge: 'Tangier', villeDecharge: 'Casablanca', marchandise: 'Cement bags', numeroBL: 'BL-A-4410', dateMission: back(52), tonnage: 28, distance: 340, prixUnitaire: 95, truck: T(1)._id, chauffeur: dr(1), statut: 'terminee', charges: [{ code: TOLL, montant: 180, note: 'Motorway' }, { code: ROAD, montant: 250, note: 'Allowances' }] }));   // 0
  ms.push(await mk({ client: agro._id, villeCharge: 'Tangier', villeDecharge: 'Fes', marchandise: 'Fertilizer', numeroBL: 'SA-1182', dateMission: back(48), tonnage: 30, distance: 300, prixUnitaire: 70, truck: T(4)._id, chauffeur: dr(4), statut: 'terminee', charges: [{ code: TOLL, montant: 140, note: '' }] }));   // 1
  ms.push(await mk({ client: ocean._id, villeCharge: 'Casablanca', villeDecharge: 'Agadir', marchandise: 'Clinker', numeroBL: 'OC-7731', dateMission: back(44), tonnage: 32, distance: 510, prixUnitaire: 120, fraisChargement: 300, fraisImmobilisation: 400, truck: T(2)._id, chauffeur: dr(2), statut: 'terminee', observation: 'Waited 5 h at the plant gate', charges: [{ code: TOLL, montant: 220, note: '' }, { code: ROAD, montant: 300, note: '' }] }));   // 2
  ms.push(await mk({ client: rif._id, villeCharge: 'Tangier', villeDecharge: 'Rabat', marchandise: 'Mixed pallets', numeroBL: 'RL-905', dateMission: back(40), mode: 'forfait', prixForfait: 9500, tonnage: 24, distance: 250, truck: T(3)._id, chauffeur: dr(3), statut: 'terminee', charges: [{ code: TOLL, montant: 120, note: '' }] }));   // 3 (flat rate)
  ms.push(await mk({ client: atlas._id, villeCharge: 'Tangier', villeDecharge: 'Marrakech', marchandise: 'Floor tiles', numeroBL: 'BL-A-4457', dateMission: back(30), tonnage: 26, distance: 580, prixUnitaire: 98, truck: T(1)._id, chauffeur: dr(1), statut: 'terminee', charges: [{ code: TOLL, montant: 260, note: '' }, { code: ROAD, montant: 320, note: '' }] }));   // 4
  ms.push(await mk({ client: agro._id, villeCharge: 'Fes', villeDecharge: 'Oujda', marchandise: 'Seeds', numeroBL: 'SA-1230', dateMission: back(28), tonnage: 29, distance: 330, prixUnitaire: 72, truck: T(4)._id, chauffeur: dr(4), statut: 'terminee', charges: [{ code: TOLL, montant: 90, note: '' }] }));   // 5
  ms.push(await mk({ type: 'soustraite', client: ocean._id, villeCharge: 'Tangier', villeDecharge: 'Agadir', marchandise: 'Cement', numeroBL: 'OC-7790', dateMission: back(36), tonnage: 30, distance: 830, prixUnitaire: 140, sousTraitant: sts[0]._id, vehiculeST: vst[0]._id, prixUnitaireST: 95, statut: 'terminee' }));   // 6
  ms.push(await mk({ type: 'soustraite', client: rif._id, villeCharge: 'Tangier', villeDecharge: 'Kenitra', marchandise: 'Bricks', numeroBL: 'RL-931', dateMission: back(14), mode: 'forfait', prixForfait: 2600, tonnage: 25, distance: 200, sousTraitant: sts[1]._id, vehiculeST: vst[2]._id, modeST: 'forfait', coutST: 1800, statut: 'terminee' }));   // 7 (flat-rate subcontract)
  ms.push(await mk({ client: agro._id, villeCharge: 'Tangier', villeDecharge: 'Meknes', marchandise: 'Cattle feed', dateMission: back(1), dateDechargement: ago(-1), tonnage: 27, distance: 290, prixUnitaire: 68, truck: T(1)._id, chauffeur: dr(1), statut: 'en_cours' }));   // 8
  ms.push(await mk({ client: atlas._id, villeCharge: 'Tangier', villeDecharge: 'Oujda', marchandise: 'Precast concrete', dateMission: ago(-3), tonnage: 30, distance: 620, prixUnitaire: 105, truck: T(0)._id, chauffeur: dr(0), statut: 'planifiee' }));   // 9
  ms.push(await mk({ type: 'soustraite', client: sahara._id, villeCharge: 'Tangier', villeDecharge: 'Laayoune', marchandise: 'Packaging material', dateMission: ago(-5), tonnage: 24, distance: 1500, prixUnitaire: 210, sousTraitant: sts[2]._id, vehiculeST: vst[3]._id, prixUnitaireST: 150, statut: 'planifiee' }));   // 10
  ms.push(await mk({ client: sahara._id, villeCharge: 'Agadir', villeDecharge: 'Laayoune', marchandise: 'Ice machines', dateMission: ago(-8), mode: 'forfait', prixForfait: 8200, tonnage: 12, distance: 1050, truck: T(2)._id, statut: 'brouillon', observation: 'Awaiting customer confirmation' }));   // 11 (draft)
  ms.push(await mk({ client: rif._id, villeCharge: 'Tangier', villeDecharge: 'Kenitra', marchandise: 'Furniture', dateMission: back(20), tonnage: 10, distance: 200, prixUnitaire: 90, truck: T(3)._id, statut: 'annulee', observation: 'Cancelled by the customer the day before' }));   // 12 (cancelled)
  ms.push(await mk({ client: ocean._id, villeCharge: 'Casablanca', villeDecharge: 'Tangier', marchandise: 'Scrap steel', dateMission: back(24), tonnage: 22, distance: 340, prixUnitaire: 38, truck: T(2)._id, chauffeur: dr(2), statut: 'terminee', observation: 'Return load at a low price', charges: [{ code: TOLL, montant: 320, note: '' }, { code: ROAD, montant: 520, note: 'Night driver + parking' }] }));   // 13 (loss-making)
  ms.push(await mk({ client: sahara._id, villeCharge: 'Agadir', villeDecharge: 'Casablanca', marchandise: 'Frozen fish', numeroBL: 'SF-0042', dateMission: back(40), tonnage: 24, distance: 510, prixUnitaire: 110, truck: T(0)._id, chauffeur: dr(0), statut: 'terminee', charges: [{ code: TOLL, montant: 200, note: '' }] }));   // 14 (VAT-exempt export)
  ms.push(await mk({ type: 'soustraite', client: ocean._id, villeCharge: 'Agadir', villeDecharge: 'Casablanca', marchandise: 'Cement', numeroBL: 'OC-7812', dateMission: back(33), tonnage: 30, distance: 510, prixUnitaire: 100, sousTraitant: sts[2]._id, vehiculeST: vst[3]._id, prixUnitaireST: 70, statut: 'terminee' }));   // 15
  ms.push(await mk({ type: 'soustraite', client: atlas._id, villeCharge: 'Fes', villeDecharge: 'Oujda', marchandise: 'Steel beams', numeroBL: 'BL-A-4480', dateMission: back(18), mode: 'forfait', prixForfait: 3600, tonnage: 18, distance: 330, sousTraitant: sts[3]._id, vehiculeST: vst[4]._id, modeST: 'forfait', coutST: 2400, statut: 'terminee' }));   // 16

  // ===== Delivery notes (5: issued / delivered / signed; from missions and manual) =====
  const bl = async (m, statut, extra = {}) => BonLivraison.create({ numero: await nextNumber('BL', yr(m.dateMission)), client: m.client, mission: m._id, date: m.dateDechargement, lieuLivraison: m.villeDecharge, camion: m.truck ? (trucks.find((t) => String(t._id) === String(m.truck))?.immatriculation || '') : '', chauffeur: '', statut, lignes: [{ designation: m.marchandise, qte: m.tonnage, unite: 't', pu: 0, tva: 0 }], ...extra });
  await bl(ms[0], 'signe', { observation: 'Signed by the site manager' });
  await bl(ms[2], 'signe');
  await bl(ms[1], 'livre', { observation: 'Delivered — signed copy to follow' });
  await bl(ms[8], 'emis', { lieuLivraison: 'Meknes — Zone Industrielle' });
  await BonLivraison.create({ numero: await nextNumber('BL', yr(ago(2))), client: atlas._id, date: ago(2), lieuLivraison: 'Tangier — Atlas yard', camion: T(0).immatriculation, chauffeur: 'Rachid Alaoui', statut: 'emis', lignes: [{ designation: 'Pallet return (empty)', qte: 40, unite: 'u', pu: 0, tva: 0 }], observation: 'Manual delivery note, no mission' });

  // ===== Rentals (5: every status and mode) =====
  const loc = async (o) => {
    const l = { mode: 'jour', tva: 20, heures: 0, ...o }; l.dateFin = l.dateFin || l.dateDebut;
    const j = Math.round((new Date(`${l.dateFin}T00:00:00Z`) - new Date(`${l.dateDebut}T00:00:00Z`)) / 864e5) + 1; l.nbJours = j;
    if (l.mode === 'jour') { l.heures = j * 8; l.totalHT = r2(j * l.prix); } else if (l.mode === 'heure') l.totalHT = r2(l.heures * l.prix); else { l.heures = l.heures || j * 8; l.totalHT = r2(l.prix); }
    l.totalTTC = r2(l.totalHT * (1 + l.tva / 100)); l.ref = await nextNumber('L', yr(l.dateDebut)); const d = await Location.create(l); await syncLocation(d.toObject()); return d;
  };
  const locA = await loc({ client: rif._id, truck: T(0)._id, chauffeur: dr(0), dateDebut: back(26), dateFin: back(24), prix: 2800, statut: 'terminee', observation: 'Dry-run for a port transfer' });           // day rate, billed
  const locB = await loc({ client: atlas._id, truck: T(4)._id, mode: 'heure', dateDebut: back(12), heureDebut: '08:00', heureFin: '16:30', heures: 8.5, prix: 420, statut: 'terminee', chauffeur: dr(4) });   // hourly, completed, not yet invoiced
  await loc({ client: agro._id, truck: T(3)._id, mode: 'forfait', dateDebut: ago(1), dateFin: ago(-2), prix: 9000, statut: 'en_cours', observation: 'Flat price for the harvest campaign' });   // flat rate, in progress
  await loc({ client: atlas._id, truck: T(1)._id, dateDebut: ago(-10), dateFin: ago(-8), prix: 3000, statut: 'planifiee' });                                                          // planned
  await loc({ client: ocean._id, truck: T(2)._id, dateDebut: back(15), dateFin: back(14), prix: 2600, statut: 'annulee', observation: 'Customer cancelled' });                         // cancelled

  // ===== Invoices =====
  const invoice = async (client, missions, locations, { date, statut = 'emise', modePaiement = 'virement' }) => {
    const lignes = missions.flatMap((m) => lignesDepuisMission(m.toObject())); for (const l of locations) lignes.push({ designation: `Truck rental ${l.ref}`, qte: 1, pu: l.totalHT, tva: l.tva, unite: 'forfait', locationId: String(l._id) });
    const b = { client: client._id, clientSnap: { nom: client.nom, ice: client.ice, adresse: client.adresse, ville: client.ville }, date, lignes, fraisSupp: [], remisePct: 0, missions: missions.map((m) => m._id), locations: locations.map((l) => l._id), statut, modePaiement };
    applyTotals(b); b.reste = b.totalTTC; b.echeance = plusDays(date, client.delaiPaiement);
    if (statut === 'emise') b.numero = await nextNumber('F', yr(date));
    const f = await Facture.create(b);
    await Mission.updateMany({ _id: { $in: f.missions } }, { $set: { facture: f._id } }); await Location.updateMany({ _id: { $in: f.locations } }, { $set: { facture: f._id } });
    return f;
  };
  const pay = async (f, montant, date, mode, reference = '') => { const p = await Paiement.create({ facture: f._id, client: f.client, date, montant, mode, reference }); await syncCaisse('paiement_client', p._id, { date, sens: 'entree', libelle: `Règlement ${f.numero}`, montant, mode }); await recomputeFacture(f._id); return p; };
  const credit = async (f, date, motif, lignes) => { const b = { numero: await nextNumber('AV', yr(date)), facture: f._id, client: f.client, date, motif, lignes, fraisSupp: [], remisePct: 0 }; applyTotals(b); await Avoir.create(b); await recomputeFacture(f._id); };

  // created in date order so the numbering stays chronological
  const f1 = await invoice(atlas, [ms[0]], [], { date: back(50) }); await pay(f1, f1.totalTTC, back(22), 'virement', 'WIRE-20418');                                      // paid in full (bank transfer)
  const f2 = await invoice(agro, [ms[1]], [], { date: back(46), modePaiement: 'cheque' }); await pay(f2, r2(f2.totalTTC * 0.4), back(30), 'cheque', 'CHQ-6620'); await pay(f2, r2(f2.totalTTC * 0.2), back(10), 'effet', 'BoE-118');   // partly paid (cheque + bill of exchange)
  const f4 = await invoice(sahara, [ms[14]], [], { date: back(38) });                                                                                                     // overdue (15-day terms), nothing paid
  const f8 = await invoice(rif, [ms[3]], [], { date: back(36), modePaiement: 'carte' }); await pay(f8, f8.totalTTC, back(30), 'carte', 'POS-7781');                        // paid in full by card
  const f3 = await invoice(ocean, [ms[2], ms[6]], [], { date: back(34), modePaiement: 'especes' }); await pay(f3, 2000, back(20), 'especes', 'Receipt 114');           // partly paid in cash (feeds the cash register)
  const f7 = await invoice(agro, [ms[5]], [], { date: back(25) });                                                                                                        // issued then cancelled
  await Facture.updateOne({ _id: f7._id }, { $set: { statut: 'annulee' } }); await Mission.updateMany({ _id: ms[5]._id }, { $set: { facture: null } });
  const f5 = await invoice(rif, [], [locA], { date: back(20) });                                                                                                          // unpaid, not yet due
  const f6 = await invoice(atlas, [ms[4]], [], { date: back(2), statut: 'brouillon' });                                                                                    // draft (not numbered yet)
  // credit notes (5), also created in date order
  await credit(f4, back(30), 'Price correction — agreed rate was 105 per tonne', [{ designation: 'Price correction', qte: 24, pu: 5, tva: 0, unite: 't' }]);
  await credit(f5, back(15), 'Late delivery penalty agreed with the customer', [{ designation: 'Late delivery penalty', qte: 1, pu: 300, tva: 20, unite: 'flat' }]);
  await credit(f3, back(12), 'Waiting-time fee waived (goodwill)', [{ designation: 'Idle-time fee waived', qte: 1, pu: 400, tva: 20, unite: 'flat' }]);
  await credit(f2, back(8), 'Commercial discount on the price per tonne', [{ designation: 'Commercial discount', qte: 1, pu: 500, tva: 10, unite: 'flat' }]);
  await credit(f2, back(5), 'Two pallets returned (damaged)', [{ designation: 'Damaged goods returned', qte: 2, pu: 150, tva: 10, unite: 'pallet' }]);
  void f6; void locB;

  // ===== Quotes (5: draft / sent / accepted / rejected / converted) =====
  const devis = async (client, statut, date, valid, lignes, extra = {}) => { const b = { numero: await nextNumber('D', yr(date)), client: client._id, date, validite: valid, statut, lignes, fraisSupp: [], remisePct: 0, ...extra }; applyTotals(b); return Devis.create(b); };
  await devis(atlas, 'brouillon', back(1), ago(-29), [{ designation: 'Transport Tangier–Marrakech, 26 t', qte: 26, pu: 100, tva: 20, unite: 't' }]);
  await devis(rif, 'envoye', back(40), back(10), [{ designation: 'Monthly dedicated truck (2 trucks)', qte: 2, pu: 42000, tva: 20, unite: 'month' }], { observation: 'Offer expired — follow up' });
  await devis(ocean, 'accepte', back(9), ago(-21), [{ designation: 'Clinker Casablanca–Agadir, 32 t', qte: 32, pu: 118, tva: 20, unite: 't' }, { designation: 'Loading fee', qte: 1, pu: 300, tva: 20, unite: 'flat' }]);
  await devis(agro, 'refuse', back(22), back(2), [{ designation: 'Seasonal fertilizer transport (10 loads)', qte: 10, pu: 2100, tva: 10, unite: 'load' }], { observation: 'Customer found a cheaper offer' });
  const dvConv = await devis(sahara, 'converti', back(7), ago(-23), [{ designation: 'Truck rental 5 days', qte: 5, pu: 2800, tva: 0, unite: 'day' }]);
  const fConv = await Facture.create({ client: sahara._id, clientSnap: { nom: sahara.nom, ice: sahara.ice, adresse: sahara.adresse, ville: sahara.ville }, date: back(6), echeance: plusDays(back(6), 15), lignes: dvConv.lignes, fraisSupp: [], remisePct: 0, statut: 'brouillon', modePaiement: 'virement', ...(() => { const t = { lignes: dvConv.lignes, fraisSupp: [], remisePct: 0 }; applyTotals(t); return { totalBrutHT: t.totalBrutHT, totalHT: t.totalHT, totalTVA: t.totalTVA, totalTTC: t.totalTTC, reste: t.totalTTC }; })() });
  await Devis.updateOne({ _id: dvConv._id }, { $set: { facture: fConv._id } });

  // ===== Subcontractor payments (5 modes) =====
  const stPay = async (st, mission, date, montant, mode, reference) => { const p = await PaiementST.create({ sousTraitant: st._id, mission: mission._id, date, montant, mode, reference }); await syncCaisse('paiement_st', p._id, { date, sens: 'sortie', libelle: `Sous-traitant ${reference}`, montant, mode }); };
  await stPay(sts[0], ms[6], back(25), 1500, 'virement', 'WIRE-ST-77');          // Chaouia: 2,850 due → 1,500 + 1,000 paid
  await stPay(sts[0], ms[6], back(12), 1000, 'especes', 'ST-CASH-01');
  await stPay(sts[1], ms[7], back(5), 1800, 'cheque', 'CHQ-ST-310');              // Gharb: flat cost fully paid
  await stPay(sts[2], ms[15], back(20), 1000, 'effet', 'BoE-ST-09');              // Souss: 2,100 due → 1,000 paid
  await stPay(sts[3], ms[16], back(9), 600, 'carte', 'POS-ST-45');                // Oriental: 2,400 due → 600 paid

  // ===== Purchases (7: draft / paid / partly paid / overdue / unpaid / cancelled / card) =====
  const achat = async (fr, date, lignes, num, { statut = 'validee', payments = [] } = {}) => {
    const b = { numero: await nextNumber('ACH', yr(date)), numeroFournisseur: num, fournisseur: fr._id, date, statut, lignes, fraisSupp: [], remisePct: 0 }; applyTotals(b); b.echeance = plusDays(date, fr.delaiPaiement); b.reste = b.totalTTC;
    const a = await Achat.create(b);
    for (const [montant, d, mode, ref] of payments) { const p = await PaiementFournisseur.create({ achat: a._id, fournisseur: fr._id, date: d, montant: montant === 'all' ? a.totalTTC : montant, mode, reference: ref || '' }); await syncCaisse('paiement_fournisseur', p._id, { date: d, sens: 'sortie', libelle: `Achat ${a.numero}`, montant: p.montant, mode }); }
    await recomputeAchat(a._id); return a;
  };
  await achat(fuelSup, back(25), [{ designation: 'Diesel (bulk)', qte: 5000, pu: 10.4, tva: 10, unite: 'L' }], 'FC-2210', { payments: [['all', back(10), 'virement', 'WIRE-901']] });                                  // fully paid
  await achat(tyreSup, back(40), [{ designation: 'Tyre 315/80 R22.5', qte: 8, pu: 3100, tva: 20, unite: 'u' }], 'MT-0412', { payments: [[10000, back(22), 'cheque', 'CHQ-6601'], [3000, back(9), 'especes', 'CASH-17']] });   // partly paid (cheque + cash)
  await achat(partsSup, back(5), [{ designation: 'Front brake pads', qte: 8, pu: 640, tva: 20, unite: 'u' }, { designation: 'Oil filter', qte: 10, pu: 180, tva: 20, unite: 'u' }], 'TAP-8890');                       // unpaid, due soon
  await achat(oilSup, back(50), [{ designation: 'Engine oil 15W40 (208 L drum)', qte: 3, pu: 4300, tva: 20, unite: 'u' }], 'AL-2231', { payments: [[5000, back(30), 'effet', 'BoE-331']] });                          // overdue (30 days passed), partly paid
  await achat(garageSup, back(2), [{ designation: 'Oil change labour', qte: 6, pu: 250, tva: 20, unite: 'h' }], 'NGS-051', { statut: 'brouillon' });                                                                 // draft
  await achat(tyreSup, back(35), [{ designation: 'Tyre 315/80 R22.5', qte: 1, pu: 3100, tva: 20, unite: 'u' }], 'MT-0399', { statut: 'annulee' });                                                                    // cancelled
  await achat(fuelSup, back(11), [{ designation: 'AdBlue 20 L', qte: 12, pu: 95, tva: 20, unite: 'u' }], 'FC-2288', { payments: [['all', back(11), 'carte', 'POS-3320']] });                                           // paid by card

  // ===== Expenses (7 categories / payment modes) + manual cash entries (5) =====
  const dep = async (date, categorie, libelle, montant, mode, extra = {}) => { const d = await Depense.create({ date, categorie, libelle, montant, mode, ...extra }); await syncCaisse('depense', d._id, { date, sens: 'sortie', libelle, montant, mode }); };
  await dep(back(18), 'Rent', 'Depot rent — current month', 6500, 'virement', { reference: 'WIRE-RENT' });
  await dep(back(9), 'Office supplies', 'Stationery and toner', 420, 'especes');
  await dep(back(4), 'Tolls', 'Motorway toll card top-up', 1500, 'especes', { truck: T(1)._id });
  await dep(back(15), 'Electricity & water', 'Depot utilities', 1280, 'cheque', { reference: 'CHQ-6644' });
  await dep(back(30), 'Insurance', 'Fleet liability insurance — instalment', 8200, 'effet', { reference: 'BoE-INS-5', fournisseur: garageSup._id });
  await dep(back(7), 'Phone & internet', 'Mobile plans and GPS subscription', 960, 'carte', { reference: 'POS-ONLINE' });
  await dep(back(3), 'Fines', 'Overload fine, Kenitra weighbridge', 700, 'especes', { truck: T(3)._id, observation: 'Paid on the spot' });
  await Caisse.insertMany([
    { date: back(50), sens: 'entree', libelle: 'Opening cash float', categorie: 'Contribution', montant: 10000, source: 'manuel' },
    { date: back(35), sens: 'sortie', libelle: 'Cash deposited at the bank', categorie: 'Bank deposit', montant: 4000, source: 'manuel' },
    { date: back(21), sens: 'entree', libelle: 'Refund from fuel station (double charge)', categorie: 'Refund', montant: 350, source: 'manuel' },
    { date: back(14), sens: 'sortie', libelle: 'Driver mission allowance — Laayoune trip', categorie: 'Allowances', montant: 1800, source: 'manuel', observation: 'Advance on road expenses' },
    { date: back(6), sens: 'entree', libelle: 'Cash received — scrap tyres sold', categorie: 'Other income', montant: 600, source: 'manuel' },
  ]);

  // ===== Fuel → bonus / deduction transfers (real fill-ups from the operations) =====
  const transfer = async (truck, month, e, type, montant, motif) => {
    const o = await Operation.findOne({ truck: truck._id, kind: 'plein', date: { $gte: `${month}-01`, $lte: `${month}-31` }, supprime: { $ne: true } }).sort({ date: -1 });
    if (!o) return;
    const p = await PrimeRetenue.create({ employe: e._id, date: o.date, type, libelle: motif, montant, source: 'gasoil', refId: String(o._id) });
    o.meta = { ...(o.meta || {}), transfert: { id: String(p._id), type, montant, employe: e.nom } }; o.markModified('meta');
    o.historique.push({ at: new Date(), par: 'Demo', action: 'modification', avant: { transfert: null } }); await o.save();
  };
  await transfer(T(2), P1, E.Hamid, 'retenue', 650, `Over-consumption ${P1} (${T(2).immatriculation})`);          // the over-consuming Scania
  await transfer(T(0), P0, E.Rachid, 'prime', 200, `Fuel saving ${P0} (${T(0).immatriculation})`);                  // economical driver

  // ===== Payroll: P-2 paid, P-1 validated (3 paid), current month draft =====
  const cfg = await paieConfig(); const monthEnd = (p) => `${p}-31`;
  const generer = async (periode) => {
    for (const e of await Employe.find({ statut: 'actif' }).lean()) {
      if (e.dateEmbauche && e.dateEmbauche > monthEnd(periode)) continue;
      const ex = await Bulletin.findOne({ employe: e._id, periode });
      const [pointages, prs, avances] = await Promise.all([Pointage.find({ employe: e._id, date: { $gte: `${periode}-01`, $lte: monthEnd(periode) } }).lean(), PrimeRetenue.find({ employe: e._id, date: { $gte: `${periode}-01`, $lte: monthEnd(periode) } }).lean(), Avance.find({ employe: e._id, statut: 'en_cours', date: { $lte: monthEnd(periode) } }).lean()]);
      const calc = calcBulletin(e, { pointages, primes: prs.filter((p) => p.type === 'prime'), retenues: prs.filter((p) => p.type === 'retenue'), avances, ir: ex?.ir || 0 }, cfg);
      if (ex) { ex.set(calc); await ex.save(); } else await Bulletin.create({ employe: e._id, periode, ...calc });
    }
  };
  const setIR = async (periode, name, ir) => { const bu = await Bulletin.findOne({ periode, employe: E[name]._id }); if (!bu) return; bu.ir = ir; bu.net = r2(bu.brut - bu.cnss - bu.amo - bu.ir - bu.retenues - bu.avances); await bu.save(); };
  const valider = async (periode) => {
    for (const bu of await Bulletin.find({ periode, statut: 'brouillon' })) {
      for (const a of bu.detail?.avancesDetail || []) { const x = await Avance.findById(a.id); if (x) { x.solde = r2(Math.max(0, x.solde - a.montant)); x.statut = x.solde <= 0.005 ? 'soldee' : 'en_cours'; await x.save(); } }
      bu.statut = 'validee'; await bu.save();
    }
  };
  const payer = async (bu, date, mode) => { bu.statut = 'payee'; bu.datePaiement = date; bu.modePaiement = mode; await bu.save(); const e = await Employe.findById(bu.employe).lean(); await syncCaisse('paie', bu._id, { date, sens: 'sortie', libelle: `Salaire ${bu.periode} — ${e?.nom || ''}`, montant: bu.net, mode }); };
  await generer(P2); await setIR(P2, 'Karim', 180); await setIR(P2, 'Hamid', 150); await valider(P2);
  const modeFor = { Mohamed: 'especes', Abdelkader: 'cheque' };
  for (const bu of await Bulletin.find({ periode: P2 }).populate('employe', 'nom')) await payer(bu, `${P2}-28`, modeFor[bu.employe.nom.split(' ')[0]] || 'virement');
  await generer(P1); await setIR(P1, 'Karim', 190); await setIR(P1, 'Hamid', 160); await valider(P1);
  for (const bu of (await Bulletin.find({ periode: P1 }).populate('employe', 'nom')).filter((b) => ['Karim', 'Youssef', 'Said'].includes(b.employe.nom.split(' ')[0]))) await payer(bu, `${P1}-28`, 'virement');
  await generer(P0); await setIR(P0, 'Karim', 190);   // current month stays a draft
  void avSaid; void avYouss; void avKarim; void avRachid; void avOuali;

  // ===== Demo users for the three roles (created once; password printed in the log) =====
  const pwd = crypto.randomBytes(6).toString('base64url');
  const extra = [['saisie@flotte.local', 'Data Entry (demo)', 'saisie'], ['lecture@flotte.local', 'Read-only (demo)', 'lecture']];
  let created2 = 0;
  for (const [email, nom, role] of extra) if (!(await User.exists({ email }))) { await User.create({ email, nom, role, passwordHash: await hash(pwd) }); created2++; }
  if (created2) console.log(`[seed] demo users saisie@flotte.local / lecture@flotte.local — password: ${pwd}`);

  return { clients: clients.length, missions: ms.length };
}
