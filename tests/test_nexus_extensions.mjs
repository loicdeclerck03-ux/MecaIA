#!/usr/bin/env node
// tests/test_nexus_extensions.mjs — sanity check recall_radar + vision + voice (auth only)
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const THOMAS = AGENTS.find(a => a.id === 'thomas');
const client = await MecaIAClient.create(THOMAS);
const v = THOMAS.vehicle;
console.log('Auth OK\n');

// 1. nexus_recall_radar — véhicule réel Thomas (BMW E46 2003)
console.log('[1/3] nexus_recall_radar — BMW E46 320d 2003...');
let r = await client.call('nexus_recall_radar', { make: v.marque, model: v.modele, year: v.annee });
console.log(`  Statut: ${r.status} | Rappels: ${r.data?.total ?? 'err'} | Critiques: ${r.data?.critical_count ?? '-'} | Sources: NHTSA=${r.data?.sources?.nhtsa} EU=${r.data?.sources?.eu} | MS: ${r.data?.elapsed_ms}`);
if (r.data?.recalls?.length) console.log(`  1er rappel: [${r.data.recalls[0].severity}] ${r.data.recalls[0].component}: ${r.data.recalls[0].summary?.slice(0,80)}`);

// 2. nexus_vision — image invalide → 400 attendu (pas de clé API en test)
console.log('\n[2/3] nexus_vision — test auth (image vide)...');
r = await client.call('nexus_vision', { image: '', mimeType: 'image/jpeg' });
console.log(`  Statut: ${r.status} (attendu 400) | Erreur: ${r.data?.error}`);

// 3. nexus_voice — audio invalide → 400 attendu
console.log('\n[3/3] nexus_voice — test auth (audio vide)...');
r = await client.call('nexus_voice', { audio: '', audioFormat: 'webm' });
console.log(`  Statut: ${r.status} (attendu 400) | Erreur: ${r.data?.error}`);

await client.signOut();
console.log('\n✅ Sanity check terminé — fonctions accessibles et authentifiées.');
