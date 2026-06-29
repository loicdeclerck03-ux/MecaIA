// sample_10.mjs — 10 tests pour mesurer le gain post-fix
import { MecaIAClient } from './lib/mecaia_client.mjs';
import { BATTERY } from './agents/battery_scenarios.mjs';
import { AGENTS } from './agents/personas.mjs';

const SAMPLE = [BATTERY[0],BATTERY[7],BATTERY[15],BATTERY[30],BATTERY[35],
                BATTERY[50],BATTERY[59],BATTERY[80],BATTERY[95],BATTERY[99]];

function evaluate(sc, reply) {
  if (!reply || reply.length < 50) return {score:0};
  const r = reply.toLowerCase(); let s = 0;
  const sys = (sc.sys||'').toLowerCase().split(/[+\s]+/).filter(x=>x.length>2);
  if (sys.some(t=>r.includes(t))) s+=20;
  if (['cause','hypothes','probable','piste'].some(w=>r.includes(w))) s+=15;
  if (['verif','test','controle','remplac','nettoy','mesur','etape'].some(w=>r.includes(w))) s+=20;
  if (['\u20ac','euro','prix','cout','devis'].some(w=>r.includes(w))) s+=15;
  if (['rouler','urgence','danger','continuer','arr'].some(w=>r.includes(w))) s+=15;
  if (reply.length>400) s+=10; else if (reply.length>200) s+=5;
  return {score:Math.min(100,s)};
}

(async () => {
  const client = await MecaIAClient.create(AGENTS[0]);
  console.log(`Agent: ${client.agent.name}`);
  let total = 0;
  for (const sc of SAMPLE) {
    const r = await client.call('dylan_agents', {
      session_id:null, user_input:sc.msg, language:'fr', messages:[],
      vehicle:{make:sc.make,model:sc.model,year:sc.year,fuel:sc.fuel,mileage_km:sc.km},
      vehicle_marque:sc.make, vehicle_modele:sc.model, vehicle_km:sc.km
    });
    const reply = r.data?.reply || r.data?.message || r.data?.data?.reply || '';
    const {score} = evaluate(sc, reply);
    total += score;
    const sym = score>=70?'✅':score>=50?'⚠️':'❌';
    console.log(`${sym} [${sc.id}] ${sc.make} ${sc.model} · ${sc.sys} → ${score}/100`);
    if (reply) console.log(`   → ${reply.slice(0,120)}...`);
    await new Promise(r=>setTimeout(r,300));
  }
  const avg = (total/SAMPLE.length).toFixed(1);
  console.log(`\nMoyenne: ${avg}/100 (avant fix: ~27/100)`);
  await client.signOut().catch(()=>{});
})();
