import express from 'express';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User, getSettings } from './models.js';
import { hash, requireRole, publicUser, ROLES } from './auth.js';
import { createBackup, listBackups, validName, backupPath, readBackup, parseBackup, restoreSnapshot, backupDir } from './backup.js';
import { templateWorkbook, parseWorkbook, runImport } from './importer.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const raw = express.raw({ type: 'application/octet-stream', limit: '30mb' });
const adminOnly = requireRole();
const plain = (d) => (d?.toObject ? d.toObject({ minimize: false }) : d);
const checkId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Identifiant invalide' }));

async function otherActiveAdmins(exceptId) {
  return User.countDocuments({ role: 'admin', actif: { $ne: false }, _id: { $ne: exceptId } });
}

export function mountAdmin(r) {
  // ---------- Utilisateurs (admin) ----------
  const userBody = z.object({
    email: z.string().email().max(120), nom: z.string().trim().min(1).max(80), role: z.enum(ROLES),
    actif: z.boolean().default(true), password: z.string().min(8, 'Mot de passe : 8 caractères minimum').max(100).optional(),
  });
  r.get('/users', adminOnly, wrap(async (_req, res) => res.json((await User.find({}).sort({ createdAt: 1 })).map(publicUser))));
  r.post('/users', adminOnly, wrap(async (req, res) => {
    const b = userBody.parse(req.body);
    if (!b.password) return res.status(400).json({ error: 'Mot de passe requis' });
    const u = await User.create({ email: b.email, nom: b.nom, role: b.role, actif: b.actif, passwordHash: await hash(b.password) });
    res.status(201).json(publicUser(u));
  }));
  r.put('/users/:id', adminOnly, checkId, wrap(async (req, res) => {
    const b = userBody.partial({ email: true, password: true }).parse(req.body);
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const losesAdmin = u.role === 'admin' && u.actif !== false && (b.role !== 'admin' || b.actif === false);
    if (losesAdmin && !(await otherActiveAdmins(u._id))) return res.status(400).json({ error: 'Il doit rester au moins un administrateur actif' });
    if (String(u._id) === String(req.user._id) && b.actif === false) return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
    Object.assign(u, { nom: b.nom, role: b.role, actif: b.actif });
    if (b.email) u.email = b.email;
    if (b.password) u.passwordHash = await hash(b.password);
    await u.save(); res.json(publicUser(u));
  }));
  r.delete('/users/:id', adminOnly, checkId, wrap(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (String(u._id) === String(req.user._id)) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    if (u.role === 'admin' && u.actif !== false && !(await otherActiveAdmins(u._id))) return res.status(400).json({ error: 'Il doit rester au moins un administrateur actif' });
    await u.deleteOne(); res.json({ ok: true });
  }));

  // ---------- Sauvegardes (admin) ----------
  const checkName = (req, res, next) => (validName(req.params.name) ? next() : res.status(400).json({ error: 'Nom de sauvegarde invalide' }));
  r.get('/backups', adminOnly, wrap(async (_req, res) => res.json({ dossier: backupDir(), fichiers: await listBackups() })));
  r.post('/backups', adminOnly, wrap(async (_req, res) => res.status(201).json(await createBackup())));
  r.post('/backups/importer', adminOnly, raw, wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier manquant' });
    await parseBackup(req.body);                                   // refuse tout fichier invalide
    await fs.mkdir(backupDir(), { recursive: true });
    const probe = await createBackup('-import');                   // réserve un nom unique, puis remplace par le fichier reçu
    await fs.writeFile(backupPath(probe.name), req.body);
    res.status(201).json({ name: probe.name });
  }));
  r.get('/backups/:name', adminOnly, checkName, wrap(async (req, res) => {
    await fs.access(backupPath(req.params.name)).catch(() => { throw Object.assign(new Error('Sauvegarde introuvable'), { status: 404 }); });
    res.download(backupPath(req.params.name));
  }));
  r.post('/backups/:name/restaurer', adminOnly, checkName, wrap(async (req, res) => {
    if (req.body?.confirmation !== 'RESTAURER') return res.status(400).json({ error: 'Tapez RESTAURER pour confirmer' });
    const snap = await readBackup(req.params.name).catch(() => { throw Object.assign(new Error('Sauvegarde introuvable ou illisible'), { status: 404 }); });
    res.json(await restoreSnapshot(snap));
  }));
  r.delete('/backups/:name', adminOnly, checkName, wrap(async (req, res) => { await fs.unlink(backupPath(req.params.name)).catch(() => {}); res.json({ ok: true }); }));

  // ---------- Import Excel (admin + saisie) ----------
  const canImport = requireRole('saisie');
  r.get('/import/modele', canImport, wrap(async (_req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modele-import-suivi-flotte.xlsx"');
    await (await templateWorkbook()).xlsx.write(res); res.end();
  }));
  const importHandler = (dryRun) => wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Fichier manquant' });
    const rows = await parseWorkbook(req.body);
    const settings = plain(await getSettings());
    res.json(await runImport(rows, { creerCamions: req.query.creerCamions === '1', ecraser: req.query.ecraser === '1', settings, dryRun }));
  });
  r.post('/import/apercu', canImport, raw, importHandler(true));
  r.post('/import/valider', canImport, raw, importHandler(false));
}
