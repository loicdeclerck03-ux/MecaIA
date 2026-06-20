@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  LANCER_BOX_E46.bat — MecaIA Box sur BMW E46 (COM5, OBDLink MX+)
REM  20/06/2026 — inclut specs EU (vehicle_specs + TSBs + recalls)
REM ═══════════════════════════════════════════════════════════════════

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║           MecaIA Box — BMW E46 / COM5                ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

REM ─── ÉTAPE 1 : Renseigne tes clés ici ───────────────────────────────
REM Clé Anthropic → https://console.anthropic.com/settings/keys
SET ANTHROPIC_API_KEY=METS_TA_CLE_SK_ANT_ICI

REM Service Role Supabase → https://supabase.com/dashboard/project/vexxjbpbfrvgszvzpmgu/settings/api
SET SUPABASE_URL=https://vexxjbpbfrvgszvzpmgu.supabase.co
SET SUPABASE_SECRET=METS_TA_SERVICE_ROLE_ICI

REM ─── Config OBD ──────────────────────────────────────────────────────
SET SERIAL_PORT=COM5

REM ─── Vérif clés ──────────────────────────────────────────────────────
IF "%ANTHROPIC_API_KEY%"=="METS_TA_CLE_SK_ANT_ICI" (
    echo  [ERREUR] Renseigne ANTHROPIC_API_KEY dans ce fichier .bat
    echo  Ouvre le fichier avec Notepad et remplace METS_TA_CLE_SK_ANT_ICI
    pause
    exit /b 1
)
IF "%SUPABASE_SECRET%"=="METS_TA_SERVICE_ROLE_ICI" (
    echo  [ERREUR] Renseigne SUPABASE_SECRET dans ce fichier .bat
    pause
    exit /b 1
)

REM ─── npm install si besoin ────────────────────────────────────────────
echo  Vérification packages node...
cd /d "C:\Users\pasmoi\Documents\GitHub\MecaIA\box_agent_prototype\box_app"
IF NOT EXIST "node_modules\serialport" (
    echo  Installation serialport...
    npm install
)

REM ─── Lancement ───────────────────────────────────────────────────────
echo.
echo  Adaptateur  : COM5 (OBDLink MX+)
echo  Dylan IA    : RÉEL (Claude Haiku)
echo  Base        : Supabase LIVE (18k codes + specs EU)
echo.
echo  MX+ bien branché sur l'OBD ? Contact mis ? Moteur tournant ?
echo  Ouvre http://localhost:8123 dans ton navigateur.
echo.

node server.mjs

pause
