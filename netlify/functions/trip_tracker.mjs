// trip_tracker.mjs — MecaIA ONE — Detection automatique des trajets
import { createClient } from '@supabase/supabase-js';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
export const handler=async(event)=>{
  if(event.httpMethod!=='POST')return{statusCode:405,body:'nope'};
  const tok=(event.headers?.authorization||'').replace('Bearer ','').trim();
  if(!tok)return{statusCode:401,body:JSON.stringify({error:'auth'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{vehicle_id,session_key,pids={}}=b;
  if(!vehicle_id||!session_key)return{statusCode:400,body:JSON.stringify({error:'missing'})};
  const supa=getSupa();
  const{data:_ad,error:_ae}=await supa.auth.getUser(tok);
  if(_ae||!_ad?.user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  const user=_ad.user;
  const now=new Date();
  const rpm=parseFloat(pids.RPM||0),speed=parseFloat(pids.SPEED||0);
  const coolant=parseFloat(pids.COOLANT||0),ltft=parseFloat(pids.LTFT||0);
  const voltage=parseFloat(pids.BATTERY||0);
  const on=rpm>400;
  let trip=null;
  try{const r=await supa.from('trips').select('*').eq('session_key',session_key).is('ended_at',null).single();trip=r.data;}catch{}
  if(!trip&&on){
    let nt=null;
    try{const r=await supa.from('trips').insert({user_id:user.id,vehicle_id,session_key,started_at:now.toISOString(),max_rpm:Math.round(rpm),max_coolant:Math.round(coolant),avg_ltft:+ltft.toFixed(2),start_voltage:+voltage.toFixed(2),dtcs_seen:[]}).select().single();nt=r.data;}catch{}
    return{statusCode:200,body:JSON.stringify({action:'trip_started',trip_id:nt?.id})};
  }
  if(trip&&on){
    const dist=speed*(30/3600);
    try{await supa.from('trips').update({max_rpm:Math.max(trip.max_rpm||0,Math.round(rpm)),max_coolant:Math.max(trip.max_coolant||0,Math.round(coolant)),avg_ltft:+ltft.toFixed(2),avg_speed_kph:+speed.toFixed(1),distance_km:+((trip.distance_km||0)+dist).toFixed(2)}).eq('id',trip.id);}catch{}
    return{statusCode:200,body:JSON.stringify({action:'updated',trip_id:trip.id})};
  }
  if(trip&&!on){
    const dur=Math.round((now-new Date(trip.started_at))/60000);
    if(dur<1){try{await supa.from('trips').delete().eq('id',trip.id);}catch{}return{statusCode:200,body:JSON.stringify({action:'cancelled'})};}
    try{await supa.from('trips').update({ended_at:now.toISOString(),duration_min:dur,end_voltage:+voltage.toFixed(2)}).eq('id',trip.id);}catch{}
    return{statusCode:200,body:JSON.stringify({action:'trip_ended',duration_min:dur})};
  }
  return{statusCode:200,body:JSON.stringify({action:'no_trip'})};
};