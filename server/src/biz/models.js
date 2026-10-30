import mongoose from 'mongoose';
const { Schema } = mongoose;
const opt = { timestamps: true, minimize: false };
const ref = (to, extra = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const day = { type: String, default: '', match: /^(\d{4}-\d{2}-\d{2})?$/ };
const str = (extra = {}) => ({ type: String, default: '', trim: true, ...extra });
const money = { type: Number, default: 0 };
const make = (name, def, indexes = []) => { const s = new Schema(def, opt); indexes.forEach((i) => s.index(...i)); return mongoose.model(name, s); };

// ---------- Numérotation ----------
export const Counter = make('Counter', { key: { type: String, unique: true, required: true }, seq: { type: Number, default: 0 } });
export async function nextNumber(prefix, year = new Date().getFullYear()) {
  const c = await Counter.findOneAndUpdate({ key: `${prefix}-${year}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(c.seq).padStart(4, '0')}-${year}`;
}

export async function nextSeq(key) { const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true }); return c.seq; }

// ---------- Tiers ----------
const tiers = { nom: str({ required: true }), ice: str(), if: str(), rc: str(), adresse: str(), ville: str(), telephone: str(), email: str(), contact: str(), notes: str(), actif: { type: Boolean, default: true } };
export const Client = make('Client', { ...tiers, tvaDefaut: { type: Number, default: 20 }, delaiPaiement: { type: Number, default: 30 } });
export const Fournisseur = make('Fournisseur', { ...tiers, delaiPaiement: { type: Number, default: 30 } });
export const SousTraitant = make('SousTraitant', tiers);
export const VehiculeST = make('VehiculeST', { sousTraitant: ref('SousTraitant', { required: true, index: true }), immatriculation: str({ required: true }), type: str(), capaciteTonnes: money, chauffeur: str(), telephone: str(), actif: { type: Boolean, default: true } });
export const Article = make('Article', { reference: str(), designation: str({ required: true }), categorie: str(), unite: str({ default: 'u' }), prixAchat: money, tva: { type: Number, default: 20 }, actif: { type: Boolean, default: true } });

// ---------- Exploitation ----------
const ligne = { _id: false, designation: str(), qte: { type: Number, default: 1 }, pu: money, tva: { type: Number, default: 20 }, unite: str(), missionId: str(), locationId: str() };
const frais = { _id: false, libelle: str(), montant: money, tva: { type: Number, default: 20 } };
export const Mission = make('Mission', {
  ref: str({ required: true }), type: { type: String, enum: ['interne', 'soustraite'], default: 'interne' },
  client: ref('Client', { required: true, index: true }), numeroBL: str(),
  villeCharge: str(), villeDecharge: str(), dateMission: { ...day, index: true }, dateChargement: day, dateDechargement: day,
  marchandise: str(), tonnage: money, distance: money,
  mode: { type: String, enum: ['tonnage', 'forfait'], default: 'tonnage' }, prixUnitaire: money, prixForfait: money, tva: { type: Number, default: 20 },
  fraisChargement: money, fraisDechargement: money, fraisImmobilisation: money,
  statut: { type: String, enum: ['brouillon', 'planifiee', 'en_cours', 'terminee', 'annulee'], default: 'planifiee', index: true },
  truck: ref('Truck', { default: null }), remorque: str(), chauffeur: ref('Employe', { default: null }),
  sousTraitant: ref('SousTraitant', { default: null, index: true }), vehiculeST: ref('VehiculeST', { default: null }), modeST: { type: String, enum: ['tonnage', 'forfait'], default: 'tonnage' }, prixUnitaireST: money, coutST: money,
  charges: [{ _id: false, code: str(), montant: money, note: str() }],
  totalHT: money, totalTTC: money, coutTotal: money,
  facture: ref('Facture', { default: null, index: true }), observation: str(),
});
export const Location = make('Location', {
  ref: str({ required: true }), client: ref('Client', { required: true, index: true }), truck: ref('Truck', { required: true, index: true }), chauffeur: ref('Employe', { default: null }),
  dateDebut: { ...day, index: true }, dateFin: day, heureDebut: str(), heureFin: str(),
  mode: { type: String, enum: ['jour', 'heure', 'forfait'], default: 'jour' }, nbJours: money, heures: money, prix: money, tva: { type: Number, default: 20 },
  totalHT: money, totalTTC: money, statut: { type: String, enum: ['planifiee', 'en_cours', 'terminee', 'annulee'], default: 'planifiee' },
  facture: ref('Facture', { default: null }), observation: str(),
});
export const DocumentVehicule = make('DocumentVehicule', {
  truck: ref('Truck', { required: true, index: true }), type: str({ required: true }), numero: str(), dateEmission: day, dateExpiration: day, observation: str(),
  fichier: { nom: str(), mime: str(), taille: money, chemin: str() },
});
export const Panne = make('Panne', {
  ref: str(), truck: ref('Truck', { required: true, index: true }), date: { ...day, index: true }, description: str({ required: true }), gravite: { type: String, enum: ['mineure', 'majeure', 'critique'], default: 'mineure' },
  statut: { type: String, enum: ['ouverte', 'en_cours', 'resolue'], default: 'ouverte' }, immobilise: { type: Boolean, default: false }, dateResolution: day, cout: money, chauffeur: str(), lieu: str(), observation: str(),
});
export const Piece = make('Piece', { reference: str(), designation: str({ required: true }), categorie: str(), unite: str({ default: 'u' }), seuil: money, prixUnitaire: money, emplacement: str(), actif: { type: Boolean, default: true } });
export const MouvementPiece = make('MouvementPiece', { piece: ref('Piece', { required: true, index: true }), date: day, type: { type: String, enum: ['entree', 'sortie'], required: true }, qte: { type: Number, required: true }, prixUnitaire: money, truck: ref('Truck', { default: null }), observation: str() });

// ---------- Commercial ----------
const docBase = { lignes: [ligne], fraisSupp: [frais], remisePct: money, totalBrutHT: money, totalHT: money, totalTVA: money, totalTTC: money, observation: str() };
export const Devis = make('Devis', { numero: str({ required: true }), client: ref('Client', { required: true, index: true }), date: day, validite: day, statut: { type: String, enum: ['brouillon', 'envoye', 'accepte', 'refuse', 'converti'], default: 'brouillon' }, facture: ref('Facture', { default: null }), ...docBase });
export const BonLivraison = make('BonLivraison', { numero: str({ required: true }), client: ref('Client', { required: true, index: true }), mission: ref('Mission', { default: null }), date: day, lieuLivraison: str(), camion: str(), chauffeur: str(), lignes: [ligne], statut: { type: String, enum: ['emis', 'livre', 'signe'], default: 'emis' }, observation: str() });
export const Facture = make('Facture', {
  numero: str({ index: true }), client: ref('Client', { required: true, index: true }), clientSnap: { nom: str(), ice: str(), adresse: str(), ville: str() },
  date: { ...day, index: true }, echeance: day, dateDepot: day, modePaiement: str(), prestation: str(), nomPdf: str(),
  statut: { type: String, enum: ['brouillon', 'emise', 'annulee'], default: 'brouillon', index: true },
  missions: [{ type: Schema.Types.ObjectId, ref: 'Mission' }], locations: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
  paye: money, avoirs: money, reste: money, ...docBase,
});
export const Avoir = make('Avoir', { numero: str({ required: true }), facture: ref('Facture', { required: true, index: true }), client: ref('Client', { index: true }), date: day, motif: str(), ...docBase });
export const Paiement = make('Paiement', { facture: ref('Facture', { required: true, index: true }), client: ref('Client', { index: true }), date: { ...day, index: true }, montant: { type: Number, required: true }, mode: { type: String, default: 'virement' }, reference: str(), observation: str() });
export const Caisse = make('Caisse', { date: { ...day, index: true }, sens: { type: String, enum: ['entree', 'sortie'], required: true }, libelle: str({ required: true }), categorie: str(), montant: { type: Number, required: true }, source: { type: String, default: 'manuel' }, refId: str(), observation: str() });
export const Depense = make('Depense', { date: { ...day, index: true }, categorie: str({ required: true }), libelle: str({ required: true }), montant: { type: Number, required: true }, fournisseur: ref('Fournisseur', { default: null }), truck: ref('Truck', { default: null }), mode: { type: String, default: 'especes' }, reference: str(), observation: str() });

// ---------- Achats & sous-traitance ----------
export const Achat = make('Achat', { numero: str({ required: true }), numeroFournisseur: str(), fournisseur: ref('Fournisseur', { required: true, index: true }), date: { ...day, index: true }, echeance: day, statut: { type: String, enum: ['brouillon', 'validee', 'annulee'], default: 'validee' }, paye: money, reste: money, ...docBase });
export const PaiementFournisseur = make('PaiementFournisseur', { achat: ref('Achat', { required: true, index: true }), fournisseur: ref('Fournisseur', { index: true }), date: day, montant: { type: Number, required: true }, mode: { type: String, default: 'virement' }, reference: str(), observation: str() });
export const PaiementST = make('PaiementST', { sousTraitant: ref('SousTraitant', { required: true, index: true }), mission: ref('Mission', { default: null }), date: day, montant: { type: Number, required: true }, mode: { type: String, default: 'virement' }, reference: str(), observation: str() });

// ---------- RH ----------
export const Employe = make('Employe', {
  matricule: str({ required: true }), nom: str({ required: true }), cin: str(), cnss: str(), poste: str(), departement: str({ default: 'Exploitation' }), telephone: str(), email: str(), adresse: str(),
  dateNaissance: day, dateEmbauche: day, typeContrat: { type: String, default: 'CDI' }, dateDebutContrat: day, dateFinContrat: day,
  typeSalaire: { type: String, enum: ['mensuel', 'journalier', 'horaire'], default: 'mensuel' }, salaireBase: money, soumisCnss: { type: Boolean, default: true },
  truck: ref('Truck', { default: null }), statut: { type: String, enum: ['actif', 'inactif'], default: 'actif' }, observation: str(),
});
export const Contrat = make('Contrat', { employe: ref('Employe', { required: true, index: true }), type: str({ default: 'CDI' }), dateDebut: day, dateFin: day, salaireBase: money, poste: str(), statut: { type: String, enum: ['actif', 'termine'], default: 'actif' }, observation: str() });
export const Pointage = make('Pointage', { employe: ref('Employe', { required: true, index: true }), date: { ...day, index: true }, type: { type: String, enum: ['present', 'absent', 'conge', 'maladie', 'ferie', 'heures_sup'], default: 'present' }, heures: money, observation: str() });
export const Avance = make('Avance', { employe: ref('Employe', { required: true, index: true }), date: day, montant: { type: Number, required: true }, motif: str(), remboursementMensuel: money, solde: money, statut: { type: String, enum: ['en_cours', 'soldee'], default: 'en_cours' } });
export const PrimeRetenue = make('PrimeRetenue', { employe: ref('Employe', { required: true, index: true }), date: { ...day, index: true }, type: { type: String, enum: ['prime', 'retenue'], required: true }, libelle: str({ required: true }), montant: { type: Number, required: true }, source: { type: String, default: 'manuel' }, refId: str() });
export const Bulletin = make('Bulletin', {
  employe: ref('Employe', { required: true, index: true }), periode: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  base: money, joursTravailles: money, heures: money, heuresSup: money, montantHeuresSup: money, absences: money, retenueAbsences: money, primes: money, retenues: money, avances: money,
  brut: money, cnss: money, amo: money, ir: money, net: money, statut: { type: String, enum: ['brouillon', 'validee', 'payee'], default: 'brouillon' }, datePaiement: day, modePaiement: str(),
  detail: { type: Schema.Types.Mixed, default: {} },
}, [[{ employe: 1, periode: 1 }, { unique: true }]]);

export const BIZ_MODELS = { Counter, Client, Fournisseur, SousTraitant, VehiculeST, Article, Mission, Location, DocumentVehicule, Panne, Piece, MouvementPiece, Devis, BonLivraison, Facture, Avoir, Paiement, Caisse, Depense, Achat, PaiementFournisseur, PaiementST, Employe, Contrat, Pointage, Avance, PrimeRetenue, Bulletin };
