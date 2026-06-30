#!/usr/bin/env node
// tests/run_nexus_tier3_test.mjs — validation initiale Tier 3 (5 cas, pas 25 — on valide
// le timing/comportement avant une batterie complete, lecon Tier 2)

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const MARIE = AGENTS.find(a => a.id === 'marie');
const THOMAS = AGENTS.find(a => a.id === 'thomas');

function vehFor(agentId) {
  const v = (agentId === 'marie' ? MARIE : THOMAS).vehicle;
  return { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage: parseInt(v.km) };
}

const CASES = [
  { agent: 'marie', dtcCodes: ['P0401'], symptoms: 'Ma voiture consomme aussi plus depuis 2 mois, et le voyant moteur est allume.', label: 'P0401 + symptome conso (cas reel Marie)' },
  { agent: 'thomas', dtcCodes: ['P0300'], symptoms: 'Rates aleatoires depuis 3 semaines, cliquetis a froid 2-3s qui disparait, LTFT +8%, bougies neuves il y a 15000km.', label: 'P0300 + contexte riche (cas reel Thomas)' },
  { agent: 'marie', dtcCodes: ['P0420'], symptoms: '', label: 'P0420 seul (cas simple force en tier3)' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Vibration importante en acceleration, voyant DSC allume.', label: 'Symptome seul: vibration + DSC' },
  { agent: 'marie', dtcCodes: ['P0401', 'P0299'], symptoms: '', label: '2 codes simultanes (EGR + turbo)' },
];

(async () => {
  console.log('='.repeat(70));
  console.log('  NEXUS ORCHESTRATOR — Validation Tier 3 (5 cas)');
  console.log('='.repeat(70));

  const marieClient = await MecaIAClient.create(MARIE);
  const thomasClient = await MecaIAClient.create(THOMAS);
  console.log('Auth OK (Marie + Thomas)\n');

  for (const [i, c] of CASES.entries()) {
    const client = c.agent === 'marie' ? marieClient : thomasClient;
    const veh = vehFor(c.agent);
    const body = { dtcCodes: c.dtcCodes, symptoms: c.symptoms, forceTier: 3, ...veh };

    console.log(`[${i + 1}/5] ${c.label}`);
    const r = await client.call('nexus_orchestrator', body, 'POST');
    console.log(`  STATUS: ${r.status} | MS: ${r.ms}`);

    if (r.ok) {
      const d = r.data;
      console.log(`  Sonnet OK: ${!!d.diagnosis_sonnet} | GPT OK: ${!!d.diagnosis_gpt}`);
      console.log(`  Consensus: ${d.consensus?.consensus ?? 'absent (timeout?)'}`);
      console.log(`  Vulnerability: ${d.challenger?.vulnerability_score ?? 'n/a'} | needs_tier4: ${d.needs_tier4_escalation}`);
      if (d.diagnosis_sonnet) console.log(`  Cause (Sonnet): ${d.diagnosis_sonnet.cause_principale?.slice(0, 100)}`);
      if (d.diagnosis_gpt) console.log(`  Cause (GPT)   : ${d.diagnosis_gpt.cause_principale?.slice(0, 100)}`);
    } else {
      console.log(`  ERREUR: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    console.log();
  }

  await marieClient.signOut();
  await thomasClient.signOut();
  console.log('Termine.');
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
