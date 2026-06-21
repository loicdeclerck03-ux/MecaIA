// push_notify.mjs — MecaIA ONE — Notifications push Expo
import { createClient } from '@supabase/supabase-js';
const SUPA_URL=process.env.SUPABASE_URL,SUPA_KEY=process.env.SUPABASE_SERVICE_KEY;
let _s=null;const getSupa=()=>_s||(_s=createClient(SUPA_URL,SUPA_KEY));
export const handler=async(event)=>{
  if(event.httpMethod!=='POST')return{statusCode:405,body:'nope'};
  let b;try{b=JSON.parse(event.body||'{}')}catch{b={}}
  const{user_id,title,message,data={},type='alert'}=b;
  if(!user_id||!title||!message)return{statusCode:400,body:JSON.stringify({error:'params manquants'})};
  const supa=getSupa();
  let profile=null;try{const r=await supa.from('user_profiles').select('expo_push_token,push_enabled').eq('user_id',user_id).single();profile=r.data;}catch{}
  if(!profile?.expo_push_token||profile.push_enabled===false)return{statusCode:200,body:JSON.stringify({sent:false,reason:'no_token'})};
  try{
    const r=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:profile.expo_push_token,title,body:message,data:{type,...data},sound:'default',priority:'high'})});
    const res=await r.json();
    try{await supa.from('email_logs').insert({user_id,type:'push_notification',subject:title,status:'sent',sent_at:new Date().toISOString()});}catch{}
    return{statusCode:200,body:JSON.stringify({sent:true,result:res.data})};
  }catch(e){return{statusCode:500,body:JSON.stringify({error:e.message})};}
};