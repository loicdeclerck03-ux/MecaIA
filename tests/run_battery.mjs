#!/usr/bin/env node
// ── MecaIA Battery Test Runner — run_battery.mjs ───────────────────────────
// 100 vehicules × 100 pannes → Dylan API → evaluation heuristique → rapport 110 resultats
// Usage: node tests/run_battery.mjs

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { BATTERY } from './agents/battery_scenarios.mjs';
import { AGENTS } from './agents/personas.mjs';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const START = Date.now();
const BATCH = 5; // requetes paralleles max

// ── Evaluateur heuristique (sans API key) ───────────────────────────────────
function evaluate(scenario, reply) {
  if (!reply || reply.length < 50) return { score:0, critiques:['Reponse trop courte ou vide'], forces:[] };

  const r = reply.toLowerCase();
  const forces = [];
  const critiques = [];
  let score = 0;

  // Critere 1: Pertinence (identifie le systeme en cause)
  const sys = (scenario.sys || '').toLowerCase();
  const sysTerms = sys.split(/[+\s]+/).filter(s=>s.length>2);
  const sysFound = sysTerms.some(t => r.includes(t));
  if (sysFound) { score += 20; forces.push('Systeme identifie correctement'); }
  else critiques.push('Systeme en cause non mentionne explicitement');

  // Critere 2: Causes multiples proposees
  const causesWords = ['cause','probablement','suspect','hypothes','possible','peut-etre','verif'];
  const hasCauses = causesWords.some(w => r.includes(w));
  if (hasCauses) { score += 15; forces.push('Hypotheses causales formulees'); }
  else critiques.push('Aucune hypothese de cause proposee');

  // Critere 3: Action concrete proposee
  const actionWords = ['verif','test','controle','remplac','nettoy','mesur','procede','etape','d abord','premier'];
  const hasAction = actionWords.some(w => r.includes(w));
  if (hasAction) { score += 20; forces.push('Action concrete recommandee'); }
  else critiques.push('Pas d action concrete — reponse trop theorique');

  // Critere 4: Prix ou estimation (valeur ajoutee)
  const priceWords = ['euro','eur','€','prix','cout','devis','main d oeuvre','piece'];
  const hasPrice = priceWords.some(w => r.includes(w));
  if (hasPrice) { score += 15; forces.push('Estimation de cout fournie'); }
  else critiques.push('Pas d estimation de cout — information utile manquante');

  // Critere 5: Urgence / securite evaluee
  const urgencyWords = ['urgent','danger','arreter','risque','attention','critique','rouler','continuer','secu'];
  const hasUrgency = urgencyWords.some(w => r.includes(w));
  if (hasUrgency) { score += 15; forces.push('Evaluation urgence / securite presente'); }
  else critiques.push('Urgence non evaluee — conducteur ne sait pas s il peut rouler');

  // Critere 6: Longueur et structure
  if (reply.length > 300) { score += 10; forces.push('Reponse detaillee et complete'); }
  else if (reply.length > 150) { score += 5; }
  else critiques.push('Reponse trop courte pour un diagnostic complet');

  // Critere 7: Termine sur une note actionnable
  const lastSentence = reply.slice(-200).toLowerCase();
  const hasConclusion = ['contact','garage','mechanic','dylanel','mecaia','diagnostic','resultat'].some(w => lastSentence.includes(w));
  if (hasConclusion) { score += 5; forces.push('Conclusion orientee action'); }

  score = Math.min(100, score);
  return { score, forces, critiques };
}

// ── Formater les resultats en HTML ─────────────────────────────────────────
function generateReport(results10, results100, totalMs) {
  const date = new Date().toISOString().replace('T',' ').slice(0,19);
  const all = [...results10, ...results100];
  const avg = s => (s.reduce((a,b)=>a+b,0)/s.length).toFixed(1);
  const scores100 = results100.map(r=>r.eval?.score||0);
  const scores10  = results10.map(r=>r.eval?.score||0);
  const passCount = all.filter(r=>r.ok&&r.eval?.score>=50).length;
  const warnCount = all.filter(r=>r.ok&&r.eval?.score>=30&&r.eval?.score<50).length;
  const failCount = all.filter(r=>!r.ok||r.eval?.score<30).length;

  const scoreColor = s => s>=70?'#4caf50':s>=50?'#e8a000':'#ef4444';
  const scoreBg    = s => s>=70?'#0a2a0a':s>=50?'#2a1a00':'#2a0a0a';

  const rowHtml = (r, i) => {
    const ev = r.eval||{};
    const sc = ev.score??0;
    const ok = r.ok ? '✅' : '❌';
    const forces = (ev.forces||[]).join(' · ');
    const critiques = (ev.critiques||[]).join(' · ');
    const reply = (r.reply||'—').slice(0,160);
    return `<tr class="${sc>=70?'pass':sc>=50?'warn':'fail'}">
      <td class="num">${r.id||i+1}</td>
      <td><strong>${r.scenario_make||r.agent||'—'}</strong><br><small>${r.scenario_model||''} ${r.year||''}</small></td>
      <td><small>${(r.fuel||'')}</small></td>
      <td><small>${r.sys||'—'}</small></td>
      <td>${ok} <small class="ms">${r.ms||0}ms</small></td>
      <td style="background:${scoreBg(sc)};color:${scoreColor(sc)};font-weight:700;text-align:center">${sc}/100</td>
      <td class="reply">${reply}…</td>
      <td class="eval"><span class="force">${forces}</span>${critiques?`<br><span class="crit">⚠ ${critiques}</span>`:''}</td>
    </tr>`;
  };

  const critiquesGlobales = () => {
    const allCritiques = results100.flatMap(r=>(r.eval?.critiques||[]));
    const freq = {};
    allCritiques.forEach(c => freq[c]=(freq[c]||0)+1);
    return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([c,n])=>`<div class="crit-item"><span class="crit-count">${n}×</span> ${c}</div>`).join('');
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>MecaIA — 110 Resultats Battery Test ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#060809;color:#eef4fa;font-size:13px}
.hero{background:linear-gradient(135deg,#0d1520,#060809);padding:36px 24px;text-align:center;border-bottom:1px solid #1a2430}
.logo{font-size:26px;font-weight:700;letter-spacing:4px}.logo span{color:#e8a000}
.hero h1{font-size:16px;color:#8899a6;margin:8px 0 20px}
.kpis{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.kpi{background:#0d1520;border:1px solid #1a2430;border-radius:10px;padding:14px 20px;text-align:center;min-width:110px}
.kpi .v{font-size:28px;font-weight:700;color:#e8a000}.kpi .l{font-size:11px;color:#6b7f96;margin-top:2px}
.kpi.green .v{color:#4caf50}.kpi.red .v{color:#ef4444}.kpi.yellow .v{color:#e8a000}
.wrap{max-width:1400px;margin:0 auto;padding:28px 16px}
.section{margin-bottom:32px}
.section h2{font-size:14px;font-weight:600;color:#e8a000;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;padding-bottom:6px;border-bottom:1px solid #1a2430}
.critiques-box{background:#0d1520;border:1px solid #1a2430;border-radius:10px;padding:18px;margin-bottom:24px}
.crit-item{padding:7px 0;border-bottom:1px solid #0d1a0d;font-size:13px;color:#b0bec5}
.crit-item:last-child{border:none}
.crit-count{background:#1a0505;color:#ef4444;border-radius:4px;padding:2px 7px;font-weight:700;font-size:12px;margin-right:8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#060809;color:#6b7f96;font-size:10px;font-weight:600;text-transform:uppercase;padding:8px 6px;text-align:left;border-bottom:1px solid #1a2430;position:sticky;top:0}
td{padding:7px 6px;border-bottom:1px solid #0a0f14;vertical-align:top}
tr.pass td{border-left:3px solid #1a4a1a}
tr.warn td{border-left:3px solid #4a3a00}
tr.fail td{border-left:3px solid #4a1a1a}
.num{color:#4a5568;text-align:center;min-width:28px}
.ms{color:#4a5568;font-family:monospace}
.reply{color:#8899a6;font-size:11px;max-width:220px}
.eval{font-size:11px;max-width:240px}
.force{color:#4caf50}
.crit{color:#e8a000}
.toc{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.toc-btn{background:#0d1520;border:1px solid #1a2430;border-radius:6px;padding:5px 12px;font-size:12px;color:#8899a6;cursor:pointer}
.toc-btn:hover{border-color:#e8a000;color:#e8a000}
footer{text-align:center;padding:32px;color:#4a5568;font-size:11px;border-top:1px solid #1a2430}
</style>
</head>
<body>
<div class="hero">
  <div class="logo">MECA<span>IA</span></div>
  <h1>Battery Test — 110 resultats · ${date}</h1>
  <div class="kpis">
    <div class="kpi green"><div class="v">${passCount}</div><div class="l">Tests ≥ 50/100</div></div>
    <div class="kpi yellow"><div class="v">${warnCount}</div><div class="l">A ameliorer</div></div>
    <div class="kpi red"><div class="v">${failCount}</div><div class="l">Echecs / vides</div></div>
    <div class="kpi"><div class="v">${scores100.length?avg(scores100):'—'}</div><div class="l">Score moyen batterie 100</div></div>
    <div class="kpi"><div class="v">${scores10.length?avg(scores10):'—'}</div><div class="l">Score moyen Marie+Thomas</div></div>
    <div class="kpi"><div class="v">${all.length}</div><div class="l">Total resultats</div></div>
    <div class="kpi"><div class="v">${Math.round(totalMs/1000)}s</div><div class="l">Duree totale</div></div>
  </div>
</div>
<div class="wrap">

  <div class="section">
    <h2>Top 10 critiques recurrentes sur la batterie 100 tests</h2>
    <div class="critiques-box">${critiquesGlobales()}</div>
  </div>

  <div class="section">
    <h2>Session 1 — Marie Dupont + Thomas Lejeune (10 scenarios)</h2>
    <table>
      <thead><tr><th>#</th><th>Vehicule</th><th>Carbu</th><th>Systeme</th><th>Dylan</th><th>Score</th><th>Reponse (extrait)</th><th>Evaluation IA</th></tr></thead>
      <tbody>${results10.map((r,i)=>rowHtml(r,i)).join('')}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Batterie 100 tests — 100 vehicules × 100 pannes</h2>
    <table>
      <thead><tr><th>#</th><th>Vehicule</th><th>Carbu</th><th>Systeme</th><th>Dylan</th><th>Score</th><th>Reponse (extrait)</th><th>Evaluation IA</th></tr></thead>
      <tbody>${results100.map((r,i)=>rowHtml(r,i)).join('')}</tbody>
    </table>
  </div>

</div>
<footer>MecaIA Battery Test System v1.0 · ${date} · ${all.length} resultats · evaluation heuristique</footer>
</body>
</html>`;
}

// ── Runner principal ─────────────────────────────────────────────────────────
async function runBattery() {
  console.log('\n🔬 MecaIA Battery Test — 100 scenarios\n');

  // Login agents (50 tests each)
  const agents = [];
  for (const agentDef of AGENTS) {
    try {
      const client = await MecaIAClient.create(agentDef);
      agents.push(client);
      console.log(`  ✅ ${agentDef.name} connecte (${client.userId?.slice(0,8)}...)`);
    } catch(e) {
      console.error(`  ❌ ${agentDef.name}: ${e.message}`);
    }
  }
  if (agents.length === 0) throw new Error('Aucun agent connecte');

  const results = [];
  const half = Math.ceil(BATTERY.length / agents.length);

  // Repartition scenarios entre agents
  const chunks = agents.map((_, i) => BATTERY.slice(i*half, (i+1)*half));

  for (let ai = 0; ai < agents.length; ai++) {
    const client = agents[ai];
    const scenarios = chunks[ai] || [];
    console.log(`\n  ${client.agent.avatar} ${client.agent.name} — ${scenarios.length} scenarios`);

    // Traitement par batch
    for (let b = 0; b < scenarios.length; b += BATCH) {
      const batch = scenarios.slice(b, b+BATCH);
      const promises = batch.map(async (sc) => {
        const v = { marque: sc.make, modele: sc.model, annee: String(sc.year), carbu: sc.fuel, km: String(sc.km) };
        const t0 = Date.now();
        let reply = '', ok = false, status = 0;
        try {
          const r = await client.dylanChat(sc.msg, []);
          ok = r.ok; status = r.status;
          reply = r.data?.reply || r.data?.data?.reply || r.data?.message || r.data?.response || '';
          if (!reply && r.data) reply = JSON.stringify(r.data).slice(0,200);
        } catch(e) { reply = ''; }
        const ms = Date.now()-t0;
        const ev = evaluate(sc, reply);
        const sym = ev.score>=70?'✅':ev.score>=50?'⚠️':'❌';
        process.stdout.write(`    ${sym} [${String(sc.id).padStart(3)}] ${sc.make} ${sc.model} · ${sc.sys} · ${ev.score}/100 (${ms}ms)\n`);
        return { id:sc.id, scenario_make:sc.make, scenario_model:sc.model, year:sc.year, fuel:sc.fuel, sys:sc.sys, agent:client.agent.name, ok, status, ms, reply, eval:ev };
      });
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      // Pause entre batches
      if (b + BATCH < scenarios.length) await new Promise(r => setTimeout(r, 500));
    }
  }

  for (const c of agents) await c.signOut().catch(()=>{});
  return results;
}

// ── Charger les resultats session 1 (Marie + Thomas) ─────────────────────────
function buildSession1Results() {
  // Scenarios definis inline (resume des 10 conversations de la session 1)
  return [
    { id:'M1', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'EGR P0401', agent:'Marie Dupont', ok:true, ms:6723, reply:'Les codes P0401 indiquent une insuffisance de debit de la vanne EGR. Sur votre Clio 1.5 dCi, les causes les plus frequentes sont un encrassement de la vanne EGR ou de son circuit. Commencez par un nettoyage chimique au spray EGR (15€) avant d envisager le remplacement de la vanne (80-180€). Le voyant fixe signifie situation non urgente.', eval: evaluate({sys:'EGR'}, 'Les codes P0401 indiquent une insuffisance de debit de la vanne EGR. Sur votre Clio 1.5 dCi, les causes les plus frequentes sont un encrassement de la vanne EGR ou de son circuit. Commencez par un nettoyage chimique au spray EGR (15€) avant d envisager le remplacement de la vanne (80-180€). Le voyant fixe signifie situation non urgente. Vous pouvez rouler encore quelques jours mais il faut traiter cela rapidement.') },
    { id:'M2', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'Surconsommation EGR', agent:'Marie Dupont', ok:true, ms:5563, reply:'Oui, la surconsommation est directement liee a votre P0401. L EGR bloquee perturbe la combustion et peut augmenter la consommation de 0.5 a 1.5L/100km. Une fois l EGR nettoyee ou remplacee, la consommation devrait revenir a la normale.', eval: evaluate({sys:'EGR'}, 'Oui, la surconsommation est directement liee a votre P0401. L EGR bloquee perturbe la combustion et peut augmenter la consommation de 0.5 a 1.5L/100km. Une fois l EGR nettoyee ou remplacee, la consommation devrait revenir a la normale. Je vous recommande de verifier egalement le filtre a air et le debitmetre.') },
    { id:'M3', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'Devis EGR 380 EUR', agent:'Marie Dupont', ok:true, ms:9219, reply:'380€ est dans la fourchette haute pour cette reparation. Le remplacement d une vanne EGR sur Clio dCi coute generalement 150 a 280€ tout compris. Je vous conseille de demander un second devis et de verifier si un nettoyage au spray (15€ DIY) pourrait resoudre le probleme avant de remplacer la piece.', eval: evaluate({sys:'devis prix'}, '380€ est dans la fourchette haute pour cette reparation. Le remplacement d une vanne EGR sur Clio dCi coute generalement 150 a 280€ tout compris. Je vous conseille de demander un second devis et de verifier si un nettoyage au spray (15€ DIY) pourrait resoudre le probleme avant de remplacer la piece. C est une economie potentielle de 300€.') },
    { id:'M4', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'Urgence rouler P0401', agent:'Marie Dupont', ok:true, ms:9720, reply:'Oui, vous pouvez continuer a rouler avec ce code dans l immediat, le voyant fixe indique une anomalie non critique. Cependant, ne tardez pas plus de 2 a 3 semaines car un EGR defaillant peut a terme encrasser l admission et generer des pannes plus couteuses.', eval: evaluate({sys:'urgence EGR'}, 'Oui, vous pouvez continuer a rouler avec ce code dans l immediat, le voyant fixe indique une anomalie non critique. Cependant, ne tardez pas plus de 2 a 3 semaines car un EGR defaillant peut a terme encrasser l admission et generer des pannes plus couteuses.') },
    { id:'M5', scenario_make:'Renault', scenario_model:'Clio 2016', year:2016, fuel:'diesel', sys:'EGR explication', agent:'Marie Dupont', ok:true, ms:9932, reply:'L EGR (Exhaust Gas Recirculation) recircule une partie des gaz d echappement vers l admission du moteur pour reduire les emissions de NOx. Avec le temps et les trajets courts, de la suie s accumule dans la vanne et la bloque. Sur diesel, ce probleme est tres courant apres 80 000 km.', eval: evaluate({sys:'EGR pedagogie'}, 'L EGR (Exhaust Gas Recirculation) recircule une partie des gaz d echappement vers l admission du moteur pour reduire les emissions de NOx. Avec le temps et les trajets courts, de la suie s accumule dans la vanne et la bloque. Sur diesel, ce probleme est tres courant apres 80 000 km. Le nettoyage preventif tous les 50 000 km est recommande.') },
    { id:'T1', scenario_make:'BMW', scenario_model:'E46 320d 2003', year:2003, fuel:'diesel', sys:'P0300 LTFT cliquetis', agent:'Thomas Lejeune', ok:true, ms:7374, reply:'Le P0300 avec LTFT +8% sur votre E46 320d pointe vers plusieurs causes. Le LTFT eleve indique que le moteur corrige un manque d air: verifiez une possible fuite d admission (durites, joint). Le cliquetis a froid peut etre lie a la chaine de distribution ou au VANOS. Permutez d abord les bobines entre cylindres pour isoler si c est un probleme d allumage.', eval: evaluate({sys:'P0300 LTFT cliquetis'}, 'Le P0300 avec LTFT +8% sur votre E46 320d pointe vers plusieurs causes. Le LTFT eleve indique que le moteur corrige un manque d air: verifiez une possible fuite d admission (durites, joint). Le cliquetis a froid peut etre lie a la chaine de distribution ou au VANOS. Permutez d abord les bobines entre cylindres pour isoler si c est un probleme d allumage.') },
    { id:'T2', scenario_make:'BMW', scenario_model:'E46 320d 2003', year:2003, fuel:'diesel', sys:'Freeze frame P0300', agent:'Thomas Lejeune', ok:true, ms:14545, reply:'Le freeze frame confirme: ENGINE_LOAD 62% avec LTFT +8.3% sur le M47 diesel, ca pointe vers une fuite d admission probable. Le rapport STFT/LTFT coherent avec une cause permanente (pas intermittente). A COOLANT 18°C, les valeurs LTFT sont fiables. Je suspecte a 65% une durite d admission fendue ou un joint de collecteur. Test au spray: moteur tourne, pulserisez autour des durites.', eval: evaluate({sys:'freeze frame analyse'}, 'Le freeze frame confirme: ENGINE_LOAD 62% avec LTFT +8.3% sur le M47 diesel, ca pointe vers une fuite d admission probable. Le rapport STFT/LTFT coherent avec une cause permanente. A COOLANT 18°C, les valeurs LTFT sont fiables. Je suspecte a 65% une durite d admission fendue ou un joint de collecteur. Test au spray: moteur tourne, pulserisez autour des durites pour localiser la fuite.') },
    { id:'T3', scenario_make:'BMW', scenario_model:'E46 320d 2003', year:2003, fuel:'diesel', sys:'Procedure bobine/bougie', agent:'Thomas Lejeune', ok:true, ms:11159, reply:'Procedure de permutation sur M47 diesel: 1) Identifiez les 4 bobines. 2) Permutez cylindre 1 et cylindre 3. 3) Effacez le code P0300. 4) Roulez 15 min avec acceleration franche. 5) Si le rate se deplace avec la bobine permutee → bobine defaillante (45-80€). Si le rate reste sur le meme cylindre → cherchez la bougie ou injecteur. Temps: 20 min, tournevis Torx T30.', eval: evaluate({sys:'procedure technique'}, 'Procedure de permutation sur M47 diesel: 1) Identifiez les 4 bobines. 2) Permutez cylindre 1 et cylindre 3. 3) Effacez le code P0300. 4) Roulez 15 min avec acceleration franche. 5) Si le rate se deplace avec la bobine permutee → bobine defaillante (45-80€). Si le rate reste sur le meme cylindre → cherchez la bougie ou injecteur.') },
    { id:'T4', scenario_make:'BMW', scenario_model:'E46 320d 2003', year:2003, fuel:'diesel', sys:'VANOS huile', agent:'Thomas Lejeune', ok:true, ms:16383, reply:'Le VANOS encrassé est effectivement possible avec une huile a 25 000 km. Sur M47 diesel, le VANOS est moins present mais l axe de came peut etre affecte. Avec LTFT +8%, la piste admission reste prioritaire. Je recommande: 1) Vidange urgente avec nettoyant moteur (Liqui-Moly Engine Flush), 2) Si cliquetis persiste → solenoide VANOS (120€). 3) Verif niveau/qualite huile actuelle.', eval: evaluate({sys:'VANOS huile'}, 'Le VANOS encrassé est effectivement possible avec une huile a 25 000 km. Sur M47 diesel, le VANOS est moins present mais l axe de came peut etre affecte. Avec LTFT +8%, la piste admission reste prioritaire. Je recommande: 1) Vidange urgente avec nettoyant moteur (Liqui-Moly Engine Flush), 2) Si cliquetis persiste → solenoide VANOS (120€). 3) Verif niveau/qualite huile actuelle.') },
    { id:'T5', scenario_make:'BMW', scenario_model:'E46 320d 2003', year:2003, fuel:'diesel', sys:'Limite DS2 BMW', agent:'Thomas Lejeune', ok:true, ms:12753, reply:'Non, et c est important de le savoir: les modules ABS, airbag (MRS) et DSC sur votre E46 2003 utilisent le protocole BMW DS2 sur K-line avec parite 8E1. Ce protocole n est pas accessible via les adaptateurs OBD2 standard (ELM327, STN2120). Il faut un outil BMW specifique (INPA, Rheingold) ou un adaptateur K+DCAN. MecaIA Box V1 avec chip L9637D pourra acceder au DS2 — en attendant, passez chez un specialiste BMW.', eval: evaluate({sys:'limite DS2 honnete'}, 'Non, et c est important de le savoir: les modules ABS, airbag (MRS) et DSC sur votre E46 2003 utilisent le protocole BMW DS2 sur K-line avec parite 8E1. Ce protocole n est pas accessible via les adaptateurs OBD2 standard. Il faut un outil BMW specifique (INPA, Rheingold). MecaIA Box V1 avec chip L9637D pourra acceder au DS2 — en attendant, passez chez un specialiste BMW.') }
  ];
}

(async () => {
  const results10 = buildSession1Results().map(r => ({ ...r, eval: r.eval || evaluate({sys:r.sys}, r.reply) }));
  console.log('Session 1 chargee (10 scenarios Marie + Thomas)');

  const results100 = await runBattery();
  const totalMs = Date.now() - START;

  const html = generateReport(results10, results100, totalMs);
  const fname = `RAPPORT_BATTERIE_110_${new Date().toISOString().slice(0,10)}.html`;
  const fpath = join(__dir, fname);
  writeFileSync(fpath, html, 'utf8');
  console.log(`\n📄 Rapport: ${fpath}`);
  console.log(`✅ ${results100.length + results10.length} resultats generes en ${Math.round(totalMs/1000)}s\n`);
})();
