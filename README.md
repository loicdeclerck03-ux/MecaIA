# 🔧 MecaIA V1 — Documentation Loïc

## 📦 Contenu du projet

```
mecaia-v1/
├── index.html                          # Frontend complet (l'app)
├── netlify.toml                        # Configuration Netlify
├── README.md                           # Ce fichier
└── netlify/functions/
    ├── api.js                          # Backend IA Dylan + RAG + VIN + Urgence + Photo
    ├── stripe-checkout.js              # Création paiements Stripe
    ├── stripe-webhook.js               # Réception confirmations Stripe
    ├── send-email.js                   # Emails automatiques Resend
    └── scout.js                        # Agent Scout (collecte auto, lancé chaque nuit à 3h)
```

## 🚀 Déploiement sur Netlify

### Étape 1 : Upload sur GitHub

1. Va sur ton repo GitHub MecaIA
2. Supprime les anciens fichiers (ou crée une nouvelle branche)
3. Upload TOUS les fichiers ci-dessus EN RESPECTANT LA STRUCTURE des dossiers
4. Commit & push

### Étape 2 : Variables d'environnement Netlify

Vérifie que ces 10 variables sont configurées sur Netlify
(Site settings → Environment variables) :

```
ANTHROPIC_KEY            (déjà fait)
STRIPE_SECRET_KEY        sk_live_51Taf2S...
STRIPE_WEBHOOK_SECRET    whsec_Cwo9mB...
STRIPE_PRICE_1EUR        price_1TbQghQ1...
STRIPE_PRICE_5EUR        price_1TbQm9Q1...
STRIPE_PRICE_10EUR       price_1TbQrVQ1...
STRIPE_PRICE_15EUR       price_1TbQtTQ1...
RESEND_API_KEY           re_BE5pLH5M...
SUPABASE_URL             https://vexxjbpbfrvgszvzpmgu.supabase.co
SUPABASE_SECRET          sb_secret_HpEhmpf8...
```

### Étape 3 : Webhook Stripe

Sur dashboard.stripe.com → Developers → Webhooks → Add endpoint :
- **URL** : `https://euphonious-frangollo-da0cc1.netlify.app/.netlify/functions/stripe-webhook`
- **Events** : `checkout.session.completed`
- **Save** et copie le webhook secret

Si le webhook secret est différent de celui actuel, mets à jour la variable `STRIPE_WEBHOOK_SECRET` sur Netlify.

### Étape 4 : Déploiement

Netlify détecte automatiquement le push GitHub et déploie. Tu peux vérifier sur :
`https://app.netlify.com/sites/euphonious-frangollo-da0cc1/deploys`

Attendre 1-2 minutes que le déploiement soit terminé.

---

## ✅ Test après déploiement

Dans cet ordre :

1. **Test connexion** : Crée un compte test
2. **Test chat Dylan** : Pose une question simple ("voyant moteur Renault Clio")
3. **Test VIN** : Décode un VIN (gratuit)
4. **Test paiement Stripe** : Pack 1€ avec ta vraie carte
   - Si ça marche, tu peux te rembourser sur dashboard.stripe.com
5. **Test code propriétaire** : Code `LOIC2024` pour crédits illimités
6. **Test photo** : Upload une photo de pièce
7. **Test urgence** : Bouton "C'est grave docteur"

---

## 🤖 Comment fonctionne Dylan

### Personnalité adaptée au niveau utilisateur

À l'inscription, l'utilisateur choisit :
- **Débutant** → Dylan parle simple, métaphores, rassure
- **Apprenti** → Dylan enseigne le raisonnement, valeurs précises
- **Pro** → Dylan technique direct, jargon, valeurs précises

### RAG Supabase (expertise terrain)

Quand un user pose une question, Dylan cherche dans la table `expertise_loic` de Supabase les conseils pertinents qui correspondent. Plus la table grossit, meilleur sera Dylan.

### Score de confiance honnête

Dylan donne TOUJOURS son % de confiance (60-90%). Pas de fausse certitude.

### Anti-arnaque intégré

Dylan défend l'utilisateur contre les arnaques garage.

---

## 🔍 Agent Scout (automatique)

L'agent Scout tourne automatiquement **chaque nuit à 3h du matin** (cron Netlify).

### Ce qu'il fait :

À chaque exécution, il enrichit jusqu'à **10 codes OBD** dans la table `obd_codes` de Supabase, avec :
- Description
- Causes probables
- Symptômes
- Gravité
- Types de carburant concernés

### Coût estimé :

- 10 codes × 0.001€ = **0.01€ par jour**
- = **~0.30€/mois**

Tu as un budget de 10€/mois, donc largement OK pour faire plus si besoin.

### Pour lancer le Scout manuellement (test) :

Va sur : `https://euphonious-frangollo-da0cc1.netlify.app/.netlify/functions/scout`

Tu verras combien de codes ont été enrichis.

---

## 💳 Flux de paiement Stripe (vraiment fonctionnel)

1. User clique "Acheter"
2. Frontend appelle `stripe-checkout` (création de session)
3. User est redirigé vers la page de paiement Stripe sécurisée
4. User paie
5. Stripe envoie une confirmation au `stripe-webhook`
6. Le webhook :
   - Met à jour les crédits dans Supabase
   - Envoie un email de confirmation via Resend
7. User est redirigé vers ton site avec un message de succès

**Tout est automatique. Pas d'intervention humaine nécessaire.**

---

## 📊 Tables Supabase utilisées

- `users` (Firebase principal, mais Supabase peut suivre)
- `obd_codes` → remplie par l'agent Scout
- `expertise_loic` → tes 122 réponses (à injecter manuellement plus tard)
- `cas_reels` → se remplit automatiquement avec chaque diagnostic
- `pannes`, `vehicules`, `pieces`, `forum_findings`, `cache_diagnostics` → pour V2

---

## 🔄 Pour faire évoluer le projet (V2)

Quand tu auras 200+ utilisateurs en bêta, on ajoutera :
- Multi-agents intelligents
- Raisonnement probabiliste
- Validation engine (Dylan demande des mesures)
- Mémoire de cas réels enrichie

Mais pour V1, ce qui est livré ci-dessus est suffisant et propre.

---

## 🆘 En cas de problème

### Erreur 500 sur les fonctions Netlify

→ Vérifier que TOUTES les variables d'env sont bien configurées
→ Aller sur Netlify Logs (Functions tab)

### Stripe paiement échoue

→ Vérifier le webhook URL
→ Vérifier que STRIPE_SECRET_KEY commence bien par `sk_live_`

### Dylan ne répond pas

→ Vérifier ANTHROPIC_KEY
→ Regarder les logs de la fonction `api.js`

### Email pas reçus

→ Vérifier RESEND_API_KEY
→ Vérifier les spams
→ Resend gratuit limité à 100/jour

---

**MecaIA V1 — Créé pour Loïc Declerck, mécano au Garage Mécapro à Barchon, Belgique. 🇧🇪🔧**
