// tool_guide_test.mjs - 5 tests multi-tour pour verifier response.tool_guide
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

const TOOL_SCENARIOS = [
  { id:'T1', name:'Alternateur — multimetre tension',
    make:'Renault', model:'Megane III', year:2012, fuel:'diesel', km:156000,
    msg1:'Renault Megane III 1.5 dCi 2012 156000km. Voyant batterie rouge allume moteur tournant. Tension 12.1V mesure. Code P0622 generateur champ circuit. Quelles hypotheses ?',
    msg2:'Jai un multimetre. Dis-moi exactement comment tester alternateur et circuit de charge maintenant.'},
  { id:'T2', name:'ABS capteur roue — multimetre resistance',
    make:'Volkswagen', model:'Sharan II', year:2015, fuel:'diesel', km:134000,
    msg1:'VW Sharan 2.0 TDI 2015. ABS se declenche basse vitesse sur route seche. Code C0040 capteur vitesse roue avant gauche.',
    msg2:'Jai un multimetre. Comment tester exactement le capteur ABS roue avant gauche ?'},
  { id:'T3', name:'Fuite admission — vacuometre',
    make:'Citroen', model:'C3 III', year:2018, fuel:'essence', km:41000,
    msg1:'Citroen C3 1.2 PureTech 2018. P0171 melange trop pauvre LTFT +14%. Quelles hypotheses ?',
    msg2:'Jai un vacuometre. Comment l utiliser pour localiser la fuite sur ce moteur ?'},
  { id:'T4', name:'Pression carburant — manometre',
    make:'Audi', model:'A3 8V', year:2016, fuel:'essence', km:73000,
    msg1:'Audi A3 1.4 TFSI 2016. P0087 pression carburant insuffisante. Rates sous charge.',
    msg2:'Jai un manometre de carburant. Comment mesurer la pression sur ma rampe injection ?'},
  { id:'T5', name:'Parasitaire — pince amperemtrique',
    make:'Opel', model:'Mokka A', year:2014, fuel:'essence', km:112000,
    msg1:'Opel Mokka 1.4 Turbo 2014. Batterie se decharge en 2 jours stationnement. Alternateur OK tension 14.2V moteur tourne.',
    msg2:'Jai une pince amperemtrique. Comment mesurer le courant parasite sur mon Mokka ?'}
];

async function dylanCall(client, msg, vehicule, sessionId) {
  const r = await client.call('dylan_agents', {
    session_id: sessionId || null, user_input: msg, language: 'fr', messages: [],
    vehicle: { make: vehicule.make, model: vehicule.model, year: vehicule.year, fuel: vehicule.fuel, mileage_km: vehicule.km },
    vehicle_marque: vehicule.make, vehicle_modele: vehicule.model, vehicle_km: vehicule.km
  });
  return {
    ok: r.ok, status: r.status,
    session_id: r.data?.session_id || r.data?.data?.session_id,
    reply: r.data?.reply || r.data?.message || r.data?.data?.reply || '',
    tool_guide: r.data?.tool_guide || r.data?.data?.tool_guide || null,
    etat: r.data?.etat || r.data?.data?.etat,
  };
}

(async () => {
  const client = await MecaIAClient.create(AGENTS[0]);
  console.log(`Agent: ${client.agent.name}\n`);
  const results = [];

  for (const ts of TOOL_SCENARIOS) {
    console.log(`=== ${ts.id}: ${ts.name} ===`);
    const veh = { make: ts.make, model: ts.model, year: ts.year, fuel: ts.fuel, km: ts.km };

    const r1 = await dylanCall(client, ts.msg1, veh, null);
    console.log(`  Tour 1 etat: ${r1.etat} | session: ${r1.session_id?.slice(0,8)}...`);
    await new Promise(r => setTimeout(r, 600));

    const r2 = await dylanCall(client, ts.msg2, veh, r1.session_id);
    console.log(`  Tour 2 etat: ${r2.etat}`);
    console.log(`  Reply T2: ${r2.reply.slice(0, 180)}...`);
    console.log(`  tool_guide: ${r2.tool_guide ? 'OUI ✅ outil=' + JSON.stringify(r2.tool_guide.outil) : 'NON ❌'}`);
    if (r2.tool_guide?.fiche) console.log(`  Fiche: ${r2.tool_guide.fiche.slice(0,120)}`);
    console.log();
    results.push({ ...ts, r1_etat: r1.etat, r2_etat: r2.etat, r2_reply: r2.reply, tool_guide: r2.tool_guide });
    await new Promise(r => setTimeout(r, 500));
  }

  const ok = results.filter(r => r.tool_guide).length;
  console.log(`\n=== BILAN FICHES OUTILS: ${ok}/${TOOL_SCENARIOS.length} ===`);
  results.forEach(r => console.log(`  ${r.tool_guide ? '✅' : '❌'} ${r.id} ${r.name}`));

  await client.signOut().catch(() => {});
})();
