import mongoose from 'mongoose';
// Connexion réutilisée entre les invocations (serverless).
export async function connectDb(uri = process.env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
}
