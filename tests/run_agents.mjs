#!/usr/bin/env node
// ── MecaIA Beta Agent System — run_agents.mjs ──────────────────────────────
// Lance les 2 agents IA, teste tout le site, genere un rapport HTML
// Usage: ANTHROPIC_KEY=sk-... node tests/run_agents.mjs
//
// Variables env requises:
//   ANTHROPIC_KEY      — cle API Anthropic (pour evaluation des reponses Dylan)
//   SUPABASE_ANON_KEY  — (optionnel, deja code dans mecaia_client.mjs)

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { evaluateDylanResponse, avgScore, scoreColor } from './lib/evaluator.mjs';
import { AGENTS } from './agents/personas.mjs';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const START = Date.now();

// ── Helpers ────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString().replace('T',' ').slice(0,19);
const pad = (s, n=50) => String(s).padEnd(n, ' ');

function log(msg, symbol = '·') {
  process.stdout.write(`  ${symbol}  ${msg}\n`);
}

// ── Test homepage (fetch simple) ────────────────────────────────────────────
async function testHomepage() {
  const t0 = Date.now();
  try {
    const r = await fetch('https://mecaiaauto.com/', { redirect: 'follow' });
    const body = await r.text();
    return {
      ok: r.status === 200 && body.includes('MecaIA'),
      status: r.status, ms: Date.now()-t0,
      detail: r.status === 200 ? 'Page chargee, "MecaIA" present' : `Status ${r.status}`
    };
  } catch(e) {
    return { ok: false, status: 0, ms: Date.now()-t0, detail: e.message };
  }
}

// ── Execution d un agent complet ────────────────────────────────────────────
async function runAgent(agentDef) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${agentDef.avatar}  AGENT: ${agentDef.name.toUpperCase()}`);
  console.log(`  ${agentDef.persona}`);
  console.log(`${'═'.repeat(60)}`);

  const results = {
    agent:         agentDef,
    auth:          null,
    profile:       null,
    garage_add:    null,
    garage_get:    null,
    vin:           null,
    parts:         null,
    ct:            null,
    homepage:      null,
    dylan_convos:  [],
    errors:        []
  };

  // ── 1. Homepage ──────────────────────────────────────────────────────────
  log('Test homepage mecaiaauto.com...', '🌐');
  results.homepage = await testHomepage();
  log(`Homepage: ${results.homepage.ok ? '✅' : '❌'} ${results.homepage.detail} (${results.homepage.ms}ms)`,
      results.homepage.ok ? '✅' : '❌');

  // ── 2. Auth ──────────────────────────────────────────────────────────────
  log(`Authentification en tant que ${agentDef.name}...`, '🔑');
  let client;
  try {
    client = await MecaIAClient.create(agentDef);
    results.auth = { ok: !!client.token, userId: client.userId,
      detail: client.token ? `Connecte · userId: ${client.userId?.slice(0,8)}...` : 'Auth echouee' };
    log(`Auth: ${results.auth.ok ? '✅' : '❌'} ${results.auth.detail}`, results.auth.ok ? '✅' : '❌');
  } catch(e) {
    results.auth = { ok: false, detail: e.message };
    results.errors.push('Auth: ' + e.message);
    log(`Auth ECHEC: ${e.message}`, '❌');
    return results;
  }

  // ── 3. Profil ─────────────────────────────────────────────────────────────
  log('Lecture profil utilisateur...', '👤');
  const profR = await client.getProfile();
  results.profile = { ok: profR.ok, status: profR.status, ms: profR.ms,
    credits: profR.data?.credits_balance ?? profR.data?.data?.credits_balance ?? '?',
    detail: profR.ok ? `OK · credits: ${profR.data?.credits_balance ?? profR.data?.data?.credits_balance ?? '?'}` : `${profR.status}` };
  log(`Profil: ${results.profile.ok ? '✅' : '⚠️'} ${results.profile.detail}`, results.profile.ok ? '✅' : '⚠️');

  // ── 4. Ajout vehicule ─────────────────────────────────────────────────────
  log(`Ajout vehicule ${agentDef.vehicle.marque} ${agentDef.vehicle.modele}...`, '🚗');
  const addR = await client.addVehicle(agentDef.vehicle);
  results.garage_add = { ok: addR.ok, status: addR.status, ms: addR.ms,
    vehicleId: client.vehicleId,
    detail: addR.ok ? `Vehicule ajoute · id: ${client.vehicleId?.slice(0,8) ?? 'existant'}` : `${addR.status} ${JSON.stringify(addR.data).slice(0,80)}` };
  log(`Garage add: ${results.garage_add.ok ? '✅' : '⚠️'} ${results.garage_add.detail}`, results.garage_add.ok ? '✅' : '⚠️');

  // ── 5. Lecture garage ─────────────────────────────────────────────────────
  log('Lecture garage...', '🏠');
  const getR = await client.getGarage();
  const nbVeh = getR.data?.vehicles?.length ?? getR.data?.data?.length ?? '?';
  results.garage_get = { ok: getR.ok, status: getR.status, ms: getR.ms,
    nbVehicles: nbVeh,
    detail: getR.ok ? `${nbVeh} vehicule(s) en garage` : `${getR.status}` };
  log(`Garage get: ${results.garage_get.ok ? '✅' : '⚠️'} ${results.garage_get.detail}`, results.garage_get.ok ? '✅' : '⚠️');

  // ── 6. VIN decoder ────────────────────────────────────────────────────────
  log(`VIN decoder: ${agentDef.vin}...`, '🔎');
  const vinR = await client.vinLookup(agentDef.vin);
  const vinOk = vinR.ok && (vinR.data?.make || vinR.data?.data?.make || vinR.data?.vin);
  results.vin = { ok: vinOk, status: vinR.status, ms: vinR.ms,
    detail: vinOk ? `Decodage OK · ${JSON.stringify(vinR.data?.make || vinR.data?.data?.make || 'voir data').slice(0,60)}` : `${vinR.status} · ${JSON.stringify(vinR.data).slice(0,80)}` };
  log(`VIN: ${results.vin.ok ? '✅' : '⚠️'} ${results.vin.detail}`, results.vin.ok ? '✅' : '⚠️');

  // ── 7. Recherche pieces ───────────────────────────────────────────────────
  log('Recherche de pieces...', '🔧');
  const q = agentDef.id === 'marie' ? 'vanne EGR Renault Clio' : 'bobine allumage BMW E46 320d';
  const partsR = await client.partsSearch(q);
  const hasResults = partsR.ok && (partsR.data?.results?.length > 0 || partsR.data?.data?.length > 0);
  results.parts = { ok: partsR.ok, status: partsR.status, ms: partsR.ms,
    detail: partsR.ok ? `OK · query: "${q}"` : `${partsR.status}` };
  log(`Parts: ${results.parts.ok ? '✅' : '⚠️'} ${results.parts.detail}`, results.parts.ok ? '✅' : '⚠️');

  // ── 8. CT check (Thomas uniquement) ───────────────────────────────────────
  if (agentDef.ui_tests.includes('ct')) {
    log('CT check (controle technique)...', '📋');
    const ctR = await client.ctCheck();
    results.ct = { ok: ctR.ok, status: ctR.status, ms: ctR.ms,
      detail: ctR.ok ? 'CT check OK' : `${ctR.status}` };
    log(`CT: ${results.ct.ok ? '✅' : '⚠️'} ${results.ct.detail}`, results.ct.ok ? '✅' : '⚠️');
  }

  // ── 9. Scenarios Dylan ────────────────────────────────────────────────────
  console.log(`\n  🧠 SCENARIOS DYLAN (${agentDef.scenarios.length} conversations)\n`);
  let conversationHistory = [];

  for (const [i, scenario] of agentDef.scenarios.entries()) {
    log(`[${i+1}/${agentDef.scenarios.length}] ${scenario.name}`, '💬');
    log(`  → "${scenario.message.slice(0,80)}..."`, ' ');

    const dylanR = await client.dylanChat(scenario.message, conversationHistory);
    const dylanText = dylanR.data?.reply || dylanR.data?.data?.reply || dylanR.data?.response || '';

    // Mise a jour historique conversation
    if (dylanText) {
      conversationHistory.push({ role: 'user', content: scenario.message });
      conversationHistory.push({ role: 'assistant', content: dylanText });
    }

    // Evaluation par Claude
    let evaluation = null;
    if (process.env.ANTHROPIC_KEY && dylanText) {
      evaluation = await evaluateDylanResponse(
        scenario.name, scenario.message, dylanText, agentDef.persona
      );
    }

    const entry = {
      scenario: scenario.name,
      message: scenario.message,
      expect: scenario.expect,
      ok: dylanR.ok,
      status: dylanR.status,
      ms: dylanR.ms,
      reply: dylanText,
      evaluation,
      score: evaluation ? avgScore(evaluation) : null
    };
    results.dylan_convos.push(entry);

    const scoreStr = entry.score !== null ? ` · score: ${entry.score}/10` : '';
    log(`  ← Dylan: ${dylanR.ok ? '✅' : '❌'} (${dylanR.ms}ms${scoreStr})`, dylanR.ok ? '  ' : '  ');
    if (dylanText) log(`     "${dylanText.slice(0,100)}..."`, '  ');
    if (evaluation?.commentaire) log(`     Eval: ${evaluation.commentaire}`, '  ');
    console.log();
  }

  await client.signOut();
  return results;
}

// ── Rapport HTML ─────────────────────────────────────────────────────────────
function generateReport(allResults, totalMs) {
  const date = now();

  const agentCard = (res) => {
    const ag = res.agent;
    const pass = [res.homepage, res.auth, res.profile, res.garage_add, res.garage_get, res.vin, res.parts, res.ct]
      .filter(Boolean).filter(r => r.ok).length;
    const total = [res.homepage, res.auth, res.profile, res.garage_add, res.garage_get, res.vin, res.parts, res.ct]
      .filter(Boolean).length;
    const dylanAvg = res.dylan_convos.filter(c => c.score !== null).length > 0
      ? (res.dylan_convos.filter(c=>c.score!==null).reduce((a,c)=>a+c.score,0) / res.dylan_convos.filter(c=>c.score!==null).length).toFixed(1)
      : null;

    const uiRows = [
      { label: 'Page accueil', r: res.homepage },
      { label: 'Authentification', r: res.auth },
      { label: 'Profil utilisateur', r: res.profile },
      { label: 'Ajout vehicule', r: res.garage_add },
      { label: 'Lecture garage', r: res.garage_get },
      { label: 'VIN decoder', r: res.vin },
      { label: 'Recherche pieces', r: res.parts },
      res.ct ? { label: 'CT check', r: res.ct } : null
    ].filter(Boolean);

    const uiTable = uiRows.map(row => {
      const status = row.r ? (row.r.ok ? '✅' : '⚠️') : '—';
      const ms = row.r?.ms ? `${row.r.ms}ms` : '—';
      const detail = row.r?.detail || '—';
      return `<tr><td>${row.label}</td><td>${status}</td><td class="ms">${ms}</td><td class="detail">${detail.slice(0,80)}</td></tr>`;
    }).join('');

    const dylanRows = res.dylan_convos.map(c => {
      const ev = c.evaluation;
      const scoreStr = c.score !== null ? c.score : '—';
      const scoreCol = c.score !== null ? scoreColor(c.score) : '#6b7f96';
      const bars = ev ? ['pertinence','causes_identifiees','actions_concretes','securite','ton_dylan']
        .map(k => `<span title="${k}: ${ev[k]}/10" style="display:inline-block;width:${(ev[k]||0)*10}%;height:4px;background:${scoreColor(ev[k]||0)};border-radius:2px;margin-right:2px"></span>`).join('') : '';
      return `<tr>
        <td><strong>${c.scenario}</strong></td>
        <td>${c.ok ? '✅' : '❌'}</td>
        <td class="ms">${c.ms}ms</td>
        <td style="color:${scoreCol};font-weight:700">${scoreStr}/10</td>
        <td style="white-space:nowrap">${bars}</td>
        <td class="detail">${(c.reply || '—').slice(0,120)}...</td>
      </tr>`;
    }).join('');

    return `
<div class="agent-section">
  <div class="agent-header">
    <span class="agent-avatar">${ag.avatar}</span>
    <div>
      <div class="agent-name">${ag.name}</div>
      <div class="agent-persona">${ag.persona}</div>
      <div class="agent-vehicle">🚗 ${ag.vehicle.marque} ${ag.vehicle.modele} ${ag.vehicle.annee} · ${ag.vehicle.km}km</div>
    </div>
    <div class="agent-scores">
      <div class="score-pill ${pass===total?'green':pass>=total*0.7?'yellow':'red'}">${pass}/${total} UI tests OK</div>
      ${dylanAvg !== null ? `<div class="score-pill ${parseFloat(dylanAvg)>=7?'green':parseFloat(dylanAvg)>=5?'yellow':'red'}">Dylan: ${dylanAvg}/10</div>` : ''}
    </div>
  </div>

  <h3>Tests UI & Endpoints</h3>
  <table class="test-table">
    <thead><tr><th>Feature</th><th>Statut</th><th>Temps</th><th>Detail</th></tr></thead>
    <tbody>${uiTable}</tbody>
  </table>

  <h3>Conversations Dylan (${res.dylan_convos.length} scenarios)</h3>
  <table class="test-table dylan-table">
    <thead><tr><th>Scenario</th><th>OK</th><th>ms</th><th>Score</th><th>Criteres</th><th>Extrait reponse</th></tr></thead>
    <tbody>${dylanRows}</tbody>
  </table>

  ${res.dylan_convos.filter(c=>c.evaluation?.commentaire).map(c => `
  <div class="eval-comment">
    <strong>${c.scenario}</strong>: ${c.evaluation.commentaire}
  </div>`).join('')}
</div>`;
  };

  const globalPass = allResults.flatMap(r =>
    [r.homepage,r.auth,r.profile,r.garage_add,r.garage_get,r.vin,r.parts,r.ct].filter(Boolean)
  ).filter(r=>r.ok).length;
  const globalTotal = allResults.flatMap(r =>
    [r.homepage,r.auth,r.profile,r.garage_add,r.garage_get,r.vin,r.parts,r.ct].filter(Boolean)
  ).length;
  const globalDylanScores = allResults.flatMap(r => r.dylan_convos.filter(c=>c.score!==null).map(c=>c.score));
  const globalDylanAvg = globalDylanScores.length > 0
    ? (globalDylanScores.reduce((a,b)=>a+b,0)/globalDylanScores.length).toFixed(1) : null;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport Beta Agents — MecaIA ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#060809;color:#eef4fa;font-size:14px;padding:0}
.header{background:linear-gradient(135deg,#0d1520,#060809);padding:40px;border-bottom:1px solid #1a2430;text-align:center}
.logo{font-size:28px;font-weight:700;letter-spacing:4px;color:#eef4fa;margin-bottom:8px}
.logo span{color:#e8a000}
.header h1{font-size:18px;color:#8899a6;margin-bottom:16px}
.global-scores{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.global-pill{background:#0d1520;border:1px solid #1a2430;border-radius:10px;padding:16px 24px;text-align:center}
.global-pill .val{font-size:32px;font-weight:700;color:#e8a000}
.global-pill .lbl{font-size:12px;color:#6b7f96;margin-top:4px}
.wrap{max-width:1100px;margin:0 auto;padding:40px 24px}
.agent-section{background:#0d1520;border:1px solid #1a2430;border-radius:12px;padding:28px;margin-bottom:28px}
.agent-header{display:flex;gap:16px;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap}
.agent-avatar{font-size:48px;flex-shrink:0}
.agent-name{font-size:20px;font-weight:700;color:#eef4fa}
.agent-persona{font-size:13px;color:#8899a6;margin-top:4px}
.agent-vehicle{font-size:13px;color:#6b7f96;margin-top:4px}
.agent-scores{margin-left:auto;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.score-pill{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600}
.score-pill.green{background:#0a2a0a;border:1px solid #1a4a1a;color:#4caf50}
.score-pill.yellow{background:#2a1a00;border:1px solid #4a3a00;color:#e8a000}
.score-pill.red{background:#2a0a0a;border:1px solid #4a1a1a;color:#ef4444}
h3{font-size:14px;font-weight:600;color:#e8a000;text-transform:uppercase;letter-spacing:1px;margin:20px 0 12px}
.test-table{width:100%;border-collapse:collapse;font-size:13px}
.test-table th{text-align:left;padding:8px 12px;background:#060809;color:#6b7f96;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1a2430}
.test-table td{padding:8px 12px;border-bottom:1px solid #0d1520;vertical-align:top}
.test-table tr:last-child td{border-bottom:none}
.ms{color:#6b7f96;font-family:monospace;white-space:nowrap}
.detail{color:#8899a6;font-size:12px}
.dylan-table .detail{font-size:11px}
.eval-comment{background:#060809;border-left:3px solid #e8a000;padding:10px 14px;margin-top:8px;font-size:13px;color:#b0bec5}
.eval-comment strong{color:#e8a000}
footer{text-align:center;padding:40px;color:#4a5568;font-size:12px;border-top:1px solid #1a2430;margin-top:40px}
</style>
</head>
<body>
<div class="header">
  <div class="logo">MECA<span>IA</span></div>
  <h1>Rapport Beta Agents IA — ${date}</h1>
  <div class="global-scores">
    <div class="global-pill"><div class="val">${globalPass}/${globalTotal}</div><div class="lbl">Tests UI reussis</div></div>
    ${globalDylanAvg !== null ? `<div class="global-pill"><div class="val">${globalDylanAvg}/10</div><div class="lbl">Score Dylan moyen</div></div>` : ''}
    <div class="global-pill"><div class="val">${Math.round(totalMs/1000)}s</div><div class="lbl">Duree totale</div></div>
    <div class="global-pill"><div class="val">${allResults.flatMap(r=>r.dylan_convos).length}</div><div class="lbl">Scenarios Dylan</div></div>
  </div>
</div>
<div class="wrap">
${allResults.map(agentCard).join('\n')}
</div>
<footer>MecaIA Beta Agent System v1.0 · ${date} · ${allResults.length} agents · Auto-genere</footer>
</body>
</html>`;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  🤖  MecaIA Beta Agent System v1.0');
  console.log(`  📅  ${now()}`);
  console.log(`  🌐  mecaiaauto.com`);
  if (!process.env.ANTHROPIC_KEY) {
    console.log('  ⚠️   ANTHROPIC_KEY manquant — evaluation desactivee');
  }
  console.log('═'.repeat(60));

  const allResults = [];
  for (const agent of AGENTS) {
    try {
      const res = await runAgent(agent);
      allResults.push(res);
    } catch(e) {
      console.error(`\n❌ Agent ${agent.name} crash: ${e.message}`);
      allResults.push({ agent, errors: [e.message], dylan_convos: [], homepage: null, auth: { ok: false, detail: e.message }, profile: null, garage_add: null, garage_get: null, vin: null, parts: null, ct: null });
    }
  }

  const totalMs = Date.now() - START;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅  Tests termines en ${Math.round(totalMs/1000)}s`);

  // Generer rapport HTML
  const html  = generateReport(allResults, totalMs);
  const fname = `RAPPORT_BETA_${new Date().toISOString().slice(0,10)}.html`;
  const fpath = join(__dir, fname);
  writeFileSync(fpath, html, 'utf8');
  console.log(`  📄  Rapport: ${fpath}`);
  console.log('═'.repeat(60) + '\n');
})();
