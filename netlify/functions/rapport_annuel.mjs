// rapport_annuel.mjs — MecaIA ONE — Bilan annuel de la voiture
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY,ANT_KEY=process.env.ANTHROPIC_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
export const handler=async(event)=>{
  if(event.httpMethod!=='POST')return{statusCode:405,body:'nope'};
  const tok=(event.headers?.authorization||'').replace('Bearer ','').trim();
  if(!tok)return{statusCode:401,body:JSON.stringify({error:'auth'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{vehicle_id,year=new Date().getFullYear()-1}=b;
  const supa=getSupa();
  const{data:{user}}=await supa.auth.getUser(tok);
  if(!user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  const start=`${year}-01-01T00:00:00Z`;
  const safe=async q=>{try{return(await q).data||[];}catch{return[];}};
  const[trips,diags,alerts,events]=await Promise.all([
    safe(supa.from('trips').select('distance_km,duration_min').eq('user_id',user.id).gte('started_at',start).lte('started_at',`${year+1}-01-01T00:00:00Z`)),
    safe(supa.from('user_diagnostics').select('id').eq('user_id',user.id).gte('created_at',start)),
    safe(supa.from('obd_alerts').select('type').eq('user_id',user.id).gte('created_at',start)),
    safe(supa.from('vehicle_events').select('cost_eur').eq('user_id',user.id).gte('created_at',start)),
  ]);
  const totalKm=(trips.reduce((s,t)=>s+(t.distance_km||0),0)).toFixed(0);
  const totalTrips=trips.length;
  const avgTrip=totalTrips>0?Math.round(trips.reduce((s,t)=>s+(t.duration_min||0),0)/totalTrips):0;
  const totalDiags=diags.length;
  const critAlerts=alerts.filter(a=>a.type==='CRITICAL').length;
  const mainCost=(events.reduce((s,e)=>s+(e.cost_eur||0),0)).toFixed(0);
  const a=new Anthropic({apiKey:ANT_KEY});
  let narrative='';
  try{
    const p=`Bilan auto MecaIA ${year}: ${totalKm}km, ${totalTrips} trajets moy ${avgTrip}min, ${totalDiags} diagnostics, ${critAlerts} alertes critiques, ${mainCost}EUR maintenance. Ecris bilan sympa 80 mots, titre accrocheur, conseil ${year+1}.`;
    const r=await a.messages.create({model:'claude-haiku-4-5',max_tokens:200,messages:[{role:'user',content:p}]});
    narrative=r.content[0]?.text||'';
  }catch{}
  return{statusCode:200,body:JSON.stringify({year,stats:{total_km:+totalKm,total_trips:totalTrips,avg_trip_min:avgTrip,total_diagnostics:totalDiags,critical_alerts:critAlerts,maintenance_cost_eur:+mainCost},narrative,generated_at:new Date().toISOString()})};
};