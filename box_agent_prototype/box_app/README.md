# box_app — MecaIA Box (Phase 3) : Dylan fait le diagnostic lui-même

App locale = **chat avec Dylan** qui pilote la boucle agentique complète (il décide, exécute, analyse,
conclut, mémorise). Clé API côté serveur, jamais dans le navigateur. Deux exécuteurs OBD : **simulé**
(testable maintenant) et **adaptateur réel** (pré-câblé, à activer quand tu branches).

## A) Tester ce soir — voiture simulée + vrai Dylan
```powershell
cd "C:\Users\pasmoi\Documents\GitHub\MecaIA\box_agent_prototype\box_app"

# Vrai Dylan (Claude) — crée une clé sur console.anthropic.com (ne la colle nulle part en public) :
$env:ANTHROPIC_API_KEY="sk-ant-..."
node server.mjs
# → http://localhost:8123 : choisis une voiture/cas, "Démarrer", puis DISCUTE avec Dylan (questions de suivi OK).

# Démo sans clé (Dylan scripté) :
$env:MOCK_DYLAN="1" ; node server.mjs
```

### 11 cas de test (menu déroulant)
`p0299` turbo · `p0300` ratés essence (Mode 06) · `p0420` catalyseur · `battery` batterie ·
`p0171` prise d'air · `p0401` EGR · `abs` ABS/frein (sécurité) · `p0455` EVAP/bouchon ·
`overheat` surchauffe (danger) · `oil` reset vidange (UDS) · `dpf` régé FAP forcée (UDS, opération longue).

## B) "Go c'est branché" — adaptateur réel OBDLink MX+
1. Appaire le MX+ en Bluetooth → port COM (ex `COM5`). Le voir : `[System.IO.Ports.SerialPort]::GetPortNames()`
2. `npm i serialport`
3. Sonde seule (vérifie le lien) : `node obd_serial.mjs COM5`
4. Brancher dans l'app :
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..." ; $env:SERIAL_PORT="COM5" ; node server.mjs
```
→ Dylan lit les **vrais** codes / VIN / régime de la voiture. (Les écritures UDS restent bloquées par
sécurité — c'est ce qu'on code ensemble en Phase 3.)

## (option) Vraie base de connaissance
```powershell
$env:SUPABASE_URL="https://vexxjbpbfrvgszvzpmgu.supabase.co" ; $env:SUPABASE_SECRET="..." ; node server.mjs
```
→ `lookup_dtc` / `search_similar_cases` tapent les vraies 18k codes + cas (au lieu du simulé).

## Capacités de Dylan (outils)
- **Lecture** : read_dtcs, read_permanent_dtcs, read_freeze_frame, read_live_data, **read_live_stream** (flux),
  **read_onboard_tests** (Mode 06 : ratés/cylindre, rendement cata), read_readiness_monitors, read_vin.
- **Connaissance** : lookup_dtc (causes+catégorie+gravité), search_similar_cases, record_case (mémoire).
- **UDS (niveau v2, écriture, confirmation obligatoire)** : read_extended_data, service_reset
  (oil/dpf/egr/injecteurs/EPB/batterie/angle volant/boîte/TPMS…), actuator_test (ventilo/EGR/frein parking/clim/…).

## Quand tu reviens
Lance **A** (option vrai Dylan), teste plusieurs cas, discute avec lui. Puis dis "go c'est branché"
(option B) → on attaque la Phase 3 réelle : mapper tous les PIDs sur l'adaptateur + coder les séquences
UDS (session 0x10 + SecurityAccess seed/key par marque) pour les écritures.

## Fichiers
`server.mjs` (serveur + boucle + sessions) · `index.html` (chat) · `obd_sim.mjs` (voiture simulée) ·
`obd_serial.mjs` (adaptateur réel ELM327) · réutilise `../box_agent.mjs`, `../scenarios.mjs`, `../dtc_enrich.mjs`.


---

## MàJ — expérience "outil pro" (façon WOW / Carly)
- **Bouton « 🔍 Trouve la panne »** : un seul clic. L'utilisateur ne tape RIEN. Dylan enchaîne tout seul
  (lecture codes + données temps réel + tests embarqués), trouve la panne, conclut. Il ne demande ton accord
  que pour une action qui ÉCRIT dans la voiture (sécurité).
- **Identification véhicule** : champs Marque / Modèle / Année / Carburant (ou « Détecter via VIN »).
  Le diagnostic de Dylan **s'adapte à la voiture** déclarée (ex : diesel → DPF/rail/suralim ; essence → ratés/O2/cata).
  Laisse vide = véhicule détecté par la Box.
- **Chat de suivi** : après la conclusion, tu peux continuer à discuter (« et si je change juste la sonde ? »).
- En haut : la liste déroulante = la **voiture branchée** (en simulation, elle porte la panne cachée à trouver).


---

## Phase 3 — couche de LECTURE réelle PRÊTE (préparée à l'avance)
- `obd_pids.mjs` : table des PIDs OBD-II (norme J1979) + décodeurs DTC / PID / readiness. Fonctions pures.
- `selftest.mjs` : valide les décodeurs avec des trames ELM327 simulées → `node selftest.mjs` (13/13 OK, sans matériel).
- `obd_serial.mjs` : lit RÉELLEMENT codes stockés (03) + permanents (0A) + tous les PIDs + moniteurs (0101) +
  Mode 06 + VIN + tension. Tout est branché dans le serveur (`SERIAL_PORT`).
- Donc au moment où tu branches : les **lectures** devraient marcher direct (générique OBD).
  Restent à coder ENSEMBLE (Phase 3, avec la voiture) : les **écritures UDS** (resets/activations) — session 0x10 +
  SecurityAccess seed/key propre à BMW — et les PIDs constructeur (BOOST/EGT/DPF/ABS via Mode 0x22).
