# 🚗 MecaIA V3 — GUIDE COMPLET (tout ce que tu dois faire)

Ce document explique **absolument tout**, de A à Z, pour mettre le site en ligne et le faire tester.
Lis-le dans l'ordre. Coche chaque étape au fur et à mesure.

---

## 0. CE QUE TU AS ENTRE LES MAINS

MecaIA est une plateforme de **diagnostic auto par IA** (l'assistant « Dylan »), avec garage,
historique d'entretien, comparateur de pièces, décodeur VIN, paiements, et un **tableau de bord
propriétaire** (pour toi) avec des **codes promo**.

L'archive `MecaIA-V3-COMPLET.zip` contient **tout le site**. Le fichier de remplissage de la base
`INSERT_1500_CASES.sql` (~44 Mo) est fourni **séparément** (trop gros pour le zip).

### Les briques (qui fait quoi)
- **Frontend** : `index.html` — la page du site (interface utilisateur). Hébergée par **Netlify**.
- **Backend** : `netlify/functions/*.mjs` — la logique serveur (diagnostic, paiement, garage…).
- **Base de données + comptes** : **Supabase** (PostgreSQL + Auth).
- **Paiement** : **Stripe**.
- **Emails** : **Resend**.
- **IA** : **Anthropic** (Claude) — utilisé côté serveur uniquement.

### État honnête (à savoir avant de lancer)
- ✅ Prêt pour une **bêta** (faire tester par de vraies personnes).
- ⚠️ Le **comparateur de pièces** et le **VIN européen** sont **indicatifs** (pas une base
  officielle). On les fiabilisera plus tard avec ton `MASTER_DATABASE`.
- ⚠️ Les **« agents scraper » (cron) restent désactivés** en bêta (données simulées → doublons).
- ⚠️ Les tests **en conditions réelles** (Stripe, Supabase, montée en charge) se font **après**
  le déploiement.

---

## 1. INVENTAIRE DES FICHIERS

```
MecaIA-V3/
├── index.html                  → le site (déjà migré sur Supabase, clé retirée)
├── package.json                → dépendances backend (npm install)
├── netlify.toml                → config Netlify (build + cron, cron désactivable)
├── README_DEPLOIEMENT.md        → version courte du déploiement
├── GUIDE_COMPLET.md             → CE document
├── RAPPORT_SIMULATION.txt       → résultat des vérifications statiques
│
├── sql/                        → à exécuter dans Supabase, DANS L'ORDRE 00 → 18
│   ├── 00_DIAGNOSTIC_CASES.sql       (table des cas + extension pgvector) ← EN PREMIER
│   ├── 01_SUPABASE_FUNCTIONS.sql     (recherche + trigger)
│   ├── 02_DATABASE_FIXES.sql
│   ├── 03_INSERT_1500_CASES__A_EXECUTER.txt  (note : lance le vrai .sql fourni à part)
│   ├── 04_USER_GARAGE_SCHEMA.sql
│   ├── 05_MAINTENANCE_HISTORY_SCHEMA.sql
│   ├── 06_REPAIR_MODE_SCHEMA.sql
│   ├── 07_PAYMENTS_SCHEMA.sql
│   ├── 08_EMAIL_SCHEMA.sql
│   ├── 09_HEALTH_SCORE_SCHEMA.sql
│   ├── 10_GAMIFICATION_SCHEMA.sql
│   ├── 11_STRIPE_IDEMPOTENCY.sql
│   ├── 12_TOKEN_MODEL.sql            (jetons : session diag 10 min, illimité, etc.)
│   ├── 13_OWNERSHIP.sql              (anti-vol de données entre utilisateurs)
│   ├── 14_DIAGNOSTIC_SEARCH.sql      (recherche de cas par mots-clés)
│   ├── 15_DATA_LAYER.sql             (profils, garage enrichi…)
│   ├── 16_VIN_LIMIT.sql              (3 VIN gratuits/jour/personne)
│   ├── 17_PROMO_ADMIN.sql           (dashboard admin + codes promo)
│   └── 18_RLS.sql                   (sécurité par ligne ; EN DERNIER)
│
├── netlify/
│   ├── lib/auth.mjs             → vérification du compte (JWT), CORS, contrôle propriétaire
│   └── functions/              → 32 fonctions serveur, dont :
│       ├── dylan_agents.mjs          (le diagnostic IA)
│       ├── parts_compare.mjs         (comparateur de pièces, 1 jeton)
│       ├── vin_lookup.mjs            (décodeur VIN gratuit, 3/jour)
│       ├── photo_analyze.mjs         (analyse photo)
│       ├── alerts_generate.mjs       (alertes)
│       ├── garage_*.mjs              (garage : véhicules, km…)
│       ├── maintenance_*.mjs         (entretien)
│       ├── health_score_get.mjs      (score de santé du véhicule)
│       ├── repair_*.mjs              (mode réparation guidée)
│       ├── profile_get.mjs           (profil + crédits)
│       ├── stripe_checkout.mjs       (crée le paiement, applique un code %)
│       ├── stripe_webhook.mjs        (crédite après paiement — sécurisé)
│       ├── stripe_verify.mjs         (lecture seule)
│       ├── email_send_verification.mjs / email_verify.mjs (emails)
│       ├── admin.mjs                 (dashboard : stats, codes promo, octrois)
│       ├── promo_redeem.mjs          (un utilisateur échange un code)
│       ├── gamification_stats.mjs
│       ├── orchestrator/scraper/cleaner/consolidator/scheduled_pipeline.mjs (pipeline, OFF en bêta)
│       └── api.js                   (ancien point d'entrée, conservé)
│
└── frontend/                   → blocs source de la migration (référence ; déjà intégrés dans index.html)
```

---

## 2. LES VARIABLES D'ENVIRONNEMENT (à mettre dans Netlify)

Ce sont les « réglages secrets » du site. Tu les colleras dans Netlify (Phase 4).
**Ne les mets jamais dans le code public.**

| Variable | À quoi ça sert | Où la trouver |
|---|---|---|
| `SUPABASE_URL` | Adresse de ta base Supabase | Supabase → Project Settings → API |
| `SUPABASE_ANON` | Clé publique (vérifie les comptes) | Supabase → API → « anon public » |
| `SUPABASE_SECRET` | Clé service (accès serveur complet) | Supabase → API → « service_role » (SECRÈTE) |
| `ANTHROPIC_KEY` | Clé IA (diagnostic) | console.anthropic.com → API Keys |
| `ANTHROPIC_MODEL` *(option)* | Modèle utilisé | défaut : `claude-haiku-4-5-20251001` |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe | dashboard.stripe.com → Developers → API keys |
| `STRIPE_PUBLIC_KEY` | Clé publique Stripe | idem (pk_...) |
| `STRIPE_WEBHOOK_SECRET` | Signe les notifications de paiement | créé en Phase 5 (whsec_...) |
| `STRIPE_PRICE_1CREDIT` | ID du prix « 1 crédit » | Stripe → Products → ton prix (price_...) |
| `STRIPE_PRICE_25CREDITS` | ID du prix « 25 crédits » | idem |
| `STRIPE_PRICE_60CREDITS` | ID du prix « 60 crédits » | idem |
| `STRIPE_PRICE_UNLIMITED` | ID du prix « illimité 30 j » | idem |
| `FRONTEND_URL` | Adresse publique du site | ton URL Netlify (ex : https://mecaia.netlify.app) |
| `RESEND_API_KEY` | Envoi d'emails | resend.com → API Keys |
| `EMAIL_FROM` | Adresse d'expédition des emails | une adresse de **ton domaine vérifié** chez Resend |
| `OWNER_EMAIL` | **Ouvre ton dashboard admin** | **ton email** (ex : loicdeclerck4020@gmail.com) |
| `CRON_SECRET` *(option)* | Protège le pipeline cron | une chaîne au hasard (seulement si tu actives le cron) |

> `OWNER_CODE` n'est plus utilisé (l'ancien code l'avait en dur, on l'a retiré). Tu peux l'ignorer.
> C'est **`OWNER_EMAIL`** qui donne l'accès admin, vérifié côté serveur.

---

## 3. DÉPLOIEMENT — PAS À PAS

### PHASE 0 — Sécurité (5 min, à faire en premier)
Ton ancienne clé Anthropic avait été mise dans le code public. **Régénère-la** :
1. Va sur console.anthropic.com → API Keys.
2. Révoque l'ancienne, crée-en une nouvelle.
3. Garde-la de côté (tu la colleras dans Netlify en Phase 4).

### PHASE 1 — Supabase : créer la base (20 min)
1. Crée un compte sur **supabase.com**, puis un **nouveau projet** (note bien le mot de passe DB).
2. Ouvre **SQL Editor** (menu de gauche).
3. Exécute les scripts du dossier `sql/` **dans l'ordre, un par un** : ouvre le fichier,
   copie tout, colle dans l'éditeur, clique **Run**. Ordre :
   `00 → 01 → 02 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18`.
   - **`00` d'abord, toujours** (sinon le diagnostic n'a pas de table → tout casse).
   - Si un script renvoie « already exists », ce n'est pas grave (c'est idempotent).
4. **REMPLIS la base** : ouvre **`INSERT_1500_CASES.sql`** (le gros fichier fourni à part),
   colle-le dans le SQL Editor, **Run**. → 1500 cas réels insérés.
   - Vérifie : `SELECT count(*) FROM diagnostic_cases;` doit renvoyer ~1500.

### PHASE 2 — Supabase : comptes (Auth) (5 min)
1. Menu **Authentication → Providers** : active **Email** (mot de passe).
2. **Authentication → URL Configuration** : mets ton URL Netlify dans « Site URL » et
   « Redirect URLs » (ex : `https://mecaia.netlify.app`). (Tu reviendras l'ajuster après Phase 4.)

### PHASE 3 — Récupérer toutes les clés (10 min)
Ouvre un bloc-notes et note :
- Supabase : `SUPABASE_URL`, `SUPABASE_ANON`, `SUPABASE_SECRET` (Project Settings → API).
- Stripe : `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, et les 4 `STRIPE_PRICE_*`
  (crée 4 produits/prix dans Stripe : 1 crédit, 25, 60, illimité 30 j — mode **paiement unique**).
- Anthropic : la nouvelle `ANTHROPIC_KEY`.
- Resend : `RESEND_API_KEY` + une adresse `EMAIL_FROM` (Phase 6).
- `OWNER_EMAIL` = ton email.

### PHASE 4 — Netlify : déployer (20 min)
1. Mets le code sur **GitHub** (un dépôt avec le contenu de `MecaIA-V3/`).
2. Sur **netlify.com** : « Add new site → Import from Git » → choisis ton dépôt.
3. Build : Netlify détecte `netlify.toml`. (Functions dans `netlify/functions`.)
4. **Site settings → Environment variables** : ajoute **toutes** les variables de la section 2.
5. Lance `npm install` en local une fois (pour figer les versions), puis pousse.
6. Déploie. Note ton URL (ex : `https://xxxx.netlify.app`) → c'est ton `FRONTEND_URL`
   (remets-la à jour dans les variables ET dans Supabase Auth, Phase 2).

### PHASE 5 — Stripe : webhook (10 min)
Le webhook crédite l'utilisateur **après** un vrai paiement (c'est la partie sécurisée).
1. Stripe → Developers → **Webhooks** → « Add endpoint ».
2. URL : `https://TON-SITE/.netlify/functions/stripe_webhook`
3. Événement à écouter : **`checkout.session.completed`**.
4. Copie le **Signing secret** (`whsec_...`) → mets-le dans `STRIPE_WEBHOOK_SECRET` (Netlify).
5. Redéploie.

### PHASE 6 — Resend : emails (10 min)
1. Sur resend.com, **vérifie ton domaine** (DNS).
2. Mets une adresse de ce domaine dans `EMAIL_FROM` (ex : `no-reply@tondomaine.com`).
3. Mets ta `RESEND_API_KEY`. Redéploie.

### PHASE 7 — index.html : 2 valeurs + 2 branchements (10 min)
`index.html` est **déjà migré**. Il reste :
1. **Remplir 2 valeurs publiques** (en haut du `<script type="module">`) :
   - `SUPABASE_URL="<<<TON_PROJECT_URL>>>"` → ton URL Supabase.
   - `SUPABASE_ANON="<<<TA_CLE_ANON_PUBLIQUE>>>"` → ta clé anon.
   *(Ces 2 valeurs sont publiques, aucun risque.)*
2. **Boutons d'achat** : fais en sorte que tes boutons appellent
   `buyPack('1credit')`, `buyPack('25credits')`, `buyPack('60credits')`, `buyPack('unlimited')`.
   Exemple : `<button onclick="buyPack('25credits')">Acheter 25 crédits</button>`.
3. **Bouton « code promo »** (pour les testeurs) : ajoute quelque part
   `<button onclick="redeemPromo()">J'ai un code</button>`.
4. Commit + push. Netlify redéploie automatiquement.

### PHASE 8 — Tests (checklist)
- [ ] Je peux **créer un compte** et me connecter.
- [ ] J'ai mes **crédits offerts** à l'inscription.
- [ ] Je peux **ajouter un véhicule** au garage.
- [ ] Je peux lancer un **diagnostic** (Dylan répond).
- [ ] Le **VIN** fonctionne (et bloque au 4ᵉ essai du jour).
- [ ] Le **comparateur de pièces** consomme 1 jeton.
- [ ] Un **achat test** Stripe crédite bien le compte (via le webhook).
- [ ] Connecté avec `OWNER_EMAIL`, j'arrive sur le **dashboard**.

### PHASE 9 — Dashboard admin & codes promo (usage)
Connecte-toi avec l'email = `OWNER_EMAIL` → tu arrives sur le tableau de bord.
- **Monitoring** : nombre d'utilisateurs, diagnostics, illimités actifs, codes actifs.
- **Offrir à un testeur** : entre son email → « Illimité 30 jours » ou « +50 crédits ».
  *(Le testeur doit déjà avoir un compte.)*
- **Créer un code promo** : choisis le type
  (**% de réduction 1–100** appliqué à l'achat / **crédits** offerts / **illimité en jours**),
  le **nombre max d'utilisateurs**, et la **durée de validité**.
- **Historique** : tous les codes (actifs / désactivés / expirés / épuisés),
  avec **Désactiver / Réactiver** quand tu veux.

---

## 4. COMMENT DONNER DE L'ILLIMITÉ À TES TESTEURS

Deux façons :
1. **Direct** (dashboard → « Offrir à un testeur ») : entre l'email du testeur → « Illimité 30 jours ».
2. **Par code** : crée un code de type « illimité » (ex : `TESTEUR2026`, 30 jours, max 50 personnes),
   donne-le à tes testeurs ; ils cliquent « J'ai un code » et le saisissent.

---

## 5. LIMITES HONNÊTES (à dire à tes testeurs)
- **Pièces** : les références sont **indicatives** (générées par l'IA), pas une base officielle.
- **VIN** : gratuit (NHTSA), mais **faible en Europe**. À fiabiliser plus tard.
- **Pipeline scraper** : **désactivé** (simulé). La base se remplit via les 1500 cas + l'usage réel.
- Ce n'est pas (encore) un produit « 100 000 utilisateurs » blindé : il faut les tests live + un
  test de charge avant un grand lancement.

---

## 6. PLUS TARD — Intégrer ton MASTER_DATABASE
Ton `MASTER_DATABASE.zip` contient de **vraies données** :
- `DTC_CODES.csv` (codes pannes OBD), `PARTS.csv` (pièces), `RECALLS.csv` (rappels),
  `VEHICLES.csv` (véhicules), versions enrichies, TSB.

Quand tu voudras, on l'adaptera à notre schéma pour :
- fiabiliser le **comparateur de pièces** (vraies références),
- enrichir le **diagnostic** (codes DTC réels + rappels),
- améliorer le **VIN**.

---

## 7. DÉPANNAGE (erreurs fréquentes)
- **« relation diagnostic_cases does not exist »** → tu n'as pas exécuté `00` en premier. Lance-le.
- **Le diagnostic ne trouve aucun cas similaire** → tu n'as pas lancé `INSERT_1500_CASES.sql`.
- **403 sur le dashboard** → `OWNER_EMAIL` n'est pas réglé (ou pas le bon email).
- **Le paiement ne crédite pas** → le **webhook Stripe** n'est pas configuré (Phase 5) ou
  `STRIPE_WEBHOOK_SECRET` est faux.
- **Emails non reçus** → domaine Resend non vérifié, ou `EMAIL_FROM` n'est pas du bon domaine.
- **« Unauthorized » partout** → `SUPABASE_ANON` / `SUPABASE_URL` faux dans `index.html` ou Netlify.

---

## 8. RÉSUMÉ ULTRA-COURT (si tu es pressé)
1. Régénère la clé Anthropic.
2. Supabase : exécute `00 → 18`, puis **`INSERT_1500_CASES.sql`**.
3. Supabase Auth : active Email + mets ton URL.
4. Netlify : pousse le code + colle **toutes** les variables (dont `OWNER_EMAIL`, `EMAIL_FROM`).
5. Stripe : crée le webhook `checkout.session.completed` → `STRIPE_WEBHOOK_SECRET`.
6. Resend : vérifie le domaine → `EMAIL_FROM`.
7. `index.html` : remplis `SUPABASE_URL` + `SUPABASE_ANON`, branche `buyPack(...)` et `redeemPromo()`.
8. Teste avec la checklist (Phase 8).

Bon déploiement. 🚀
