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
npm run dev:server          # API sur :4000 (compte dev : admin@flotte.local, mot de passe = ADMIN_PASSWORD de server/.env)
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

## Mois de bascule (Paramètres)

Dans **Paramètres → Mode opérations**, la direction choisit un mois de bascule. À partir de ce mois, les produits et les 5 charges variables viennent **uniquement des opérations datées** (la fiche mensuelle garde les charges fixes, amortissements, taxe annuelle et impôt). Avant ce mois, rien ne change. Vide = jamais. Modifier la date recalcule immédiatement les mois concernés. Si une opération est saisie pour un compte qui a déjà un montant tapé à la main dans la fiche d'un mois non basculé, un avertissement signale le risque de double comptage.

## Semaines et charges fixes

Le tableau **Semaines** (lundi→dimanche) peut répartir les charges fixes + amortissements du mois par jour (case « Répartir les charges fixes »). Il faut une fiche mensuelle pour que les charges fixes apparaissent ; sinon un avertissement s'affiche. Résultat hebdomadaire avant impôt.

## Rapport global

Menu **Rapport global** : période au choix (max 60 mois), comparaison avec la période précédente, classement des camions, charges et produits par poste, trajets, alertes. Impression PDF depuis le navigateur ou export Excel (Synthèse, Par camion, Par mois, Par poste, Trajets). Le mois en cours est provisoire.

## Gasoil (pleins et surconsommation)

Menu **Gasoil** : chaque plein est saisi avec le camion, la date, le **kilométrage du compteur**, les litres, le prix du litre (ou le montant total), le chauffeur, le N° de bon, la source (cuve interne / station externe) et la station. Le montant alimente automatiquement le compte « Gazole & AdBlue » du camion au jour saisi (donc le résultat du camion, les semaines, le rapport global et l'historique).

La consommation est calculée par la méthode **plein à plein** : litres du plein ÷ km parcourus depuis le plein précédent du même camion × 100. Elle est comparée à la **consommation théorique** (champ « Consommation théorique » de la fiche camion, en L/100 km). Statuts : *Normal*, *Surconsommation* (au-dessus de la référence + le seuil réglé dans Paramètres, 10 % par défaut), *Suspect* (valeur incohérente, probablement une faute de saisie), *Non évalué* (premier plein ou kilométrage inférieur au plein précédent) et *Sans référence* (théorique non renseignée). Le surcoût estimé = litres en trop × prix du litre. Limite : la méthode suppose que le réservoir est rempli à chaque plein.

## Maintenance

Menu **Maintenance** : un tableau de bord (coût par mois, camions les plus coûteux, par catégorie, préventif/curatif), la liste des **interventions** (date, camion, type préventive/curative, catégorie, garage, km, montant, description) et les **plans d'entretien** (ex. vidange tous les 30 000 km ou 180 jours). Chaque intervention alimente le compte « Maintenance & Réparations » (ou « Pneumatiques » pour la catégorie pneus) du camion. Une intervention remet à jour les plans de la même catégorie sur ce camion. Alerte « Bientôt » à 15 jours ou 1 000 km de l'échéance, « En retard » au-delà. Le kilométrage actuel d'un camion est le relevé le plus récent (plein ou intervention).

Les pleins et interventions sont stockés comme des opérations datées : ils apparaissent dans le journal (badges « plein » / « entretien »), se corrigent depuis leur page (historique conservé), se suppriment doucement et sont inclus dans les sauvegardes. Les plans d'entretien sont aussi sauvegardés.

## Missions, facturation, caisse (menu Exploitation / Facturation)

- **Missions** : client, BL, trajet, tonnage × prix ou forfait, frais de chargement / déchargement / immobilisation, camion et chauffeur, charges (péages, frais de route…). Une mission **interne « Terminée »** crée automatiquement sa recette et ses charges dans les opérations du camion (donc dans le résultat, les semaines et les rapports) ; elle ne compte jamais deux fois. Une mission **sous-traitée** ne passe pas dans le résultat des camions : sa marge propre = montant client − coût sous-traitant − charges (page Rentabilité).
- **Factures** : brouillon (modifiable) → **émise** (numéro définitif `F-0001-2026` attribué à l'émission, plus de modification) → règlements (jamais au-delà du reste dû) et **avoirs** (jamais au-delà du TTC). Création depuis des missions/locations terminées, TVA calculée par taux sur la base remisée, montant en lettres, impression / PDF. Les règlements en espèces, les dépenses en espèces et les paies en espèces alimentent la **caisse** automatiquement. Pas de module banque.
- Devis (convertibles en facture), bons de livraison (depuis une mission), relevé des règlements clients, relevé des missions d'un client, dépenses, rentabilité par mission / client / véhicule.
- **Coordonnées de l'entreprise** (Paramètres) : adresse, ICE, IF, RC, patente, CNSS, RIB et mentions légales, reprises en en-tête / pied des documents. À faire valider par votre comptable (mentions obligatoires, numérotation, TVA).

## Sous-traitance et achats

- Sous-traitants, véhicules des sous-traitants (matricules), opérations (missions sous-traitées avec marge), **rapport tonnage** par sous-traitant et matricule, suivi des paiements (dû / payé / reste).
- Fournisseurs, articles & services, achats (lignes, TVA, remise), paiements fournisseurs, relevé des achats.

## RH et paie (administrateur uniquement)

Employés, contrats (alertes de fin de CDD à 30 jours), pointage (y compris en lot), avances (remboursement mensuel déduit à la validation), primes / retenues, et **paie** : générer → saisir l'IR → valider (verrouille le pointage de la période) → payer (caisse si espèces) → bulletin imprimable. Les taux CNSS 4,48 % (plafond 6 000 DHS), AMO 2,26 % et la majoration des heures supplémentaires (25 %) sont modifiables (bouton « Taux »). **Les calculs de paie sont une aide : faites-les valider par votre comptable ; l'IR se saisit à la main.**
Depuis la page **Gasoil**, une surconsommation (ou une économie) peut être transférée en **retenue (ou prime)** sur la paie du chauffeur.

## Flotte étendue

Documents véhicules (carte grise, assurance, visite technique, vignette…) avec **scan** (PDF/JPG/PNG/WEBP, 10 Mo) et alertes à 30 / 15 / 7 jours ; **disponibilité** (disponible, mission, location, maintenance, documents expirés) ; **calendrier** mensuel ; **locations de camions** (jour / heure / forfait) et rapport des heures ; **pannes** (une panne immobilisante rend le camion indisponible) ; **pièces & stock** avec seuil d'alerte. Fiche camion : type, capacité, places, mise en service.

Les scans sont stockés dans `./uploads` (volume Docker) — **ils ne sont pas inclus dans les sauvegardes de l'application** : copiez ce dossier avec vos sauvegardes. Toutes les autres données (modules ci-dessus compris) sont dans les sauvegardes.
