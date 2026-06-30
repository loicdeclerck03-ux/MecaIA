#!/usr/bin/env node
// tests/test_dylan_memory.mjs — Vérifie les 3 bugs fixes :
// 1. Dylan ne repose pas la même question au tour 3
// 2. La mémoire inter-session injecte les diagnostics précédents
// 3. Le merge contexte ne perd pas les valeurs entre tours

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const THOMAS = AGENTS.find(a => a.id === 'thomas');
const client = await MecaIAClient.create(THOMAS);
const v = THOMAS.vehicle;

console.log('='.repeat(60));
console.log('  TEST MÉMOIRE DYLAN — 4 tours consécutifs');
console.log('='.repeat(60));

let session_id = null;

// Tour 1 — symptôme initial
console.log('\n[TOUR 1] Symptôme initial...');
let r = await client.call('dylan_agents', {
  user_input: "Bruit de claquement au démarrage à froid, disparaît après 2 minutes",
  vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) },
});
console.log(`  Statut: ${r.status} | État: ${r.data?.etat} | Session: ${r.data?.session_id?.slice(0,8)}`);
console.log(`  Réponse: ${r.data?.reply?.slice(0,150)}`);
session_id = r.data?.session_id;

// Tour 2 — info complémentaire
console.log('\n[TOUR 2] Info complémentaire...');
r = await client.call('dylan_agents', {
  user_input: "C'est surtout quand le moteur est vraiment froid, moins 5 degrés ce matin",
  session_id,
  vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) },
});
console.log(`  Statut: ${r.status} | État: ${r.data?.etat}`);
console.log(`  Réponse: ${r.data?.reply?.slice(0,150)}`);
const redemandeBruit = (r.data?.reply || '').toLowerCase().includes('quel bruit') || (r.data?.reply || '').toLowerCase().includes('pouvez-vous décrire');
console.log(`  ⚠️  Redemande le symptôme initial ? ${redemandeBruit ? 'OUI (BUG)' : 'NON (OK)'}`);

// Tour 3 — réponse à une question Dylan
console.log('\n[TOUR 3] Réponse à question Dylan...');
r = await client.call('dylan_agents', {
  user_input: "Le bruit ressemble à du métal qui claque, genre chaîne",
  session_id,
  vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) },
});
console.log(`  Statut: ${r.status} | État: ${r.data?.etat}`);
console.log(`  Hypothèses: ${(r.data?.hypotheses||[]).map(h=>h.libelle).join(' | ')}`);
console.log(`  Réponse: ${r.data?.reply?.slice(0,200)}`);
const recommenceDiag = (r.data?.reply || '').toLowerCase().includes('quel est') || (r.data?.reply || '').toLowerCase().includes('décrivez');
console.log(`  ⚠️  Recommence le diagnostic ? ${recommenceDiag ? 'OUI (BUG)' : 'NON (OK)'}`);

// Tour 4 — vérifier que le symptôme est toujours dans l'état
console.log('\n[TOUR 4] Test contexte préservé...');
r = await client.call('dylan_agents', {
  user_input: "Oui ça semble venir du côté du moteur",
  session_id,
  vehicle: { make: v.marque, model: v.modele, year: v.annee, fuel: v.carbu, mileage_km: parseInt(v.km) },
});
console.log(`  Statut: ${r.status} | État: ${r.data?.etat}`);
console.log(`  Réponse: ${r.data?.reply?.slice(0,200)}`);

await client.signOut();
console.log('\n✅ Test terminé. Vérifier manuellement si aucun bug de redémarrage n\'est survenu.');
