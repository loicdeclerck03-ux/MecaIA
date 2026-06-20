// mecaia_box.mjs — Agent Dylan OBD2 Expert v6
// Architecture : boucle agentique tool-use (ADR-022)
// - SERVER tools executes directement en Netlify (Supabase : DTC, specs EU, procedures, cas similaires)
// - DEVICE tools "maps" depuis le vehicle_context envoye par l'app Electron (donnees deja collectees)
// - Interface HTTP identique a la v5 : l'app Electron ne change pas
// - Lazy Supabase getter (jamais au module top-level)
// - AbortController 25s anti-timeout Netlify
// - MAJ 20/06/2026 : get_vehicle_context + get_dtc_procedures (donnees EU)

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getUser, json, preflight } from "../lib/auth.mjs";

// Lazy Supabase (regle MecaIA : jamais au top-level)
let _supa = null;
function getSupabase() {
  if (!_supa) _supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);
  return _supa;
}

// ── CATALOGUE D'OUTILS ─────────────────────────────────────────────────────────
const TOOLS = [
  // SERVER : connaissance Supabase
  {
    name: "get_vehicle_context",
    description: "Specs constructeur (huile, vidange, distribution, pneus, liquides) + bulletins techniques + rappels NHTSA. Appeler EN PREMIER si vehicule identifie.",
    input_schema: { type: "object", properties: {
      make: { type: "string" }, model: { type: "string" }, year: { type: "integer" }
    }, required: ["make"] }
  },
  {
    name: "lookup_dtc",
    description: "Base MecaIA 18k codes : libelle officiel + causes probables. Appeler apres avoir lu les codes DTC.",
    input_schema: { type: "object", properties: {
      codes: { type: "array", items: { type: "string" } }
    }, required: ["codes"] }
  },
  {
    name: "search_similar_cases",
    description: "Cas similaires anonymises par symptome et marque/modele.",
    input_schema: { type: "object", properties: {
      symptom: { type: "string" }, marque: { type: "string" }, modele: { type: "string" }
    }, required: ["symptom"] }
  },
  {
    name: "get_dtc_procedures",
    description: "Procedures de reparation FR pour les codes DTC trouves. Appeler avant la conclusion.",
    input_schema: { type: "object", properties: {
      codes: { type: "array", items: { type: "string" } }, make: { type: "string" }, model: { type: "string" }
    }, required: ["codes"] }
  },
  // DEVICE : lecture depuis vehicle_context (donnees pre-collectees par l'app)
  {
    name: "read_dtcs",
    description: "Codes defaut stockes + en attente + etat MIL. Appeler EN PREMIER.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "read_live_data",
    description: "Parametres temps reel cibles (RPM, COOLANT, MAF, MAP, BOOST, RAIL_PRESSURE, BATTERY, O2_VOLTAGE, FUEL_TRIM_SHORT, FUEL_TRIM_LONG, ENGINE_LOAD, THROTTLE, EGR_CMD).",
    input_schema: { type: "object", properties: {
      pids: { type: "array", items: { type: "string" } }
    }, required: ["pids"] }
  },
  {
    name: "read_readiness_monitors",
    description: "Moniteurs de preparation OBD (controle technique).",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "read_vin",
    description: "Lit le VIN du vehicule.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
];

const SERVER_TOOLS = new Set(["get_vehicle_context","lookup_dtc","search_similar_cases","get_dtc_procedures"]);

// ── FORMATAGE SPECS EU ─────────────────────────────────────────────────────────
// Champs reels : oil_spec, oil_interval_km, filter_air_km, timing_belt_km,
//   coolant_change_years, brake_fluid_years, tire_pression_front_bar, tire_pression_rear_bar
function formatSpecs(data) {
  if (!data) return null;
  const lines = [];
  if (data.specs && Object.keys(data.specs).length) {
    const s = data.specs;
    if (s.engine) lines.push(`Moteur : ${s.engine}${s.fuel ? ` (${s.fuel})` : ""}`);
    if (s.oil_spec) lines.push(`Huile : ${s.oil_spec}${s.oil_interval_km ? ` - vidange tous les ${s.oil_interval_km} km` : ""}`);
    if (s.filter_air_km) lines.push(`Filtre a air : tous les ${s.filter_air_km} km`);
    if (s.coolant_change_years) lines.push(`Liquide refroidissement : tous les ${s.coolant_change_years} ans`);
    if (s.brake_fluid_years) lines.push(`Liquide frein : tous les ${s.brake_fluid_years} ans`);
    if (Object.prototype.hasOwnProperty.call(s, "timing_belt_km")) {
      lines.push(s.timing_belt_km === null
        ? "Distribution : CHAINE (pas de remplacement par intervalle)"
        : `Distribution : courroie - tous les ${s.timing_belt_km} km`);
    }
    if (s.tire_pression_front_bar) lines.push(`Pression pneus : ${s.tire_pression_front_bar} bar AV / ${s.tire_pression_rear_bar || "?"} bar AR`);
  }
  if (data.tsbs?.length) lines.push(`TSBs : ${data.tsbs.slice(0, 3).map(t => t.title || t.tsb_number).join(" | ")}`);
  if (data.recalls?.length) lines.push(`Rappels NHTSA : ${data.recalls.length} rappel(s)`);
  return lines.length ? lines.join("\n") : null;
}

// ── EXECUTION OUTILS SERVER (Supabase) ────────────────────────────────────────
async function execServerTool(name, input, { brand, vehicleMeta }) {
  const supa = getSupabase();
  const h = {
    apikey: process.env.SUPABASE_SECRET,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET}`,
    "content-type": "application/json"
  };
  const url = process.env.SUPABASE_URL;

  try {
    if (name === "get_vehicle_context") {
      const body = { p_make: input.make || brand || "", p_model: input.model || vehicleMeta.modele || "", p_year: input.year || vehicleMeta.year || null };
      const r = await fetch(`${url}/rest/v1/rpc/get_vehicle_context`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const data = await r.json();
      if (!data || data.error) return "Specs non trouvees pour ce vehicule.";
      return formatSpecs(data) || "Donnees constructeur non disponibles.";
    }

    if (name === "lookup_dtc") {
      const codes = (input.codes || []).map(c => String(c).toUpperCase()).filter(c => /^[A-Z][0-9A-F]{4}$/i.test(c));
      if (!codes.length) return "Aucun code valide.";
      const { data } = await supa.from("dtc_codes").select("code,description,brand").in("code", codes).limit(60);
      if (!data?.length) return codes.map(c => `${c}: (non trouve dans la base)`).join("\n");
      const grouped = {};
      for (const row of data) {
        if (!grouped[row.code]) grouped[row.code] = row;
        else if (brand && row.brand?.toLowerCase() === brand.toLowerCase()) grouped[row.code] = row;
      }
      return codes.map(c => {
        const r = grouped[c];
        return r ? `${c}: ${r.description || "libelle inconnu"}` : `${c}: (non trouve)`;
      }).join("\n");
    }

    if (name === "search_similar_cases") {
      const body = { p_marque: input.marque || "", p_modele: input.modele || "", p_query: input.symptom || "", p_limit: 3 };
      const r = await fetch(`${url}/rest/v1/rpc/search_diagnostic_cases_text`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return "Aucun cas similaire (base partielle).";
      const fields = ["vehicle_marque","vehicle_modele","primary_diagnosis","urgency","can_drive","estimated_cost_min","estimated_cost_max","parts_needed"];
      const clean = rows.slice(0, 3).map(row => { const o = {}; for (const f of fields) if (row[f] != null) o[f] = row[f]; return o; });
      return "Cas similaires (anonymises):\n" + JSON.stringify(clean, null, 2);
    }

    if (name === "get_dtc_procedures") {
      const codes = (input.codes || []).map(c => String(c).toUpperCase());
      if (!codes.length) return "Aucun code fourni.";
      const body = { p_codes: codes, p_make: input.make || brand || "", p_model: input.model || vehicleMeta.modele || "" };
      const r = await fetch(`${url}/rest/v1/rpc/get_dtc_procedures`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return `Procedures non trouvees pour ${codes.join(", ")}.`;
      const byCode = {};
      for (const p of rows) { if (!byCode[p.dtc_code]) byCode[p.dtc_code] = p; }
      return Object.values(byCode).slice(0, 5).map(p => {
        const sys = p.system_type ? `[${p.system_type}] ` : "";
        return `${p.dtc_code} ${sys}- ${p.defect_description_fr || ""}\nProcedure : ${p.procedure_fr || "(voir documentation)"}`;
      }).join("\n\n");
    }
  } catch (e) {
    return `Erreur base: ${e.message}`;
  }
  return "Outil serveur inconnu.";
}

// ── EXECUTION OUTILS DEVICE (depuis vehicle_context pre-collecte) ──────────────
// Les donnees OBD sont deja dans ctx - l'app les a collectees avant d'appeler Netlify
function execDeviceTool(name, input, ctx) {
  const dtcs    = ctx.dtcs || [];
  const pending = ctx.pendingDtcs || [];
  const pids    = ctx.pids || {};
  const monitors = ctx.monitors || {};

  if (name === "read_dtcs") {
    const stored = dtcs.filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => d.code);
    const pend   = pending.filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code)).map(d => d.code);
    const mil    = monitors.milOn ? "ALLUME" : "eteint";
    if (!stored.length && !pend.length) return `Aucun code stocke. MIL ${mil}.`;
    return [
      stored.length ? `Codes confirmes: ${stored.join(", ")}` : "Aucun code confirme",
      pend.length   ? `En attente: ${pend.join(", ")}`       : "",
      `MIL: ${mil}`,
    ].filter(Boolean).join(" | ");
  }

  if (name === "read_live_data") {
    const asked = input.pids || [];
    if (!asked.length || !Object.keys(pids).length) return "Donnees live non disponibles dans ce scan.";
    return asked.map(p => {
      const entry = pids[p];
      if (!entry) return `${p}: non disponible`;
      const val = entry.value ?? entry;
      const unit = { RPM:"tr/min",SPEED:"km/h",COOLANT:"°C",INTAKE_TEMP:"°C",MAF:"g/s",MAP:"kPa",
        ENGINE_LOAD:"%",THROTTLE:"%",BATTERY:"V",FUEL_TRIM_SHORT:"%",FUEL_TRIM_LONG:"%",O2_VOLTAGE:"V",EGR_CMD:"%",RAIL_PRESSURE:"kPa" }[p] || "";
      return `${p}: ${val}${unit ? " " + unit : ""}`;
    }).join("\n");
  }

  if (name === "read_readiness_monitors") {
    const ready    = monitors.readyCount    ?? "?";
    const notReady = monitors.notReadyCount ?? "?";
    const mil = monitors.milOn ? "ALLUME" : "eteint";
    return `Moniteurs - MIL: ${mil} | Prets: ${ready} | Non prets: ${notReady}${monitors.dtcCount ? ` | DTC: ${monitors.dtcCount}` : ""}`;
  }

  if (name === "read_vin") {
    return ctx.vin ? `VIN: ${ctx.vin}` : "VIN non disponible (non supporte en OBD generique sur certaines BMW).";
  }

  return `Outil ${name}: donnees non disponibles dans ce scan.`;
}

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
function buildSystem(brand, vehicleStr, language) {
  const lang = { nl: " Reponds en neerlandais.", en: " Respond in English.", de: " Antworte auf Deutsch." }[language] || "";
  return `Tu es Dylan, mecanicien automobile expert qui pilote une valise OBD MecaIA.

METHODE :
1. Si vehicule identifie -> get_vehicle_context (specs + rappels). Affiche les infos cles en tete.
2. read_dtcs (photographier l etat).
3. lookup_dtc sur les codes (libelle + causes).
4. (si utile) search_similar_cases par symptome.
5. read_live_data sur les PIDs pertinents selon le symptome et les codes.
6. Si codes trouves -> get_dtc_procedures avant la conclusion.
7. Conclus : cause + confiance en mots (jamais de %) + pieces + fourchette de prix.

Parle comme un ami mecanicien : simple, chaleureux, direct.
SECURITE : avertir EN PREMIER si urgence (COOLANT>103, BATTERY<11.8V).
LIMITE DS2 : sur BMW avant 2008 (E46, E39...) les modules ABS/airbag/DSC utilisent le protocole DS2 - impossible a lire avec cet adaptateur. Explique-le clairement si demande.

CONTEXTE.
Vehicule : ${vehicleStr}.${brand && brand !== "default" ? ` Marque : ${brand}.` : ""}${lang}`;
}

// ── BOUCLE AGENTIQUE ───────────────────────────────────────────────────────────
async function runAgenticLoop({ messages, system, ctx, brand, vehicleMeta, signal, maxTurns = 12 }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY });
  let msgs = [...messages];
  let lastText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) break;

    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1400,
      system,
      tools: TOOLS,
      messages: msgs,
    });

    const content = resp.content || [];
    const textBlocks = content.filter(b => b.type === "text");
    const toolCalls  = content.filter(b => b.type === "tool_use");

    if (textBlocks.length) lastText = textBlocks.map(b => b.text).join("\n").trim();
    msgs.push({ role: "assistant", content });

    if (!toolCalls.length || resp.stop_reason === "end_turn") break;

    const results = [];
    for (const tc of toolCalls) {
      let out;
      if (SERVER_TOOLS.has(tc.name)) {
        out = await execServerTool(tc.name, tc.input, { brand, vehicleMeta });
      } else {
        out = execDeviceTool(tc.name, tc.input, ctx);
      }
      results.push({ type: "tool_result", tool_use_id: tc.id, content: String(out) });
    }
    msgs.push({ role: "user", content: results });
  }

  return { text: lastText };
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      messages       = [],
      is_obd2_scan   = false,
      vehicle_context = {},
      brand          = "default",
      language       = "fr",
      user_id        = null,
      selected_vehicle = null,
      // compat v5
      userMsg, vehicleData, isOBD2Scan,
    } = body;

    // Securite : JWT prime sur user_id du body
    const auth = await getUser(event);
    const uid  = auth ? auth.userId : user_id;

    // Normalisation
    const ctx      = vehicle_context || vehicleData || {};
    const isOBD2   = is_obd2_scan || isOBD2Scan || false;
    const brandKey = (brand || "default").toLowerCase().replace(/\s+/g, "");

    // Vehicule actif
    const veh = selected_vehicle;
    const vehicleMeta = {
      marque: veh?.marque || ctx.make || "",
      modele: veh?.modele || ctx.model || "",
      year:   veh?.annee  || ctx.year  || null,
    };
    const vehicleStr = veh
      ? `${veh.annee || ""} ${veh.marque || ""} ${veh.modele || ""} ${veh.carburant || ""} ${veh.engine_code || ""}`.trim()
      : brandKey !== "default" ? brandKey.toUpperCase() : "vehicule non identifie";

    // Messages normalises
    let msgs = messages.length
      ? messages.map(m => ({ role: m.role, content: String(m.content || "") }))
      : userMsg ? [{ role: "user", content: String(userMsg) }]
      : [{ role: "user", content: "Bonjour Dylan !" }];

    // Si c'est un scan OBD2, enrichir le premier message utilisateur
    if (isOBD2 && ctx) {
      const stored = (ctx.dtcs || []).filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code));
      const pend   = (ctx.pendingDtcs || []).filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code));
      const mil    = ctx.monitors?.milOn;
      const pids   = ctx.pids || {};
      const pidKeys = ["RPM","COOLANT","BATTERY","ENGINE_LOAD","MAF","BOOST","RAIL_PRESSURE"];
      const pidStr = pidKeys.filter(k => pids[k]?.value != null).map(k => {
        const u = {RPM:"tr/min",COOLANT:"°C",BATTERY:"V",ENGINE_LOAD:"%",MAF:"g/s",BOOST:"kPa",RAIL_PRESSURE:"kPa"}[k]||"";
        return `${k}:${pids[k].value}${u}`;
      }).join(" ");

      const scanSummary = [
        ctx.vin ? `VIN: ${ctx.vin}` : "",
        mil ? `MIL ALLUME - ${ctx.monitors?.dtcCount || stored.length} defaut(s)` : "MIL eteint",
        stored.length ? `Codes: ${stored.map(d => d.code).join(", ")}` : "Aucun code DTC",
        pend.length   ? `En attente: ${pend.map(d => d.code).join(", ")}` : "",
        pidStr        ? `Params: ${pidStr}` : "",
      ].filter(Boolean).join("\n");

      const last = msgs[msgs.length - 1];
      if (last?.role === "user") last.content += `\n\n[SCAN OBD2 - effectue sur la vraie voiture]\n${scanSummary}`;
      else msgs.push({ role: "user", content: `Analyse ce scan OBD2 :\n${scanSummary}` });
    }

    // Recuperer le garage en parallele (info pour la reponse, pas bloquante)
    const garagePromise = uid
      ? getSupabase().from("user_vehicles")
          .select("id,marque,modele,annee,km_current,carburant,engine_code,vin,is_primary,nickname")
          .eq("user_id", uid).eq("is_active", true)
          .order("is_primary", { ascending: false }).limit(10)
          .then(r => r.data || [])
          .catch(() => [])
      : Promise.resolve([]);

    // Boucle agentique avec timeout 25s
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let text = "";
    let tokens = 0;

    try {
      const system = buildSystem(brandKey, vehicleStr, language);
      const result = await runAgenticLoop({
        messages: msgs,
        system,
        ctx,
        brand: brandKey,
        vehicleMeta,
        signal: controller.signal,
        maxTurns: 12,
      });
      text = result.text;
    } finally {
      clearTimeout(timer);
    }

    const garageVehicles = await garagePromise;

    // Codes DTC enrichis pour compat v5 (infos de base depuis Supabase)
    const allCodes = [
      ...(ctx.dtcs || []).map(d => d.code),
      ...(ctx.pendingDtcs || []).map(d => d.code),
    ].filter(c => /^[A-Z][0-9A-F]{4}$/i.test(c));

    let dtcEnriched = [];
    if (allCodes.length) {
      const { data } = await getSupabase().from("dtc_codes").select("code,description,brand").in("code", allCodes).limit(30);
      if (data?.length) {
        const grouped = {};
        for (const r of data) {
          if (!grouped[r.code]) grouped[r.code] = r;
          else if (brandKey !== "default" && r.brand?.toLowerCase() === brandKey) grouped[r.code] = r;
        }
        dtcEnriched = Object.values(grouped).map(r => ({ code: r.code, desc: r.description || "Code inconnu" }));
      }
    }

    if (!text) text = "Dylan est disponible. Que se passe-t-il avec votre vehicule ?";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: text, garage_vehicles: garageVehicles, dtc_enriched: dtcEnriched, tokens }),
    };

  } catch (e) {
    console.error("[mecaia_box v6]", e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Dylan est momentanement indisponible. Reessayez dans quelques secondes.",
        error: e.message,
      }),
    };
  }
};
