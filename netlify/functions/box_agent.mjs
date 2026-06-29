// box_agent.mjs — Dylan Tool-Use Brain · Netlify Function · v1.0
// 1 requete HTTP = 1 tour IA court (anti-timeout). App gere les DEVICE tools.
// ADR-022 · 29/06/2026
// ANTHROPIC_KEY (pas ANTHROPIC_API_KEY) · lazy getSupabase · createClient jamais top-level

import Anthropic from '@anthropic-ai/sdk';
import { getUser, serviceClient, json, preflight, ensureDiagSession } from '../lib/auth.mjs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// Lazy getSupabase — JAMAIS top-level (regles Netlify Functions ESM)
let _sb = null;
function getSupabase() {
  if (!_sb) _sb = serviceClient();
  return _sb;
}

// PIDs disponibles pour les outils DEVICE
const PIDS = [
  'RPM','SPEED','COOLANT','INTAKE_TEMP','AMBIENT_TEMP','OIL_TEMP',
  'MAF','MAP','BOOST','RAIL_PRESSURE','FUEL_TRIM_SHORT','FUEL_TRIM_LONG',
  'FUEL_LEVEL','FUEL_PRESSURE','O2_VOLTAGE','LAMBDA','THROTTLE',
  'ENGINE_LOAD','BATTERY','CONTROL_MODULE_VOLTAGE','TIMING_ADVANCE',
  'KNOCK_RETARD','EGR_CMD','COMMANDED_EGR','DPF_DIFF_PRESSURE','EGT',
  'CATALYST_TEMP','EVAP_PRESSURE','DISTANCE_WITH_MIL','ABS_WHEEL_SPEED',
];

// ── dtc_enrich (inline depuis box_agent_prototype/dtc_enrich.mjs) ──────────
function faultCategory(code) {
  const c = String(code || '').toUpperCase();
  if (c[0] === 'B') return 'Carrosserie';
  if (c[0] === 'C') return 'Chassis';
  if (c[0] === 'U') return 'Reseau / Communication';
  if (c[0] === 'P') {
    const map = {
      '0':'Carburant / Air (dosage & emissions)','1':'Carburant / Air (dosage)',
      '2':'Carburant / Air (injection)','3':'Allumage / Rates de combustion',
      '4':'Emissions auxiliaires','5':'Regime / Ralenti',
      '6':'Calculateur / Circuits de sortie','7':'Transmission','8':'Transmission',
      '9':'Transmission','A':'Propulsion hybride','B':'Propulsion hybride','C':'Propulsion hybride',
    };
    return map[c[2]] || 'Moteur / Transmission';
  }
  return null;
}

function severityHint(code, description = '') {
  const c = String(code || '').toUpperCase();
  const d = String(description || '').toLowerCase();
  const HIGH = /misfire|rat[ee]|overheat|oil pressure|huile.*pression|brake|frein|airbag|steering|direction|knock|cliquetis|timing|distribution/;
  const LOW = /evap|small leak|petite fuite|purge|gas cap|bouchon|readiness|ambient|lamp|voyant|comfort/;
  if (c[0] === 'C' && /brake|abs|frein|stability/.test(d)) return 'elevee';
  if (c[0] === 'P' && c[2] === '3') return 'elevee';
  if (HIGH.test(d)) return 'elevee';
  if (LOW.test(d)) return 'faible';
  return 'moderee';
}

function enrichLine(code, description, brandCauses) {
  const cat = faultCategory(code);
  const sev = severityHint(code, description);
  const causes = (brandCauses && brandCauses !== description) ? ` | Causes frequentes : ${brandCauses}` : '';
  return `${code}: ${description || 'libelle inconnu'}${causes} [categorie : ${cat} · gravite estimee : ${sev}]`;
}

// ── Outils SERVER (executes cote Netlify via Supabase) ─────────────────────
const KNOWLEDGE_TOOLS = [
  { name: 'get_vehicle_context',
    description: 'Specs constructeur (huile, vidange, distribution, pneus) + TSBs + rappels. Appeler EN PREMIER si vehicule identifie.',
    input_schema: { type: 'object', properties: { make: { type: 'string' }, model: { type: 'string' }, year: { type: 'integer' } }, required: ['make'] } },
  { name: 'lookup_dtc',
    description: 'Base MecaIA 18k codes: libelle + causes + categorie + gravite. Appeler apres read_dtcs.',
    input_schema: { type: 'object', properties: { codes: { type: 'array', items: { type: 'string' } } }, required: ['codes'] } },
  { name: 'search_similar_cases',
    description: 'Cas similaires par symptome pour ce type de vehicule (anonymises).',
    input_schema: { type: 'object', properties: { symptom: { type: 'string' }, marque: { type: 'string' }, modele: { type: 'string' } }, required: ['symptom'] } },
  { name: 'get_dtc_procedures',
    description: 'Procedures de reparation FR. Appeler avant CONCLUSION si codes detectes.',
    input_schema: { type: 'object', properties: { codes: { type: 'array', items: { type: 'string' } }, make: { type: 'string' }, model: { type: 'string' } }, required: ['codes'] } },
  { name: 'record_case',
    description: 'Enregistre le diagnostic conclu. UNE fois, a la fin.',
    input_schema: { type: 'object', properties: {
      obd_code: { type: 'string' }, symptom: { type: 'string' }, primary_diagnosis: { type: 'string' },
      parts_needed: { type: 'array', items: { type: 'string' } },
      estimated_cost_min: { type: 'number' }, estimated_cost_max: { type: 'number' },
      urgency: { type: 'string', enum: ['preventif','bientot','urgent'] },
      can_drive: { type: 'boolean' }, confidence_percent: { type: 'number' }
    }, required: ['primary_diagnosis'] } },
];

// ── Outils DEVICE V1 (executes par l'app, retournes comme deviceCalls) ──────
const DEVICE_TOOLS = [
  { name: 'read_dtcs', description: 'Codes defaut stockes + en attente + MIL. APPELER EN PREMIER.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'read_permanent_dtcs', description: 'Codes PERMANENTS (mode 0A).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'read_freeze_frame', description: 'Donnees figees au declenchement.', input_schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { name: 'read_onboard_tests', description: 'Tests Mode 06: rates par cylindre, catalyseur, O2.', input_schema: { type: 'object', properties: { focus: { type: 'string', enum: ['misfire','catalyst','o2','evap','all'] } }, required: ['focus'] } },
  { name: 'read_live_data', description: 'Instantane de PIDs cibles.', input_schema: { type: 'object', properties: { pids: { type: 'array', items: { type: 'string', enum: PIDS } } }, required: ['pids'] } },
  { name: 'read_live_stream', description: 'Observer des PIDs dans la duree avec consigne au conducteur.', input_schema: { type: 'object', properties: { pids: { type: 'array', items: { type: 'string', enum: PIDS } }, duration_s: { type: 'integer' }, instruction: { type: 'string' } }, required: ['pids','duration_s'] } },
  { name: 'read_readiness_monitors', description: 'Moniteurs de preparation (controle technique).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'read_vin', description: 'Lit le VIN du vehicule.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'clear_dtcs', description: 'Efface les codes. SENSIBLE: confirmed:true apres accord explicite.', input_schema: { type: 'object', properties: { confirmed: { type: 'boolean' } }, required: ['confirmed'] } },
];

const SERVER_TOOL_NAMES = new Set(KNOWLEDGE_TOOLS.map(t => t.name));
const isServerTool = name => SERVER_TOOL_NAMES.has(name);

// ── Systeme Dylan ─────────────────────────────────────────────────────────────
function buildSystem(vehicle, brand, language, vehicleContext) {
  const v = vehicle ? `Vehicule : ${vehicle}.` : 'Vehicule : inconnu.';
  const b = brand ? ` Marque : ${brand}.` : '';
  const l = (language && language !== 'fr') ? ` Reponds en langue : ${language}.` : '';
  const ctx = vehicleContext ? `\n\nSPECS VEHICULE (donnees constructeur EU) :\n${vehicleContext}` : '';
  return `Tu es Dylan, mecanicien automobile expert qui pilote une valise OBD. Tu raisonnes et AGIS comme un pro.

METHODE :
1. Si vehicule identifie -> get_vehicle_context d'abord (specs + rappels). Affiche les infos cles.
2. read_dtcs (photographier l'etat des codes).
3. lookup_dtc sur les codes (libelle + causes + gravite).
4. (si utile) search_similar_cases par symptome.
5. Mesures CIBLEES : read_live_data (instantane) ou read_live_stream (parametre variable) ou read_onboard_tests (Mode 06).
6. Si codes DTC trouves -> get_dtc_procedures avant la conclusion.
7. Conclus : cause + confiance EN MOTS (jamais de %) + pieces + fourchette de prix.
8. record_case UNE fois a la fin.

SECURITE : avertir AVANT si COOLANT>103C ou BATTERY<11.8V. clear_dtcs seulement apres accord explicite.
LIMITE DS2 : BMW avant 2008 (E46, E39...) — modules ABS/airbag/DSC en protocole DS2 K-line 8E1 — impossible avec adaptateur ELM/STN standard. L'expliquer honnêtement.

CONTEXTE : ${v}${b}${l}${ctx}`;
}

// ── Formatage specs vehicule (retour RPC get_vehicle_context) ─────────────
function formatSpecs(data) {
  if (!data) return null;
  const lines = [];
  if (data.specs && typeof data.specs === 'object' && Object.keys(data.specs).length) {
    const s = data.specs;
    if (s.engine) lines.push(`Moteur : ${s.engine}${s.fuel ? ` (${s.fuel})` : ''}`);
    if (s.oil_spec) lines.push(`Huile : ${s.oil_spec}${s.oil_interval_km ? ` — vidange tous les ${s.oil_interval_km} km` : ''}`);
    if (s.filter_air_km) lines.push(`Filtre air : tous les ${s.filter_air_km} km`);
    if (s.coolant_change_years) lines.push(`Liquide refroidissement : tous les ${s.coolant_change_years} ans`);
    if (s.brake_fluid_years) lines.push(`Liquide frein : tous les ${s.brake_fluid_years} ans`);
    if ('timing_belt_km' in s) {
      lines.push(s.timing_belt_km === null
        ? 'Distribution : CHAINE (pas de remplacement par intervalle)'
        : `Distribution : courroie — tous les ${s.timing_belt_km} km`);
    }
    if (s.tire_pression_front_bar) {
      lines.push(`Pression pneus : ${s.tire_pression_front_bar} bar AV / ${s.tire_pression_rear_bar || '?'} bar AR`);
    }
  }
  if (data.tsbs?.length) lines.push(`TSBs : ${data.tsbs.slice(0,3).map(t => t.title || t.tsb_number).join(' | ')}`);
  if (data.recalls?.length) lines.push(`Rappels NHTSA : ${data.recalls.length} rappel(s)`);
  return lines.length ? lines.join('\n') : null;
}

// ── Execution outils SERVER (Supabase SDK) ────────────────────────────────
const SAFE_CASE_FIELDS = ['vehicle_marque','vehicle_modele','primary_diagnosis','urgency',
  'can_drive','estimated_cost_min','estimated_cost_max','parts_needed'];

async function execServerTool(name, input, { supabase, brand, userId, vehicleMeta = {} }) {
  try {

    if (name === 'get_vehicle_context') {
      const { data, error } = await supabase.rpc('get_vehicle_context', {
        p_make:  input.make  || brand || '',
        p_model: input.model || vehicleMeta.modele || '',
        p_year:  input.year  || vehicleMeta.year  || null,
      });
      if (error) return `Erreur specs : ${error.message}`;
      return formatSpecs(data) || 'Specs non trouvees pour ce vehicule dans la base EU.';
    }

    if (name === 'get_dtc_procedures') {
      const codes = (input.codes || []).map(c => String(c).toUpperCase());
      if (!codes.length) return 'Aucun code fourni.';
      const { data: rows, error } = await supabase.rpc('get_dtc_procedures', {
        p_codes: codes,
        p_make:  input.make  || brand || '',
        p_model: input.model || vehicleMeta.modele || '',
      });
      if (error) return `Erreur procedures : ${error.message}`;
      if (!rows?.length) return `Procedures non trouvees pour ${codes.join(', ')}.`;
      const byCode = {};
      for (const p of rows) if (!byCode[p.dtc_code]) byCode[p.dtc_code] = p;
      return Object.values(byCode).slice(0,5).map(p => {
        const sys = p.system_type ? `[${p.system_type}] ` : '';
        const descr = p.defect_description_fr || '';
        const proc  = p.procedure_fr || '(voir documentation)';
        return `${p.dtc_code} ${sys}- ${descr}\nProcedure : ${proc}`;
      }).join('\n\n');
    }


    if (name === 'lookup_dtc') {
      const codes = (input.codes || [])
        .map(c => String(c).toUpperCase())
        .filter(c => /^[A-Z][0-9A-F]{4}$/.test(c));
      if (!codes.length) return 'Aucun code valide.';
      const { data: rows } = await supabase
        .from('dtc_codes').select('code,description,brand').in('code', codes);
      if (!rows?.length) return codes.map(c => enrichLine(c, '(non trouve)')).join('\n');
      return codes.map(code => {
        const m   = rows.filter(x => x.code === code);
        const gen = m.find(x => x.brand === code[0]) || m[0];
        const brd = brand ? m.find(x => x.brand?.toLowerCase() === String(brand).toLowerCase()) : null;
        return enrichLine(code, gen?.description, brd?.description);
      }).join('\n');
    }

    if (name === 'search_similar_cases') {
      const { data: rows } = await supabase.rpc('search_similar_cases', {
        p_marque:  input.marque  || '',
        p_modele:  input.modele  || '',
        p_query:   input.symptom || '',
        p_limit:   3,
      });
      if (!rows?.length) return 'Aucun cas similaire (base en construction).';
      const clean = rows.slice(0,3).map(r =>
        Object.fromEntries(SAFE_CASE_FIELDS.map(f => [f, r[f]]).filter(([,v]) => v != null))
      );
      return 'Cas similaires (anonymises) :\n' + JSON.stringify(clean);
    }

    if (name === 'record_case') {
      if (!userId) return 'Enregistrement impossible : utilisateur inconnu.';
      const row = {
        user_id:            userId,
        vehicle_marque:     vehicleMeta.marque || null,
        vehicle_modele:     vehicleMeta.modele || null,
        vehicle_year:       vehicleMeta.year   || null,
        vehicle_km:         vehicleMeta.km     || null,
        symptoms:           input.symptom      || null,
        obd_code:           input.obd_code     || null,
        primary_diagnosis:  input.primary_diagnosis,
        confidence_percent: input.confidence_percent ?? null,
        urgency:            input.urgency      || null,
        can_drive:          input.can_drive    ?? null,
        estimated_cost_min: input.estimated_cost_min ?? null,
        estimated_cost_max: input.estimated_cost_max ?? null,
        parts_needed:       input.parts_needed || [],
        created_at:         new Date().toISOString(),
      };
      const { error } = await supabase.from('diagnostics').insert(row);
      return error ? `Echec enregistrement : ${error.message}` : 'Diagnostic enregistre.';
    }

  } catch (e) { return `Erreur base : ${e.message}`; }
  return 'Outil serveur inconnu.';
}

// ── HANDLER NETLIFY ───────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST')    return json(405, { error: 'POST only' });

  // Auth JWT Supabase
  const auth = await getUser(event);
  if (!auth) return json(401, { error: 'Non authentifie' });

  const supabase = getSupabase();

  // Gate credits (1 session = 1 credit ou illimite)
  let gate;
  try {
    gate = await ensureDiagSession(supabase, auth.userId);
  } catch (e) {
    return json(500, { error: `Gate : ${e.message}` });
  }
  if (!gate.allowed) {
    return json(402, {
      success: false,
      code: 'insufficient_credits',
      message: 'Credits insuffisants pour une session de diagnostic.',
      remaining_balance: gate.balance,
    });
  }

  // Parse body
  let b;
  try { b = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'JSON invalide' }); }

  const {
    messages     = [],
    vehicle      = '',
    brand        = '',
    language     = 'fr',
    level        = 'v1',
    vehicleContext = null,
    vehicleMeta  = {},
  } = b;

  if (!Array.isArray(messages) || !messages.length) {
    return json(400, { error: 'messages[] requis' });
  }

  // Appel IA — 1 TOUR (anti-timeout Netlify 10s)
  const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
  const allTools   = [...KNOWLEDGE_TOOLS, ...DEVICE_TOOLS];
  const system     = buildSystem(vehicle, brand, language, vehicleContext);

  let aiResult;
  try {
    aiResult = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 2000,
      system,
      tools:      allTools,
      messages,
    });
  } catch (e) {
    return json(500, { error: `IA : ${e.message}` });
  }

  const content   = aiResult.content || [];
  const toolCalls = content
    .filter(c => c.type === 'tool_use')
    .map(c => ({ id: c.id, name: c.name, input: c.input }));
  const text = content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();

  // Routing tools : SERVER executes ici, DEVICE retournes a l'app
  const serverResults = [];
  const deviceCalls   = [];

  for (const tc of toolCalls) {
    if (isServerTool(tc.name)) {
      const result = await execServerTool(tc.name, tc.input, {
        supabase,
        brand,
        userId:      auth.userId,
        vehicleMeta,
      });
      serverResults.push({ id: tc.id, name: tc.name, content: result });
    } else {
      deviceCalls.push(tc);
    }
  }

  // Reponse — format symetrique avec swarm_diagnosis.mjs
  return json(200, {
    stop_reason:     aiResult.stop_reason,  // 'tool_use' | 'end_turn' | 'max_tokens'
    text,                                    // Texte Dylan si present
    assistantContent: content,               // Bloc complet (pour reconstruire messages[])
    serverResults,   // Outils SERVER deja resolus — a injecter comme tool_result avant le prochain appel
    deviceCalls,     // Outils DEVICE — l'app les execute via BLE/OBD et renvoie les resultats
    charged:   gate.charged,
    unlimited: gate.unlimited,
  });
};

/*
 * PROTOCOLE APP — boucle agentique cote client
 *
 * 1. App appelle POST /box_agent avec messages = [{ role:'user', content:'...' }]
 * 2. Si stop_reason === 'tool_use' && deviceCalls.length > 0 :
 *    - App execute chaque DEVICE tool via OBD BLE
 *    - App reconstruit messages[] :
 *        [...messages, { role:'assistant', content: assistantContent },
 *                      { role:'user', content: [{ type:'tool_result', tool_use_id: id, content: result }, ...] }]
 *    - App ajoute aussi les serverResults comme tool_result supplementaires
 *    - App re-appelle POST /box_agent avec le nouveau messages[]
 * 3. Si stop_reason === 'end_turn' : boucle terminee, afficher text a l'utilisateur
 * 4. Si stop_reason === 'tool_use' && deviceCalls.length === 0 :
 *    - Tous les tools etaient SERVER et sont dans serverResults
 *    - Reconstruire messages[] et re-appeler immediatement
 */
