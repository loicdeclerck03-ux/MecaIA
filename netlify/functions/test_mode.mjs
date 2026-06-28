// test_mode.mjs — MecaIA · Holter Automobile
// Actions: start | snapshot | complete | get_status | pause | resume
import Anthropic from "@anthropic-ai/sdk";

const getSupabase = async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
};

const CORS = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization" };
const DURATIONS = { test_15min:900, test_1h:3600, ghost_inspector:3600, test_24h:86400 };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:CORS, body:"" };
  try {
    const auth = (event.headers["authorization"] || "").replace("Bearer ","").trim();
    if (!auth) return e401("Token manquant");
    const sb = await getSupabase();
    const { data:{ user }, error:ae } = await sb.auth.getUser(auth);
    if (ae || !user) return e401("Non autorisé");
    const uid = user.id;
    const { action, session_id, vehicle_id, session_type, snapshot_data } = JSON.parse(event.body||"{}");

    switch(action) {
      case "start": {
        if (!vehicle_id || !session_type) return e400("vehicle_id + session_type requis");
        if (!DURATIONS[session_type]) return e400("session_type invalide");

        // Ghost Inspector : verifier credits si non-abonne
        if (session_type === "ghost_inspector") {
          const GHOST_COST = 5;
          const { data: udat } = await sb.from("users")
            .select("credits, unlimited_until")
            .eq("id", uid).single();
          const now = new Date().toISOString();
          const isUnlimited = udat?.unlimited_until && udat.unlimited_until > now;
          const hasCredits = (udat?.credits || 0) >= GHOST_COST;
          if (!isUnlimited && !hasCredits) {
            return { statusCode:402, headers:{...CORS,"Content-Type":"application/json"},
              body: JSON.stringify({ error:"credits_insuffisants", ghost_price_id:"price_1TnKusQ1QuRc9MT3CRIGvHb8", cost: GHOST_COST }) };
          }
          // Consommer credits si pas illimite
          if (!isUnlimited) {
            await sb.from("users").update({ credits: (udat.credits - GHOST_COST) }).eq("id", uid);
          }
        }

        const { data, error } = await sb.from("obd_sessions").insert({
          user_id:uid, vehicle_id, session_type, session_status:"active",
          target_duration_seconds:DURATIONS[session_type], elapsed_seconds:0,
          test_started_at:new Date().toISOString(),
          pids_snapshot:{ meta:{ session_type, interval_seconds:30 }, snapshots:[] }
        }).select("id,target_duration_seconds,test_started_at").single();
        if (error) return e500(error.message);
        return ok({ session_id:data.id, target_seconds:data.target_duration_seconds, started_at:data.test_started_at });
      }

      case "snapshot": {
        if (!session_id || !snapshot_data) return e400("session_id + snapshot_data requis");
        const { data:s } = await sb.from("obd_sessions")
          .select("pids_snapshot,elapsed_seconds,session_status")
          .eq("id",session_id).eq("user_id",uid).single();
        if (!s) return e404("Session introuvable");
        if (s.session_status !== "active") return e409("Session non active");
        const snap = s.pids_snapshot || { snapshots:[] };
        snap.snapshots.push({ t:s.elapsed_seconds, ...snapshot_data });
        const ne = s.elapsed_seconds + 30;
        await sb.from("obd_sessions").update({ pids_snapshot:snap, elapsed_seconds:ne })
          .eq("id",session_id).eq("user_id",uid);
        return ok({ ok:true, elapsed:ne });
      }

      case "get_status": {
        if (!session_id) return e400("session_id requis");
        const { data:s } = await sb.from("obd_sessions")
          .select("session_status,elapsed_seconds,target_duration_seconds,rapport_dylan,rapport_verdict,pids_snapshot")
          .eq("id",session_id).eq("user_id",uid).single();
        if (!s) return e404("Session introuvable");
        const last = s.pids_snapshot?.snapshots?.slice(-1)[0] || null;
        return ok({ status:s.session_status, elapsed:s.elapsed_seconds, target:s.target_duration_seconds,
          pct:Math.round((s.elapsed_seconds/(s.target_duration_seconds||1))*100),
          last_pids:last, rapport_ready:!!s.rapport_dylan, verdict:s.rapport_verdict });
      }

      case "pause": case "resume": {
        if (!session_id) return e400("session_id requis");
        const ns = action==="pause"?"paused":"active";
        await sb.from("obd_sessions").update({ session_status:ns }).eq("id",session_id).eq("user_id",uid);
        return ok({ status:ns });
      }

      case "complete": {
        if (!session_id) return e400("session_id requis");
        const { data:s } = await sb.from("obd_sessions")
          .select("pids_snapshot,session_type,dtcs,vehicle_id")
          .eq("id",session_id).eq("user_id",uid).single();
        if (!s) return e404("Session introuvable");
        await sb.from("obd_sessions").update({ session_status:"completed", test_completed_at:new Date().toISOString() })
          .eq("id",session_id).eq("user_id",uid);
        const { rapport, verdict } = await generateRapport(s.session_type, s.pids_snapshot?.snapshots||[], s.dtcs||[], s.vehicle_id);
        await sb.from("obd_sessions").update({ rapport_dylan:rapport, rapport_verdict:verdict })
          .eq("id",session_id).eq("user_id",uid);
        return ok({ rapport, verdict, session_id });
      }

      default: return e400(`Action inconnue: ${action}`);
    }
  } catch(e) { console.error("[test_mode]",e); return e500(e.message||"Erreur serveur"); }
};

async function generateRapport(session_type, snapshots, dtcs, vehicle_id) {
  const client = new Anthropic({ apiKey:process.env.ANTHROPIC_KEY });
  const n = snapshots.length;
  const avg = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  const rpms = snapshots.map(s=>s.RPM).filter(Number.isFinite);
  const cool = snapshots.map(s=>s.COOLANT).filter(Number.isFinite);
  const batt = snapshots.map(s=>s.BATTERY).filter(Number.isFinite);
  const stats = {
    mesures:n,
    RPM:  rpms.length?{ min:Math.min(...rpms), max:Math.max(...rpms), avg:Math.round(avg(rpms)) }:null,
    COOLANT: cool.length?{ debut:cool[0], fin:cool[cool.length-1], max:Math.max(...cool) }:null,
    BATTERY: batt.length?{ avg:avg(batt).toFixed(1), min:Math.min(...batt), max:Math.max(...batt) }:null
  };
  const keys = [0,.25,.5,.75,1].map(r=>snapshots[Math.floor((n-1)*r)]).filter(Boolean);
  const isGhost = session_type==="ghost_inspector"||session_type==="test_1h";
  const is24h   = session_type==="test_24h";
  let system, user;
  if (isGhost) {
    system="Tu es Dylan, expert automobile IA MecaIA. Commence TOUJOURS par VERDICT en majuscules (ACHETER, NÉGOCIER ou REFUSER). Sois précis et honnête.";
    user=`GHOST INSPECTOR — 1H · Véhicule ${vehicle_id}\nStats (${n} mesures): ${JSON.stringify(stats)}\nDTCs: ${dtcs.join(",")||"Aucun"}\nSnapshots clés: ${JSON.stringify(keys)}\n\nRapport: 1) VERDICT 2) Score/10 3) Moteur 4) Électrique 5) DTCs+coût 6) Points+ 7) Arguments négociation 8) Recommandation`;
  } else if (is24h) {
    system="Tu es Dylan, expert automobile IA MecaIA. Analyse 24h de surveillance. Rédige en français.";
    user=`RAPPORT 24H · ${vehicle_id} · ${n} mesures · DTCs: ${dtcs.join(",")||"Aucun"}\nStats: ${JSON.stringify(stats)}\nRapport: Vue 24h · Démarrages · Thermique · Drain nuit · Pannes intermittentes · Score/10 · Recommandations`;
  } else {
    system="Tu es Dylan, expert automobile IA MecaIA. Analyse 15min post-réparation. Concis et pratique.";
    user=`RAPPORT 15MIN · ${vehicle_id} · ${n} mesures · DTCs: ${dtcs.join(",")||"Aucun"}\nStats: ${JSON.stringify(stats)}\nRapport: 1) Résumé 2 phrases 2) Chauffe 3) Démarrage 4) Alternateur 5) Points+/- 6) Recommandation`;
  }
  const resp = await client.messages.create({ model:"claude-sonnet-4-6", max_tokens:1500, system, messages:[{ role:"user", content:user }] });
  const rapport = resp.content[0]?.text?.trim() || "Rapport indisponible.";
  let verdict = null;
  if (isGhost) { verdict = /\bACHETER\b/.test(rapport)?"ACHETER":/\bN[EÉ]GOCIER\b/.test(rapport)?"NEGOCIER":"REFUSER"; }
  else { verdict = /\bATTENTION\b|\bURGENT\b/.test(rapport)?"ATTENTION":"PASSE"; }
  return { rapport, verdict };
}

const ok   = (b) => ({ statusCode:200, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify(b) });
const e400 = (m) => ({ statusCode:400, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify({error:m}) });
const e401 = (m) => ({ statusCode:401, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify({error:m}) });
const e404 = (m) => ({ statusCode:404, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify({error:m}) });
const e409 = (m) => ({ statusCode:409, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify({error:m}) });
const e500 = (m) => ({ statusCode:500, headers:{...CORS,"Content-Type":"application/json"}, body:JSON.stringify({error:m}) });