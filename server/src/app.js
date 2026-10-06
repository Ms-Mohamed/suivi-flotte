import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { buildRouter } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
  app.use(express.json({ limit: '200kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', buildRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable' }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'donnée'} : ${i.message}`).join(' ; ') });
    if (err?.code === 11000) return res.status(409).json({ error: 'Cette immatriculation existe déjà' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  });
  return app;
}
