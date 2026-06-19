// box_agent.mjs — PROTOTYPE (NON déployé — hors netlify/functions volontairement). Voir ADR-022.
// Cerveau "tool-use" de la MecaIA Box. 1 appel IA = 1 tour COURT (anti-timeout).
//
// NIVEAUX : SERVER (Supabase) · DEVICE V1 (lecture OBD) · DEVICE V2/V3 (UDS, écriture).
// buildTools({level}) : 'v1' (défaut) ou 'v2' (ajoute UDS).

import { enrichLine } from "./dtc_enrich.mjs";

export const PIDS = [
  "RPM","SPEED","COOLANT","INTAKE_TEMP","AMBIENT_TEMP","OIL_TEMP","MAF","MAP","BOOST","RAIL_PRESSURE",
  "FUEL_TRIM_SHORT","FUEL_TRIM_LONG","FUEL_LEVEL","FUEL_PRESSURE","O2_VOLTAGE","LAMBDA","THROTTLE",
  "ENGINE_LOAD","BATTERY","CONTROL_MODULE_VOLTAGE","TIMING_ADVANCE","KNOCK_RETARD","EGR_CMD","COMMANDED_EGR",
  "DPF_DIFF_PRESSURE","EGT","CATALYST_TEMP","EVAP_PRESSURE","DISTANCE_WITH_MIL","ABS_WHEEL_SPEED",
];

// ── SERVER (connaissance / mémoire) ───────────────────────────────────────────
export const KNOWLEDGE_TOOLS = [
  { name: "lookup_dtc", description: "Base MecaIA (18k codes) : libellé + causes + catégorie + gravité estimée. À appeler après read_dtcs.",
    input_schema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } }, required: ["codes"] } },
  { name: "search_similar_cases", description: "Cas similaires par SYMPTÔME pour le même type de véhicule (anonymisé).",
    input_schema: { type: "object", properties: { symptom: { type: "string" }, marque: { type: "string" }, modele: { type: "string" } }, required: ["symptom"] } },
  { name: "record_case", description: "Enregistre le diagnostic CONCLU. UNE fois, à la fin.",
    input_schema: { type: "object", properties: { obd_code: { type: "string" }, symptom: { type: "string" }, primary_diagnosis: { type: "string" },
      parts_needed: { type: "array", items: { type: "string" } }, estimated_cost_min: { type: "number" }, estimated_cost_max: { type: "number" },
      urgency: { type: "string", enum: ["préventif", "bientôt", "urgent"] }, can_drive: { type: "boolean" }, confidence_percent: { type: "number" } }, required: ["primary_diagnosis"] } },
];

// ── DEVICE V1 (lecture seule) ─────────────────────────────────────────────────
export const DEVICE_TOOLS = [
  { name: "read_dtcs", description: "Codes défaut stockés + en attente + état MIL. À APPELER EN PREMIER.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_permanent_dtcs", description: "Codes PERMANENTS (mode 0A) — ne s'effacent pas tant que le défaut n'est pas réglé. Utile après un effacement.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_freeze_frame", description: "Données figées au déclenchement d'un code.", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "read_onboard_tests", description: "Résultats des tests embarqués (Mode 06) : ratés par cylindre, rendement catalyseur, sondes O2. Précieux pour misfire/cata.", input_schema: { type: "object", properties: { focus: { type: "string", enum: ["misfire", "catalyst", "o2", "evap", "all"] } }, required: ["focus"] } },
  { name: "read_live_data", description: "INSTANTANÉ de PIDs CIBLÉS.", input_schema: { type: "object", properties: { pids: { type: "array", items: { type: "string", enum: PIDS } } }, required: ["pids"] } },
  { name: "read_live_stream", description: "OBSERVE des PIDs DANS LA DURÉE (flux). Pour un paramètre qui varie : suralim en accélération, O2 qui oscille. Donne une consigne à l'utilisateur pendant la mesure.",
    input_schema: { type: "object", properties: { pids: { type: "array", items: { type: "string", enum: PIDS } }, duration_s: { type: "integer" }, instruction: { type: "string" } }, required: ["pids", "duration_s"] } },
  { name: "read_readiness_monitors", description: "Moniteurs de préparation (contrôle technique).", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_vin", description: "Lit le VIN.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "clear_dtcs", description: "Efface les codes. SENSIBLE : confirmed:true après accord. À éviter s'il va au garage.", input_schema: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] } },
];

// ── DEVICE V2/V3 (UDS, ISO 14229) ─────────────────────────────────────────────
export const UDS_TOOLS = [
  { name: "read_extended_data", description: "V2 — Données constructeur (UDS 0x22) : suie FAP, adaptations, correction injecteurs, santé batterie, statut routine. LECTURE.",
    input_schema: { type: "object", properties: { request: { type: "string", enum: ["dpf_soot_load", "dpf_regen_status", "injector_correction", "battery_soh", "adaptation_values", "oil_quality", "ecu_info"] } }, required: ["request"] } },
  { name: "service_reset", description: "V2 — Routine d'entretien / réinit (UDS 0x31/0x2E). SENSIBLE (écrit). Routines longues : surveiller via read_extended_data.",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["oil", "dpf_forced_regen", "dpf_additive_reset", "epb_brake_service", "battery_register", "steering_angle_calibration", "throttle_adaptation", "egr_learn", "injector_coding", "tpms_reset", "gearbox_adaptation"] }, confirmed: { type: "boolean" }, preconditions_ok: { type: "boolean" } }, required: ["type", "confirmed", "preconditions_ok"] } },
  { name: "actuator_test", description: "V3 — Active/teste un composant (UDS 0x2F). SENSIBLE (pièces en mouvement / surfaces chaudes / véhicule peut bouger).",
    input_schema: { type: "object", properties: { component: { type: "string", enum: ["cooling_fan", "egr_valve", "parking_brake_release", "parking_brake_apply", "ac_compressor", "glow_plugs", "fuel_pump", "purge_valve", "vnt_actuator", "injector_balance", "horn", "door_lock", "window"] }, action: { type: "string", enum: ["on", "off", "cycle", "test"] }, duration_s: { type: "integer" }, confirmed: { type: "boolean" }, preconditions_ok: { type: "boolean" } }, required: ["component", "action", "confirmed", "preconditions_ok"] } },
];

export const SERVER_TOOL_NAMES = new Set(KNOWLEDGE_TOOLS.map(t => t.name));
export const SENSITIVE_TOOLS = new Set(["clear_dtcs", "service_reset", "actuator_test"]);
export const UDS_WRITE_TOOLS = new Set(["service_reset", "actuator_test"]);
export const isServerTool = (name) => SERVER_TOOL_NAMES.has(name);
export const isSensitive = (name) => SENSITIVE_TOOLS.has(name);

export function buildTools({ level = "v1" } = {}) {
  const base = [...KNOWLEDGE_TOOLS, ...DEVICE_TOOLS];
  return level === "v2" ? [...base, ...UDS_TOOLS] : base;
}

const SYSTEM_BASE = `Tu es Dylan, mécanicien automobile expert qui pilote une valise OBD. Tu raisonnes et AGIS comme un pro, en parlant simplement à l'utilisateur.

MÉTHODE :
1. read_dtcs d'abord (photographier l'état).
2. lookup_dtc sur les codes (libellé + causes + gravité).
3. (si utile) search_similar_cases par symptôme.
4. Mesures CIBLÉES :
   - read_live_data : instantané (tensions, températures stables).
   - read_live_stream : paramètre qui VARIE (donne une consigne au conducteur).
   - read_onboard_tests (Mode 06) : ratés par cylindre, rendement catalyseur.
   Choisis selon symptôme + codes, ne mesure pas tout.
5. Conclus : cause + confiance EN MOTS (jamais de %) + pièces + fourchette de prix.
6. record_case UNE fois à la fin.

Réponds à l'utilisateur, pose une question si tu as besoin d'un complément, et propose toujours l'étape suivante.
SÉCURITÉ : avertir AVANT si lecture dangereuse (COOLANT>103°C, BATTERY<11.8V, freins). clear_dtcs seulement après accord.`;

const UDS_SAFETY = `

OUTILS AVANCÉS UDS (service_reset, actuator_test) — ILS ÉCRIVENT DANS LA VOITURE. Règles STRICTES :
- Avant TOUTE action : (1) explique l'action + le risque, (2) liste les PRÉ-CONDITIONS physiques, (3) attends un OUI explicite → alors seulement confirmed:true ET preconditions_ok:true.
- Dangers : parking_brake (la voiture peut bouger → cales, terrain plat) ; cooling_fan/glow_plugs/fuel_pump/egr/vnt (surfaces chaudes, pièces en mouvement) ; dpf_forced_regen (gaz ~600°C → dehors, ne pas couper le moteur, ~20-40 min) ; injector/gearbox (moteur dans un état précis).
- read_extended_data d'abord pour MESURER (ex: dpf_soot_load) avant une routine.
- Routine longue : lance-la puis SURVEILLE read_extended_data(...status) — non finie tant que le statut ne le dit pas.
- Lecture anormale pendant l'action → STOP et avertis.`;

function buildSystem(level, vehicle, brand, language) {
  const v = vehicle ? `Véhicule : ${vehicle}.` : "Véhicule : inconnu.";
  const b = brand ? ` Marque : ${brand}.` : "";
  const l = language && language !== "fr" ? ` Réponds en langue: ${language}.` : "";
  return SYSTEM_BASE + (level === "v2" ? UDS_SAFETY : "") + `\n\nCONTEXTE.\n${v}${b}${l}`;
}

export async function runDylanTurn({ messages, vehicle, brand, language = "fr", level = "v1",
  apiKey = process.env.ANTHROPIC_API_KEY, model = "claude-haiku-4-5-20251001", maxTokens = 2000 }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY manquant");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: buildSystem(level, vehicle, brand, language), tools: buildTools({ level }), messages }),
  });
  const data = await res.json();
  if (data.type === "error") throw new Error("Anthropic: " + JSON.stringify(data.error));
  const content = data.content || [];
  const toolCalls = content.filter(b => b.type === "tool_use").map(b => ({ id: b.id, name: b.name, input: b.input }));
  const text = content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return { stop_reason: data.stop_reason, text, toolCalls, assistantContent: content };
}

export function toolResultsMessage(results) {
  return { role: "user", content: results.map(r => ({ type: "tool_result", tool_use_id: r.id,
    content: typeof r.content === "string" ? r.content : JSON.stringify(r.content) })) };
}

// ── Exécution des outils SERVER (Supabase REST) ───────────────────────────────
const SAFE_CASE_FIELDS = ["vehicle_marque","vehicle_modele","primary_diagnosis","urgency","can_drive","estimated_cost_min","estimated_cost_max","parts_needed"];
export async function execServerTool(name, input, opts = {}) {
  const { supabaseUrl = process.env.SUPABASE_URL, supabaseKey = process.env.SUPABASE_SECRET, brand, userId, vehicleMeta = {} } = opts;
  if (!supabaseUrl || !supabaseKey) return "Base de connaissance indisponible.";
  const h = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "content-type": "application/json" };
  try {
    if (name === "lookup_dtc") {
      const codes = (input.codes || []).map(c => String(c).toUpperCase()).filter(c => /^[A-Z][0-9A-F]{4}$/i.test(c));
      if (!codes.length) return "Aucun code valide.";
      const inList = codes.map(c => `"${c}"`).join(",");
      const r = await fetch(`${supabaseUrl}/rest/v1/dtc_codes?select=code,description,brand&code=in.(${inList})&limit=60`, { headers: h });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return codes.map(c => enrichLine(c, "(non trouvé)")).join("\n");
      return codes.map(code => {
        const m = rows.filter(x => x.code === code);
        const generic = m.find(x => x.brand === "P" || x.brand === code[0]) || m[0];
        const brandRow = brand ? m.find(x => x.brand && x.brand.toLowerCase() === String(brand).toLowerCase()) : null;
        return enrichLine(code, generic?.description, brandRow?.description);
      }).join("\n");
    }
    if (name === "search_similar_cases") {
      const body = { p_marque: input.marque || "", p_modele: input.modele || "", p_query: input.symptom || "", p_limit: 3 };
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/search_diagnostic_cases_text`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return "Aucun cas similaire (base partielle).";
      const clean = rows.slice(0, 3).map(row => { const o = {}; for (const f of SAFE_CASE_FIELDS) if (row[f] != null) o[f] = row[f]; return o; });
      return "Cas similaires (anonymisés):\n" + JSON.stringify(clean);
    }
    if (name === "record_case") {
      const row = { user_id: userId || null, vehicle_marque: vehicleMeta.marque || null, vehicle_modele: vehicleMeta.modele || null,
        vehicle_year: vehicleMeta.year || null, vehicle_km: vehicleMeta.km || null, symptoms: input.symptom || null, obd_code: input.obd_code || null,
        primary_diagnosis: input.primary_diagnosis, confidence_percent: input.confidence_percent ?? null, urgency: input.urgency || null,
        can_drive: input.can_drive ?? null, estimated_cost_min: input.estimated_cost_min ?? null, estimated_cost_max: input.estimated_cost_max ?? null,
        parts_needed: input.parts_needed || [], created_at: new Date().toISOString() };
      if (process.env.BOX_RECORD_CASES !== "1") return "[dry-run] Cas NON enregistré. Aurait enregistré : " + JSON.stringify(row);
      if (!userId) return "Enregistrement impossible : utilisateur inconnu.";
      const r = await fetch(`${supabaseUrl}/rest/v1/diagnostic_cases`, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(row) });
      return r.ok ? "Diagnostic enregistré." : `Échec enregistrement (${r.status}).`;
    }
  } catch (e) { return `Erreur base: ${e.message}`; }
  return "Outil serveur inconnu.";
}
