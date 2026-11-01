// Demo data (fictional trucks, 12 months). Usage: npm run seed:demo
import 'dotenv/config';
import mongoose from 'mongoose';
import { Truck, Entry, Operation, Plan, Settings, getSettings } from './models.js';
import { User } from './models.js';
import { ensureAdmin } from './auth.js';
import { addMonths, currentMonth } from '../../shared/calc.js';

const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const FLEET = [
  ['12345-A-1', 'Volvo', 'FH 460', 'Karim Benali', 1.0, 18500, 105600], ['67890-B-6', 'Renault', 'T High', 'Youssef Amrani', 0.97, 16200, 105600],
  ['24680-A-1', 'Mercedes', 'Actros 1845', 'Said Idrissi', 0.93, 17400, 98000], ['13579-D-2', 'Scania', 'R450', 'Hamid Tazi', 0.84, 18900, 112000],
  ['11223-A-1', 'DAF', 'XF 480', 'Rachid Alaoui', 1.05, 16800, 0],
];

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/suivi_flotte');
await ensureAdmin(); await getSettings();
await Entry.deleteMany({}); await Truck.deleteMany({}); await Operation.deleteMany({}); await Plan.deleteMany({});
const ROUTES = [['Tangier–Casablanca', 340], ['Tangier–Fes', 300], ['Casablanca–Agadir', 510], ['Tangier–Marrakech', 580], ['Tangier–Rabat', 250], ['Fes–Oujda', 330]];
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
// Bascule au 1er du mois M-2 : 12 mois de fiches mensuelles avant, puis 3 mois (M-2, M-1, M en cours) en opérations datées
const bascule = addMonths(currentMonth(), -2);
const histEnd = addMonths(bascule, -1);
const start = new Date(`${bascule}-01T00:00:00Z`);
const nbJours = Math.round((today - start) / 864e5);
let nbOps = 0;
const odoLog = {};   // truck id -> [[date, odo]]
await Settings.updateOne({ key: 'main' }, { $set: { dateBascule: bascule, societe: 'Maghreb Express Maroc (demo)' } });
for (const [i, [immat, marque, modele, chauffeur, prof, leasing, dotation]] of FLEET.entries()) {
  const defauts = { amounts: { 61310000: leasing, 61340000: 4100, 61455000: 350, 61710000: 5500, 61740000: 1380 },
    annuel: { 61610000: 9960, 61900000: dotation }, modes: {}, tarifKm: +(9.4 * prof).toFixed(2), prixLitre: 11 };
  const truck = await Truck.create({ immatriculation: immat, marque, modele, annee: 2019 + i, chauffeur, defauts, consoTheorique: [31, 32, 33, 30, 31][i] });
  let odo = 150000 + i * 23000 + 8000, sinceFill = 0, nbPleins = 0;
  odoLog[truck._id] = [[iso(start), odo]];
  const conso = [1.02, 1.0, 1.04, 1.27, 0.99][i];   // le 4e camion consomme ~27 % de trop
  for (let k = 0; k < 12; k++) {
    const month = addMonths(histEnd, k - 11), r = rng((i + 1) * 977 + k * 31);
    const km = Math.round(9400 + r() * 1800), litres = Math.round(km * (0.31 + r() * 0.03));
    await Entry.create({ truck: truck._id, month, km, tarifKm: +(9.6 * prof + r() * 0.5).toFixed(2), litres, prixLitre: +(10.6 + r() * 0.8).toFixed(2),
      amounts: { 71280000: Math.round(litres * 0.35), 71880000: Math.round(r() * 2000), 61222000: Math.round(900 + r() * 1200), 61330000: Math.round(1500 + r() * 1800),
        61420000: Math.round(km * 0.5), 61430000: Math.round(2200 + r() * 1200), ...defauts.amounts },
      annuel: defauts.annuel });
  }
  // Mois en mode opérations : la fiche ne porte que les charges fixes
  for (let k = 0; k < 3; k++) await Entry.create({ truck: truck._id, month: addMonths(bascule, k), amounts: { ...defauts.amounts }, annuel: defauts.annuel });
  const r2 = rng((i + 1) * 4421);
  for (let day = nbJours; day >= 0; day--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - day);
    if (d.getUTCDay() === 0 || r2() > 0.56) continue;
    const [voyage, dist] = ROUTES[Math.floor(r2() * ROUTES.length)];
    const km = Math.round(dist * (2 * (0.95 + r2() * 0.1))), date = iso(d), month = date.slice(0, 7);
    const mk = (code, montant, k = 0) => ({ truck: truck._id, date, month, code, montant, km: k, voyage, createdBy: 'Demo', historique: [{ at: new Date(), par: 'Demo', action: 'creation' }] });
    const docs = [mk('71210000', Math.round(km * (9.3 * prof + r2() * 0.5)), km), mk('61420000', Math.round(dist * 0.8)), mk('61430000', Math.round(150 + r2() * 200))];
    await Operation.insertMany(docs); nbOps += docs.length;
    odo += km; sinceFill += km; odoLog[truck._id].push([date, odo]);
    // plein à plein : un plein dès que ~900 km ont été parcourus
    if (sinceFill >= 900) {
      let litres = Math.round((sinceFill * [31, 32, 33, 30, 31][i] * conso * (0.97 + r2() * 0.06)) / 100);
      if (i === 2 && nbPleins === 3) litres = Math.round(litres * 0.35);   // une saisie incohérente (litres trop faibles)
      const prix = +(10.4 + r2() * 0.9).toFixed(2);
      await Operation.create({ truck: truck._id, date, month, code: '61221000', montant: Math.round(litres * prix * 100) / 100, km: 0, voyage, kind: 'plein', createdBy: 'Demo',
        meta: { litres, prixLitre: prix, kmCompteur: odo, source: r2() > 0.7 ? 'interne' : 'externe', station: r2() > 0.7 ? '' : ['Afriquia Tangier', 'Shell Ain Sebaa', 'Total Fes'][Math.floor(r2() * 3)], bon: `BON-${10000 + Math.floor(r2() * 89999)}`, chauffeur },
        historique: [{ at: new Date(), par: 'Demo', action: 'creation' }] });
      nbOps += 1; nbPleins += 1; sinceFill = 0;
    }
  }
}

// Interventions de maintenance + plans d'entretien d'exemple
{
  const trucks = await Truck.find({}).sort({ immatriculation: 1 });
  const GARAGES = ['Atlas Garage', 'Tangier South Workshop', 'Al Baraka Garage'];
  const jour = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
  for (const [i, t] of trucks.entries()) {
    const log = odoLog[t._id]; const lastKm = log[log.length - 1][1]; const odoAt = (date) => { let o = log[0][1]; for (const [d, v] of log) if (d <= date) o = v; return o; };
    const items = [[48, 'preventive', i === 1 ? 'filtres' : 'vidange', 1100 + i * 80, i === 1 ? 'Filter replacement' : 'Oil change + filters'], [30, 'curative', i === 4 ? 'transmission' : 'freins', 2600 + i * 300, i === 4 ? 'Clutch adjustment' : 'Brake pad replacement'], [14, 'curative', i === 3 ? 'moteur' : 'pneus', i === 3 ? 7400 : 4200, i === 3 ? 'Injectors' : 'Front axle tyres']];
    for (const [ago, type, categorie, montant, description] of items) {
      const date = jour(ago + i * 2);
      await Operation.create({ truck: t._id, date, month: date.slice(0, 7), code: categorie === 'pneus' ? '61222000' : '61330000', montant, kind: 'entretien', note: description, createdBy: 'Demo',
        meta: { type, categorie, garage: GARAGES[(i + ago) % 3], kmCompteur: odoAt(date), description }, historique: [{ at: new Date(), par: 'Demo', action: 'creation' }] });
      nbOps += 1;
    }
    const dV = jour(48 + i * 2), dF = jour(30 + i * 2);
    await Plan.create({ truck: t._id, libelle: 'Oil change', categorie: 'vidange', intervalleKm: 30000, intervalleJours: 180, dernierKm: i === 1 ? lastKm - 31000 : odoAt(dV), dernierDate: i === 1 ? jour(200) : dV });
    await Plan.create({ truck: t._id, libelle: 'Brake check', categorie: 'freins', intervalleKm: 0, intervalleJours: 90, dernierDate: i === 4 ? jour(80) : dF });
  }
}
{ const { seedBiz } = await import('./seedBiz.js'); const r = await seedBiz(); console.log(`[seed] business modules: ${r.clients} customers, ${r.missions} missions, invoices, purchases, HR, documents…`); }
console.log(`[seed] ${FLEET.length} trucks × 12 months of sheets + dated operations since ${bascule} + ${nbOps} operation lines`);
await mongoose.disconnect();
