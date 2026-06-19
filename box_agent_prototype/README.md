# box_agent_prototype — Dylan pilote la Box (tool-use)

Prototype **non déployé** du cerveau agentique de la MecaIA Box. Voir `ADR-022` dans `00_IA_BRAIN`.
Ne touche pas à `mecaia_box.mjs` (legacy `[CMD]`) ni à la prod.

## Lancer
```powershell
# SANS secret (Dylan scripté + base mockée) :
node simulate.mjs --mock --case=p0299    # turbo diesel
node simulate.mjs --mock --case=p0300    # ratés essence
node simulate.mjs --mock --case=p0420    # catalyseur
node simulate.mjs --mock --case=battery  # batterie (aucun code)
node simulate.mjs --mock --case=dpf      # UDS : régénération FAP forcée (confirmation + opération longue)

# Vrai Dylan (choisit lui-même outils + PIDs) :
$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:SUPABASE_URL="https://vexxjbpbfrvgszvzpmgu.supabase.co"; $env:SUPABASE_SECRET="..."   # base réelle (option)
node simulate.mjs --case=dpf
```

## Principe (anti-timeout)
**1 appel IA = 1 tour court.** Le scan OBD (30-60 s) — et même une régé FAP de ~25 min — se passe sur le boîtier,
JAMAIS pendant l'appel IA. Pour les opérations longues, Dylan **poll** le statut (`read_extended_data`) → zéro timeout.

## Outils
**SERVER (backend / Supabase)** : `lookup_dtc` (18k : libellé+causes+catégorie+gravité), `search_similar_cases`
(anonymisé), `record_case` (boucle vertueuse, dry-run sauf `BOX_RECORD_CASES=1`).

**DEVICE V1 (app / OBD, lecture)** : `read_dtcs`, `read_freeze_frame`, `read_live_data` (instantané),
`read_live_stream` (**flux dans la durée** — pour observer un paramètre qui varie), `read_readiness_monitors`,
`read_vin`, `clear_dtcs` (sensible).

**DEVICE V2/V3 (app / UDS, niveau `v2`)** : `read_extended_data` (données constructeur : suie FAP, adaptations,
statut routine — lecture), `service_reset` (oil/dpf_forced_regen/epb/battery/steering/throttle — **écriture, sensible**),
`actuator_test` (ventilo/EGR/frein parking/clim/bougies/pompe — **écriture, sensible**).

`buildTools({level})` : `v1` (défaut) ou `v2` (ajoute UDS). `isServerTool()` / `SENSITIVE_TOOLS` / `isSensitive()`.

## Sécurité
- Outils sensibles : exécutés seulement si `confirmed:true` (+ `preconditions_ok:true` pour UDS) ET demandés par Dylan
  après explication des dangers + pré-conditions physiques. Couche `UDS_SAFETY` dans le system prompt.
- Lectures dangereuses (surchauffe, batterie faible) → Dylan avertit avant.
- `search_similar_cases` : whitelist de champs, jamais `user_id`. `record_case` : dry-run sauf `BOX_RECORD_CASES=1`.

## Contrat app ↔ backend
App → backend : `{ messages, vehicle, brand, language, level }`
Backend → app : `{ stop_reason, text, toolCalls:[{id,name,input}], assistantContent }`
Boucle app : empiler l'assistant → si `toolCalls` vide = conclusion → sinon exécuter les DEVICE tools sur l'OBD →
empiler `toolResultsMessage(...)` → rappeler. (Les SERVER tools sont résolus par le backend.)

## Fichiers
- `box_agent.mjs` — outils SERVER+DEVICE+UDS, system prompt mécano + sécurité UDS, `runDylanTurn({level})`, `execServerTool()`.
- `dtc_enrich.mjs` — `faultCategory` + `severityHint` + `enrichLine` (déterministe, à la volée).
- `scenarios.mjs` — bancs d'essai : p0299, p0300, p0420, battery, dpf (UDS).
- `simulate.mjs` — OBD simulé (V1+UDS) + base mockée + boucle (mock & réel), `--case=`.
- `enrich_dtc.sql` — backfill optionnel des colonnes `fault_category`/`severity` (dry-run → backup → update). NON exécuté.

## Suite
1. `node simulate.mjs --case=...` (vrai Dylan) → valider le raisonnement autonome (besoin clé API).
2. App native (Phase 3) : exécution Bluetooth + séquences UDS réelles (session/SecurityAccess par marque).
3. Options prod (ta validation) : lancer `enrich_dtc.sql` ; activer `BOX_RECORD_CASES=1`.
