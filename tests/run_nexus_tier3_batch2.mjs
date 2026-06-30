#!/usr/bin/env node
// tests/run_nexus_tier3_batch2.mjs — 2e vague Tier 3 (10 cas supplementaires,
// reutilise la banque de cas riches deja construite pour Tier1/2) pour
// confirmer ou infirmer le pattern vulnerability_score=62 observe sur le 1er run.

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
  { agent: 'marie', dtcCodes: [], symptoms: 'Bruit bizarre au freinage depuis hier, pas de voyant allume.', label: 'Bruit freinage' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Fumee blanche au demarrage a froid, disparait apres quelques minutes.', label: 'Fumee blanche froid' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Perte de puissance progressive depuis 1 semaine, voyant moteur clignote (pas fixe).', label: 'Perte puissance + clignotant' },
  { agent: 'marie', dtcCodes: [], symptoms: "Odeur d'essence dans l'habitacle depuis ce matin.", label: 'Odeur essence (securite)' },
  { agent: 'marie', dtcCodes: ['P0420', 'P0171'], symptoms: '', label: '2 codes (cat + pauvre)' },
  { agent: 'thomas', dtcCodes: [], symptoms: 'Le moteur cale au ralenti par intermittence depuis ce matin.', label: 'Calage ralenti' },
  { agent: 'marie', dtcCodes: [], symptoms: 'Bruit de claquement en virage, surtout a basse vitesse.', label: 'Claquement virage' },
  { agent: 'marie', dtcCodes: [], symptoms: 'Voyant batterie allume et difficultes au demarrage a froid depuis 3 jours.', label: 'Voyant batterie + demarrage' },
  { agent: 'thomas', dtcCodes: ['P0401'], symptoms: 'Le code P0401 revient toujours apres nettoyage de la vanne EGR par le garage.', label: 'P0401 + echec reparation' },
  { agent: 'thomas', dtcCodes: ['P0011'], symptoms: '', label: 'P0011 seul (VANOS)' },
];

(async () => {
  console.log('='.repeat(70));
  console.log('  NEXUS ORCHESTRATOR — Tier 3 batch 2 (10 cas)');
  console.log('='.repeat(70));

  const marieClient = await MecaIAClient.create(MARIE);
  const thomasClient = await MecaIAClient.create(THOMAS);
  console.log('Auth OK\n');

  const results = [];

  for (const [i, c] of CASES.entries()) {
    const client = c.agent === 'marie' ? marieClient : thomasClient;
    const veh = vehFor(c.agent);
    const body = { dtcCodes: c.dtcCodes, symptoms: c.symptoms, forceTier: 3, ...veh };

    process.stdout.write(`[${i + 1}/10] ${c.label}... `);
    const r = await client.call('nexus_orchestrator', body, 'POST');

    if (r.ok) {
      const d = r.data;
      console.log(`OK (${r.ms}ms) consensus=${d.consensus?.consensus ?? 'absent'} vuln=${d.challenger?.vulnerability_score ?? 'n/a'} sonnet=${!!d.diagnosis_sonnet} gpt=${!!d.diagnosis_gpt}`);
      results.push({ label: c.label, ms: r.ms, ok: true, consensus: d.consensus?.consensus, vuln: d.challenger?.vulnerability_score, sonnetOk: !!d.diagnosis_sonnet, gptOk: !!d.diagnosis_gpt });
    } else {
      console.log(`ECHEC (${r.status})`);
      results.push({ label: c.label, ms: r.ms, ok: false, status: r.status });
    }
  }

  await marieClient.signOut();
  await thomasClient.signOut();

  const oks = results.filter(r => r.ok);
  const vulns = oks.map(r => r.vuln).filter(v => typeof v === 'number');
  const uniqueVulns = [...new Set(vulns)];
  const sonnetFails = oks.filter(r => !r.sonnetOk).length;
  const gptFails = oks.filter(r => !r.gptOk).length;

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTAT: ${oks.length}/10 OK HTTP`);
  console.log(`Valeurs vulnerability_score observees: [${vulns.join(', ')}]`);
  console.log(`Valeurs distinctes: ${uniqueVulns.length} sur ${vulns.length} mesures`);
  console.log(`Sonnet echecs: ${sonnetFails}/10 | GPT echecs: ${gptFails}/10`);
  console.log(`Consensus distribution: ${JSON.stringify(oks.reduce((acc,r)=>{acc[r.consensus]=(acc[r.consensus]||0)+1;return acc;},{}))}`);
  console.log('='.repeat(70));

  writeFileSync(join(__dir, 'nexus_tier3_batch2_results.json'), JSON.stringify(results, null, 2), 'utf8');
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
