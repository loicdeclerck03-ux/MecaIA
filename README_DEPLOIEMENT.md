# 🚀 MecaIA V3 — Déploiement complet (Supabase + Netlify + Stripe)

Ce guide te fait passer de zéro à un site en ligne, sécurisé, prêt pour beaucoup d'utilisateurs.
Suis les phases **dans l'ordre**. Compte ~1 h la première fois.

---

## PHASE 0 — Avant de commencer

- Régénère ta clé Anthropic (l'ancienne a été exposée en clair) : console.anthropic.com → API Keys → Create. Mets la nouvelle dans `ANTHROPIC_KEY`.
- Garde sous la main : ton URL Supabase, ta clé **anon** (publique) et ta clé **service** (secrète).

---

## PHASE 1 — Base de données (Supabase → SQL Editor)

Ouvre Supabase → **SQL Editor** → **New query**. Colle et **Run** chaque fichier, **dans cet ordre** (un par un, attends « Success ») :

0. `00_DIAGNOSTIC_CASES.sql`  **← À EXÉCUTER EN PREMIER** *(crée la table des cas + l'extension pgvector — sans elle, tout le diagnostic échoue)*
1. `SUPABASE_FUNCTIONS.sql`  *(déjà dans ton repo : table diagnostic_cases + recherche)*
2. `DATABASE_FIXES.sql`  *(corrige le trigger + rend embedding optionnel)*
3. `INSERT_1500_CASES.sql`  *(optionnel : les 1500 cas)*
4. `USER_GARAGE_SCHEMA.sql`
5. `MAINTENANCE_HISTORY_SCHEMA.sql`
6. `REPAIR_MODE_SCHEMA.sql`
7. `PAYMENTS_SCHEMA.sql`
8. `EMAIL_SCHEMA.sql`
9. `HEALTH_SCORE_SCHEMA.sql`
10. `GAMIFICATION_SCHEMA.sql`
11. `STRIPE_IDEMPOTENCY.sql`
12. `TOKEN_MODEL.sql`
13. `OWNERSHIP.sql`
14. `DIAGNOSTIC_SEARCH.sql`
15. `DATA_LAYER.sql`
16. `VIN_LIMIT.sql`  *(limite 3 VIN gratuits/jour/personne)*
17. `PROMO_ADMIN.sql`  *(dashboard admin + codes promo)*
18. `RLS.sql`  *(en dernier : active la sécurité par ligne)*

### ⚠️ REMPLIR la base (indispensable, sinon la bêta ne sert à rien)
Après avoir exécuté les scripts ci-dessus (qui **créent** les tables), il faut **remplir** la base de cas de diagnostic :
- Exécute **`INSERT_1500_CASES.sql`** → insère **1500 cas réels** dans `diagnostic_cases`. C'est ÇA qui remplit ta base pour le lancement.
- Ensuite, la base **grossit toute seule** : chaque diagnostic d'un utilisateur est automatiquement enregistré.
- (Plus tard : on adaptera ton gros `MASTER_DATABASE` — DTC, pièces, recalls — pour fiabiliser pièces + VIN.)

> Le pipeline « agents scraper » (cron) reste **désactivé** en bêta : il est simulé/non aligné et créerait des doublons. On le branchera proprement avec le MASTER_DATABASE.

> Si un script dit « already exists », ce n'est pas grave (ils sont idempotents).

---

## PHASE 2 — Supabase Auth (réglages)

Supabase → **Authentication** → **Providers** → **Email** : activé.
- **Confirm email** : si activé, l'utilisateur doit confirmer par email avant de se connecter (Supabase envoie l'email tout seul). Si tu veux la connexion immédiate après inscription, désactive « Confirm email ».
- **URL Configuration** → **Site URL** : mets ton domaine (= `FRONTEND_URL`).

---

## PHASE 3 — Variables d'environnement (Netlify → Site settings → Environment)

Tu as déjà la plupart. Vérifie/ajoute :

Déjà présentes : `ANTHROPIC_KEY`, `FRONTEND_URL`, `RESEND_API_KEY`,
`STRIPE_PRICE_1CREDIT`, `STRIPE_PRICE_25CREDITS`, `STRIPE_PRICE_60CREDITS`, `STRIPE_PRICE_UNLIMITED`,
`STRIPE_PUBLIC_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_ANON`, `SUPABASE_SECRET`, `SUPABASE_URL`.

À AJOUTER :
- `EMAIL_FROM` = un expéditeur d'un **domaine vérifié dans Resend** (ex : `MecaIA <no-reply@tondomaine.com>`).
- `ANTHROPIC_MODEL` *(optionnel)* = `claude-haiku-4-5-20251001` (défaut si absent).
- `CRON_SECRET` *(optionnel)* = un secret au hasard, seulement si tu veux déclencher le pipeline à la main.
- `OWNER_EMAIL` = **ton email** (ex : loicdeclerck4020@gmail.com). C'est lui qui ouvre le **dashboard admin** et les actions promo, **vérifié côté serveur**. Indispensable pour le dashboard.

`OWNER_CODE` : n'est plus utilisé → tu peux la laisser ou la supprimer.

> `FRONTEND_URL` ne doit PAS finir par `/` (ex : `https://mecaiabyloky.netlify.app`).

---

## PHASE 4 — Code backend (repo → Netlify)

1. Place tous les fichiers `.mjs` dans `netlify/functions/` et `auth.mjs` dans `netlify/lib/`.
2. Mets `package.json` et `netlify.toml` à la racine.
3. `git add . && git commit -m "MecaIA V3 backend sécurisé" && git push`
4. Netlify déploie. Vérifie dans **Functions** que tu vois (entre autres) : `dylan_agents`, `profile_get`, `garage_get/add_vehicle/update_km/delete_vehicle/add_diagnostic`, `maintenance_add/get/alerts`, `health_score_get`, `repair_guide_get/start/update`, `gamification_stats`, `parts_compare`, `vin_lookup`, `photo_analyze`, `alerts_generate`, `email_send_verification`, `email_verify`, `stripe_checkout/verify/webhook`.

> Localement, fais `npm install` une fois pour générer `package-lock.json`.

---

## PHASE 5 — Stripe (webhook)

1. Stripe → **Developers** → **Webhooks** → **Add endpoint**.
2. URL : `https://TON-DOMAINE/.netlify/functions/stripe_webhook`
3. Événement : `checkout.session.completed`
4. Récupère le **Signing secret** de cet endpoint et vérifie qu'il correspond à `STRIPE_WEBHOOK_SECRET` dans Netlify (sinon remplace-le).
5. Vérifie que tes 4 Price IDs (`STRIPE_PRICE_*`) sont bien ceux de tes produits.

Règles jetons appliquées côté serveur :
- 1 jeton = 1 session diagnostic de **10 min** (messages Dylan/photo/alertes gratuits dans la fenêtre)
- 1 jeton = 1 comparatif de pièces
- VIN = **gratuit**
- `unlimited` = pass **30 jours** illimité (supposé **achat unique**, mode `payment`). Si ton Price est un **abonnement récurrent**, dis-le moi : je passe le mode en `subscription` et j'ajoute la gestion des renouvellements.

---

## PHASE 6 — Resend (emails)

1. Resend → **Domains** → ajoute et **vérifie** ton domaine (DNS).
2. `EMAIL_FROM` doit utiliser ce domaine.
> Sans domaine vérifié, Resend n'enverra qu'à l'adresse du propriétaire du compte (mode test).

---

## PHASE 7 — Frontend (`index.html`) — DÉJÀ MIGRÉ ✅

Bonne nouvelle : `index.html` est **déjà migré sur Supabase** (Firebase retiré, clé retirée, auth + données + IA + paiement branchés). Il te reste **2 petites choses** :

### 7.1 Remplir tes 2 valeurs publiques
Dans `index.html`, en haut du `<script type="module">`, remplace :
- `SUPABASE_URL="<<<TON_PROJECT_URL>>>"` → ton Project URL Supabase
- `SUPABASE_ANON="<<<TA_CLE_ANON_PUBLIQUE>>>"` → ta clé **anon** publique
(Les deux sont publiques, aucun risque.)

### 7.2 Brancher tes boutons d'achat
Sur tes boutons de la fenêtre de paiement, appelle :
- `buyPack('1credit')`, `buyPack('25credits')`, `buyPack('60credits')`, `buyPack('unlimited')`
Exemple : `<button onclick="buyPack('25credits')">Acheter 25 crédits</button>`
(Ça crée la session Stripe et redirige ; le webhook crédite ensuite, le solde se rafraîchit au retour.)

### 7.3 Commit & push
`git add index.html && git commit -m "Frontend Supabase migré" && git push`

> Note : le **tableau de bord propriétaire** (`loadDash`, visible par toi seul) n'est pas encore rebranché sur Supabase — sans impact pour tes testeurs. On le fera plus tard.


## PHASE 7bis — Dashboard admin & codes promo

- **Accès** : connecte-toi avec l'email = `OWNER_EMAIL` → tu arrives sur le dashboard (`s-dash`).
- **Offrir à un testeur** : entre son email → « Illimité 30 jours » ou « +50 crédits ». (Le testeur doit déjà avoir un compte.)
- **Créer un code promo** : code + type (**% réduction 1-100** à l'achat / **crédits** offerts / **illimité** en jours) + max utilisateurs (vide = illimité) + durée de validité en jours (vide = toujours).
- **Historique** : tous les codes (actifs/désactivés/expirés/épuisés), avec **Désactiver/Réactiver** à tout moment.
- **Côté testeur** : ajoute un bouton `onclick="redeemPromo()"` (ex. près des crédits) pour qu'ils saisissent un code crédits/illimité. Les codes **%** s'appliquent automatiquement à l'achat si tu passes `buyPack` avec le code (option avancée).

> Donner l'illimité à un testeur = soit via « Offrir à un testeur », soit via un code `illimité` qu'il échange avec `redeemPromo()`.

## PHASE 8 — Tests (après déploiement)

1. **Inscription** : crée un compte → tu reçois (ou pas, selon réglage) l'email de confirmation → connexion → tu arrives sur l'app.
2. **Garage** : ajoute un véhicule → il apparaît, rechargé depuis Supabase. Supprime / modifie KM → OK.
3. **Crédits** : nouveau compte = 3 crédits offerts. Fais un diagnostic → 1 crédit consommé (vérifie l'affichage). Refais un 2e diag dans les 10 min → **gratuit** (même session).
4. **VIN** : décode un VIN → gratuit, aucun crédit retiré.
5. **Pièces** : comparatif → 1 crédit retiré.
6. **Paiement (test)** : Stripe en mode test, carte `4242 4242 4242 4242` → après paiement, le **webhook** crédite le compte (vérifie le solde). Rappelle la page succès plusieurs fois → le solde **n'augmente pas** (idempotence OK).
7. **Sécurité** : essaie d'appeler une fonction sans être connecté → `401`. Essaie d'accéder au véhicule d'un autre `vehicle_id` → `403`.

---

## PHASE 9 — Passage en production

- Stripe : repasse en **Live**, mets les clés `sk_live_`/`pk_live_` et le **webhook live** (refais Phase 5 en live).
- Vérifie une dernière fois `FRONTEND_URL`.
- C'est en ligne. 🎉

---

## Inventaire des fichiers

**SQL (18, ordre Phase 1)** : SUPABASE_FUNCTIONS, DATABASE_FIXES, INSERT_1500_CASES, USER_GARAGE_SCHEMA, MAINTENANCE_HISTORY_SCHEMA, REPAIR_MODE_SCHEMA, PAYMENTS_SCHEMA, EMAIL_SCHEMA, HEALTH_SCORE_SCHEMA, GAMIFICATION_SCHEMA, STRIPE_IDEMPOTENCY, TOKEN_MODEL, OWNERSHIP, DIAGNOSTIC_SEARCH, DATA_LAYER, VIN_LIMIT, PROMO_ADMIN, RLS.

**Fonctions Netlify** (`netlify/functions/`) : dylan_agents, profile_get, garage_get, garage_add_vehicle, garage_add_diagnostic, garage_update_km, garage_delete_vehicle, maintenance_add, maintenance_get, maintenance_alerts, health_score_get, repair_guide_get, repair_start, repair_update, gamification_stats, parts_compare, vin_lookup, photo_analyze, alerts_generate, email_send_verification, email_verify, stripe_checkout, stripe_verify, stripe_webhook, orchestrator, scheduled_pipeline, scraper, cleaner, consolidator, api.

**Lib** : `netlify/lib/auth.mjs`

**Racine** : `package.json`, `netlify.toml`

**Frontend** (`frontend/`) : MECAIA_SUPABASE_MODULE.html, MECAIA_92_AUTH.js, MECAIA_93_DATA.js, MECAIA_94_AI.js

---

## Ce qui a été corrigé (résumé)

- Déploiement débloqué (`package.json` manquant).
- Paiement : prix non falsifiable (Price IDs serveur) + webhook signé + idempotence (plus de double crédit).
- Variables d'env alignées (`SUPABASE_ANON/SECRET`, `FRONTEND_URL`) — avant, tout le code Supabase recevait `undefined`.
- Auth serveur sur toutes les fonctions + contrôle de propriété (fin de l'IDOR).
- Diagnostic côté serveur (1 appel au lieu de 5), clé Anthropic sortie du navigateur, parsing JSON sécurisé.
- Modèle jetons + pass illimité (10 min/jeton, VIN gratuit).
- Emails via Resend.
- Frontend migré Firebase → Supabase (auth + données), clé en dur supprimée.
- RLS activé (défense en profondeur).

## Ce qui reste à confirmer / améliorer
- `unlimited` : confirmer achat unique vs abonnement.
- VIN via NHTSA : couverture limitée pour certains modèles européens (option : décodage IA si besoin).
- Tests de **charge** réels à faire en conditions de production.
- `lib/auth.mjs` doit être déployé dans `netlify/lib/` (pas dans `functions/`).
