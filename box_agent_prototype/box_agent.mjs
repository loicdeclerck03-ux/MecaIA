// box_agent.mjs — PROTOTYPE (NON deploye hors netlify/functions). Voir ADR-022.
// Cerveau tool-use de la MecaIA Box. 1 appel IA = 1 tour COURT (anti-timeout).
// MAJ 20/06/2026 : get_vehicle_context + get_dtc_procedures (donnees EU v7)
// Colonnes vehicle_specs : oil_spec, oil_interval_km, filter_air_km,
//   timing_belt_km (null=chaine), coolant_change_years, brake_fluid_years,
//   tire_pression_front_bar, tire_pression_rear_bar
// Colonnes dtc_procedures : dtc_code, procedure_fr, defect_description_fr, system_type

import { enrichLine } from "./dtc_enrich.mjs";

export const PIDS = [
  "RPM","SPEED","COOLANT","INTAKE_TEMP","AMBIENT_TEMP","OIL_TEMP","MAF","MAP","BOOST","RAIL_PRESSURE",
  "FUEL_TRIM_SHORT","FUEL_TRIM_LONG","FUEL_LEVEL","FUEL_PRESSURE","O2_VOLTAGE","LAMBDA","THROTTLE",
  "ENGINE_LOAD","BATTERY","CONTROL_MODULE_VOLTAGE","TIMING_ADVANCE","KNOCK_RETARD","EGR_CMD","COMMANDED_EGR",
  "DPF_DIFF_PRESSURE","EGT","CATALYST_TEMP","EVAP_PRESSURE","DISTANCE_WITH_MIL","ABS_WHEEL_SPEED",
];

// SERVER (connaissance / memoire)
export const KNOWLEDGE_TOOLS = [
  { name: "get_vehicle_context",
    description: "Specs constructeur (huile, intervalle vidange, filtre air, distribution, liquide refroidissement/frein, pression pneus) + bulletins techniques (TSBs) + rappels NHTSA. A appeler EN PREMIER si le vehicule est identifie (marque/modele/annee connus).",
    input_schema: { type: "object", properties: {
      make: { type: "string", description: "Marque : BMW, Volkswagen, Renault, etc." },
      model: { type: "string", description: "Modele exact : Serie 3, Golf, Clio, etc. (sans accent sur e)" },
      year: { type: "integer", description: "Annee de fabrication" }
    }, required: ["make"] } },

  { name: "lookup_dtc",
    description: "Base MecaIA (18k codes) : libelle + causes + categorie + gravite estimee. A appeler apres read_dtcs.",
    input_schema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } }, required: ["codes"] } },

  { name: "search_similar_cases",
    description: "Cas similaires par SYMPTOME pour le meme type de vehicule (anonymise).",
    input_schema: { type: "object", properties: { symptom: { type: "string" }, marque: { type: "string" }, modele: { type: "string" } }, required: ["symptom"] } },

  { name: "get_dtc_procedures",
    description: "Procedures de reparation FR pour les codes DTC trouves. A appeler avant la CONCLUSION si des codes ont ete detectes.",
    input_schema: { type: "object", properties: {
      codes: { type: "array", items: { type: "string" }, description: "Ex: ['P0299', 'P0401']" },
      make: { type: "string" },
      model: { type: "string" }
    }, required: ["codes"] } },

  { name: "record_case",
    description: "Enregistre le diagnostic CONCLU. UNE fois, a la fin.",
    input_schema: { type: "object", properties: {
      obd_code: { type: "string" }, symptom: { type: "string" }, primary_diagnosis: { type: "string" },
      parts_needed: { type: "array", items: { type: "string" } }, estimated_cost_min: { type: "number" }, estimated_cost_max: { type: "number" },
      urgency: { type: "string", enum: ["preventif", "bientot", "urgent"] }, can_drive: { type: "boolean" }, confidence_percent: { type: "number" }
    }, required: ["primary_diagnosis"] } },
];

// DEVICE V1 (lecture seule)
export const DEVICE_TOOLS = [
  { name: "read_dtcs", description: "Codes defaut stockes + en attente + etat MIL. A APPELER EN PREMIER.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_permanent_dtcs", description: "Codes PERMANENTS (mode 0A) - ne s effacent pas tant que le defaut n est pas regle.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_freeze_frame", description: "Donnees figees au declenchement d un code.", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "read_onboard_tests", description: "Tests embarques (Mode 06) : rates par cylindre, rendement catalyseur, sondes O2.", input_schema: { type: "object", properties: { focus: { type: "string", enum: ["misfire", "catalyst", "o2", "evap", "all"] } }, required: ["focus"] } },
  { name: "read_live_data", description: "INSTANTANE de PIDs CIBLES.", input_schema: { type: "object", properties: { pids: { type: "array", items: { type: "string", enum: PIDS } } }, required: ["pids"] } },
  { name: "read_live_stream", description: "OBSERVE des PIDs DANS LA DUREE (flux). Pour un parametre qui varie. Donne une consigne au conducteur.",
    input_schema: { type: "object", properties: { pids: { type: "array", items: { type: "string", enum: PIDS } }, duration_s: { type: "integer" }, instruction: { type: "string" } }, required: ["pids", "duration_s"] } },
  { name: "read_readiness_monitors", description: "Moniteurs de preparation (controle technique).", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "read_vin", description: "Lit le VIN.", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "clear_dtcs", description: "Efface les codes. SENSIBLE : confirmed:true apres accord explicite. A eviter s il va au garage.", input_schema: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] } },
];

// DEVICE V2/V3 (UDS, ISO 14229)
export const UDS_TOOLS = [
  { name: "read_extended_data", description: "V2 - Donnees constructeur (UDS 0x22) : suie FAP, adaptations, correction injecteurs, sante batterie, statut routine. LECTURE.",
    input_schema: { type: "object", properties: { request: { type: "string", enum: ["dpf_soot_load", "dpf_regen_status", "injector_correction", "battery_soh", "adaptation_values", "oil_quality", "ecu_info"] } }, required: ["request"] } },
  { name: "service_reset", description: "V2 - Routine d entretien / reinit (UDS 0x31/0x2E). SENSIBLE (ecrit).",
    input_schema: { type: "object", properties: { type: { type: "string", enum: ["oil", "dpf_forced_regen", "dpf_additive_reset", "epb_brake_service", "battery_register", "steering_angle_calibration", "throttle_adaptation", "egr_learn", "injector_coding", "tpms_reset", "gearbox_adaptation"] }, confirmed: { type: "boolean" }, preconditions_ok: { type: "boolean" } }, required: ["type", "confirmed", "preconditions_ok"] } },
  { name: "actuator_test", description: "V3 - Active/teste un composant (UDS 0x2F). SENSIBLE (pieces en mouvement).",
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

const SYSTEM_BASE = `Tu es Dylan, mecanicien automobile expert qui pilote une valise OBD. Tu raisonnes et AGIS comme un pro, en parlant simplement a l'utilisateur.

METHODE :
1. Si le vehicule est identifie (marque/modele/annee) -> get_vehicle_context d'abord (specs + rappels). Affiche les infos cles en tete de ton premier message.
2. read_dtcs (photographier l'etat des codes).
3. lookup_dtc sur les codes (libelle + causes + gravite).
4. (si utile) search_similar_cases par symptome.
5. Mesures CIBLEES :
   - read_live_data : instantane (tensions, temperatures stables).
   - read_live_stream : parametre qui VARIE (donne une consigne au conducteur).
   - read_onboard_tests (Mode 06) : rates par cylindre, rendement catalyseur.
   Choisis selon symptome + codes, ne mesure pas tout.
6. Si codes DTC trouves -> get_dtc_procedures avant la conclusion.
7. Conclus : cause + confiance EN MOTS (jamais de %) + pieces + fourchette de prix.
8. record_case UNE fois a la fin.

Reponds a l'utilisateur, pose une question si tu as besoin d'un complement.
SECURITE : avertir AVANT si lecture dangereuse (COOLANT>103C, BATTERY<11.8V). clear_dtcs seulement apres accord explicite.
LIMITE DS2 : sur BMW avant 2008 (E46, E39...), les modules ABS/airbag/DSC utilisent le protocole DS2 (K-line 8E1) - impossible a lire avec cet adaptateur ELM/STN. Si l'utilisateur pose la question, explique-le clairement et honnetement.`;

const UDS_SAFETY = `

OUTILS AVANCES UDS (service_reset, actuator_test) - ILS ECRIVENT DANS LA VOITURE. Regles STRICTES :
- Avant TOUTE action : (1) explique l action + le risque, (2) liste les PRE-CONDITIONS physiques, (3) attends un OUI explicite -> alors seulement confirmed:true ET preconditions_ok:true.
- Dangers : parking_brake (la voiture peut bouger -> cales, terrain plat) ; dpf_forced_regen (gaz ~600 C -> dehors, ne pas couper le moteur, ~20-40 min).
- read_extended_data d'abord pour MESURER avant une routine. Routine longue : poll le statut a intervalles.`;

// vehicleContext = string pre-charge par server.mjs au /start (specs EU formatees)
function buildSystem(level, vehicle, brand, language, vehicleContext) {
  const v = vehicle ? `Vehicule : ${vehicle}.` : "Vehicule : inconnu.";
  const b = brand ? ` Marque : ${brand}.` : "";
  const l = language && language !== "fr" ? ` Reponds en langue: ${language}.` : "";
  const ctx = vehicleContext ? `\n\nSPECS VEHICULE (donnees constructeur EU) :\n${vehicleContext}` : "";
  return SYSTEM_BASE + (level === "v2" ? UDS_SAFETY : "") + `\n\nCONTEXTE.\n${v}${b}${l}${ctx}`;
}

export async function runDylanTurn({ messages, vehicle, brand, language = "fr", level = "v1", vehicleContext = null,
  apiKey = process.env.ANTHROPIC_API_KEY, model = "claude-haiku-4-5-20251001", maxTokens = 2000 }) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY manquant");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: buildSystem(level, vehicle, brand, language, vehicleContext), tools: buildTools({ level }), messages }),
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

// Formatage specs EU (structure reelle retournee par get_vehicle_context RPC)
// Champs specs : oil_spec, oil_interval_km, filter_air_km, timing_belt_km,
//   coolant_change_years, brake_fluid_years, tire_pression_front_bar, tire_pression_rear_bar
function formatSpecs(data) {
  if (!data) return null;
  const lines = [];
  if (data.specs && typeof data.specs === "object" && Object.keys(data.specs).length) {
    const s = data.specs;
    if (s.engine) lines.push(`Moteur : ${s.engine}${s.fuel ? ` (${s.fuel})` : ""}`);
    if (s.oil_spec) lines.push(`Huile : ${s.oil_spec}${s.oil_interval_km ? ` - vidange tous les ${s.oil_interval_km} km` : ""}`);
    if (s.filter_air_km) lines.push(`Filtre a air : tous les ${s.filter_air_km} km`);
    if (s.coolant_change_years) lines.push(`Liquide refroidissement : renouveler tous les ${s.coolant_change_years} ans`);
    if (s.brake_fluid_years) lines.push(`Liquide frein : changer tous les ${s.brake_fluid_years} ans`);
    // timing_belt_km null = chaine ; valeur = courroie avec intervalle
    if (Object.prototype.hasOwnProperty.call(s, "timing_belt_km")) {
      if (s.timing_belt_km === null) lines.push("Distribution : CHAINE (pas de remplacement par intervalle)");
      else lines.push(`Distribution : courroie - tous les ${s.timing_belt_km} km`);
    }
    if (s.tire_pression_front_bar) lines.push(`Pression pneus : ${s.tire_pression_front_bar} bar AV / ${s.tire_pression_rear_bar || "?"} bar AR`);
  }
  if (data.tsbs && data.tsbs.length) {
    lines.push(`Bulletins techniques (TSBs) : ${data.tsbs.slice(0, 3).map(t => t.title || t.tsb_number).join(" | ")}`);
  }
  if (data.recalls && data.recalls.length) {
    lines.push(`Rappels NHTSA : ${data.recalls.length} rappel(s) enregistre(s)`);
  }
  return lines.length ? lines.join("\n") : null;
}

// fetchVehicleContext - pre-chargement par server.mjs au /start
export async function fetchVehicleContext({ make, model, year,
  supabaseUrl = process.env.SUPABASE_URL, supabaseKey = process.env.SUPABASE_SECRET } = {}) {
  if (!supabaseUrl || !supabaseKey || !make) return null;
  const h = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "content-type": "application/json" };
  try {
    const body = { p_make: make, p_model: model || "", p_year: year || null };
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_vehicle_context`, { method: "POST", headers: h, body: JSON.stringify(body) });
    const data = await r.json();
    if (!data || data.error) return null;
    return formatSpecs(data);
  } catch { return null; }
}

// Execution des outils SERVER (Supabase REST)
const SAFE_CASE_FIELDS = ["vehicle_marque","vehicle_modele","primary_diagnosis","urgency","can_drive","estimated_cost_min","estimated_cost_max","parts_needed"];

export async function execServerTool(name, input, opts = {}) {
  const { supabaseUrl = process.env.SUPABASE_URL, supabaseKey = process.env.SUPABASE_SECRET, brand, userId, vehicleMeta = {} } = opts;
  if (!supabaseUrl || !supabaseKey) return "Base de connaissance indisponible.";
  const h = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "content-type": "application/json" };
  try {
    // get_vehicle_context
    if (name === "get_vehicle_context") {
      const body = { p_make: input.make || brand || "", p_model: input.model || vehicleMeta.modele || "", p_year: input.year || vehicleMeta.year || null };
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_vehicle_context`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const data = await r.json();
      if (!data || data.error) return "Specs non trouvees pour ce vehicule dans la base EU.";
      const result = formatSpecs(data);
      return result || "Donnees constructeur non disponibles pour ce vehicule.";
    }

    // get_dtc_procedures
    // Retourne : { dtc_code, procedure_fr, defect_description_fr, system_type, make, model, engine_code }
    if (name === "get_dtc_procedures") {
      const codes = (input.codes || []).map(c => String(c).toUpperCase());
      if (!codes.length) return "Aucun code fourni.";
      const body = { p_codes: codes, p_make: input.make || brand || "", p_model: input.model || vehicleMeta.modele || "" };
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_dtc_procedures`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return `Procedures non trouvees pour ${codes.join(", ")} dans la base EU.`;
      // Regrouper par code DTC (1 procedure representative par code)
      const byCode = {};
      for (const p of rows) {
        const c = p.dtc_code;
        if (!byCode[c]) byCode[c] = p;
      }
      return Object.values(byCode).slice(0, 5).map(p => {
        const sys = p.system_type ? `[${p.system_type}] ` : "";
        const descr = p.defect_description_fr || "";
        const proc = p.procedure_fr || "(voir documentation)";
        return `${p.dtc_code} ${sys}- ${descr}\nProcedure : ${proc}`;
      }).join("\n\n");
    }

    // lookup_dtc
    if (name === "lookup_dtc") {
      const codes = (input.codes || []).map(c => String(c).toUpperCase()).filter(c => /^[A-Z][0-9A-F]{4}$/i.test(c));
      if (!codes.length) return "Aucun code valide.";
      const inList = codes.map(c => `"${c}"`).join(",");
      const r = await fetch(`${supabaseUrl}/rest/v1/dtc_codes?select=code,description,brand&code=in.(${inList})&limit=60`, { headers: h });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return codes.map(c => enrichLine(c, "(non trouve)")).join("\n");
      return codes.map(code => {
        const m = rows.filter(x => x.code === code);
        const generic = m.find(x => x.brand === "P" || x.brand === code[0]) || m[0];
        const brandRow = brand ? m.find(x => x.brand && x.brand.toLowerCase() === String(brand).toLowerCase()) : null;
        return enrichLine(code, generic?.description, brandRow?.description);
      }).join("\n");
    }

    // search_similar_cases
    if (name === "search_similar_cases") {
      const body = { p_marque: input.marque || "", p_modele: input.modele || "", p_query: input.symptom || "", p_limit: 3 };
      const r = await fetch(`${supabaseUrl}/rest/v1/rpc/search_diagnostic_cases_text`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return "Aucun cas similaire (base partielle).";
      const clean = rows.slice(0, 3).map(row => { const o = {}; for (const f of SAFE_CASE_FIELDS) if (row[f] != null) o[f] = row[f]; return o; });
      return "Cas similaires (anonymises):\n" + JSON.stringify(clean);
    }

    // record_case
    if (name === "record_case") {
      const row = { user_id: userId || null, vehicle_marque: vehicleMeta.marque || null, vehicle_modele: vehicleMeta.modele || null,
        vehicle_year: vehicleMeta.year || null, vehicle_km: vehicleMeta.km || null, symptoms: input.symptom || null, obd_code: input.obd_code || null,
        primary_diagnosis: input.primary_diagnosis, confidence_percent: input.confidence_percent ?? null, urgency: input.urgency || null,
        can_drive: input.can_drive ?? null, estimated_cost_min: input.estimated_cost_min ?? null, estimated_cost_max: input.estimated_cost_max ?? null,
        parts_needed: input.parts_needed || [], created_at: new Date().toISOString() };
      if (process.env.BOX_RECORD_CASES !== "1") return "[dry-run] Cas NON enregistre. Aurait enregistre : " + JSON.stringify(row);
      if (!userId) return "Enregistrement impossible : utilisateur inconnu.";
      const r = await fetch(`${supabaseUrl}/rest/v1/diagnostic_cases`, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(row) });
      return r.ok ? "Diagnostic enregistre." : `Echec enregistrement (${r.status}).`;
    }
  } catch (e) { return `Erreur base: ${e.message}`; }
  return "Outil serveur inconnu.";
}
