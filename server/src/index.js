import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { ensureAdmin } from './auth.js';
import { startBackupScheduler } from './backup.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/suivi_flotte';
const port = process.env.PORT || 4000;
await mongoose.connect(uri);
await ensureAdmin();
startBackupScheduler();
createApp().listen(port, () => console.log(`[api] http://localhost:${port}  (db: ${mongoose.connection.name})`));
