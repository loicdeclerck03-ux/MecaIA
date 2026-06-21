// baseline_learn.mjs — MecaIA ONE — Baseline personnalisée par véhicule
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
  const{data:{user}}=await supa.auth.getUser(tok);
  if(!user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  const{data:baseline,error}=await supa.rpc('compute_baseline',{p_vehicle_id:vehicle_id,p_user_id:user.id});
  if(error)return{statusCode:500,body:JSON.stringify({error:error.message})};
  if(!baseline||baseline.length===0)return{statusCode:200,body:JSON.stringify({status:'insufficient_data',message:'Min 20 lectures OBD par PID sur 30 jours requis'})};
  const now=new Date().toISOString();
  const rows=baseline.map(r=>({vehicle_id,user_id:user.id,pid:r.pid,label:r.pid,samples:r.samples,mean:r.mean,std_dev:r.std_dev,p10:r.p10,p90:r.p90,min_val:r.min_val,max_val:r.max_val,updated_at:now}));
  const{error:uErr}=await supa.from('baseline_profiles').upsert(rows,{onConflict:'vehicle_id,pid'});
  if(uErr)return{statusCode:500,body:JSON.stringify({error:uErr.message})};
  const{data:anomalies}=await supa.rpc('detect_anomalies',{p_vehicle_id:vehicle_id,p_user_id:user.id}).catch(()=>({data:[]}));
  return{statusCode:200,body:JSON.stringify({status:'ok',pids_computed:baseline.length,anomalies:anomalies||[]})};
};