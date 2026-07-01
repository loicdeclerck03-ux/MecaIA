# CLAUDE.md — MecaIA · Contexte CTO
`Mis à jour : 01/07/2026 · Indexé par graphify · Lu au démarrage de chaque session`

## PROTOCOLE DÉMARRAGE SESSION (obligatoire)

```
1. Appeler GET https://mecaiaauto.com/.netlify/functions/brain_api?token=mecaia-brain-2026
2. Lire le JSON → contexte complet du projet (tasks + decisions + métriques + règles)
3. Répondre avec le format standardisé :
   "Loïc, ✅ Context chargé · [date] · commit [hash] · [N] tasks P0 actives · [X] sessions 24h"
```

## CONTEXTE RAPIDE

**MecaIA** = diagnosticien automobile IA #1 Europe francophone.
**Dylan** = l'IA. **Dylan OBD2** = connecté au boîtier.
**MecaIA ONE** = le boîtier hardware (ESP32-S3 + STN2120 + L9637D + SIM7600E + u-blox M10).
**NEXUS** = orchestration 5 IAs (Haiku T1 · Sonnet T2 · +GPT T3 · +Gemini+Mistral T4).

**Site** : https://mecaiaauto.com · **Dashboard cerveau** : https://mecaiaauto.com/brain
**Supabase** : vexxjbpbfrvgszvzpmgu · **Netlify** : b8c0a559-8e2c-4038-81c6-0c0de4914b0d

## STACK IA (modèles actifs)

```
Haiku     : claude-haiku-4-5-20251001   → conversation Dylan (T1 NEXUS)
Sonnet    : claude-sonnet-4-6            → conclusion Dylan UNIQUEMENT
GPT       : gpt-4.1-mini                → T3 NEXUS + prix pièces
Gemini    : gemini-2.5-flash-lite        → T4 NEXUS
Mistral   : mistral-large-latest         → T4 NEXUS
```

## RÈGLES ABSOLUES (non-négociables)

```
JAMAIS caveman:write_file           → desktop-commander:write_file
JAMAIS Stop-Process node            → tue tous les MCPs
JAMAIS Sonnet pour conversation     → timeout systématique 504
JAMAIS crédits                      → abonnements uniquement (décidé 01/07)
JAMAIS modifier obd2.js             → sans instruction explicite Loïc
JAMAIS committer main.js Electron   → local uniquement
JAMAIS ATS0                         → ATS1 toujours (K-line)
JAMAIS str_replace sans lu le fichier cette session
```

## ARCHITECTURE FONCTIONS NETLIFY (47 total)

```
IA / Core :
  dylan_agents.mjs          → moteur diagnostic Dylan (1025 lignes · Haiku+Sonnet+GPT)
  nexus_orchestrator.mjs    → NEXUS Tier 1-4 dispatch
  nexus_parts_price.mjs     → prix pièces live
  nexus_vision.mjs          → GPT-4o Vision
  nexus_voice.mjs           → Whisper transcription
  nexus_recall_radar.mjs    → rappels NHTSA + web search
  nexus_feedback.mjs        → flywheel feedback
  brain_api.mjs             → ← CE FICHIER (cerveau projet)

Paiement :
  stripe_checkout.mjs       → création session Stripe
  stripe_webhook.mjs        → invoice.paid + subscription events
  stripe_verify.mjs         → vérification post-checkout

Garage :
  garage_get.mjs            → liste véhicules
  garage_add_vehicle.mjs    → ajout véhicule
  vehicle_memory.mjs        → mémoire inter-session
  vehicle_context.mjs       → specs + TSBs constructeur

OBD / Monitoring :
  obd_store.mjs             → stockage lectures PIDs
  mecaia_box.mjs            → API boîtier MecaIA ONE
  push_notify.mjs           → alertes push multi-appareils
```

## TABLES SUPABASE PRINCIPALES (65 total)

```
diag_sessions          → sessions Dylan (412 total · 369 en 24h)
user_vehicle_memory    → mémoire véhicule inter-session
nexus_orchestrator_log → logs NEXUS (tier · confiance · consensus)
nexus_feedback         → retours post-réparation
project_brain          → ← CE SYSTÈME (cerveau projet)
user_profiles          → profils utilisateurs (6 users)
user_credits           → OBSOLETE → à supprimer (T001 en cours)
obd_readings           → lectures PIDs monitoring
dtc_codes              → 61 502 codes OBD enrichis
vehicle_specs          → specs carnet entretien constructeur
```

## PLANS ABONNEMENTS (décidé 01/07 — zéro crédits)

```
Essai     : 3 jours gratuit (mémoire gardée)
Starter   : 7.99 EUR/mois  → Dylan web
Pro 15j   : 10.99 EUR      → Dylan OBD2
Pro       : 17.99 EUR/mois → Dylan OBD2 + monitoring + alertes + NEXUS
Pro Annuel: 149 EUR/an
Garage    : 44.99 EUR/mois → multi-véhicules B2B
```

## FICHIERS CLÉS À LIRE AVANT TOUTE MODIFICATION

```
dylan_agents.mjs       → 1239 lignes · lire ENTIÈREMENT avant tout patch
nexus_orchestrator.mjs → 420 lignes · architecture NEXUS Tier 1-4
netlify/lib/auth.mjs   → helpers getUser(), json(), preflight()
brain_api.mjs          → cerveau projet (ce fichier = 168 lignes)
```

## LEÇONS CRITIQUES (ne pas répéter)

```
1. APIUserAbortError : name="Error" (pas "AbortError") → if (e.name === "Error" && e.constructor?.name === "APIUserAbortError")
2. Supabase top-level createClient() → lazy getter getSupabase() obligatoire
3. Object.assign(client, newClient) ne met pas à jour le client → mc = newMc directement
4. forceConclusion sans forceMsg dans userMsg → Sonnet repose des questions → toujours injecter forceMsg
5. Fast-track seuil 15 trop bas → 40 chars (couvre "code + contexte court")
6. netlify.toml BOM (byte 239) → build échoue silencieusement → vérifier byte[0] = 91 '[' après écriture
7. Netlify MCP env vars secrets → HTTP 422 → dashboard Netlify uniquement
8. BRAIN_TOKEN à ajouter dans Netlify env vars dashboard (pas via MCP)
```
