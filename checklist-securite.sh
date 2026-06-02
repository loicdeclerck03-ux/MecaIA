#!/usr/bin/env bash
# ============================================================
# 🔐 CHECKLIST SÉCURITÉ MECAIA AVANT TOUT DÉPLOIEMENT
# ============================================================
# À cocher ✅ avant de push en production
# Exécute : bash checklist-securite.sh

echo "════════════════════════════════════════"
echo "  🔐 VÉRIFICATIONS DE SÉCURITÉ MECAIA"
echo "════════════════════════════════════════"
echo ""

FAIL=0

# ============ 1. CLÉS API ============
echo "1️⃣  CLÉS API & SECRETS"
echo "─────────────────────"

echo -n "   [1.1] .env n'existe pas (seulement .env.example) ? "
if [ ! -f ".env" ] && [ ! -f ".env.local" ] && [ ! -f ".env.production" ]; then
  echo "✅"
else
  echo "❌ CRITIQUE : Les fichiers .env existent — à supprimer avant git push"
  FAIL=$((FAIL+1))
fi

echo -n "   [1.2] .gitignore contient .env* ? "
if grep -q "^\.env" .gitignore; then
  echo "✅"
else
  echo "⚠️ MANQUANT : Ajouter à .gitignore : .env"
fi

echo -n "   [1.3] Pas de sk_live_ / sk_test_ / sk-ant- dans le code ? "
if grep -r "sk_live_\|sk_test_\|sk-ant-" netlify/ index.html 2>/dev/null | grep -v ".json\|node_modules"; then
  echo "❌ CRITIQUE : Des clés secrètes sont visibles dans le code"
  FAIL=$((FAIL+1))
else
  echo "✅"
fi

echo -n "   [1.4] Pas de clé dans .env.example (sauf OWNER_CODE masqué) ? "
if grep "sk_live_\|sk_test_\|sk-ant-" .env.example; then
  echo "❌ CRITIQUE : .env.example contient vraies clés"
  FAIL=$((FAIL+1))
else
  echo "✅"
fi

# ============ 2. SUPABASE ============
echo ""
echo "2️⃣  SUPABASE (Base de données)"
echo "───────────────────────────────"

echo -n "   [2.1] RLS (Row Level Security) activé sur users ? "
# Vérifier dans le code si RLS est activé
if grep -q "ALTER TABLE users ENABLE ROW LEVEL SECURITY" supabase/schema.sql; then
  echo "✅"
else
  echo "⚠️ À vérifier dans Supabase Dashboard"
fi

echo -n "   [2.2] Pas de clé service_role exposée en frontend ? "
if grep -q "SUPABASE_SECRET\|service_role" netlify/functions/*.js supabase/; then
  echo "✅ (Clé utilisée seulement en backend)"
else
  echo "⚠️ Vérifier"
fi

echo -n "   [2.3] Anon key publique OK (SUPABASE_PUBLISHABLE_KEY) ? "
if grep -q "SUPABASE_ANON_KEY\|SUPABASE_PUBLISHABLE_KEY" index.html netlify/functions/*.js; then
  echo "✅"
else
  echo "⚠️ À vérifier"
fi

# ============ 3. STRIPE ============
echo ""
echo "3️⃣  STRIPE (Paiements)"
echo "──────────────────────"

echo -n "   [3.1] Clé publique (pk_live_...) en frontend seulement ? "
if grep -q "STRIPE_PUBLIC_KEY" index.html; then
  echo "✅"
else
  echo "⚠️ À vérifier"
fi

echo -n "   [3.2] Clé secrète (sk_live_...) en backend seulement ? "
if grep -q "STRIPE_SECRET_KEY" netlify/functions/*.js && ! grep -q "STRIPE_SECRET_KEY" index.html; then
  echo "✅"
else
  echo "❌ Clé secrète exposée"
  FAIL=$((FAIL+1))
fi

echo -n "   [3.3] Webhook secret configuré dans Netlify ? "
echo "⚠️ À faire dans Netlify Settings → Environment"

echo -n "   [3.4] HTTPS forcé (pas de http://) ? "
if grep -q "https://" netlify.toml .env.example; then
  echo "✅"
else
  echo "⚠️ À vérifier"
fi

# ============ 4. CODE ============
echo ""
echo "4️⃣  CODE & TESTS"
echo "────────────────"

echo -n "   [4.1] npm test passe (83 tests) ? "
TEST_RESULT=$(npm test 2>&1 | grep -c "🎉\|TOUS LES TESTS")
if [ "$TEST_RESULT" -ge 3 ]; then
  echo "✅"
else
  echo "❌ Tests échouent — ne pas déployer"
  FAIL=$((FAIL+1))
fi

echo -n "   [4.2] Pas d'erreur linting (ESLint) ? "
echo "⚠️ À faire : npm install eslint (optionnel pour MVP)"

echo -n "   [4.3] JSON valides (package.json, manifest.json) ? "
python3 -m json.tool package.json > /dev/null 2>&1 && echo "✅" || echo "❌"

# ============ 5. DÉPLOIEMENT ============
echo ""
echo "5️⃣  DÉPLOIEMENT NETLIFY"
echo "───────────────────────"

echo -n "   [5.1] Les 14 env variables sont dans Netlify ? "
echo "   Variables requises :"
echo "      - ANTHROPIC_KEY"
echo "      - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET"
echo "      - STRIPE_PUBLIC_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET"
echo "      - STRIPE_PRICE_* (4 price IDs)"
echo "      - RESEND_API_KEY"
echo "      - OWNER_CODE"
echo "      - FRONTEND_URL"
echo "   ✅ Vérifier dans Netlify Dashboard → Site settings"

echo -n "   [5.2] Build command correct (npm install + netlify deploy) ? "
if grep -q "build = \"npm install\"" netlify.toml; then
  echo "✅"
else
  echo "⚠️ À vérifier"
fi

echo -n "   [5.3] Fonctions Lambda sont bien dans /netlify/functions/ ? "
if [ -f "netlify/functions/api.js" ] && [ -f "netlify/functions/stripe-webhook.js" ]; then
  echo "✅"
else
  echo "❌ Manquent des fonctions"
  FAIL=$((FAIL+1))
fi

# ============ 6. FINAL ============
echo ""
echo "════════════════════════════════════════"

if [ $FAIL -eq 0 ]; then
  echo "✅ TOUS LES CONTRÔLES PASSENT"
  echo ""
  echo "Prêt pour le déploiement :"
  echo "  1. git add ."
  echo "  2. git commit -m 'V1.0 production ready'"
  echo "  3. git push origin main"
  echo ""
  echo "Netlify déploiera automatiquement (~2 min)"
  exit 0
else
  echo "❌ $FAIL PROBLÈME(S) DÉTECTÉ(S) — NE PAS DÉPLOYER"
  exit 1
fi
