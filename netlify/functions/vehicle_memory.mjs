// vehicle_memory.mjs — MecaIA ONE — Mémoire long-terme du véhicule
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY,ANT_KEY=process.env.ANTHROPIC_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
const EMPTY={known_issues:[],maintenance_done:[],driving_habits:{},special_notes:[],last_diagnostic:null};
export const handler=async(event)=>{
  const tok=(event.headers?.authorization||'').replace('Bearer ','').trim();
  if(!tok)return{statusCode:401,body:JSON.stringify({error:'auth'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{vehicle_id,action='get',new_info=''}=b;
  if(!vehicle_id)return{statusCode:400,body:JSON.stringify({error:'vehicle_id requis'})};
  const supa=getSupa();
  const{data:{user}}=await supa.auth.getUser(tok);
  if(!user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  let mem=EMPTY;
  try{const r=await supa.from('user_vehicle_memory').select('memory_json').eq('vehicle_id',vehicle_id).eq('user_id',user.id).single();if(r.data?.memory_json)mem=r.data.memory_json;}catch{}
  if(action==='get')return{statusCode:200,body:JSON.stringify({memory:mem})};
  if(action==='update'&&new_info){
    let updated=mem;
    try{
      const a=new Anthropic({apiKey:ANT_KEY});
      const p=`Memoire vehicule actuelle: ${JSON.stringify(mem)}\nNouvelle info: "${new_info}"\nRetourne UNIQUEMENT le JSON mis a jour avec ces cles: known_issues, maintenance_done, driving_habits, special_notes, last_diagnostic`;
      const r=await a.messages.create({model:'claude-haiku-4-5',max_tokens:600,messages:[{role:'user',content:p}]});
      updated=JSON.parse(r.content[0].text.replace(/```json\n?/g,'').replace(/```/g,'').trim());
    }catch{}
    try{await supa.from('user_vehicle_memory').upsert({vehicle_id,user_id:user.id,memory_json:updated,updated_at:new Date().toISOString()},{onConflict:'vehicle_id,user_id'});}catch{}
    return{statusCode:200,body:JSON.stringify({status:'updated',memory:updated})};
  }
  return{statusCode:400,body:JSON.stringify({error:'action invalide'})};
};