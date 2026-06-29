// tool_quick_3.mjs - T3 simplifie pour eviter timeout Netlify
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { AGENTS } from './agents/personas.mjs';

async function dylanCall(client, msg, veh, sid) {
  const r = await client.call('dylan_agents', {
    session_id:sid||null, user_input:msg, language:'fr', messages:[],
    vehicle:{make:veh.make,model:veh.model,year:veh.year,fuel:veh.fuel,mileage_km:veh.km},
    vehicle_marque:veh.make, vehicle_modele:veh.model, vehicle_km:veh.km
  });
  return {
    ok:r.ok, status:r.status,
    session_id: r.data?.session_id||null,
    reply: r.data?.reply||r.data?.message||'',
    tool_guide: r.data?.tool_guide||null,
    etat: r.data?.etat||'?'
  };
}

(async () => {
  const client = await MecaIAClient.create(AGENTS[1]); // Thomas (18 credits)
  const veh = {make:'Volkswagen',model:'Golf VII',year:2015,fuel:'diesel',km:143000};
  console.log(`Agent: ${client.agent.name}\n`);

  // T3-bis: vacuometre sur diesel (plus fiable que essence complex)
  console.log('=== T3-bis: Vacuometre — VW Golf diesel P2002 ===');
  const r1 = await dylanCall(client, 'VW Golf 7 2.0 TDI 2015 143000km. P2002 FAP efficacite insuffisante + perte puissance. Fuite admission suspectee LTFT +9%.', veh, null);
  console.log(`T1: status=${r1.status} etat=${r1.etat} session=${r1.session_id?.slice(0,8)}`);
  await new Promise(r=>setTimeout(r,1500));

  if (r1.session_id) {
    const r2 = await dylanCall(client, 'Jai un vacuometre. Comment je l utilise pour tester si j ai une fuite admission sur ce Golf TDI ?', veh, r1.session_id);
    console.log(`T2: status=${r2.status} etat=${r2.etat}`);
    console.log(`reply: ${r2.reply.slice(0,200)}`);
    console.log(`tool_guide: ${r2.tool_guide ? 'OUI ✅ outil='+JSON.stringify(r2.tool_guide.outil) : 'NON ❌'}`);
    if (r2.tool_guide?.fiche) console.log(`fiche: ${r2.tool_guide.fiche.slice(0,200)}`);
  }

  await new Promise(r=>setTimeout(r,1000));

  // T4-bis: manometre diesel
  console.log('\n=== T4-bis: Manometre — Audi diesel ===');
  const veh4={make:'Renault',model:'Megane III',year:2015,fuel:'diesel',km:98000};
  const r3 = await dylanCall(client, 'Renault Megane III dCi 2015. P0089 pression carburant regulateur performance. Pression rail insuffisante.', veh4, null);
  console.log(`T1: status=${r3.status} etat=${r3.etat} session=${r3.session_id?.slice(0,8)}`);
  await new Promise(r=>setTimeout(r,1500));

  if (r3.session_id) {
    const r4 = await dylanCall(client, 'Jai un manometre carburant. Comment je le branche sur le rail diesel pour mesurer la pression ?', veh4, r3.session_id);
    console.log(`T2: status=${r4.status} etat=${r4.etat}`);
    console.log(`reply: ${r4.reply.slice(0,200)}`);
    console.log(`tool_guide: ${r4.tool_guide ? 'OUI ✅ outil='+JSON.stringify(r4.tool_guide.outil) : 'NON ❌'}`);
    if (r4.tool_guide?.fiche) console.log(`fiche: ${r4.tool_guide.fiche.slice(0,200)}`);
  }

  await new Promise(r=>setTimeout(r,1000));

  // T5-bis: pince amperemtrique sur circuit simple
  console.log('\n=== T5-bis: Pince amperemtrique — Renault Clio ===');
  const veh5={make:'Renault',model:'Clio IV',year:2016,fuel:'diesel',km:87000};
  const r5 = await dylanCall(client, 'Renault Clio IV dCi 2016. Batterie se decharge en 48h stationnement. Alternateur verifie OK. Batterie neuve 3 mois. Suspecte courant parasite.', veh5, null);
  console.log(`T1: status=${r5.status} etat=${r5.etat} session=${r5.session_id?.slice(0,8)}`);
  await new Promise(r=>setTimeout(r,1500));

  if (r5.session_id) {
    const r6 = await dylanCall(client, 'Jai une pince amperemtrique. Comment je mesure le courant parasite sur ma Clio ?', veh5, r5.session_id);
    console.log(`T2: status=${r6.status} etat=${r6.etat}`);
    console.log(`reply: ${r6.reply.slice(0,200)}`);
    console.log(`tool_guide: ${r6.tool_guide ? 'OUI ✅ outil='+JSON.stringify(r6.tool_guide.outil) : 'NON ❌'}`);
    if (r6.tool_guide?.fiche) console.log(`fiche: ${r6.tool_guide.fiche.slice(0,200)}`);
  }

  await client.signOut().catch(()=>{});
})();
