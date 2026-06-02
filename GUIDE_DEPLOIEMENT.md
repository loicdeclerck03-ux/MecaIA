# ============================================================
# MECAIA — GUIDE DE DÉPLOIEMENT COMPLET
# Lis tout avant de commencer. Suit dans l'ordre.
# ============================================================

## RÉSUMÉ DES FICHIERS À METTRE EN LIGNE

```
À la racine du projet GitHub :
├── index.html              ← remplace l'ancien
├── netlify.toml            ← nouveau
├── .gitignore              ← nouveau
├── README.md               ← nouveau (propre, sans secrets)
├── .env.example            ← nouveau (modèle, pas les vraies valeurs)
└── netlify/
    └── functions/
        ├── api.js              ← nouveau
        ├── stripe-checkout.js  ← nouveau
        ├── stripe-webhook.js   ← nouveau
        └── send-email.js       ← nouveau

À faire dans Supabase (SQL Editor) :
├── supabase/schema.sql     ← créer les tables
└── supabase/functions.sql  ← créer les fonctions SQL
```

---

## ÉTAPE 1 — SUPABASE (base de données)

### 1A. Ouvrir Supabase
1. Va sur https://supabase.com/dashboard
2. Sélectionne ton projet **meca-ia-dec38** (ou crée-en un nouveau)
3. Clique sur **SQL Editor** dans le menu gauche

### 1B. Exécuter schema.sql
1. Clique sur **New query**
2. Copie-colle TOUT le contenu de `supabase/schema.sql`
3. Clique sur **Run** (▶)
4. Tu dois voir "Success" en vert

### 1C. Exécuter functions.sql
1. Clique sur **New query** (nouvelle)
2. Copie-colle TOUT le contenu de `supabase/functions.sql`
3. Clique sur **Run** (▶)
4. Tu dois voir "Success" en vert

### 1D. Vérifier les tables créées
Dans **Table Editor**, tu dois voir :
- users
- cars
- diagnostics
- transactions
- promo_codes
- used_promos
- team_members
- chat_messages

### 1E. Récupérer les clés Supabase
Va dans **Settings → API** et note :
- **Project URL** → c'est SUPABASE_URL
- **anon (public)** → c'est SUPABASE_ANON_KEY
- **service_role** → c'est SUPABASE_SECRET ⚠️ NE JAMAIS PARTAGER

### 1F. Configurer l'auth Supabase
Va dans **Authentication → Settings** :
- **Site URL** : https://euphonious-frangollo-da0cc1.netlify.app
- **Redirect URLs** : ajoute https://euphonious-frangollo-da0cc1.netlify.app/**
- **Email confirmation** : désactiver pour commencer (ou activer si tu veux)

---

## ÉTAPE 2 — NETLIFY (variables d'environnement)

### 2A. Ouvrir Netlify
1. Va sur https://app.netlify.com
2. Sélectionne le site **MecaIA**

### 2B. Ajouter les variables d'environnement
1. Clique **Site configuration** (ou Site settings)
2. Clique **Environment variables**
3. Ajoute CHAQUE variable une par une :

| Nom | Valeur | Source |
|-----|--------|--------|
| ANTHROPIC_KEY | sk-ant-... | console.anthropic.com → API Keys |
| SUPABASE_URL | https://xxx.supabase.co | Supabase → Settings → API |
| SUPABASE_ANON_KEY | eyJ... (anon/public) | Supabase → Settings → API |
| SUPABASE_SECRET | eyJ... (service_role) | Supabase → Settings → API |
| STRIPE_PUBLIC_KEY | pk_live_... | Stripe → Developers → API Keys |
| STRIPE_SECRET_KEY | sk_live_... | Stripe → Developers → API Keys |
| STRIPE_WEBHOOK_SECRET | whsec_... | Stripe → Developers → Webhooks |
| STRIPE_PRICE_1CREDIT | price_1TbQ... | Stripe → Products |
| STRIPE_PRICE_25CREDITS | price_1TbQ... | Stripe → Products |
| STRIPE_PRICE_60CREDITS | price_1TbQ... | Stripe → Products |
| STRIPE_PRICE_UNLIMITED | price_1TbQ... | Stripe → Products |
| RESEND_API_KEY | re_... | resend.com → API Keys |
| OWNER_CODE | LOIC2024 | (ton code perso) |
| FRONTEND_URL | https://euphonious-frangollo-da0cc1.netlify.app | (l'URL du site) |

⚠️ Scope de chaque variable : **All scopes** (Builds + Functions + Runtime)

---

## ÉTAPE 3 — STRIPE (webhook)

### 3A. Configurer le webhook Stripe
1. Va sur https://dashboard.stripe.com
2. Clique **Developers → Webhooks**
3. Clique **Add endpoint**
4. URL : `https://euphonious-frangollo-da0cc1.netlify.app/stripe-webhook`
5. Events à écouter :
   - `checkout.session.completed` ✅
   - `charge.refunded` ✅
6. Clique **Add endpoint**
7. Copie le **Signing secret** (whsec_...) → c'est STRIPE_WEBHOOK_SECRET dans Netlify

---

## ÉTAPE 4 — GITHUB (pousser les fichiers)

### 4A. Méthode 1 : Via GitHub Desktop (plus simple)
1. Ouvre GitHub Desktop
2. Sélectionne le repo MecaIA
3. Glisse-dépose les nouveaux fichiers dans le dossier du projet
4. Tu verras les changements dans GitHub Desktop
5. Écris un message de commit : "🔒 Migration Supabase + Backend sécurisé"
6. Clique **Commit to main**
7. Clique **Push origin**

### 4B. Méthode 2 : Via le terminal
```bash
cd /chemin/vers/MecaIA

# S'assurer qu'on est sur le bon repo
git remote -v

# Ajouter tous les fichiers
git add .

# Vérifier ce qui va être commit (IMPORTANT)
git status

# Commit
git commit -m "🔒 Migration Supabase + Backend sécurisé"

# Push
git push origin main
```

### 4C. Vérifier sur GitHub
Va sur https://github.com/loicdeclerck03-ux/MecaIA
- Tu dois voir les nouveaux fichiers
- VÉRIFIE qu'il n'y a AUCUNE clé API dans les fichiers !

---

## ÉTAPE 5 — VÉRIFIER LE DÉPLOIEMENT

### 5A. Netlify redéploie automatiquement
1. Va sur https://app.netlify.com → ton site
2. Clique **Deploys**
3. Attends que le déploiement soit **Published** (vert)
4. Si erreur → clique sur le déploiement pour voir les logs

### 5B. Erreurs courantes et solutions

| Erreur | Solution |
|--------|----------|
| "secrets detected" | Vérifier README.md et fichiers — retirer les clés |
| "function not found" | Vérifier que netlify/functions/ existe et est bien pushé |
| "ANTHROPIC_KEY undefined" | Vérifier les variables Netlify (scope = All) |
| "Build failed" | Vérifier netlify.toml — command = "echo 'no build'" |
| Page blanche | Ouvrir DevTools → Console → voir l'erreur JS |

---

## ÉTAPE 6 — TESTER

### 6A. Test inscription
1. Va sur le site
2. Clique "COMMENCER"
3. Crée un compte avec un vrai email
4. Vérifie dans Supabase → Table Editor → users → tu dois voir le nouvel utilisateur

### 6B. Test diagnostic
1. Connecte-toi
2. Va dans DIAGNOSTIC
3. Remplis le formulaire
4. Clique "DIAGNOSTIC IA (1 crédit)"
5. Tu dois voir un résultat IA après quelques secondes

### 6C. Test VIN
1. Va dans VIN
2. Entre : VF1JZS0AE51140932
3. Clique DÉCODER
4. Tu dois voir les infos du véhicule (GRATUIT, sans crédit)

### 6D. Test paiement (commence par 1€)
1. Clique sur les crédits (🪙)
2. Sélectionne "1 crédit - 1€"
3. Clique PAYER
4. Tu es redirigé vers Stripe
5. Entre la carte de test : 4242 4242 4242 4242 / 12/28 / 123
6. Valide → retour sur le site → toast "Paiement confirmé"
7. Vérifie dans Supabase → transactions → 1 ligne

### 6E. Activer les crédits illimités (toi)
1. Connecte-toi avec loicdeclerck4020@gmail.com
2. Clique sur les crédits
3. Descends à "CODE PROPRIÉTAIRE"
4. Entre : LOIC2024
5. Tu as les crédits illimités

---

## DÉPANNAGE RAPIDE

```
Site ne charge pas
→ Netlify actif ? Plan payant ? DNS OK ?

Page reste blanche après connexion
→ DevTools → Console → quelle erreur ?
→ Souvent : variable d'env manquante (SUPABASE_URL)

"Non authentifié" sur les appels API
→ SESSION non transmise → vérifier init() dans index.html

Paiement ne crédite pas
→ Webhook configuré dans Stripe ?
→ STRIPE_WEBHOOK_SECRET correct dans Netlify ?

Emails non envoyés
→ RESEND_API_KEY correcte ?
→ Domaine vérifié dans Resend ?

Déploiement bloqué "secrets detected"
→ Chercher dans README.md, .env.example
→ Ajouter SECRETS_SCAN_OMIT_PATHS dans netlify.toml
```

---

## CONTACTS

- **Loïc** : loicdeclerck4020@gmail.com
- **Supabase** : supabase.com/dashboard
- **Netlify** : app.netlify.com
- **Stripe** : dashboard.stripe.com
- **Resend** : resend.com
- **Anthropic** : console.anthropic.com

---

*MecaIA — Loïc Declerck, Belgique 🇧🇪 — Mai 2026*
