import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models.js';
import { hash } from '../src/auth.js';

export const uri = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/suivi_flotte_test';
export async function boot() {
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await User.create({ email: 'm@test.ma', role: 'admin', passwordHash: await hash('motdepasse1') });
  const app = createApp();
  const { body } = await request(app).post('/api/auth/login').send({ email: 'm@test.ma', password: 'motdepasse1' });
  return { app, token: body.token, auth: (t) => ({ Authorization: `Bearer ${body.token}` }) };
}
export const close = async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); };
