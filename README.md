# MecaIA 🔧

**L'expert automobile IA dans votre poche.**

> Diagnostic OBD ultra précis, garage virtuel, recherche de pièces et alertes entretien par IA. Disponible 24h/24.

---

## Stack

- **Frontend** : HTML/CSS/JS vanilla, PWA
- **Backend** : Netlify Functions (Node.js)
- **Base de données** : Supabase (PostgreSQL)
- **Auth** : Supabase Auth
- **IA** : Claude (Anthropic)
- **Paiement** : Stripe
- **Emails** : Resend
- **Hébergement** : Netlify

## Structure

```
MecaIA/
├── index.html
├── netlify.toml
├── netlify/functions/
│   ├── api.js
│   ├── stripe-checkout.js
│   ├── stripe-webhook.js
│   └── send-email.js
└── supabase/
    ├── schema.sql
    └── functions.sql
```

## Variables d'environnement (Netlify)

Voir `.env.example` pour la liste complète.
**Ne jamais mettre les vraies valeurs dans ce fichier.**

## Créé par

**Loïc Declerck** — Mécanicien HEV2, Belgique 🇧🇪  
loicdeclerck4020@gmail.com
