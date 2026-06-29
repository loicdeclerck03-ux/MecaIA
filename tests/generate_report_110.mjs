#!/usr/bin/env node
// generate_report_110.mjs — rapport final 110 resultats
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));

const results100 = JSON.parse(readFileSync(join(__dir,'battery_results.json'),'utf8'));

// Session 1: Marie + Thomas (10 scenarios preconstruits)
const session1 = [
  { id:'M1', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'EGR P0401', agent:'Marie', ok:true, ms:6723, reply:'Les codes P0401 indiquent une insuffisance de debit de la vanne EGR. Commencez par un nettoyage chimique au spray EGR (15€). Remplacement vanne: 80-180€. Voyant fixe = non urgent, pouvez rouler 2-3 semaines.', eval:{score:85,forces:['Systeme identifie','Hypotheses formulees','Action concrete','Cout estime','Urgence evaluee'],critiques:[]} },
  { id:'M2', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'EGR + consommation', agent:'Marie', ok:true, ms:5563, reply:'Oui, la surconsommation est directement liee au P0401. EGR bloquee = +0.5 a 1.5L/100km. Apres nettoyage, consommation normale. Verifiez aussi filtre air et debitmetre.', eval:{score:75,forces:['Lien causal explique','Action concrete','Pedagogique'],critiques:['Pas de cout explicite']} },
  { id:'M3', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'Devis EGR 380EUR', agent:'Marie', ok:true, ms:9219, reply:'380€ est dans la fourchette haute. EGR Clio dCi: 150-280€ tout compris. Demandez un second devis. Essayez le spray EGR (15€) avant de remplacer.', eval:{score:90,forces:['Cout precis','Alternative proposee','Conseil pratique'],critiques:[]} },
  { id:'M4', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'Urgence P0401', agent:'Marie', ok:true, ms:9720, reply:'Oui, vous pouvez rouler 2-3 semaines. Voyant fixe = non critique. Mais ne tardez pas: EGR defaillante peut encrasser l admission et generer des reparations plus couteuses.', eval:{score:85,forces:['Verdict clair','Urgence evaluee','Consequence expliquee'],critiques:[]} },
  { id:'M5', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'EGR explication', agent:'Marie', ok:true, ms:9932, reply:'L EGR recircule les gaz d echappement pour reduire les NOx. Apres 80 000km, la suie s accumule et bloque la vanne. Probleme tres courant sur diesel. Nettoyage preventif tous les 50 000km recommande.', eval:{score:80,forces:['Explication claire','Pedagogique','Sans jargon'],critiques:['Pas de cout mentionne']} },
  { id:'T1', scenario_make:'BMW', scenario_model:'E46 320d', year:2003, fuel:'diesel', sys:'P0300 + LTFT +8%', agent:'Thomas', ok:true, ms:7374, reply:'P0300 avec LTFT +8%: fuite admission probable. Verifiez durites, joints. Cliquetis a froid: chaine ou VANOS. Permutez bobines entre cylindres pour isoler. LTFT +8% = correction permanente, pas intermittente.', eval:{score:88,forces:['Analyse LTFT','Hypotheses multiples','Procedure concrete'],critiques:[]} },
  { id:'T2', scenario_make:'BMW', scenario_model:'E46 320d', year:2003, fuel:'diesel', sys:'Freeze frame analyse', agent:'Thomas', ok:true, ms:14545, reply:'Freeze frame: ENGINE_LOAD 62% + LTFT +8.3% = fuite admission a 65% probable. STFT/LTFT coherent = cause permanente. Test au spray: moteur tourne, pulserisez autour des durites.', eval:{score:92,forces:['Analyse freeze frame experte','Probabilite chiffree','Test concret'],critiques:[]} },
  { id:'T3', scenario_make:'BMW', scenario_model:'E46 320d', year:2003, fuel:'diesel', sys:'Procedure bobine/bougie', agent:'Thomas', ok:true, ms:11159, reply:'1) Identifiez 4 bobines. 2) Permutez cylindres 1 et 3. 3) Effacez P0300. 4) Roulez 15min. Si rate se deplace = bobine (45-80€). Si reste = bougie ou injecteur. Tournevis Torx T30, 20 minutes.', eval:{score:95,forces:['Procedure detaillee','Temps estime','Cout','Outils mentionnes'],critiques:[]} },
  { id:'T4', scenario_make:'BMW', scenario_model:'E46 320d', year:2003, fuel:'diesel', sys:'VANOS huile 25000km', agent:'Thomas', ok:true, ms:16383, reply:'VANOS possible avec huile a 25 000km. Sur M47: LTFT +8% priorite admission. 1) Vidange urgente + nettoyant moteur Liqui-Moly. 2) Si cliquetis persiste: solenoide VANOS (120€). 3) Verif niveau huile actuel.', eval:{score:87,forces:['Priorisation correcte','3 etapes claires','Cout'],critiques:[]} },
  { id:'T5', scenario_make:'BMW', scenario_model:'E46 320d', year:2003, fuel:'diesel', sys:'Limite DS2 E46', agent:'Thomas', ok:true, ms:12753, reply:'Non. E46 2003 utilise protocole BMW DS2 sur K-line 8E1. Inaccessible aux adaptateurs OBD2 standard. Il faut INPA ou K+DCAN. MecaIA Box V1 avec L9637D pourra le faire. En attendant: specialiste BMW.', eval:{score:90,forces:['Honnêtete exemplaire','Explication technique precise','Alternative proposee'],critiques:[]} }
];

const all = [...session1, ...results100];

// Stats globales
const scores = all.map(r=>(r.eval&&r.eval.score)||0);
const avg = s => (s.reduce((a,b)=>a+b,0)/s.length).toFixed(1);
const pass = scores.filter(s=>s>=70).length;
const warn = scores.filter(s=>s>=50&&s<70).length;
const fail = scores.filter(s=>s<50).length;
const noRep = results100.filter(r=>!r.reply||r.reply.length<10).length;

// Critiques globales
const allCritiques = results100.flatMap(r=>(r.eval&&r.eval.critiques)||[]);
const critFreq = {};
allCritiques.forEach(c=>critFreq[c]=(critFreq[c]||0)+1);
const topCritiques = Object.entries(critFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);

// Forces globales
const allForces = results100.flatMap(r=>(r.eval&&r.eval.forces)||[]);
const forceFreq = {};
allForces.forEach(f=>forceFreq[f]=(forceFreq[f]||0)+1);
const topForces = Object.entries(forceFreq).sort((a,b)=>b[1]-a[1]).slice(0,5);

// Score par systeme
const bySystem = {};
results100.forEach(r=>{
  const sys = r.sys || 'autre';
  if(!bySystem[sys]) bySystem[sys]=[];
  bySystem[sys].push((r.eval&&r.eval.score)||0);
});
const systemScores = Object.entries(bySystem).map(([s,sc])=>({sys:s,avg:parseFloat((sc.reduce((a,b)=>a+b,0)/sc.length).toFixed(1)),count:sc.length})).sort((a,b)=>b.avg-a.avg);

// Score par carburant
const byFuel = {};
results100.forEach(r=>{
  const f = r.fuel||'inconnu';
  if(!byFuel[f]) byFuel[f]=[];
  byFuel[f].push((r.eval&&r.eval.score)||0);
});

const sc = s => s>=70?'#4caf50':s>=50?'#e8a000':'#ef4444';
const bg = s => s>=70?'#0a2a0a':s>=50?'#2a1a00':'#2a0a0a';
const emo = s => s>=70?'✅':s>=50?'⚠️':'❌';

const rowHtml = (r,i) => {
  const ev=r.eval||{};
  const s=ev.score||0;
  const forcesStr=(ev.forces||[]).join(' · ');
  const critStr=(ev.critiques||[]).join(' · ');
  const replyStr=(r.reply||'—').slice(0,180);
  return `<tr>
    <td class="num">${String(r.id).padStart(3,'0')}</td>
    <td><strong>${r.scenario_make||''}</strong><br><small class="muted">${r.scenario_model||''} ${r.year||''}</small></td>
    <td><small>${r.fuel||''}</small></td>
    <td><small>${r.sys||'—'}</small></td>
    <td>${r.ok?'✅':'❌'} <span class="muted ms">${r.ms||0}ms</span></td>
    <td style="background:${bg(s)};color:${sc(s)};font-weight:700;text-align:center;min-width:70px">${s}/100<br><small>${emo(s)}</small></td>
    <td class="reply">${replyStr}${replyStr.length>=180?'…':''}</td>
    <td class="evalcell">
      ${forcesStr?`<div class="forces">${forcesStr}</div>`:''}
      ${critStr?`<div class="crits">⚠ ${critStr}</div>`:''}
    </td>
  </tr>`;
};

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>MecaIA — 110 Résultats Battery Test</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#060809;color:#eef4fa;font-size:12px}
.hero{background:linear-gradient(135deg,#0d1520,#060809);padding:32px 24px 24px;text-align:center;border-bottom:1px solid #1a2430}
.logo{font-size:24px;font-weight:700;letter-spacing:4px}.logo span{color:#e8a000}
.hero h1{font-size:15px;color:#8899a6;margin:6px 0 18px}
.kpis{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.kpi{background:#0d1520;border:1px solid #1a2430;border-radius:10px;padding:12px 18px;text-align:center;min-width:100px}
.kpi .v{font-size:26px;font-weight:700;color:#e8a000}.kpi .l{font-size:10px;color:#6b7f96;margin-top:2px}
.kpi.g .v{color:#4caf50}.kpi.r .v{color:#ef4444}.kpi.y .v{color:#e8a000}
.wrap{max-width:1500px;margin:0 auto;padding:24px 12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.card{background:#0d1520;border:1px solid #1a2430;border-radius:10px;padding:16px 18px}
.card h2{font-size:12px;font-weight:600;color:#e8a000;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #1a2430}
.crit-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0a0f14;font-size:12px;color:#b0bec5}
.crit-row:last-child{border:none}
.crit-n{background:#1a0505;color:#ef4444;border-radius:4px;padding:2px 6px;font-weight:700;font-size:11px;min-width:28px;text-align:center}
.force-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #0a0f14;font-size:12px;color:#b0bec5}
.force-row:last-child{border:none}
.force-n{background:#0a2a0a;color:#4caf50;border-radius:4px;padding:2px 6px;font-weight:700;font-size:11px;min-width:28px;text-align:center}
.fuel-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #0a0f14;font-size:12px}
.fuel-row:last-child{border:none}
.bar-wrap{width:120px;height:8px;background:#1a2430;border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.insight{background:#0d1a2d;border-left:3px solid #e8a000;padding:12px 14px;margin-bottom:10px;border-radius:0 8px 8px 0;font-size:12px;color:#b0bec5}
.insight strong{color:#e8a000;display:block;margin-bottom:4px}
.section-title{font-size:13px;font-weight:600;color:#e8a000;text-transform:uppercase;letter-spacing:1px;margin:20px 0 12px;padding-bottom:6px;border-bottom:1px solid #1a2430}
table{width:100%;border-collapse:collapse}
th{background:#060809;color:#6b7f96;font-size:10px;font-weight:600;text-transform:uppercase;padding:8px 6px;text-align:left;border-bottom:1px solid #1a2430;position:sticky;top:0;z-index:1}
td{padding:6px;border-bottom:1px solid #0a0f14;vertical-align:top}
.num{color:#4a5568;text-align:center;font-family:monospace;min-width:36px}
.ms{color:#4a5568;font-family:monospace;font-size:10px}
.muted{color:#4a5568}
.reply{color:#8899a6;font-size:11px;max-width:240px}
.evalcell{font-size:11px;max-width:260px}
.forces{color:#4caf50;margin-bottom:3px}
.crits{color:#e8a000}
footer{text-align:center;padding:24px;color:#4a5568;font-size:10px;border-top:1px solid #1a2430;margin-top:32px}
</style>
</head>
<body>
<div class="hero">
  <div class="logo">MECA<span>IA</span></div>
  <h1>Battery Test — 110 résultats · ${new Date().toISOString().slice(0,10)}</h1>
  <div class="kpis">
    <div class="kpi g"><div class="v">${pass}</div><div class="l">Score ≥ 70/100</div></div>
    <div class="kpi y"><div class="v">${warn}</div><div class="l">Score 50-69</div></div>
    <div class="kpi r"><div class="v">${fail}</div><div class="l">Score < 50</div></div>
    <div class="kpi"><div class="v">${avg(scores)}</div><div class="l">Score moyen/100</div></div>
    <div class="kpi"><div class="v">${avg(session1.map(r=>r.eval.score))}</div><div class="l">Score session 1</div></div>
    <div class="kpi"><div class="v">${avg(results100.map(r=>(r.eval&&r.eval.score)||0))}</div><div class="l">Score batterie 100</div></div>
    <div class="kpi r"><div class="v">${noRep}</div><div class="l">Réponses vides</div></div>
    <div class="kpi"><div class="v">${all.length}</div><div class="l">Tests totaux</div></div>
  </div>
</div>
<div class="wrap">

  <div class="grid2">
    <div class="card">
      <h2>🔴 Top 10 critiques — problèmes récurrents</h2>
      ${topCritiques.map(([c,n])=>`<div class="crit-row"><span class="crit-n">${n}×</span><span>${c}</span></div>`).join('')}
    </div>
    <div class="card">
      <h2>✅ Points forts détectés</h2>
      ${topForces.map(([f,n])=>`<div class="force-row"><span class="force-n">${n}×</span><span>${f}</span></div>`).join('')}
      <div style="margin-top:16px">
      <h2 style="margin-top:0">📊 Score par carburant</h2>
      ${Object.entries(byFuel).map(([f,sc_arr])=>{
        const a=parseFloat((sc_arr.reduce((a,b)=>a+b,0)/sc_arr.length).toFixed(0));
        return `<div class="fuel-row"><span>${f} (${sc_arr.length})</span><div class="bar-wrap"><div class="bar-fill" style="width:${a}%;background:${sc(a)}"></div></div><span style="color:${sc(a)};font-weight:700">${a}/100</span></div>`;
      }).join('')}
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h2>🔬 Insights clés — ce que les 100 tests révèlent</h2>
    <div class="grid2" style="gap:10px">
      <div class="insight"><strong>Bug #1 — Restriction véhicule dans le system prompt</strong>Dylan refuse parfois de diagnostiquer un véhicule différent de celui enregistré dans le profil. Cause: le system prompt injecte les règles carburant (diesel/essence) du véhicule enregistré, pas celui du message. Fix: utiliser le carburant décrit dans le message de l'utilisateur.</div>
      <div class="insight"><strong>Bug #2 — Réponses vides sur certains scénarios (${noRep} cas)</strong>Certains appels retournent une réponse HTTP 200 mais avec un champ reply vide ou manquant. Probablement un timeout côté Netlify (10s) sur des scénarios complexes.</div>
      <div class="insight"><strong>Amélioration #1 — Prix quasi-absents (${topCritiques.find(([c])=>c.includes('cout'))?.[1]||0}× signalé)</strong>Dylan donne rarement une estimation de coût en première réponse. Or c'est ce que l'utilisateur veut savoir en premier. Recommendation: ajouter une règle dans le system prompt pour inclure systématiquement une fourchette de coût dès la première hypothèse.</div>
      <div class="insight"><strong>Amélioration #2 — Urgence non évaluée (${topCritiques.find(([c])=>c.includes('Urgence'))?.[1]||0}× signalé)</strong>Dylan ne dit pas systématiquement "vous pouvez rouler / ne roulez pas". C'est la question numéro 1 des conducteurs. Recommendation: forcer une réponse à "puis-je continuer à rouler ?" dans chaque diagnostic.</div>
      <div class="insight"><strong>Point fort — Questions de clarification</strong>Dylan pose des questions pertinentes pour préciser le diagnostic avant de conclure. C'est correct médicalement mais pénalise le premier contact. La batterie 100 tests illustre que c'est un comportement cohérent.</div>
      <div class="insight"><strong>Point fort — Véhicules complexes (hybride, PHEV, 48V)</strong>Sur les véhicules hybrides et électriques, Dylan reconnaît ses limites et dirige vers le constructeur quand c'est nécessaire. C'est honnête et sécurisant pour l'utilisateur.</div>
    </div>
  </div>

  <div class="section-title">Session 1 — Marie Dupont + Thomas Lejeune (10 scénarios)</div>
  <table><thead><tr><th>#</th><th>Véhicule</th><th>Carburant</th><th>Système</th><th>Statut</th><th>Score</th><th>Réponse Dylan (extrait)</th><th>Évaluation</th></tr></thead>
  <tbody>${session1.map((r,i)=>rowHtml(r,i)).join('')}</tbody></table>

  <div class="section-title" style="margin-top:24px">Batterie 100 tests — 100 véhicules · 7 groupes de pannes</div>
  <table><thead><tr><th>#</th><th>Véhicule</th><th>Carburant</th><th>Système</th><th>Statut</th><th>Score</th><th>Réponse Dylan (extrait)</th><th>Évaluation</th></tr></thead>
  <tbody>${results100.map((r,i)=>rowHtml(r,i)).join('')}</tbody></table>

</div>
<footer>MecaIA Battery Test System v2.0 · ${new Date().toISOString().replace('T',' ').slice(0,19)} · ${all.length} résultats · évaluation heuristique automatique</footer>
</body>
</html>`;

const fname = `RAPPORT_BATTERIE_110_${new Date().toISOString().slice(0,10)}.html`;
const fpath = join(__dir, fname);
writeFileSync(fpath, html, 'utf8');
console.log(`\n✅ Rapport généré: ${fpath}`);
console.log(`📊 ${all.length} résultats · Score moyen: ${avg(scores)}/100 · Pass: ${pass} · Warn: ${warn} · Fail: ${fail}`);
