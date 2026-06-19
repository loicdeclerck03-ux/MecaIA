@echo off
cd /d "C:\Users\pasmoi\Documents\GitHub\MecaIA"
netlify dev:exec --context production node test/diag_20.mjs > test\diag20_full.txt 2>&1
echo FIN_WRAPPER>> test\diag20_full.txt
