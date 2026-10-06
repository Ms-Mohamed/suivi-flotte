import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from './models.js';

const secret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET est obligatoire en production');
  return 'dev-secret-change-me';
};
export const signToken = (user) => jwt.sign({ sub: String(user._id) }, secret(), { expiresIn: '7d' });
export const hash = (pwd) => bcrypt.hash(pwd, 11);
export const check = (pwd, h) => bcrypt.compare(pwd, h);

export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentification requise' });
    const { sub } = jwt.verify(token, secret());
    const user = await User.findById(sub);
    if (!user || user.actif === false) return res.status(401).json({ error: 'Session invalide' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Session expirée, reconnectez-vous' }); }
}

export const ROLES = ['admin', 'saisie', 'lecture'];
/** Autorise uniquement les rôles listés (admin toujours autorisé). */
export const requireRole = (...allowed) => (req, res, next) =>
  (req.user && (req.user.role === 'admin' || allowed.includes(req.user.role)) ? next() : res.status(403).json({ error: "Droits insuffisants pour cette action" }));
export const publicUser = (u) => ({ id: u._id, email: u.email, nom: u.nom, role: u.role, actif: u.actif !== false });

/** Crée le compte gestionnaire au premier démarrage (variables ADMIN_EMAIL / ADMIN_PASSWORD). */
export async function ensureAdmin() {
  // migration : l'ancien rôle unique « manager » devient « admin »
  await User.collection.updateMany({ role: 'manager' }, { $set: { role: 'admin' } });
  if (await User.countDocuments()) return;
  const prod = process.env.NODE_ENV === 'production';
  const email = process.env.ADMIN_EMAIL || (prod ? null : 'admin@flotte.local');
  const pwd = process.env.ADMIN_PASSWORD || (prod ? null : 'admin1234');
  if (!email || !pwd) throw new Error('Définissez ADMIN_EMAIL et ADMIN_PASSWORD pour créer le premier compte');
  await User.create({ email, nom: 'Gestionnaire', role: 'admin', passwordHash: await hash(pwd) });
  console.log(`[init] compte gestionnaire créé : ${email}${prod ? '' : '  (mot de passe dev : admin1234)'}`);
}
