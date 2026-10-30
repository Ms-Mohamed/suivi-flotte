import mongoose from 'mongoose';
import { z } from 'zod';
import { validDate } from '../ops.js';

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const plain = (d) => (d?.toObject ? d.toObject({ minimize: false }) : d);
export const who = (req) => req.user?.nom || req.user?.email || '';
export const httpError = (status, message) => Object.assign(new Error(message), { status });
export const isId = (v) => mongoose.isValidObjectId(v);
export const today = () => new Date().toISOString().slice(0, 10);

export const zDate = z.string().refine(validDate, 'Date invalide (AAAA-MM-JJ)');
export const zDateOpt = z.preprocess((v) => (v == null ? '' : v), z.string().refine((s) => s === '' || validDate(s), 'Date invalide (AAAA-MM-JJ)')).default('');
export const zId = z.string().refine(isId, 'Référence invalide');
export const zIdOpt = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().refine(isId, 'Référence invalide').nullable()).default(null);
export const zMoney = z.number().finite().min(0).max(1e10).default(0);
export const zAmount = z.number().finite().gt(0, 'Le montant doit être supérieur à 0').max(1e10);
export const zText = (max = 200) => z.string().trim().max(max).default('');
export const zTva = z.number().min(0).max(100).default(20);
export const MODES = ['especes', 'cheque', 'virement', 'effet', 'carte'];
export const zMode = z.enum(MODES).default('virement');
export const zLignes = z.array(z.object({
  designation: z.string().trim().min(1, 'Désignation obligatoire').max(300), qte: z.number().finite().min(0).max(1e9).default(1), pu: z.number().finite().min(0).max(1e10).default(0),
  tva: zTva, unite: zText(20), missionId: zText(40), locationId: zText(40),
})).max(200).default([]);
export const zFrais = z.array(z.object({ libelle: z.string().trim().min(1).max(200), montant: z.number().finite().min(0).max(1e10), tva: zTva })).max(30).default([]);
export const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
