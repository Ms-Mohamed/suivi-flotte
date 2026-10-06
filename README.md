# Suivi Flotte — rentabilité mensuelle par camion

Application MERN (MongoDB · Express · React · Node) qui suit, pour chaque camion, le compte de produits et charges mensuel
du document **« Situation camion »** : 3 comptes de produits (71…), 12 comptes de charges (61…), résultat brut, impôt, résultat net.

## Fidélité au document Word
`shared/plan_comptable.json` est **généré directement depuis le .docx** (`scripts/extract_schema.py`) : numéros de comptes, libellés,
modes de calcul, titres de groupes et formules viennent du fichier, pas d'une saisie manuelle. L'API, l'interface et l'export Excel lisent ce même fichier.
`shared/calc.js` contient la logique de calcul unique (utilisée par le serveur ET par l'interface) :

- Total A = somme des comptes 71 · Total B = variables + fixes + amortissements
- Ventes = km chargés × tarif au km (ou **total factures**) · Gazole = litres × prix du litre (ou montant)
- Taxe à l'essieu et amortissement = montant **annuel ÷ 12** (ou montant mensuel)
- Résultat brut = A − B · Résultat net = Brut − Impôt (T)
- Impôt T : automatique = max(IS × brut positif ; cotisation minimale × produits), ou saisi à la main. **Taux réglables dans Paramètres — à faire valider par votre comptable** (le document ne fixe pas la règle).

## Démarrage rapide (Docker)
```bash
cp .env.example .env      # puis éditez JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
# → http://localhost:4000
```

## Développement local
```bash
npm run install:all
# MongoDB doit tourner sur 127.0.0.1:27017 (ou définissez MONGODB_URI dans server/.env)
npm run dev:server          # API sur :4000 (compte dev : admin@flotte.local / admin1234)
npm run dev:client          # interface sur :5173 (proxy /api)
npm run seed:demo           # 5 camions × 12 mois de données fictives (efface les données existantes !)
npm test                    # 31 tests (calcul, API, rôles, import, sauvegardes) — nécessite MongoDB (MONGODB_URI_TEST optionnel)
```

## Fonctions
- **Tableau de bord** : produits, charges, résultat net, marge, coût/km, comparaison au mois précédent, tendance 12 mois, structure des charges, classement des camions, alertes (camions en perte / non saisis), export Excel de la flotte.
- **Camions** : fiche, chauffeur, modèle mensuel (charges fixes, taxe et dotation annuelles, tarif, prix du litre), archivage.
- **Situation camion** (par mois) : exactement la structure du Word, calcul en direct, enregistrement automatique, reprise des charges fixes du mois précédent, export Excel, impression / PDF, notes.
- **Rapport annuel** : matrice camion × mois, export CSV.
- **Sécurité** : JWT, mots de passe hachés (bcrypt), validation Zod de toutes les entrées, limitation des tentatives de connexion, Helmet.
- **Opérations datées** (menu Opérations) : chaque voyage ou dépense est saisi avec le camion et la date (plusieurs lignes par voyage : recette, gazole, péages…, trajet et km facultatifs). Le total du mois par compte = saisie de la fiche mensuelle + opérations, donc la fiche « Situation camion » reste identique au document Word. Modification et suppression conservent un historique (qui, quand, ancienne valeur) ; une suppression se restaure.
- **Journal et historique** : journal de toutes les opérations (filtres camion, dates, type, texte, export Excel) et page « Historique » par camion (résultat mois par mois, cumul, meilleur/pire mois, journal du camion).
- **Semaines** : tableau de bord hebdomadaire (lundi–dimanche) des recettes et dépenses des opérations, par camion et pour la flotte. Les charges fixes restent mensuelles : le solde hebdomadaire n'est pas le résultat net.
- **Rôles** (Paramètres → Utilisateurs) : *admin* (tout), *saisie* (saisit les montants et importe), *lecture* (consultation seule). Contrôlé côté serveur (403) et dans l'interface.
- **Import Excel** : modèle téléchargeable, aperçu ligne par ligne sans rien écrire, détection des doublons/erreurs, option « créer les camions » et « écraser ».
- **Sauvegardes** : automatiques chaque nuit (`BACKUP_HOUR`, défaut 2 h) dans `./backups`, conservation `BACKUP_KEEP` (30), manuelles, téléchargeables, restauration (confirmation « RESTAURER », sauvegarde de sécurité préalable). Les comptes utilisateurs ne sont jamais écrasés. Copiez le dossier `backups` hors de l'ordinateur régulièrement.

## Limites connues
- Impôt automatique : max(IS × résultat brut positif ; cotisation minimale × produits) — hypothèse à faire valider par le comptable ; la saisie manuelle reste possible.
- Les montants négatifs (avoirs) sont refusés pour éviter les fautes de frappe.
- Les tests ont été exécutés contre FerretDB (compatible MongoDB) dans l'environnement de génération ; relancez `npm test` sur votre MongoDB.
