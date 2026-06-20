@echo off
cd /d "C:\Users\pasmoi\Documents\GitHub\MecaIA"
echo Commit et push en cours...
git add netlify/functions/dylan_agents.mjs
git commit -m "feat: carnet entretien + fiches outils (multimetre/vacuometre/etc) + procedures reparation a la conclusion"
git push origin main
echo.
echo Termine ! Netlify deploie dans 2 minutes.
pause
