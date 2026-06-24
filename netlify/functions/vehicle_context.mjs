// vehicle_context.mjs — MecaIA ONE — Contexte complet véhicule pour Dylan
import { createClient } from '@supabase/supabase-js';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
export const handler=async(event)=>{
  if(event.httpMethod!=='POST')return{statusCode:405,body:'nope'};
  const tok=(event.headers?.authorization||'').replace('Bearer ','').trim();
  if(!tok)return{statusCode:401,body:JSON.stringify({error:'auth'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{vehicle_id}=b;
  if(!vehicle_id)return{statusCode:400,body:JSON.stringify({error:'vehicle_id requis'})};
  const supa=getSupa();
  const{data:_ad,error:_ae}=await supa.auth.getUser(tok);
  if(_ae||!_ad?.user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  const user=_ad.user;
  const safe=async fn=>{try{return(await fn())||null;}catch{return null;}};
  const[memR,alertsR,tripsR,readR,baseR,vehR]=await Promise.all([
    safe(()=>supa.from('user_vehicle_memory').select('memory_json').eq('vehicle_id',vehicle_id).eq('user_id',user.id).single()),
    safe(()=>supa.from('obd_alerts').select('type,label,message,days_ahead').eq('vehicle_id',vehicle_id).eq('user_id',user.id).eq('acknowledged',false).order('created_at',{ascending:false}).limit(5)),
    safe(()=>supa.from('trips').select('started_at,duration_min,distance_km,max_coolant,avg_ltft').eq('vehicle_id',vehicle_id).eq('user_id',user.id).order('started_at',{ascending:false}).limit(3)),
    safe(()=>supa.from('obd_readings').select('pid,value').eq('vehicle_id',vehicle_id).eq('user_id',user.id).gte('ts',new Date(Date.now()-3600000).toISOString()).limit(100)),
    safe(()=>supa.from('baseline_profiles').select('pid,mean,std_dev,samples').eq('vehicle_id',vehicle_id).eq('user_id',user.id)),
    safe(()=>supa.from('user_vehicles').select('marque,modele,annee,carburant,km_current,vin,engine_code').eq('id',vehicle_id).single()),
  ]);
  const live={};((readR?.data)||[]).forEach(r=>{if(!live[r.pid])live[r.pid]=[];live[r.pid].push(parseFloat(r.value));});
  Object.keys(live).forEach(k=>{live[k]=+(live[k].reduce((a,c)=>a+c,0)/live[k].length).toFixed(2);});
  const base={};((baseR?.data)||[]).forEach(r=>{base[r.pid]={mean:r.mean,std_dev:r.std_dev,samples:r.samples};});
  const v=vehR?.data||{};
  const alerts=(alertsR?.data)||[];
  const mem=memR?.data?.memory_json||{};
  const trips=(tripsR?.data)||[];
  const textSummary=[
    `VEHICULE: ${v.marque||''} ${v.modele||''} ${v.annee||''}${v.carburant?' ('+v.carburant+')':''}${v.km_current?' '+v.km_current+'km':''}`,
    alerts.length>0?'ALERTES: '+alerts.map(a=>'['+a.type+'] '+a.label).join(' | '):'Aucune alerte active',
    Object.keys(live).length>0?'OBD: '+Object.entries(live).slice(0,5).map(([k,v2])=>k+'='+v2).join(' '):'Pas de données OBD récentes',
    Object.keys(base).length>0?'Baseline: '+Object.keys(base).length+' PIDs personnalisés':'Baseline en construction',
    trips.length>0?'Dernier trajet: '+(trips[0].distance_km||0)+'km / '+(trips[0].duration_min||0)+'min':'Aucun trajet',
    (mem.known_issues||[]).length?'Problemes connus: '+mem.known_issues.slice(0,2).join(', '):''
  ].filter(Boolean).join('\n');
  return{statusCode:200,body:JSON.stringify({context:{vehicle:v,memory:mem,active_alerts:alerts,recent_trips:trips,live_obd:live,baseline:base},text_summary:textSummary})};
};