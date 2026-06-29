// tool_single.mjs - teste UN seul scenario outil (passe idx en arg)
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const IDX = parseInt(process.argv[2] || '0');
const TOOL_SCENARIOS = [
  { id:'T3', name:'Fuite admission — vacuometre',
    make:'Citroen', model:'C3 III', year:2018, fuel:'essence', km:41000,
    msg1:'Citroen C3 1.2 PureTech 2018 41000km. P0171 melange trop pauvre, LTFT +14%. Symptome: consommation elevee, leger a-coup acceleration. Quelles sont tes hypotheses pour cette panne ?',
    msg2:'Jai un vacuometre. Explique-moi exactement comment l utiliser sur ce moteur pour detecter la fuite admission.'},
  { id:'T4', name:'Pression carburant — manometre',
    make:'Audi', model:'A3 8V', year:2016, fuel:'essence', km:73000,
    msg1:'Audi A3 1.4 TFSI 2016 73000km. P0087 pression carburant insuffisante rail. Rates sous charge, demarrage difficile a chaud. Hypotheses ?',
    msg2:'Jai un manometre carburant. Comment je le branche sur mon Audi TFSI pour mesurer la pression rail ?'},
  { id:'T5', name:'Parasitaire — pince amperemtrique',
    make:'Opel', model:'Mokka A', year:2014, fuel:'essence', km:112000,
    msg1:'Opel Mokka 1.4 Turbo 2014 112000km. Batterie se decharge completement en 2-3 jours de stationnement. Alternateur OK, tension 14.2V moteur tourne, batterie AGM neuve. Quelles hypotheses ?',
    msg2:'Jai une pince amperemtrique. Guide-moi exactement pour mesurer le courant parasite sur mon Mokka.'}
];

const ts = TOOL_SCENARIOS[IDX];
if (!ts) { console.error('Index invalide'); process.exit(1); }

async function dylanCall(client, msg, veh, sid) {
  const r = await client.call('dylan_agents', {
    session_id: sid||null, user_input: msg, language:'fr', messages:[],
    vehicle:{make:veh.make,model:veh.model,year:veh.year,fuel:veh.fuel,mileage_km:veh.km},
    vehicle_marque:veh.make, vehicle_modele:veh.model, vehicle_km:veh.km
  });
  return {
    ok: r.ok, status: r.status,
    session_id: r.data?.session_id || r.data?.data?.session_id || null,
    reply: r.data?.reply || r.data?.message || r.data?.data?.reply || r.data?.data?.message || '',
    tool_guide: r.data?.tool_guide || r.data?.data?.tool_guide || null,
    etat: r.data?.etat || r.data?.data?.etat || '?',
    raw_keys: r.data ? Object.keys(r.data).join(',') : 'null'
  };
}

(async () => {
  const client = await MecaIAClient.create(AGENTS[0]);
  console.log(`=== ${ts.id}: ${ts.name} ===`);
  const veh = {make:ts.make,model:ts.model,year:ts.year,fuel:ts.fuel,km:ts.km};

  console.log('Tour 1...');
  const r1 = await dylanCall(client, ts.msg1, veh, null);
  console.log(`  status: ${r1.status} | etat: ${r1.etat} | session: ${r1.session_id?.slice(0,8)}`);
  console.log(`  raw_keys: ${r1.raw_keys}`);
  console.log(`  reply: ${r1.reply.slice(0,150)}`);

  if (!r1.session_id) { console.log('ECHEC tour 1 — pas de session'); process.exit(1); }
  await new Promise(r=>setTimeout(r,2000));

  console.log('Tour 2...');
  const r2 = await dylanCall(client, ts.msg2, veh, r1.session_id);
  console.log(`  status: ${r2.status} | etat: ${r2.etat}`);
  console.log(`  reply: ${r2.reply.slice(0,200)}`);
  console.log(`  tool_guide: ${r2.tool_guide ? 'OUI ✅ outil=' + JSON.stringify(r2.tool_guide.outil) : 'NON ❌'}`);
  if (r2.tool_guide?.fiche) console.log(`  Fiche: ${r2.tool_guide.fiche.slice(0,200)}`);

  await client.signOut().catch(()=>{});
})();
