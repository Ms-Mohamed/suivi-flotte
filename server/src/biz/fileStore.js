// Stockage des pièces jointes : disque (UPLOAD_DIR) par défaut, MongoDB si FILE_STORE=mongo
// (hébergements sans disque persistant, ex. Vercel).
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

const useMongo = () => process.env.FILE_STORE === 'mongo';
export const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');

const FileBlob = mongoose.models.FileBlob || mongoose.model('FileBlob', new mongoose.Schema({ _id: String, data: Buffer }, { collection: 'fileblobs', versionKey: false }));

export async function putFile(name, buf) {
  if (useMongo()) { await FileBlob.updateOne({ _id: name }, { $set: { data: buf } }, { upsert: true }); return; }
  await fs.mkdir(uploadDir(), { recursive: true });
  await fs.writeFile(path.join(uploadDir(), name), buf);
}
export async function getFile(name) {
  const n = path.basename(name);
  if (useMongo()) { const d = await FileBlob.findById(n).lean(); if (!d) throw new Error('not found'); return Buffer.from(d.data.buffer ?? d.data); }
  return fs.readFile(path.join(uploadDir(), n));
}
export async function delFile(name) {
  const n = path.basename(name);
  if (useMongo()) { await FileBlob.deleteOne({ _id: n }); return; }
  await fs.unlink(path.join(uploadDir(), n)).catch(() => {});
}
