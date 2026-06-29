#!/usr/bin/env node
// run_battery_chunk.mjs v2 — passe le vehicule du SCENARIO (pas celui de l'agent)
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { BATTERY } from './agents/battery_scenarios.mjs';
import { AGENTS } from './agents/personas.mjs';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const [,, startStr, endStr] = process.argv;
const START_IDX = parseInt(startStr) || 0;
const END_IDX   = parseInt(endStr)   || 25;
const CHUNK     = BATTERY.slice(START_IDX, END_IDX);
const RESULTS_FILE = join(__dir, 'battery_results.json');

function evaluate(sc, reply) {
  if (!reply || reply.length < 50) return { score:0, critiques:['Reponse vide ou trop courte'], forces:[] };
  const r = reply.toLowerCase(); const forces = []; const critiques = []; let score = 0;
  // Critere 1: Systeme identifie
  const sys = (sc.sys||'').toLowerCase().split(/[+\s]+/).filter(s=>s.length>2);
  if (sys.some(t=>r.includes(t))) { score+=20; forces.push('Systeme correctement identifie'); }
  else critiques.push('Systeme en cause non mentionne');
  // Critere 2: Hypotheses
  if (['cause','probablement','suspect','hypothes','possible','peut-etre','probable'].some(w=>r.includes(w))) { score+=15; forces.push('Hypotheses formulees'); }
  else critiques.push('Aucune hypothese causale');
  // Critere 3: Action concrete
  if (['verif','test','controle','remplac','nettoy','mesur','etape','d abord','premier','inspect'].some(w=>r.includes(w))) { score+=20; forces.push('Action concrete recommandee'); }
  else critiques.push('Pas d action concrete — trop theorique');
  // Critere 4: Prix
  if (['euro','eur','prix','cout','devis','main d oeuvre','piece'].some(w=>r.includes(w))) { score+=15; forces.push('Estimation de cout fournie'); }
  else critiques.push('Pas d estimation de cout');
  // Critere 5: Urgence
  if (['urgent','danger','arreter','risque','rouler','continuer','secu','critique','attention'].some(w=>r.includes(w))) { score+=15; forces.push('Urgence evaluee'); }
  else critiques.push('Urgence non evaluee — peut-on rouler ?');
  // Critere 6: Longueur
  if (reply.length>400) { score+=10; forces.push('Reponse complete et detaillee'); }
  else if (reply.length>200) { score+=5; forces.push('Reponse de longueur correcte'); }
  else critiques.push('Reponse trop courte');
  // Critere 7: Questions clarification (penalise legerement si pas de diagnostic direct)
  const isOnlyQuestion = (r.match(/\?/g)||[]).length > 2 && reply.length < 300;
  if (isOnlyQuestion) { score -= 10; critiques.push('Uniquement questions sans diagnostic preliminary'); }
  return { score: Math.max(0, Math.min(100,score)), forces, critiques };
}

(async () => {
  console.log(`\n=== Chunk ${START_IDX}-${END_IDX}: ${CHUNK.length} tests ===`);
  const client = await MecaIAClient.create(AGENTS[0]);
  console.log(`Agent: ${client.agent.name} (${client.userId?.slice(0,8)}...)\n`);

  const results = [];
  for (const sc of CHUNK) {
    const t0 = Date.now();
    let reply = '', ok = false;
    try {
      // CORRECTION v2: passer LE VEHICULE DU SCENARIO, pas celui de l'agent
      const scVehicle = { make: sc.make, model: sc.model, year: parseInt(sc.year), fuel: sc.fuel, mileage_km: parseInt(sc.km) };
      const r = await client.call('dylan_agents', {
        session_id: null, // nouvelle session par test
        user_input: sc.msg,
        vehicle: scVehicle,
        vehicle_marque: sc.make,
        vehicle_modele: sc.model,
        vehicle_km: parseInt(sc.km),
        language: 'fr',
        messages: []
      });
      ok = r.ok;
      reply = r.data?.reply || r.data?.data?.reply || r.data?.message || '';
      if (!reply && r.data) reply = JSON.stringify(r.data).slice(0,200);
    } catch(e) { reply = ''; }

    const ms = Date.now()-t0;
    const ev = evaluate(sc, reply);
    const sym = ev.score>=70?'✅':ev.score>=50?'⚠️':'❌';
    console.log(`${sym} [${sc.id}] ${sc.make} ${sc.model} · ${sc.sys} · ${ev.score}/100 (${ms}ms)`);
    if (!ok) console.log(`   → Echec HTTP`);
    results.push({ id:sc.id, scenario_make:sc.make, scenario_model:sc.model, year:sc.year, fuel:sc.fuel, sys:sc.sys, agent:client.agent.name, ok, ms, reply, eval:ev });
    await new Promise(r=>setTimeout(r,300));
  }
  await client.signOut().catch(()=>{});

  // Merge avec résultats existants (remplace les anciennes versions)
  const existing = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE,'utf8')) : [];
  const merged = [...existing.filter(e=>!results.find(r=>r.id===e.id)), ...results].sort((a,b)=>a.id-b.id);
  writeFileSync(RESULTS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`\n✅ Sauvegarde: ${merged.length} resultats totaux`);
})();
