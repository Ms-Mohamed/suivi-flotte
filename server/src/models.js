import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  nom: { type: String, default: 'Gestionnaire' },
  role: { type: String, enum: ['admin', 'saisie', 'lecture'], default: 'saisie' },
  actif: { type: Boolean, default: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

const truckSchema = new Schema({
  immatriculation: { type: String, required: true, unique: true, trim: true },
  marque: { type: String, default: '', trim: true },
  modele: { type: String, default: '', trim: true },
  annee: { type: Number },
  chauffeur: { type: String, default: '', trim: true },
  notes: { type: String, default: '' },
  actif: { type: Boolean, default: true },
  // Modèle de saisie : pré-remplit chaque nouveau mois (charges fixes, taxe annuelle, dotation…)
  defauts: {
    amounts: { type: Schema.Types.Mixed, default: {} },
    annuel: { type: Schema.Types.Mixed, default: {} },
    modes: { type: Schema.Types.Mixed, default: {} },
    tarifKm: { type: Number, default: 0 },
    prixLitre: { type: Number, default: 0 },
  },
}, { timestamps: true, minimize: false });

const entrySchema = new Schema({
  truck: { type: Schema.Types.ObjectId, ref: 'Truck', required: true, index: true },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  km: { type: Number, default: 0, min: 0 },
  tarifKm: { type: Number, default: 0, min: 0 },
  litres: { type: Number, default: 0, min: 0 },
  prixLitre: { type: Number, default: 0, min: 0 },
  amounts: { type: Schema.Types.Mixed, default: {} },   // code compte -> montant mensuel saisi
  annuel: { type: Schema.Types.Mixed, default: {} },    // code compte -> montant annuel (÷12)
  modes: { type: Schema.Types.Mixed, default: {} },     // code compte -> mode de saisie
  impot: { mode: { type: String, enum: ['auto', 'manuel'], default: 'auto' }, montant: { type: Number, default: 0 } },
  notes: { type: String, default: '' },
}, { timestamps: true, minimize: false });
entrySchema.index({ truck: 1, month: 1 }, { unique: true });

// Opération datée : une ligne de produit ou de charge liée à un camion et à un jour (voyage, plein, péage, réparation…).
const operationSchema = new Schema({
  truck: { type: Schema.Types.ObjectId, ref: 'Truck', required: true, index: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  code: { type: String, required: true },
  montant: { type: Number, required: true, min: 0 },
  km: { type: Number, default: 0, min: 0 },
  voyage: { type: String, default: '', trim: true },
  note: { type: String, default: '', trim: true },
  supprime: { type: Boolean, default: false },
  createdBy: { type: String, default: '' },
  historique: [{ _id: false, at: Date, par: String, action: String, avant: Schema.Types.Mixed }],
}, { timestamps: true, minimize: false });

const settingsSchema = new Schema({
  key: { type: String, default: 'main', unique: true },
  societe: { type: String, default: 'Ma société de transport' },
  tauxIS: { type: Number, default: 20, min: 0, max: 100 },
  cotisationMinimale: { type: Number, default: 0.25, min: 0, max: 100 },
  cotisationMinimaleActive: { type: Boolean, default: true },
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Truck = mongoose.model('Truck', truckSchema);
export const Entry = mongoose.model('Entry', entrySchema);
export const Operation = mongoose.model('Operation', operationSchema);
export const Settings = mongoose.model('Settings', settingsSchema);
export const getSettings = async () => (await Settings.findOne({ key: 'main' })) || (await Settings.create({ key: 'main' }));
