#!/usr/bin/env node
// ── MecaIA — tests/run_nexus_tier_test.mjs ─────────────────────────────────
// Valide nexus_orchestrator.mjs Tier 1+2 avec 25 cas reels via les agents
// beta existants (Marie/Thomas). Usage: node tests/run_nexus_tier_test.mjs

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const MARIE = AGENTS.find(a => a.id === 'marie');
const THOMAS = AGENTS.find(a => a.id === 'thomas');

function vehFor(agentId) {
  const v = (agentId === 'marie' ? MARIE : THOMAS).vehicle;
  return { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage: parseInt(v.km) };
}

const CASES = [
  { agent: 'marie',  dtcCodes: ['P0420'], symptoms: '', expectedTier: 1, label: 'P0420 seul (catalyseur)' },
  { agent: 'marie',  dtcCodes: ['P0171'], symptoms: '', expectedTier: 1, label: 'P0171 seul (melange pauvre)' },
  { agent: 'marie',  dtcCodes: ['P0401'], symptoms: '', expectedTier: 1, label: 'P0401 seul (EGR) - cas reel Marie' },
  { agent: 'marie',  dtcCodes: ['P0455'], symptoms: '', expectedTier: 1, label: 'P0455 seul (EVAP fuite large)' },
  { agent: 'marie',  dtcCodes: ['P0442'], symptoms: '', expectedTier: 1, label: 'P0442 seul (EVAP fuite petite)' },
  { agent: 'marie',  dtcCodes: ['P0301'], symptoms: '', expectedTier: 1, label: 'P0301 seul (rate cyl 1)' },
  { agent: 'thomas', dtcCodes: ['P0128'], symptoms: '', expectedTier: 1, label: 'P0128 seul (thermostat)' },
  { agent: 'thomas', dtcCodes: ['P0011'], symptoms: '', expectedTier: 1, label: 'P0011 seul (VANOS/distribution)' },
  { agent: 'thomas', dtcCodes: ['C1201'], symptoms: '', expectedTier: 1, label: 'C1201 seul (ABS)' },
  { agent: 'thomas', dtcCodes: ['P0016'], symptoms: '', expectedTier: 1, label: 'P0016 seul (correlation vilebrequin/came)' },
  { agent: 'thomas', dtcCodes: ['P0299'], symptoms: '', expectedTier: 1, label: 'P0299 seul (sous-suralimentation turbo)' },
  { agent: 'marie',  dtcCodes: ['P0700'], symptoms: '', expectedTier: 1, label: 'P0700 seul (boite auto generique)' },

  { agent: 'marie',  dtcCodes: ['P0401'], symptoms: 'Ma voiture consomme aussi plus depuis 2 mois, et le voyant moteur est allume.', expectedTier: 2, label: 'P0401 + symptome conso (cas reel Marie)' },
  { agent: 'marie',  dtcCodes: [], symptoms: 'Bruit bizarre au freinage depuis hier, pas de voyant allume.', expectedTier: 2, label: 'Symptome seul: bruit freinage' },
  { agent: 'thomas', dtcCodes: ['P0300'], symptoms: 'Rates aleatoires depuis 3 semaines, cliquetis a froid 2-3s qui disparait, LTFT +8%, bougies neuves il y a 15000km.', expectedTier: 2, label: 'P0300 + contexte riche (cas reel Thomas)' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Fumee blanche au demarrage a froid, disparait apres quelques minutes.', expectedTier: 2, label: 'Symptome seul: fumee blanche froid' },
  { agent: 'marie',  dtcCodes: ['P0401', 'P0299'], symptoms: '', expectedTier: 2, label: '2 codes simultanes (EGR + turbo)' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Perte de puissance progressive depuis 1 semaine, voyant moteur clignote (pas fixe).', expectedTier: 2, label: 'Symptome seul: perte puissance + clignotant (urgence)' },
  { agent: 'marie',  dtcCodes: [], symptoms: "Odeur d'essence dans l'habitacle depuis ce matin.", expectedTier: 2, label: 'Symptome seul: odeur essence (securite)' },
  { agent: 'marie',  dtcCodes: ['P0420', 'P0171'], symptoms: '', expectedTier: 2, label: '2 codes simultanes (cat + pauvre)' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Le moteur cale au ralenti par intermittence depuis ce matin.', expectedTier: 2, label: 'Symptome seul: calage ralenti' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Vibration importante en acceleration, voyant DSC allume.', expectedTier: 2, label: 'Symptome seul: vibration + DSC' },
  { agent: 'marie',  dtcCodes: [], symptoms: 'Bruit de claquement en virage, surtout a basse vitesse.', expectedTier: 2, label: 'Symptome seul: claquement virage (cardan)' },
  { agent: 'marie',  dtcCodes: [], symptoms: 'Voyant batterie allume et difficultes au demarrage a froid depuis 3 jours.', expectedTier: 2, label: 'Symptome seul: voyant batterie + demarrage' },
  { agent: 'thomas', dtcCodes: ['P0401'], symptoms: 'Le code P0401 revient toujours apres nettoyage de la vanne EGR par le garage.', expectedTier: 2, label: 'P0401 + contexte echec reparation' },
];

function validateDiagnosis(d) {
  const issues = [];
  if (!d) return ['diagnosis absent'];
  if (!d.cause_principale || typeof d.cause_principale !== 'string' || !d.cause_principale.trim()) issues.push('cause_principale vide');
  if (!['oui', 'non', 'avec précaution'].includes(d.peut_rouler)) issues.push(`peut_rouler invalide: ${d.peut_rouler}`);
  if (!['haute', 'moyenne', 'basse'].includes(d.urgence)) issues.push(`urgence invalide: ${d.urgence}`);
  if (!('cout_estime_min' in d) || !('cout_estime_max' in d)) issues.push('cout_estime manquant');
  if (!['haute', 'moyenne', 'basse'].includes(d.confidence)) issues.push(`confidence invalide: ${d.confidence}`);
  return issues;
}

(async () => {
  console.log('='.repeat(70));
  console.log('  NEXUS ORCHESTRATOR — Validation Tier 1+2 (25 cas)');
  console.log('  ' + new Date().toISOString());
  console.log('='.repeat(70));

  console.log('\nAuth Marie...');
  const marieClient = await MecaIAClient.create(MARIE);
  console.log(`  OK — userId ${marieClient.userId?.slice(0,8)}...`);
  console.log('Auth Thomas...');
  const thomasClient = await MecaIAClient.create(THOMAS);
  console.log(`  OK — userId ${thomasClient.userId?.slice(0,8)}...`);

  const results = [];

  for (const [i, c] of CASES.entries()) {
    const client = c.agent === 'marie' ? marieClient : thomasClient;
    const veh = vehFor(c.agent);
    const body = { dtcCodes: c.dtcCodes, symptoms: c.symptoms, ...veh };

    process.stdout.write(`[${String(i+1).padStart(2,'0')}/25] ${c.label}... `);
    const r = await client.call('nexus_orchestrator', body, 'POST');

    const entry = { ...c, status: r.status, ms: r.ms, ok: r.ok, raw: r.data };

    if (!r.ok) {
      entry.pass = false;
      entry.failReason = `HTTP ${r.status} — ${JSON.stringify(r.data).slice(0,150)}`;
      console.log(`ECHEC (${r.status}, ${r.ms}ms)`);
    } else {
      const data = r.data;
      const tierMatch = data.tier === c.expectedTier;
      const diagIssues = validateDiagnosis(data.diagnosis);
      const challengerOk = c.expectedTier < 2 || (data.challenger?.active === true && typeof data.challenger?.vulnerability_score === 'number');

      entry.tierActual = data.tier;
      entry.tierMatch = tierMatch;
      entry.diagIssues = diagIssues;
      entry.challengerOk = challengerOk;
      entry.needsEscalation = data.needs_tier3_escalation;
      entry.pass = tierMatch && diagIssues.length === 0 && challengerOk;

      const flag = entry.pass ? 'OK' : 'PROBLEME';
      console.log(`${flag} (tier ${data.tier}${tierMatch ? '' : ` attendu ${c.expectedTier}`}, ${r.ms}ms${diagIssues.length ? ', issues: ' + diagIssues.join('; ') : ''})`);
    }
    results.push(entry);
  }

  await marieClient.signOut();
  await thomasClient.signOut();

  const passCount = results.filter(r => r.pass).length;
  const tier1Results = results.filter(r => r.expectedTier === 1);
  const tier2Results = results.filter(r => r.expectedTier === 2);
  const avgMsTier1 = tier1Results.length ? Math.round(tier1Results.reduce((a,r)=>a+r.ms,0)/tier1Results.length) : 0;
  const avgMsTier2 = tier2Results.length ? Math.round(tier2Results.reduce((a,r)=>a+r.ms,0)/tier2Results.length) : 0;
  const maxMs = Math.max(...results.map(r=>r.ms));
  const escalations = results.filter(r => r.needsEscalation).length;
  const tierMismatches = results.filter(r => r.ok && !r.tierMatch);
  const errors = results.filter(r => !r.ok);

  console.log('\n' + '='.repeat(70));
  console.log(`  RESULTAT : ${passCount}/25 passent tous les criteres`);
  console.log(`  Latence moyenne Tier 1: ${avgMsTier1}ms · Tier 2: ${avgMsTier2}ms · Max observe: ${maxMs}ms`);
  console.log(`  Escalations Tier 3 suggerees par le challenger: ${escalations}/${tier2Results.length} cas tier 2`);
  console.log(`  Erreurs HTTP: ${errors.length} · Tier mismatch (bug potentiel): ${tierMismatches.length}`);
  console.log('='.repeat(70));

  if (errors.length) {
    console.log('\nERREURS:');
    errors.forEach(e => console.log(`  - [${e.label}] ${e.failReason}`));
  }
  if (tierMismatches.length) {
    console.log('\nTIER MISMATCH (heuristique deployee != heuristique attendue — verifier le code):');
    tierMismatches.forEach(e => console.log(`  - [${e.label}] attendu tier ${e.expectedTier}, obtenu tier ${e.tierActual}`));
  }

  writeFileSync(join(__dir, 'nexus_tier_test_results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nDetails complets: tests/nexus_tier_test_results.json`);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
