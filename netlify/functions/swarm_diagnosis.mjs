// swarm_diagnosis.mjs — MecaIA ONE — Intelligence collective flotte
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY,ANT_KEY=process.env.ANTHROPIC_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
export const handler=async(event)=>{
  if(event.httpMethod!=='POST')return{statusCode:405,body:'nope'};
  const tok=(event.headers?.authorization||'').replace('Bearer ','').trim();
  if(!tok)return{statusCode:401,body:JSON.stringify({error:'auth'})};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{vehicle_id,marque='',modele='',annee=0,symptoms=[]}=b;
  const supa=getSupa();
  const{data:_ad,error:_ae}=await supa.auth.getUser(tok);
  if(_ae||!_ad?.user)return{statusCode:401,body:JSON.stringify({error:'invalid'})};
  const user=_ad.user;
  const{data:reads}=await supa.from('obd_readings').select('pid,value').eq('user_id',user.id).eq('vehicle_id',vehicle_id).gte('ts',new Date(Date.now()-7*86400000).toISOString()).limit(300).catch(()=>({data:[]}));
  const byPid={};(reads||[]).forEach(r=>{if(!byPid[r.pid])byPid[r.pid]=[];byPid[r.pid].push(parseFloat(r.value));});
  const pattern={};Object.entries(byPid).forEach(([k,v])=>{pattern[k]=+(v.reduce((a,c)=>a+c,0)/v.length).toFixed(2);});
  const a=new Anthropic({apiKey:ANT_KEY});
  const p=`Expert diagnostique auto europeen.\nVehicule: ${marque} ${modele} ${annee}\nSymptomes: ${symptoms.join(', ')||'aucun'}\nPattern OBD 7j: ${JSON.stringify(pattern)}\nRetourne JSON: {"pannes_frequentes":[{"nom":"...","probabilite":"haute/moyenne/faible","description":"..."}],"prediction_risque":"...","action_prioritaire":"..."}`;
  let analysis={pannes_frequentes:[],prediction_risque:'Données insuffisantes',action_prioritaire:'Connecter l OBD et rouler 30 jours'};
  try{const r=await a.messages.create({model:'claude-haiku-4-5',max_tokens:400,messages:[{role:'user',content:p}]});analysis=JSON.parse(r.content[0].text.replace(/```json\n?/g,'').replace(/```/g,'').trim());}catch{}
  return{statusCode:200,body:JSON.stringify({vehicle_pattern:pattern,symptoms,swarm_analysis:analysis})};
};