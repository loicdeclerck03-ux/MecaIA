#!/usr/bin/env node
// tests/run_dylan_100.mjs — 100 scenarios jusqu'a CONCLUSION, 10 par 10
// Critere succes : CONCLUSION + cause + cout + can_drive

import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';
import { writeFileSync } from 'fs';

const MARIE = AGENTS.find(a => a.id === 'marie');
const THOMAS = AGENTS.find(a => a.id === 'thomas');
const mc = await MecaIAClient.create(MARIE);
const tc = await MecaIAClient.create(THOMAS);
const mv = MARIE.vehicle;
const tv = THOMAS.vehicle;
const mv_veh = { make: mv.marque, model: mv.modele, year: mv.annee, fuel: mv.carbu, mileage_km: parseInt(mv.km) };
const tv_veh = { make: tv.marque, model: tv.modele, year: tv.annee, fuel: tv.carbu, mileage_km: parseInt(tv.km) };
const peugeot_veh = { make: 'Peugeot', model: '208', year: '2019', fuel: 'essence', mileage_km: 45000 };
const golf_veh = { make: 'Volkswagen', model: 'Golf', year: '2017', fuel: 'diesel', mileage_km: 130000 };
const megane_veh = { make: 'Renault', model: 'Megane', year: '2018', fuel: 'essence', mileage_km: 95000 };

const SCENARIOS = [
  // BATCH 1 — codes OBD seuls (fast-track)
  { id:1,  ag:'m', veh:mv_veh, q:'P0420' },
  { id:2,  ag:'m', veh:mv_veh, q:'P0401' },
  { id:3,  ag:'t', veh:tv_veh, q:'P0300' },
  { id:4,  ag:'m', veh:megane_veh, q:'P0171' },
  { id:5,  ag:'t', veh:tv_veh, q:'P0299' },
  { id:6,  ag:'t', veh:tv_veh, q:'C1201' },
  { id:7,  ag:'m', veh:mv_veh, q:'P0128' },
  { id:8,  ag:'t', veh:tv_veh, q:'P0011' },
  { id:9,  ag:'m', veh:mv_veh, q:'P0455' },
  { id:10, ag:'m', veh:{make:'Peugeot',model:'508',year:'2015',fuel:'diesel',mileage_km:120000}, q:'P0700' },

  // BATCH 2 — symptomes sans code
  { id:11, ag:'m', veh:mv_veh, q:'Bruit bizarre quand je freine depuis ce matin' },
  { id:12, ag:'t', veh:tv_veh, q:'Fumee noire au demarrage et sous acceleration' },
  { id:13, ag:'t', veh:tv_veh, q:'Perte de puissance progressive depuis 3 jours, moteur bride' },
  { id:14, ag:'m', veh:mv_veh, q:'Bruit de claquement quand je tourne, surtout a basse vitesse' },
  { id:15, ag:'t', veh:tv_veh, q:'Le moteur cale au ralenti uniquement quand il est froid' },
  { id:16, ag:'m', veh:mv_veh, q:"Odeur de brule depuis l'habitacle ce matin" },
  { id:17, ag:'t', veh:tv_veh, q:'Fumee blanche au demarrage a froid, disparait apres 5 minutes' },
  { id:18, ag:'m', veh:mv_veh, q:'Voyant batterie allume et voiture demarre difficilement le matin' },
  { id:19, ag:'m', veh:mv_veh, q:'Vibration du volant a partir de 110km/h sur autoroute' },
  { id:20, ag:'t', veh:tv_veh, q:"La pedale de frein descend jusqu'en bas, freinage tres mou" },

  // BATCH 3 — codes + symptomes combines
  { id:21, ag:'m', veh:mv_veh, q:'P0401 et je consomme beaucoup plus depuis 2 mois' },
  { id:22, ag:'t', veh:tv_veh, q:'P0300 et cliquetis metallique au demarrage a froid' },
  { id:23, ag:'m', veh:megane_veh, q:'P0420 et P0171 en meme temps' },
  { id:24, ag:'t', veh:tv_veh, q:'P0299 et sifflement sous le capot' },
  { id:25, ag:'t', veh:tv_veh, q:'C1201 et le voyant ABS clignote depuis hier' },
  { id:26, ag:'m', veh:mv_veh, q:'P0401 revient toujours apres nettoyage EGR il y a 3 semaines' },
  { id:27, ag:'t', veh:tv_veh, q:'P0128 et la voiture met 15 minutes a chauffer meme en ete' },
  { id:28, ag:'t', veh:tv_veh, q:"P0011 et je rajoute 1 litre d'huile tous les 2000km" },
  { id:29, ag:'m', veh:mv_veh, q:'Le voyant moteur et le DSC sont allumes en meme temps' },
  { id:30, ag:'m', veh:mv_veh, q:'P0170 et la voiture cale 2-3 fois par semaine' },

  // BATCH 4 — autres marques/modeles
  { id:31, ag:'m', veh:peugeot_veh, q:'P0016' },
  { id:32, ag:'t', veh:golf_veh, q:'P2563' },
  { id:33, ag:'m', veh:{make:'Citroen',model:'C3',year:'2016',fuel:'essence',mileage_km:75000}, q:'Vibration forte et desagreable au ralenti depuis 1 semaine' },
  { id:34, ag:'m', veh:{make:'Toyota',model:'Yaris',year:'2020',fuel:'essence',mileage_km:38000}, q:'P0420' },
  { id:35, ag:'t', veh:{make:'Ford',model:'Focus',year:'2015',fuel:'diesel',mileage_km:145000}, q:'Le voyant FAP est allume et la voiture est en mode degrade' },
  { id:36, ag:'m', veh:{make:'Opel',model:'Astra',year:'2014',fuel:'essence',mileage_km:98000}, q:"Demarre difficilement a froid, il faut insister 3-4 secondes" },
  { id:37, ag:'t', veh:{make:'Dacia',model:'Duster',year:'2018',fuel:'diesel',mileage_km:82000}, q:'La temperature du moteur monte trop haut par temps chaud' },
  { id:38, ag:'m', veh:{make:'Hyundai',model:'i20',year:'2021',fuel:'essence',mileage_km:22000}, q:'P0301 allume, moteur tremble' },
  { id:39, ag:'t', veh:{make:'Mercedes',model:'C220',year:'2016',fuel:'diesel',mileage_km:160000}, q:'P0087' },
  { id:40, ag:'t', veh:{make:'Audi',model:'A4',year:'2013',fuel:'essence',mileage_km:195000}, q:"Je perds beaucoup d'huile, 1 litre tous les 1500km sans fuite visible" },

  // BATCH 5 — urgences securite
  { id:41, ag:'m', veh:mv_veh, q:'Fumee sort de sous le capot en roulant' },
  { id:42, ag:'t', veh:tv_veh, q:"Forte odeur d'essence a l'interieur de la voiture" },
  { id:43, ag:'m', veh:mv_veh, q:'Le frein a main ne tient plus, la voiture glisse en pente' },
  { id:44, ag:'t', veh:tv_veh, q:'Le voyant temperature est passe au rouge et ca fait un bruit bizarre' },
  { id:45, ag:'m', veh:mv_veh, q:"Flaque sous la voiture cote roue avant gauche, liquide transparent" },
  { id:46, ag:'t', veh:tv_veh, q:'La direction assistee est partie brutalement, le volant est tres dur' },
  { id:47, ag:'m', veh:mv_veh, q:"La voiture a glisse dans un virage, l'ESP n'a pas reagi" },
  { id:48, ag:'t', veh:tv_veh, q:"Bruit de frottement metallique de la roue avant droite, s'aggrave en freinant" },
  { id:49, ag:'m', veh:mv_veh, q:"Le voyant airbag est allume apres qu'on m'a percute par derriere" },
  { id:50, ag:'t', veh:tv_veh, q:"J'ai roule sur un clou, le pneu perd de l'air lentement" },

  // BATCH 6 — pannes electriques
  { id:51, ag:'m', veh:mv_veh, q:'Voyant batterie allume en permanence, voiture demarre encore' },
  { id:52, ag:'t', veh:tv_veh, q:"La voiture ne demarre plus du tout ce matin, il n'y a meme plus de bip" },
  { id:53, ag:'m', veh:mv_veh, q:"Quand je tourne la cle, ca fait un cliquetis rapide et ca ne demarre pas" },
  { id:54, ag:'t', veh:tv_veh, q:'Le leve-vitre avant gauche ne fonctionne plus, moteur silencieux' },
  { id:55, ag:'m', veh:mv_veh, q:'La batterie se decharge en 2 jours si la voiture ne roule pas' },
  { id:56, ag:'t', veh:tv_veh, q:'Mon feu stop arriere gauche ne fonctionne plus' },
  { id:57, ag:'m', veh:mv_veh, q:'Le klaxon ne fonctionne plus depuis hier' },
  { id:58, ag:'t', veh:tv_veh, q:'Tout le tableau de bord est eteint mais la voiture demarre' },
  { id:59, ag:'m', veh:mv_veh, q:'La climatisation souffle mais ne refroidit plus du tout' },
  { id:60, ag:'t', veh:tv_veh, q:'La telecommande ne deverrouille plus les portes, pile neuve' },

  // BATCH 7 — transmission/boite
  { id:61, ag:'t', veh:tv_veh, q:"L'embrayage glisse en 3eme a haute vitesse, regime monte sans accelerer" },
  { id:62, ag:'m', veh:mv_veh, q:'La boite de vitesses cogne quand je passe la 2eme' },
  { id:63, ag:'t', veh:tv_veh, q:'Bruit de claquement en virage serre uniquement, surtout a gauche' },
  { id:64, ag:'m', veh:mv_veh, q:'Grincement en virage a basse vitesse, pire sur parking' },
  { id:65, ag:'m', veh:{make:'Peugeot',model:'508',year:'2015',fuel:'diesel',mileage_km:120000}, q:'Choc violent quand la boite automatique passe le 1er rapport' },
  { id:66, ag:'t', veh:tv_veh, q:"La marche arriere et le point mort sont durs a engager a froid" },
  { id:67, ag:'m', veh:mv_veh, q:"Tremblement uniquement pendant l'acceleration entre 60-90km/h" },
  { id:68, ag:'t', veh:tv_veh, q:'Bruit sourd quand je demarre ou freine brusquement, cote moteur' },
  { id:69, ag:'m', veh:mv_veh, q:'Ronflement continu qui augmente avec la vitesse, cote avant droit' },
  { id:70, ag:'t', veh:tv_veh, q:'La voiture penche et rebondit beaucoup dans les bosses' },

  // BATCH 8 — moteur/injection
  { id:71, ag:'t', veh:tv_veh, q:'Odeur de gasoil apres demarrage, sous le capot' },
  { id:72, ag:'m', veh:mv_veh, q:'La voiture chauffe rapidement et il y a un sifflement eau' },
  { id:73, ag:'t', veh:tv_veh, q:'Fumee blanche permanente, niveau eau baisse, huile cremeuse' },
  { id:74, ag:'m', veh:mv_veh, q:'Couinement sous le capot au demarrage, disparait apres 2 minutes' },
  { id:75, ag:'t', veh:tv_veh, q:'Perte de puissance et surconsommation depuis la pluie de la semaine' },
  { id:76, ag:'m', veh:mv_veh, q:'Calage au ralenti et fumee noire, code P0401' },
  { id:77, ag:'m', veh:megane_veh, q:'P0136 et consommation augmentee de 2L/100' },
  { id:78, ag:'t', veh:tv_veh, q:'Sifflement aigu sous acceleration et perte de puissance soudaine' },
  { id:79, ag:'m', veh:mv_veh, q:'Huile partout sous le capot, bouchon de remplissage semble HS' },
  { id:80, ag:'t', veh:tv_veh, q:'Fumee noire epaisse, perte totale de puissance, turbo semble mort' },

  // BATCH 9 — entretien/CT
  { id:81, ag:'m', veh:mv_veh, q:'Mon controle technique est dans 3 mois, que dois-je verifier ?' },
  { id:82, ag:'t', veh:tv_veh, q:"J'ai 156000km, dois-je changer la courroie de distribution ?" },
  { id:83, ag:'m', veh:mv_veh, q:"J'ai oublie la vidange, je suis a 18000km depuis la derniere" },
  { id:84, ag:'t', veh:tv_veh, q:'Mes pneus arrivent a 3mm, faut-il les changer avant hiver ?' },
  { id:85, ag:'m', veh:mv_veh, q:'Quand faut-il changer les bougies sur ma voiture ?' },
  { id:86, ag:'t', veh:tv_veh, q:"Mauvaise odeur a l'interieur quand je mets le chauffage" },
  { id:87, ag:'m', veh:mv_veh, q:"Mon niveau de liquide de frein est au minimum, c'est grave ?" },
  { id:88, ag:'t', veh:tv_veh, q:"Je dois rajouter de l'eau dans le circuit, je peux mettre de l'eau du robinet ?" },
  { id:89, ag:'m', veh:{make:'Renault',model:'Clio',year:'2024',fuel:'essence',mileage_km:500}, q:"Voiture neuve, je dois eviter quoi pendant le rodage ?" },
  { id:90, ag:'m', veh:mv_veh, q:"Le voyant TPMS est allume, j'ai verifie les pressions et c'est bon" },

  // BATCH 10 — cas limites et difficiles
  { id:91, ag:'t', veh:tv_veh, q:'Bruit une fois sur 20, impossible a reproduire chez le garagiste' },
  { id:92, ag:'m', veh:mv_veh, q:'Le garagiste a change le capteur MAF il y a 2 semaines et la panne revient' },
  { id:93, ag:'t', veh:tv_veh, q:'P0016 et P0017 ensemble, distribution ?' },
  { id:94, ag:'m', veh:mv_veh, q:"Depuis le lavage haute pression moteur, ca ne marche plus bien" },
  { id:95, ag:'t', veh:tv_veh, q:"J'ai eu un petit accident par l'avant il y a un mois, maintenant ca tire a gauche" },
  { id:96, ag:'m', veh:mv_veh, q:'P0420, P0401 et C1201 sont tous allumes en meme temps' },
  { id:97, ag:'t', veh:tv_veh, q:'Il fait -15 degres ce matin et la voiture ne veut pas demarrer' },
  { id:98, ag:'m', veh:mv_veh, q:"Depuis le dernier plein, voiture bizarre, a-coups a l'acceleration" },
  { id:99, ag:'t', veh:tv_veh, q:'P0335' },
  { id:100, ag:'m', veh:mv_veh, q:'De la fumee epaisse sort du moteur et ca sent le brule tres fort' },
];

async function runToConclusion(scenario) {
  const client = scenario.ag === 'm' ? mc : tc;
  const startTs = Date.now();
  let session_id = null;
  let data = null;
  let tours = 0;
  const MAX = 7;
  // Réponse automatique riche — donne le contexte minimal que Dylan attend
  const AUTO_CONTEXT = "Depuis hier matin. Le problème est permanent, froid et chaud. Je peux encore rouler pour l'instant.";

  try {
    let r = await client.call('dylan_agents', { user_input: scenario.q, vehicle: scenario.veh });
    if (!r.ok) return { id: scenario.id, ok: false, reason: `HTTP ${r.status}`, tours: 1, ms: Date.now()-startTs };
    session_id = r.data?.session_id;
    data = r.data;
    tours = 1;

    while (data?.etat !== 'CONCLUSION' && tours < MAX) {
      const payload = { session_id, vehicle: scenario.veh };
      if (data?.controle) {
        payload.control_result = 'oui'; // Simuler résultat positif au contrôle
      } else if (data?.etat === 'CONTEXTE' && tours === 1) {
        payload.user_input = AUTO_CONTEXT; // Donner le contexte minimal
      } else if (data?.etat === 'CONTEXTE') {
        payload.user_input = "Froid et chaud, permanent. Pas de code OBD connu.";
      } else {
        payload.user_input = "Continuez avec les hypothèses les plus probables.";
      }
      r = await client.call('dylan_agents', payload);
      if (!r.ok) break;
      data = r.data;
      tours++;
    }

    const cc = data?.conclusion;
    const ok = data?.etat === 'CONCLUSION'
      && cc?.cause && cc.cause.length > 5
      && (cc.cost_min !== undefined || cc.cost_max !== undefined);

    return {
      id: scenario.id, label: scenario.q.slice(0, 50),
      ok, etat: data?.etat,
      cause: cc?.cause?.slice(0, 90) || '',
      cost: cc ? `${cc.cost_min}-${cc.cost_max}` : '',
      can_drive: cc?.can_drive,
      urgency: cc?.urgency,
      tours, ms: Date.now() - startTs,
      reason: !ok ? (data?.etat !== 'CONCLUSION' ? 'Pas de CONCLUSION' : 'Conclusion incomplete') : '',
    };
  } catch(e) {
    return { id: scenario.id, label: scenario.q.slice(0,50), ok: false, reason: e.message.slice(0,60), tours, ms: Date.now()-startTs };
  }
}

const results = [];
const BATCH = 10;

for (let b = 0; b < SCENARIOS.length; b += BATCH) {
  const batch = SCENARIOS.slice(b, b + BATCH);
  const bn = Math.floor(b / BATCH) + 1;

  // Re-login entre batches pour éviter les 401 (token Supabase expire après ~60min)
  if (b > 0 && bn % 3 === 1) {
    try {
      const newMc = await MecaIAClient.create(MARIE);
      const newTc = await MecaIAClient.create(THOMAS);
      Object.assign(mc, newMc);
      Object.assign(tc, newTc);
      console.log('  [refresh] tokens renouveles');
    } catch(e) { console.warn('  [refresh] echec:', e.message); }
  }

  console.log(`\n${'='.repeat(68)}`);
  console.log(`  BATCH ${bn}/10 — scenarios ${b+1}-${b+batch.length}`);
  console.log('='.repeat(68));

  for (const s of batch) {
    process.stdout.write(`  [${String(s.id).padStart(3)}] ${s.q.slice(0,42).padEnd(42)} `);
    const r = await runToConclusion(s);
    results.push(r);
    if (r.ok) {
      console.log(`✅ T${r.tours} ${r.ms}ms | ${r.cause.slice(0,48)}`);
    } else {
      console.log(`❌ T${r.tours} ${r.ms}ms | ${r.reason}`);
    }
  }

  const nbOk = results.slice(-BATCH).filter(r => r.ok).length;
  console.log(`\n  Batch ${bn}: ${nbOk}/${batch.length} ✅`);
}

const total = results.length;
const nbOk = results.filter(r => r.ok).length;
const fails = results.filter(r => !r.ok);
const avgMs = Math.round(results.reduce((s,r) => s+(r.ms||0), 0)/total);
const avgT = (results.reduce((s,r) => s+(r.tours||0), 0)/total).toFixed(1);

console.log(`\n${'═'.repeat(68)}`);
console.log(`  RESULTAT FINAL : ${nbOk}/${total} OK  (${Math.round(nbOk/total*100)}%)  |  moy ${avgMs}ms  |  moy ${avgT} tours`);
console.log('═'.repeat(68));

if (fails.length) {
  console.log(`\n  ECHECS (${fails.length}) :`);
  fails.forEach(f => console.log(`  [${f.id}] ${f.label} — ${f.reason}`));
}

writeFileSync('./dylan_100_results.json', JSON.stringify(results, null, 2), 'utf8');
console.log('\n  Resultats sauvegardes → dylan_100_results.json');
await mc.signOut();
await tc.signOut();
