// mecaia_box.mjs — Agent Dylan OBD2 Expert v5
// - Lookup DTC depuis 18k codes Supabase (pas de DTC hardcodés)
// - Véhicules du garage via user_id
// - Prompt ultra-optimisé (Haiku, max 1400 tokens réponse)

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Capacités OBD2 par marque ───────────────────────────────────────────────────
const BRAND_CAPS = {
  vw:     ["reset:huile","reset:dpf","reset:frein","reset:batt","reset:papillon","activate:ventilateur","activate:egr","activate:frein_parking","activate_option:feux_journee","activate_option:essuie_pluie","activate_option:retros_rabattables","activate_option:feux_bienvenue"],
  audi:   ["reset:huile","reset:dpf","reset:frein","reset:batt","activate:ventilateur","activate:egr","activate:frein_parking","activate_option:feux_journee","activate_option:lane_assist"],
  bmw:    ["reset:huile","reset:dpf","reset:frein","reset:batt","activate:ventilateur","activate:frein_parking","activate_option:feux_journee"],
  peugeot:["reset:huile","reset:dpf","reset:frein","reset:batt","activate:ventilateur","activate:egr","activate:frein_parking"],
  citroen:["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:egr"],
  renault:["reset:huile","reset:dpf","reset:frein","reset:batt","activate:ventilateur","activate:egr"],
  mercedes:["reset:huile","reset:dpf","reset:frein","reset:batt","activate:ventilateur"],
  seat:   ["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:frein_parking"],
  skoda:  ["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:frein_parking"],
  ford:   ["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:egr"],
  toyota: ["reset:huile","reset:dpf","reset:frein","activate:ventilateur"],
  hyundai:["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:frein_parking"],
  kia:    ["reset:huile","reset:dpf","reset:frein","activate:ventilateur","activate:frein_parking"],
  default:["reset:huile","reset:dpf","reset:frein","activate:ventilateur"],
};

// ── Lookup DTC depuis Supabase (18k codes) ──────────────────────────────────────
async function lookupDTCs(codes, brand) {
  if (!codes || !codes.length) return [];
  const upper = codes.map(c => c.toUpperCase()).filter(c => /^[A-Z][0-9A-F]{4}$/i.test(c));
  if (!upper.length) return [];

  try {
    // Chercher d'abord les codes spécifiques à la marque, puis génériques
    const { data } = await supabase
      .from("dtc_codes")
      .select("code, description, brand, fault_category, severity")
      .in("code", upper)
      .limit(30);

    if (!data || !data.length) return [];

    // Grouper par code, préférer le code spécifique à la marque
    const grouped = {};
    for (const row of data) {
      const key = row.code;
      if (!grouped[key]) { grouped[key] = row; continue; }
      // Préférer la description de la marque si match
      if (brand && row.brand && row.brand.toLowerCase() === brand.toLowerCase()) {
        grouped[key] = row;
      }
    }

    return Object.values(grouped).map(r => ({
      code: r.code,
      desc: r.description || "Code inconnu",
      category: r.fault_category || null,
      severity: r.severity || null,
    }));
  } catch (e) {
    console.error("[mecaia_box] DTC lookup:", e.message);
    return [];
  }
}

// ── Véhicules du garage de l'utilisateur ───────────────────────────────────────
async function getGarageVehicles(userId) {
  if (!userId) return [];
  try {
    const { data } = await supabase
      .from("user_vehicles")
      .select("id, marque, modele, annee, km_current, carburant, engine_code, vin, is_primary, nickname")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .limit(10);
    return data || [];
  } catch (e) {
    console.error("[mecaia_box] garage:", e.message);
    return [];
  }
}

// ── Analyse PIDs critiques (retourne string concis) ────────────────────────────
function analyzePIDs(pids) {
  if (!pids) return "";
  const v = {};
  for (const [k, p] of Object.entries(pids)) {
    if (p?.value != null) v[k] = p.value;
  }
  const alerts = [];
  if (v.COOLANT > 103)  alerts.push(`⚠️ Surchauffe: ${v.COOLANT}°C`);
  if (v.BATTERY < 11.8) alerts.push(`⚠️ Batterie faible: ${v.BATTERY}V`);
  if (v.BATTERY > 15.2) alerts.push(`⚠️ Surtension: ${v.BATTERY}V`);
  if (Math.abs(v.FUEL_TRIM_LT) > 25) alerts.push(`⚠️ Correction carbu long terme: ${v.FUEL_TRIM_LT}%`);

  const vals = Object.entries(v)
    .filter(([k]) => ["RPM","SPEED","COOLANT","BATTERY","ENGINE_LOAD","THROTTLE","FUEL_LEVEL"].includes(k))
    .map(([k, val]) => {
      const u = {RPM:"tr/min",SPEED:"km/h",COOLANT:"°C",BATTERY:"V",ENGINE_LOAD:"%",THROTTLE:"%",FUEL_LEVEL:"%"}[k]||"";
      const l = {RPM:"RPM",SPEED:"Vitesse",COOLANT:"Temp",BATTERY:"Batt",ENGINE_LOAD:"Charge",THROTTLE:"Papillon",FUEL_LEVEL:"Carbu"}[k]||k;
      return `${l}:${val}${u}`;
    }).join(" | ");

  return [...alerts, vals ? `Params: ${vals}` : ""].filter(Boolean).join("\n");
}

// ── Build system prompt (optimisé tokens) ──────────────────────────────────────
function buildPrompt(brand, caps, dtcInfo, pidInfo, garageVehicles, language, selectedVehicle) {
  const capsStr = caps.slice(0, 8).join(", ");
  const lang = {fr:"",nl:"\n🌐 Réponds en Néerlandais.",en:"\n🌐 Respond in English.",de:"\n🌐 Antworte auf Deutsch."}[language]||"";

  // Bloc véhicule sélectionné
  const vehBlock = selectedVehicle
    ? `Véhicule actif: ${selectedVehicle.annee||""} ${selectedVehicle.marque||""} ${selectedVehicle.modele||""} ${selectedVehicle.carburant||""} ${selectedVehicle.engine_code||""} ${selectedVehicle.km_current ? selectedVehicle.km_current+"km" : ""}`
    : `Marque: ${brand !== "default" ? brand.toUpperCase() : "non sélectionnée"}`;

  // Bloc DTC (compact)
  const dtcBlock = dtcInfo.length
    ? `\nDTC SCANNÉS:\n${dtcInfo.map(d => `${d.code}: ${d.desc}${d.severity?" ["+d.severity+"]":""}`).join("\n")}`
    : "";

  // Bloc PIDs
  const pidBlock = pidInfo ? `\nPIDs: ${pidInfo}` : "";

  // Bloc garage
  const garageBlock = garageVehicles.length
    ? `\nGARAGE USER: ${garageVehicles.map(v => `${v.annee||""} ${v.marque} ${v.modele}${v.is_primary?" ★":""}${v.nickname?" ("+v.nickname+")":""}`).join(", ")}`
    : "";

  return `Tu es Dylan, expert mécanicien IA de MecaIA Box.
${vehBlock}${dtcBlock}${pidBlock}${garageBlock}
Capacités OBD2 disponibles: ${capsStr}

RÈGLES:
- Parle comme un ami mécanicien : simple, chaleureux, direct
- ⚠️ Si urgence (surchauffe, batterie <11V, freins) : avertir EN PREMIER
- Toujours annoncer + demander confirmation avant une action
- NE PAS effacer les codes si l'utilisateur va chez le garagiste

ACTIONS DISPONIBLES (coller dans réponse):
[CMD:scan_full] [CMD:read_dtcs] [CMD:read_live] [CMD:read_monitors] [CMD:read_freeze]
[CMD:reset:huile:${brand}] [CMD:reset:dpf:${brand}] [CMD:reset:frein:${brand}] [CMD:reset:batt:${brand}]
[CMD:activate:ventilateur:${brand}] [CMD:activate:egr:${brand}]
[CMD:activate:frein_parking:${brand}] [CMD:deactivate:frein_parking:${brand}]
[CMD:activate_option:feux_journee:${brand}] [CMD:activate_option:retros_rabattables:${brand}]
[CMD:activate_option:feux_bienvenue:${brand}] [CMD:activate_option:klaxon_verrouillage:${brand}]
[CMD:clear_dtcs]

Max 2 [CMD] par message. Finis toujours par l'étape suivante concrète.${lang}`;
}

// ── Handler principal ───────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: "POST only" };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      messages = [],
      is_obd2_scan = false,
      vehicle_context = {},
      brand = "default",
      language = "fr",
      user_id = null,          // Pour récupérer le garage
      selected_vehicle = null, // Véhicule sélectionné dans la Box
      // Alias compatibilité
      userMsg, vehicleData, isOBD2Scan,
    } = body;

    // Normalisation
    const finalMessages = messages.length ? messages : userMsg ? [{ role:"user", content: userMsg }] : [];
    const ctx = vehicle_context || vehicleData || {};
    const isOBD2 = is_obd2_scan || isOBD2Scan || false;

    // Extraire les codes DTC du contexte
    const allCodes = [
      ...(ctx.dtcs || []),
      ...(ctx.pendingDtcs || []),
    ].map(d => d.code).filter(Boolean);

    // Requêtes parallèles : DTC Supabase + véhicules garage
    const [dtcInfo, garageVehicles] = await Promise.all([
      lookupDTCs(allCodes, brand),
      getGarageVehicles(user_id),
    ]);

    const caps = BRAND_CAPS[brand] || BRAND_CAPS.default;
    const pidInfo = analyzePIDs(ctx.pids);
    const systemPrompt = buildPrompt(brand, caps, dtcInfo, pidInfo, garageVehicles, language, selected_vehicle);

    // Enrichir le message si c'est un scan OBD2
    let msgs = finalMessages.map(m => ({ role: m.role, content: String(m.content || "") }));

    if (isOBD2 && ctx) {
      const dtcs = ctx.dtcs || [];
      const pending = ctx.pendingDtcs || [];
      const mil = ctx.monitors?.milOn;
      const validDTCs = dtcs.filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code));
      const validPending = pending.filter(d => /^[A-Z][0-9A-F]{4}$/i.test(d.code));

      const scanSummary = [
        ctx.vin ? `VIN: ${ctx.vin}` : "",
        mil ? `🔴 MIL ALLUMÉ — ${ctx.monitors?.dtcCount||validDTCs.length} défaut(s)` : "🟢 MIL éteint",
        validDTCs.length ? `Codes confirmés: ${validDTCs.map(d=>d.code).join(", ")}` : "Aucun code confirmé",
        validPending.length ? `En attente: ${validPending.map(d=>d.code).join(", ")}` : "",
        pidInfo ? pidInfo.split("\n").find(l => l.startsWith("Params:")) || "" : "",
      ].filter(Boolean).join("\n");

      const last = msgs[msgs.length - 1];
      if (last?.role === "user") last.content += `\n\n[SCAN OBD2]\n${scanSummary}`;
      else msgs.push({ role: "user", content: `Analyse ce scan:\n${scanSummary}` });
    }

    if (!msgs.length) msgs = [{ role:"user", content:"Bonjour Dylan !" }];

    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1400,
      system: systemPrompt,
      messages: msgs,
    });

    const message = resp.content[0]?.text || "Je suis là pour vous aider !";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message,
        garage_vehicles: garageVehicles,  // Retourné pour que la Box les affiche
        dtc_enriched: dtcInfo,
        tokens: (resp.usage?.input_tokens || 0) + (resp.usage?.output_tokens || 0),
      }),
    };
  } catch (e) {
    console.error("[mecaia_box]", e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: "Dylan est momentanément indisponible. Réessayez dans quelques secondes.",
        error: e.message,
      }),
    };
  }
};
