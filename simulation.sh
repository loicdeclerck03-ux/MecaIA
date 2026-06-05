#!/bin/bash
R=/home/claude/MecaIA-V3-FINAL
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  ✅ $1"; pass=$((pass+1)); else echo "  ❌ $1 (attendu $3, obtenu $2)"; fail=$((fail+1)); fi; }

echo "════════ SIMULATION STATIQUE — MecaIA V3 ════════"
echo ""
echo "[1] Syntaxe de toutes les fonctions backend"
ko=0; for f in $R/netlify/functions/*.mjs $R/netlify/lib/auth.mjs; do node --check "$f" 2>/dev/null || ko=$((ko+1)); done
chk "30 fonctions + lib compilent" "$ko" "0"

echo ""
echo "[2] Variables d'environnement"
broken=$(grep -rlE "process\.env\.(SUPABASE_KEY|DOMAIN|SITE_URL)\b" $R/netlify 2>/dev/null | wc -l)
chk "aucune variable cassée" "$broken" "0"

echo ""
echo "[3] Sécurité paiement"
chk "crédit UNIQUEMENT dans le webhook" "$(grep -c 'apply_stripe_purchase' $R/netlify/functions/stripe_webhook.mjs)" "1"
chk "checkout ne crédite pas" "$(grep -c 'add_credits\|apply_stripe_purchase' $R/netlify/functions/stripe_checkout.mjs)" "0"
chk "verify ne crédite pas" "$(grep -c 'add_credits\|apply_stripe_purchase' $R/netlify/functions/stripe_verify.mjs)" "0"

echo ""
echo "[4] Modèle de jetons"
chk "diagnostic = session 10 min" "$(grep -c 'start_diagnostic_session\|has_active_diagnostic_session' $R/netlify/functions/dylan_agents.mjs)" "2"
chk "comparatif = 1 jeton" "$(grep -c 'consume_parts_comparison' $R/netlify/functions/parts_compare.mjs)" "1"
chk "VIN limité 3/jour" "$(grep -c 'vin_count_today' $R/netlify/functions/vin_lookup.mjs)" "1"

echo ""
echo "[5] Auth / anti-IDOR (échantillon)"
for f in garage_get maintenance_get health_score_get profile_get; do
  chk "$f exige le JWT (401)" "$(grep -c '401' $R/netlify/functions/$f.mjs)" "1"
done
chk "contrôle propriété véhicule" "$(grep -c 'user_owns_vehicle' $R/netlify/functions/maintenance_get.mjs)" "1"

echo ""
echo "[6] Frontend index.html (migré Supabase)"
S=$(grep -n '<script type="module">' $R/index.html | head -1 | cut -d: -f1)
node -e 'const fs=require("fs");const h=fs.readFileSync("'$R'/index.html","utf8");const s=h.indexOf("<script type=\"module\">");const e=h.indexOf("</script>",s);fs.writeFileSync("/tmp/m.mjs",h.slice(s+22,e));'
node --check /tmp/m.mjs 2>/dev/null && SYN=OK || SYN=KO
chk "syntaxe du module" "$SYN" "OK"
chk "aucune clé sk-ant" "$(grep -c 'sk-ant' $R/index.html)" "0"
chk "Firebase init retiré" "$(grep -cE 'initializeApp|getFirestore\(|getAuth\(' $R/index.html)" "0"
chk "Supabase MecaIA défini" "$(grep -c 'window.MecaIA=' $R/index.html)" "1"
chk "bouton achat -> checkout" "$(grep -c 'window.buyPack=' $R/index.html)" "1"

echo ""
echo "[7] Paquet complet"
chk "17 SQL numérotés" "$(ls /home/claude/package/MecaIA-V3/sql/ | wc -l)" "17"
chk "30 fonctions packagées" "$(ls /home/claude/package/MecaIA-V3/netlify/functions | wc -l)" "30"
chk "index migré dans le paquet" "$(grep -c 'window.MecaIA=' /home/claude/package/MecaIA-V3/index.html)" "1"

echo ""
echo "════════ RÉSULTAT : $pass réussis / $fail échecs ════════"
