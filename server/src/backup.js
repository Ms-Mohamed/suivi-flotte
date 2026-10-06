import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { Truck, Entry, Operation, Settings, User } from './models.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const backupDir = () => path.resolve(process.env.BACKUP_DIR || './backups');
const NAME_RE = /^backup-\d{8}-\d{6}(-avant-restauration|-import)?\.json\.gz$/;
export const validName = (n) => typeof n === 'string' && NAME_RE.test(n);
export const backupPath = (n) => path.join(backupDir(), n);

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

async function snapshot() {
  const [trucks, entries, operations, settings, users] = await Promise.all([Truck, Entry, Operation, Settings, User].map((m) => m.collection.find({}).toArray()));
  return { app: 'suivi-flotte', version: 2, createdAt: new Date().toISOString(),
    counts: { camions: trucks.length, saisies: entries.length, operations: operations.length, utilisateurs: users.length }, data: { trucks, entries, operations, settings, users } };
}

async function uniqueName(suffix) {
  let name = `backup-${stamp()}${suffix}.json.gz`;
  for (let i = 1; await fs.access(backupPath(name)).then(() => true, () => false); i++) {
    const t = new Date(Date.now() + i * 1000); name = `backup-${stamp(t)}${suffix}.json.gz`;
  }
  return name;
}

export async function createBackup(suffix = '') {
  await fs.mkdir(backupDir(), { recursive: true });
  const snap = await snapshot();
  const name = await uniqueName(suffix);
  const file = backupPath(name);
  await fs.writeFile(`${file}.tmp`, await gzip(Buffer.from(JSON.stringify(snap))));
  await fs.rename(`${file}.tmp`, file);               // écriture atomique : jamais de fichier à moitié écrit
  await prune();
  const st = await fs.stat(file);
  return { name, size: st.size, createdAt: st.mtime.toISOString(), counts: snap.counts };
}

export async function listBackups() {
  await fs.mkdir(backupDir(), { recursive: true });
  const names = (await fs.readdir(backupDir())).filter(validName);
  const items = await Promise.all(names.map(async (name) => { const st = await fs.stat(backupPath(name)); return { name, size: st.size, createdAt: st.mtime.toISOString() }; }));
  return items.sort((a, b) => b.name.localeCompare(a.name));
}

async function prune() {
  const keep = Math.max(3, Number(process.env.BACKUP_KEEP || 30));
  const all = await listBackups();
  for (const b of all.slice(keep)) await fs.unlink(backupPath(b.name)).catch(() => {});
}

export async function parseBackup(buffer) {
  let snap;
  try { snap = JSON.parse((await gunzip(buffer)).toString('utf8')); } catch { throw Object.assign(new Error('Fichier de sauvegarde illisible ou corrompu'), { status: 400 }); }
  const d = snap?.data;
  if (snap?.app !== 'suivi-flotte' || !d || !Array.isArray(d.trucks) || !Array.isArray(d.entries) || !Array.isArray(d.settings))
    throw Object.assign(new Error("Ce fichier n'est pas une sauvegarde Suivi Flotte valide"), { status: 400 });
  return snap;
}
export async function readBackup(name) { return parseBackup(await fs.readFile(backupPath(name))); }

const oid = (v) => { if (!/^[0-9a-f]{24}$/i.test(String(v))) throw new Error('Identifiant invalide dans la sauvegarde'); return new mongoose.Types.ObjectId(String(v)); };
const dt = (v) => (v ? new Date(v) : new Date());
const conv = {
  trucks: (x) => ({ ...x, _id: oid(x._id), createdAt: dt(x.createdAt), updatedAt: dt(x.updatedAt) }),
  entries: (x) => ({ ...x, _id: oid(x._id), truck: oid(x.truck), createdAt: dt(x.createdAt), updatedAt: dt(x.updatedAt) }),
  operations: (x) => ({ ...x, _id: oid(x._id), truck: oid(x.truck), createdAt: dt(x.createdAt), updatedAt: dt(x.updatedAt),
    historique: (x.historique || []).map((h) => ({ ...h, at: h.at ? new Date(h.at) : undefined })) }),
  settings: (x) => ({ ...x, _id: oid(x._id), createdAt: dt(x.createdAt), updatedAt: dt(x.updatedAt) }),
};
const models = { trucks: Truck, entries: Entry, operations: Operation, settings: Settings };

async function replaceAll(snap) {
  // on convertit tout AVANT de toucher à la base : une sauvegarde invalide ne détruit rien
  const docs = Object.fromEntries(Object.keys(models).map((k) => [k, (snap.data[k] || []).map(conv[k])])); // anciennes sauvegardes (v1) : pas d'opérations
  for (const k of Object.keys(models)) {
    await models[k].collection.deleteMany({});
    if (docs[k].length) await models[k].collection.insertMany(docs[k]);
  }
  await Entry.syncIndexes().catch(() => {});
}

/** Restaure camions, saisies et paramètres (les comptes utilisateurs ne sont jamais touchés). */
export async function restoreSnapshot(snap) {
  const safety = await createBackup('-avant-restauration');
  try { await replaceAll(snap); }
  catch (e) { await replaceAll(await readBackup(safety.name)); throw Object.assign(new Error(`Restauration annulée, données d'origine remises en place (${e.message})`), { status: 500 }); }
  return { camions: snap.data.trucks.length, saisies: snap.data.entries.length, operations: (snap.data.operations || []).length, sauvegardeDeSecurite: safety.name };
}

export function startBackupScheduler() {
  if (process.env.BACKUP_DISABLED === '1') return;
  const hour = Number(process.env.BACKUP_HOUR ?? 2);
  const check = async () => {
    try {
      const last = (await listBackups())[0];
      const age = last ? Date.now() - new Date(last.createdAt).getTime() : Infinity;
      if (age > 24 * 3600e3 || (new Date().getHours() === hour && age > 20 * 3600e3)) {
        const b = await createBackup(); console.log(`[backup] ${b.name} (${b.counts.camions} camions, ${b.counts.saisies} saisies, ${b.counts.operations} opérations)`);
      }
    } catch (e) { console.error('[backup] échec :', e.message); }
  };
  setTimeout(check, 15_000).unref();
  setInterval(check, 3600e3).unref();
}
