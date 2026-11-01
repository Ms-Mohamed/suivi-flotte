// Point d'entrée serverless (Vercel) : toute la route /api/* passe par l'application Express.
import { connectDb } from '../server/src/connect.js';
import { createApp } from '../server/src/app.js';
import { ensureAdmin } from '../server/src/auth.js';

const app = createApp();
let ready;
async function init() {
  await connectDb();
  await ensureAdmin();
}
export default async function handler(req, res) {
  try { await (ready ||= init().catch((e) => { ready = null; throw e; })); }
  catch (e) { console.error(e); res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'Base de données indisponible' })); }
  return app(req, res);
}
