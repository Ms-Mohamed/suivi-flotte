// Données de démonstration (camions fictifs, 12 mois). Usage : npm run seed:demo
import 'dotenv/config';
import mongoose from 'mongoose';
import { Truck, Entry, Operation, getSettings } from './models.js';
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
await Entry.deleteMany({}); await Truck.deleteMany({}); await Operation.deleteMany({});
const end = addMonths(currentMonth(), -1);
const ROUTES = [['Tanger–Casablanca', 340], ['Tanger–Fès', 300], ['Casablanca–Agadir', 510], ['Tanger–Marrakech', 580], ['Tanger–Rabat', 250], ['Fès–Oujda', 330]];
const iso = (d) => d.toISOString().slice(0, 10);
let nbOps = 0;
for (const [i, [immat, marque, modele, chauffeur, prof, leasing, dotation]] of FLEET.entries()) {
  const defauts = { amounts: { 61310000: leasing, 61340000: 4100, 61455000: 350, 61710000: 5500, 61740000: 1380 },
    annuel: { 61610000: 9960, 61900000: dotation }, modes: {}, tarifKm: +(9.4 * prof).toFixed(2), prixLitre: 11 };
  const truck = await Truck.create({ immatriculation: immat, marque, modele, annee: 2019 + i, chauffeur, defauts });
  for (let k = 0; k < 12; k++) {
    const month = addMonths(end, k - 11), r = rng((i + 1) * 977 + k * 31);
    const km = Math.round(9200 + r() * 2800), litres = Math.round(km * (0.31 + r() * 0.04));
    await Entry.create({ truck: truck._id, month, km, tarifKm: +(9.2 * prof + r() * 0.9).toFixed(2), litres, prixLitre: +(10.6 + r() * 0.9).toFixed(2),
      amounts: { 71280000: Math.round(litres * 0.35), 71880000: Math.round(r() * 3000), 61222000: Math.round(2600 + r() * 2400), 61330000: Math.round(3500 + r() * 7000),
        61420000: Math.round(km * 0.5), 61430000: Math.round(2200 + r() * 1500), ...defauts.amounts },
      annuel: defauts.annuel });
  }
  // Opérations datées d'exemple : 2 à 4 voyages par semaine sur les 8 dernières semaines (s'ajoutent aux saisies mensuelles)
  const r2 = rng((i + 1) * 4421);
  for (let day = 56; day >= 0; day--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - day);
    if (d.getUTCDay() === 0 || r2() > 0.55) continue;
    const [voyage, dist] = ROUTES[Math.floor(r2() * ROUTES.length)];
    const km = Math.round(dist * (2 * (0.9 + r2() * 0.2))), date = iso(d), month = date.slice(0, 7);
    const mk = (code, montant, k = 0) => ({ truck: truck._id, date, month, code, montant, km: k, voyage, createdBy: 'Démo', historique: [{ at: new Date(), par: 'Démo', action: 'creation' }] });
    const docs = [mk('71210000', Math.round(km * (8.6 * prof + r2() * 1.2)), km), mk('61221000', Math.round(km * 0.33 * (10.6 + r2()))), mk('61420000', Math.round(dist * 0.55)), mk('61430000', Math.round(150 + r2() * 250))];
    await Operation.insertMany(docs); nbOps += docs.length;
  }
}
console.log(`[seed] ${FLEET.length} camions × 12 mois (jusqu'à ${end}) + ${nbOps} lignes d'opérations — login : admin@flotte.local / admin1234`);
await mongoose.disconnect();
