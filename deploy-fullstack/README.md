# Déploiement complet sur Vercel (API + base MongoDB Atlas)

Non utilisé par défaut : le `vercel.json` à la racine publie la **démo statique** (mode `VITE_DEMO=1`, données figées).

Pour une version avec vraie base de données :
1. Copier `api-index.js` vers `api/index.js` et `vercel.fullstack.json` vers `vercel.json` à la racine.
2. Variables Vercel : `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FILE_STORE=mongo`, `TRUST_PROXY=1`, `BACKUP_DIR=/tmp/backups`.
3. Construire le client sans `--mode demo` (`npm --prefix client run build`).
4. Jeu de démonstration : `npm run seed:demo` avec `MONGODB_URI` pointant sur Atlas.
