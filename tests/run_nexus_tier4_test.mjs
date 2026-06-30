#!/usr/bin/env node
// tests/run_nexus_tier4_test.mjs — validation initiale Tier 4 (3 cas)
// Gemini et Mistral n'avaient jamais ete testes sur du raisonnement reel,
// donc on commence petit pour mesurer la latence reelle avant de scaler.

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const MARIE = AGENTS.find(a => a.id === 'marie');
const THOMAS = AGENTS.find(a => a.id === 'thomas');

function vehFor(agentId) {
  const v = (agentId === 'marie' ? MARIE : THOMAS).vehicle;
  return { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage: parseInt(v.km) };
}

const CASES = [
  { agent: 'thomas', dtcCodes: ['P0300'], symptoms: 'Rates aleatoires depuis 3 semaines, cliquetis a froid 2-3s qui disparait, LTFT +8%, bougies neuves il y a 15000km.', label: 'Cas complexe Thomas (P0300 multi-symptomes)' },
  { agent: 'marie', dtcCodes: [], symptoms: "Odeur d'essence dans l'habitacle depuis ce matin.", label: 'Securite critique (odeur essence)' },
  { agent: 'marie', dtcCodes: ['P0401', 'P0299'], symptoms: 'Ma voiture consomme aussi plus depuis 2 mois.', label: '2 codes + symptome (EGR+turbo+conso)' },
];

(async () => {
  console.log('='.repeat(70));
  console.log('  NEXUS ORCHESTRATOR — Validation Tier 4 (3 cas pilotes)');
  console.log('  Gemini et Mistral premier test raisonnement reel');
  console.log('='.repeat(70));

  const marieClient = await MecaIAClient.create(MARIE);
  const thomasClient = await MecaIAClient.create(THOMAS);
  console.log('Auth OK\n');

  for (const [i, c] of CASES.entries()) {
    const client = c.agent === 'marie' ? marieClient : thomasClient;
    const veh = vehFor(c.agent);
    const body = { dtcCodes: c.dtcCodes, symptoms: c.symptoms, forceTier: 4, ...veh };

    console.log(`[${i + 1}/3] ${c.label}`);
    const start = Date.now();
    const r = await client.call('nexus_orchestrator', body, 'POST');
    const elapsed = Date.now() - start;

    if (r.ok) {
      const d = r.data;
      console.log(`  STATUS 200 | MS: ${elapsed}`);
      console.log(`  IAs disponibles: ${d.ia_disponibles}/4`);
      console.log(`  Sonnet: ${!!d.diagnosis_sonnet} | GPT: ${!!d.diagnosis_gpt} | Gemini: ${!!d.diagnosis_gemini} | Mistral: ${!!d.diagnosis_mistral}`);
      console.log(`  Consensus: ${d.consensus?.consensus ?? 'absent'} | Vuln: ${d.challenger?.vulnerability_score ?? 'n/a'}`);
      console.log(`  needs_human_escalation: ${d.needs_human_escalation}`);
      if (d.diagnosis_sonnet)  console.log(`  Sonnet : ${d.diagnosis_sonnet.cause_principale?.slice(0, 90)}`);
      if (d.diagnosis_gpt)     console.log(`  GPT    : ${d.diagnosis_gpt.cause_principale?.slice(0, 90)}`);
      if (d.diagnosis_gemini)  console.log(`  Gemini : ${d.diagnosis_gemini.cause_principale?.slice(0, 90)}`);
      if (d.diagnosis_mistral) console.log(`  Mistral: ${d.diagnosis_mistral.cause_principale?.slice(0, 90)}`);
    } else {
      console.log(`  ECHEC HTTP ${r.status} | MS: ${elapsed}`);
      console.log(`  ${JSON.stringify(r.data).slice(0, 300)}`);
    }
    console.log();
  }

  await marieClient.signOut();
  await thomasClient.signOut();
  console.log('Termine.');
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
