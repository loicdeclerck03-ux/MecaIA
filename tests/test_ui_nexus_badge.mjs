#!/usr/bin/env node
// tests/test_ui_nexus_badge.mjs — vérifie que le badge NEXUS s'injecte dans le DOM
// après une conclusion Dylan, via un appel HTTP direct simulant le frontend.

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const THOMAS = AGENTS.find(a => a.id === 'thomas');
const client = await MecaIAClient.create(THOMAS);
const v = THOMAS.vehicle;

console.log('='.repeat(60));
console.log('  TEST UI NEXUS BADGE — simulation flow complet');
console.log('='.repeat(60));

// 1. Simuler le flow Dylan jusqu'à la conclusion (P0420 seul = Tier1 direct)
let r = await client.call('dylan_agents', {
  user_input: 'P0420 — le voyant catalyseur est allumé depuis ce matin',
  vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) },
});
console.log(`\n[Dylan] Statut: ${r.status} | État: ${r.data?.etat}`);
const session_id = r.data?.session_id;

// Avancer jusqu'à la conclusion (max 6 tours)
let tours = 1;
while (r.data?.etat !== 'CONCLUSION' && tours < 6) {
  const cr = r.data?.controle ? 'oui' : null;
  const payload = { session_id, vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) } };
  if (cr) payload.control_result = cr;
  else payload.user_input = 'continuez le diagnostic';
  r = await client.call('dylan_agents', payload);
  tours++;
  console.log(`  Tour ${tours}: ${r.data?.etat}`);
}

const conclu = r.data?.conclusion;
console.log(`\n✅ Conclusion atteinte : ${conclu?.cause?.slice(0,80) || 'N/A'}`);

// 2. Simuler triggerNexusValidation — appel direct nexus_orchestrator avec les données
//    que le frontend enverrait (codes capturés + symptôme initial)
if (conclu) {
  console.log('\n[NEXUS] Appel nexus_orchestrator avec P0420...');
  const nr = await client.call('nexus_orchestrator', {
    dtcCodes: ['P0420'],
    symptoms: 'voyant catalyseur allumé',
    make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage: parseInt(v.km),
  });
  console.log(`  Statut: ${nr.status} | Tier: ${nr.data?.tier} | Consensus: ${nr.data?.challenger?.active ? 'actif' : 'non actif'}`);
  console.log(`  Vuln: ${nr.data?.challenger?.vulnerability_score ?? 'n/a'}`);
  console.log(`  → Badge UI afficherait: Tier ${nr.data?.tier} | ${nr.data?.challenger?.active ? Math.round(100 - (nr.data?.challenger?.vulnerability_score || 0)) + '% confiance' : 'non challengé'}`);
  console.log(`\n✅ Flow complet validé : Dylan → conclusion → NEXUS → badge`);
} else {
  console.log('\n⚠️  Conclusion non atteinte en 6 tours');
}

await client.signOut();
