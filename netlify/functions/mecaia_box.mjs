// mecaia_box.mjs — Agent Dylan OBD2 Expert v8 — +Mode$06 +FuelTrimHistory +Misfire +BatteryDeep
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
  {
    name: "read_freeze_frame",
    description: "Snapshot capteurs au moment du declenchement d un code DTC. Donne le contexte exact : chaud/froid, charge, regime. Appeler apres read_dtcs si codes actifs.",
    input_schema: { type: "object", properties: {
      code: { type: "string", description: "Code DTC dont on veut le freeze frame (ex: P0300)" }
    }, required: ["code"] }
  },
  {
    name: "get_drive_cycle",
    description: "Procedure drive cycle post-reparation pour repasser un moniteur OBD au vert (controle technique). Appeler a la fin si des moniteurs ne sont pas prets.",
    input_schema: { type: "object", properties: {
      monitor: { type: "string", description: "Nom du moniteur : catalyst, o2_sensor, egr, evap, misfire, fuel_system" }
    }, required: ["monitor"] }
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
  {
    name: "read_mode06",
    description: "Resultats des tests embarques OBD Mode $06. Detecte les composants qui derivent AVANT qu ils declenchent un code. Appeler si suspicion de degradation sonde O2, catalyseur, EGR.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "read_misfire_counts",
    description: "Compteurs de rates d allumage et statut moniteur de rates. Appeler si P0300 ou symptome de rotation irreguliere.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "read_battery_health",
    description: "Diagnostic batterie et alternateur : tension actuelle, statut, interpretation. Appeler si symptome electrique ou batterie faible.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_fuel_trim_history",
    description: "Historique des corrections carburant (STFT/LTFT) des sessions precedentes. Permet de detecter une tendance : si LTFT monte chaque semaine, il y a une fuite d admission qui grossit.",
    input_schema: { type: "object", properties: {
      vin: { type: "string", description: "VIN du vehicule pour filtrer l historique" }
    }, required: [] }
  },
];

const SERVER_TOOLS = new Set(["get_vehicle_context","lookup_dtc","search_similar_cases","get_dtc_procedures","get_fuel_trim_history"]);

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
  if (name === "get_fuel_trim_history") {
    if (!vehicleMeta?.userId) return "Historique non disponible (utilisateur non identifié).";
    try {
      const body = { p_user_id: vehicleMeta.userId, p_vin: input.vin || vehicleMeta.vin || null, p_limit: 10 };
      const r = await fetch(`${url}/rest/v1/rpc/get_fuel_trim_history`, { method: "POST", headers: h, body: JSON.stringify(body) });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return "Aucune session precedente trouvee pour ce vehicule.";
      const lines = rows.map(row => {
        const d = new Date(row.scanned_at).toLocaleDateString("fr-BE");
        const stft = row.fuel_trim_short != null ? `STFT:${(+row.fuel_trim_short).toFixed(1)}%` : "";
        const ltft = row.fuel_trim_long  != null ? `LTFT:${(+row.fuel_trim_long).toFixed(1)}%`  : "";
        const batt = row.battery_voltage != null ? `Batt:${(+row.battery_voltage).toFixed(1)}V`  : "";
        const dtc  = row.dtc_count       != null ? `DTC:${row.dtc_count}` : "";
        return `${d} — ${[stft,ltft,batt,dtc].filter(Boolean).join(" | ")}`;
      });
      // Calcul tendance LTFT
      const ltfts = rows.filter(r => r.fuel_trim_long != null).map(r => +r.fuel_trim_long);
      let trend = "";
      if (ltfts.length >= 2) {
        const delta = ltfts[0] - ltfts[ltfts.length-1];
        if (Math.abs(delta) > 2) trend = `\nTENDANCE LTFT: ${delta > 0 ? "+" : ""}${delta.toFixed(1)}% sur ${ltfts.length} sessions — ${delta > 3 ? "DEGRADATION DETECTEE (fuite admission ou sonde O2)" : delta < -3 ? "Enrichissement progressif (injecteurs ou sonde)" : "stable"}`;
      }
      return `Historique ${rows.length} sessions :\n${lines.join("\n")}${trend}`;
    } catch(e) { return `Erreur historique: ${e.message}`; }
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

  if (name === "read_freeze_frame") {
    const code = (input.code || "").toUpperCase();
    // ctx.freezeFrames = objet par code | ctx.freezeFrame = freeze frame generique (singulier)
    const ff = (ctx.freezeFrames || {})[code] || ctx.freezeFrame || null;
    if (!ff || !Object.keys(ff).length) {
      return `Freeze frame pour ${code} : non disponible (le code a pu etre efface ou le vehicule ne le supporte pas).`;
    }
    const lines = Object.entries(ff).map(([k, v]) => {
      const units = { RPM:"tr/min",COOLANT:"°C",SPEED:"km/h",ENGINE_LOAD:"%",MAF:"g/s",THROTTLE:"%",FUEL_TRIM_SHORT:"%",FUEL_TRIM_LONG:"%" };
      return `  ${k}: ${v}${units[k] ? " " + units[k] : ""}`;
    });
    return `Freeze frame ${code} (contexte au declenchement) :\n${lines.join("\n")}`;
  }

  if (name === "get_drive_cycle") {
    const cycles = {
      catalyst: "CATALYSEUR : 1) Demarrage a froid (< 35°C). 2) Accelération douce jusqu'a 90 km/h. 3) Vitesse constante 80-100 km/h pendant 5 min (4e vitesse). 4) Decelerer sans freiner jusqu'a 40 km/h. 5) 3 accelerations progressives 40->80 km/h. 6) Couper le moteur, attendre 10 min. Repetez si moniteur non pret.",
      o2_sensor: "SONDE O2 : 1) Demarrer a froid. 2) Conduire en ville 10 min (stop & go, < 50 km/h). 3) Accelération 50->80 km/h x3. 4) 5 min a vitesse constante 80 km/h. 5) Ralentissement moteur frein. Le moniteur se complete generalement en 15-20 min de conduite variee.",
      egr: "EGR : 1) Demarrer a froid. 2) Accelération modéree jusqu'a 90 km/h. 3) Maintenir 60-80 km/h en 4e vitesse pendant 8 min (charge partielle). 4) Decelerer moteur frein. La recirculation des gaz est active en charge partielle uniquement.",
      evap: "SYSTEME EVAP : 1) Reservoir entre 15% et 85% (pas plein, pas vide). 2) Demarrer a froid (temp < 35°C). 3) Conduite normale 10-15 min. 4) Le test s effectue automatiquement au ralenti apres echauffement. Ne pas couper le moteur brutalement.",
      misfire: "DETECTION RATES : 1) Chaud (>80°C). 2) Conduite a charge moderee 1500-3000 RPM. 3) Eviter ralenti prolonge. 4) Le moniteur se complete en quelques minutes de conduite normale si la reparation est effective.",
      fuel_system: "SYSTEME CARBURANT : 1) Demarrage normal (froid ou chaud). 2) Conduite variee 10 min. 3) Inclure des accelerations et decelerations. 4) Moniteur generalement le plus rapide a completer (2-5 min).",
    };
    const m = (input.monitor || "").toLowerCase();
    return cycles[m] || `Drive cycle pour moniteur ${input.monitor || "inconnu"} : effectuez une conduite normale de 20-30 min incluant demarrages a froid, conduite en ville et vitesse constante autoroute. Reconnectez le boitier pour verifier les moniteurs.`;
  }

  if (name === "read_mode06") {
    const m06 = ctx.mode06 || {};
    if (!Object.keys(m06).length) return "Mode $06 non disponible sur ce vehicule (non supporte ou pas de donnees).";
    const lines = Object.entries(m06).map(([k,v]) => {
      return `${k}: valeur=${v.value} min=${v.min} max=${v.max} (${v.pct!=null?v.pct+'%':'-'}) → ${v.status}`;
    });
    const echecs = Object.values(m06).filter(v => v.status==='ECHEC').length;
    const limites = Object.values(m06).filter(v => v.status==='LIMITE').length;
    return `Mode $06 — ${Object.keys(m06).length} tests :\n${lines.join("\n")}\n\nResume: ${echecs} echec(s), ${limites} proche(s) limite`;
  }

  if (name === "read_misfire_counts") {
    const mc = ctx.misfireCounts || {};
    if (!Object.keys(mc).length) return "Compteurs de rates non disponibles sur ce vehicule.";
    const lines = Object.entries(mc).map(([k,v]) => `${k}: ${v}`);
    return `Moniteur rates d allumage :\n${lines.join("\n")}`;
  }

  if (name === "read_battery_health") {
    const bh = ctx.batteryHealth || {};
    if (!Object.keys(bh).length) {
      const batt = (ctx.pids||{}).BATTERY;
      if (batt?.value != null) return `Tension batterie: ${batt.value}V (test approfondi non disponible)`;
      return "Test batterie non disponible.";
    }
    return `Test batterie:\nTension: ${bh.voltage||'?'}V — ${bh.status||''}\nDiagnostic: ${bh.diagnostic||''}${bh.ecu_voltage?'\nTension ECU: '+bh.ecu_voltage:''}${bh.voltage_delta?'\nEcart ATRV/ECU: '+bh.voltage_delta:''}`;
  }

  return `Outil ${name}: donnees non disponibles dans ce scan.`;
}

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
function buildSystem(brand, vehicleStr, language) {
  const lang = { nl: " Reponds en neerlandais.", en: " Respond in English.", de: " Antworte auf Deutsch." }[language] || "";
  return `Tu es Dylan, mecanicien automobile expert connecte a une vraie voiture via boitier OBD MecaIA.

PROTOCOLE DIAGNOSTIC EN 6 ETAPES (RESPECTE TOUJOURS CET ORDRE) :

ETAPE 1 - IDENTIFICATION
- get_vehicle_context (specs + TSBs + rappels) si vehicule identifie
- read_vin si VIN disponible
- Affiche les infos cles en tete de reponse (huile, distribution, pression pneus)

ETAPE 2 - TRIAGE DES CODES
- read_dtcs (codes stockes + en attente + permanents + MIL)
- lookup_dtc sur TOUS les codes trouves
- read_freeze_frame sur le code le plus grave (contexte exact du declenchement)
- Classe par priorite : SECURITE (ABS/airbag/freins) > MOTEUR > EMISSIONS > CONFORT

ETAPE 3 - ACQUISITION LIVE CIBLEE
- read_live_data avec les PIDs PERTINENTS selon les codes (pas generiques)
  P0300 (rates) -> RPM, ENGINE_LOAD, O2_VOLTAGE, FUEL_TRIM_SHORT
  P0171/P0174 (melange) -> FUEL_TRIM_SHORT, FUEL_TRIM_LONG, MAF, O2_VOLTAGE
  P0299 (turbo) -> BOOST, MAF, ENGINE_LOAD, THROTTLE
  P0420 (catalyseur) -> O2_VOLTAGE, FUEL_TRIM_LONG, COOLANT
  P0401 (EGR) -> MAF, ENGINE_LOAD, EGR_CMD
  Defaut electrique -> BATTERY

ETAPE 4 - INTERROGATION (pendant l acquisition)
- Pose 2-3 questions CIBLEES selon les codes :
  "Le probleme apparait-il a froid, chaud, ou toujours ?"
  "La perte de puissance est-elle permanente ou sous charge seulement ?"
  "Voyez-vous de la fumee ou sentez-vous quelque chose d inhabituel ?"

ETAPE 5 - DIAGNOSTIC & CAUSE RACINE
- search_similar_cases si symptome complexe
- Croise : codes + freeze frame + live data + symptomes declares
- Enonce la cause probable + CE QUI L ELIMINE ou CONFIRME
- Mentionne les tests manuels pour confirmer (multimetre, pression, visuel)
- Jamais de % de confiance : utilise "probable", "tres probable", "certain"

ETAPE 6 - PLAN D ACTION
- get_dtc_procedures avant la conclusion si codes trouves
- Inclus : pieces a commander + fourchette de prix + difficulte DIY (1-5)
- Si moniteurs non prets -> get_drive_cycle pour le guide post-reparation
- Recommande une date de reconnexion ("Reconnectez dans 200 km pour verifier")

OUTILS SUPPLEMENTAIRES :
- read_mode06 : si suspicion degradation sonde O2/catalyseur/EGR SANS code encore. Les resultats "LIMITE" indiquent une degradation pre-code.
- read_misfire_counts : si P0300 ou vibrations au ralenti. Confirme si le moniteur rates est actif.
- read_battery_health : si symptome electrique, demarrage difficile, ou batterie faible.
- get_fuel_trim_history : si LTFT > +5% OU suspicion fuite admission/sonde. Montre la tendance sur les sessions precedentes. Une progression = fuite qui grossit.

REGLES ABSOLUES :
- SECURITE EN PREMIER : si COOLANT > 103C ou BATTERY < 11.2V -> ARRETER le moteur
- CODE = PISTE, jamais conclusion directe sans live data
- Toujours proposer le moins cher / non-destructif en premier (additif, nettoyage, test avant remplacement)
- Honnete sur les limites : si intermittent ou donnees insuffisantes, le dire
- DS2 BMW (E46/E39) : ABS/airbag/DSC illisibles avec cet adaptateur, l expliquer si demande
- Les codes s effacent via le bouton "Effacer DTC" dans l interface, pas via une commande chat
- Les options vehicule (coding) s activent via les boutons dans l onglet Options

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
      userId: uid || null,
      vin:    ctx.vin || veh?.vin || null,
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

      // Freeze frames si disponibles (pluriel ou singulier depuis fullDiagScan)
      const ff = ctx.freezeFrames || {};
      const ffSingle = ctx.freezeFrame || null;
      let ffStr = Object.keys(ff).slice(0,2).map(code => {
        const data = Object.entries(ff[code] || {}).slice(0,4).map(([k,v]) => `${k}:${v}`).join(",");
        return data ? `FF(${code}): ${data}` : "";
      }).filter(Boolean).join(" | ");
      if (!ffStr && ffSingle && typeof ffSingle === 'object') {
        const data = Object.entries(ffSingle).slice(0,5).map(([k,v]) => `${k}:${v}`).join(",");
        if (data) ffStr = `FF(premier code): ${data}`;
      }

      const scanSummary = [
        ctx.vin ? `VIN: ${ctx.vin}` : "",
        mil ? `MIL ALLUME - ${ctx.monitors?.dtcCount || stored.length} defaut(s)` : "MIL eteint",
        stored.length ? `Codes: ${stored.map(d => d.code).join(", ")}` : "Aucun code DTC",
        pend.length   ? `En attente: ${pend.map(d => d.code).join(", ")}` : "",
        pidStr        ? `Params: ${pidStr}` : "",
        ffStr         ? `Freeze frames: ${ffStr}` : "",
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

    // Sauvegarder session OBD si scan avec données PIDs
    if (uid && isOBD2 && ctx && Object.keys(ctx.pids || {}).length) {
      const pids = ctx.pids || {};
      const saveSess = async () => {
        try {
          const stft = pids.FUEL_TRIM_ST?.value ?? pids.FUEL_TRIM_SHORT?.value ?? null;
          const ltft = pids.FUEL_TRIM_LT?.value ?? pids.FUEL_TRIM_LONG?.value ?? null;
          const batt = pids.BATTERY?.value ?? null;
          const temp = pids.COOLANT?.value ?? null;
          const rpm  = pids.RPM?.value ?? null;
          const allCodes = [...(ctx.dtcs||[]).map(d=>d.code), ...(ctx.pendingDtcs||[]).map(d=>d.code)];
          await getSupabase().from("obd_sessions").insert({
            user_id: uid,
            vehicle_id: veh?.id || null,
            vin: ctx.vin || veh?.vin || null,
            fuel_trim_short: stft !== null ? parseFloat(stft) : null,
            fuel_trim_long:  ltft !== null ? parseFloat(ltft) : null,
            battery_voltage: batt !== null ? parseFloat(batt) : null,
            coolant_temp:    temp !== null ? parseInt(temp)   : null,
            rpm_idle:        rpm  !== null ? parseInt(rpm)    : null,
            dtc_count: allCodes.length,
            dtcs: allCodes,
            monitors: ctx.monitors || {},
            mode06: ctx.mode06 || {},
            battery_health: ctx.batteryHealth || {},
            pids_snapshot: Object.fromEntries(
              Object.entries(pids).map(([k,v]) => [k, v?.value ?? v])
            ),
          });
        } catch(e) { /* non bloquant */ }
      };
      saveSess();
    }

    if (!text) text = "Dylan est disponible. Que se passe-t-il avec votre vehicule ?";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: text, garage_vehicles: garageVehicles, dtc_enriched: dtcEnriched, tokens }),
    };

  } catch (e) {
    console.error("[mecaia_box v8]", e.message);
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
