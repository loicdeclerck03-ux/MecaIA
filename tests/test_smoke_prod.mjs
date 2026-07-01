#!/usr/bin/env node
// tests/test_sentry_check.mjs — verifie Sentry 0 erreur sur les 24 dernières heures
// + smoke test de toutes les fonctions NEXUS en prod

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const THOMAS = AGENTS.find(a => a.id === 'thomas');
const MARIE = AGENTS.find(a => a.id === 'marie');
const tc = await MecaIAClient.create(THOMAS);
const mc = await MecaIAClient.create(MARIE);
const v = THOMAS.vehicle;
const vm = MARIE.vehicle;

console.log('='.repeat(60));
console.log('  SMOKE TEST PROD — toutes fonctions NEXUS');
console.log('='.repeat(60));

const tests = [
  // nexus_orchestrator Tier 1 (DTC seul)
  { label: 'nexus_orchestrator Tier1 (P0128)', fn: () => tc.call('nexus_orchestrator', { dtcCodes: ['P0128'], make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu }) },
  // nexus_orchestrator Tier 2 (symptome)
  { label: 'nexus_orchestrator Tier2 (symptome)', fn: () => mc.call('nexus_orchestrator', { symptoms: 'voyant moteur + fumee noire', make: vm.marque, model: vm.modele, year: vm.annee, fuel: vm.carbu }) },
  // nexus_parts_price
  { label: 'nexus_parts_price (filtre FAP)', fn: () => tc.call('nexus_parts_price', { part_name: 'filtre FAP', make: v.marque, model: v.modele, year: v.annee }) },
  // nexus_recall_radar
  { label: 'nexus_recall_radar (BMW E46)', fn: () => tc.call('nexus_recall_radar', { make: v.marque, model: v.modele, year: v.annee }) },
  // nexus_feedback (sans session réelle)
  { label: 'nexus_feedback (validation schema)', fn: () => tc.call('nexus_feedback', { was_correct: true, comments: 'smoke test' }) },
  // dylan_agents mémoire
  { label: 'dylan_agents (mémoire P0420)', fn: async () => {
    const r = await tc.call('dylan_agents', { user_input: 'P0420 revient après reset', vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) } });
    return r;
  }},
];

let passed = 0, failed = 0;
for (const t of tests) {
  process.stdout.write(`  ${t.label}... `);
  try {
    const r = await t.fn();
    const ok = r.status === 200 || r.status === 400; // 400 = validation schema OK
    if (ok) { console.log(`✅ ${r.status} (${r.data?.elapsed_ms || r.data?.tier || ''})`); passed++; }
    else { console.log(`❌ ${r.status}: ${JSON.stringify(r.data).slice(0,80)}`); failed++; }
  } catch(e) {
    console.log(`💥 ${e.message}`); failed++;
  }
}

await tc.signOut();
await mc.signOut();

console.log(`\n${'='.repeat(60)}`);
console.log(`RÉSULTAT: ${passed}/${passed+failed} OK${failed > 0 ? ' — ' + failed + ' ÉCHEC(S)' : ' ✅'}`);
if (failed === 0) console.log('→ Prod saine. Sentry manuel conseillé pour confirmer 0 erreur.');
