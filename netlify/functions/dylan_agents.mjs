// ============================================================
// DYLAN — Moteur d'enquete V2 (cote serveur, securise)
//  Ameliorations implementees :
//  #1  Retry JSON automatique        (deja present, renforce)
//  #2  DTC lookup Supabase avant hyp (NOUVEAU)
//  #3  Pseudo-streaming frontend     (affichage progressif)
//  #4  Resume anti-croissance ctx    (presente, active >5 tours)
//  #5  Boutons reponse rapide        (interface frontend)
//  #6  Haiku enquete + Sonnet conclu (NOUVEAU - modele hybride)
//  #7  Rappels constructeurs NHTSA   (NOUVEAU)
//  #8  Devis PDF auto conclusion     (frontend)
//  #9  Memoire vehicule inter-session(NOUVEAU)
//  #10 Feedback loop post-conclusion (NOUVEAU)
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// Haiku pour toutes les phases — Netlify free plan = 10s max, Sonnet trop lent
// Sonnet réactivable via ANTHROPIC_CONCLUSION_MODEL env var sur plan Pro
const MODEL_ENQUETE    = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MODEL_CONCLUSION = process.env.ANTHROPIC_CONCLUSION_MODEL || "claude-haiku-4-5-20251001";

// Plafond anti-derive de cout — 15 tours (3 contexte + 1 hyp + 4 controles + 1 conclu + marge)
const MAX_TOURS = 15;

// Bloc securite valide
const SAFETY_BLOCK = `RÔLE : tu es Dylan, un ami mécanicien expert. Tu parles franchement, tu rassures, tu expliques simplement. Jamais de jargon inutile. Ton objectif : trouver LA vraie panne, pas supposer.

CARACTÈRE : Chaleureux ("Pas de panique, c'est courant !"), Direct, Honnête (si tu ne sais pas, tu envoies chez le pro).

RÈGLES DE SÉCURITÉ (priment sur tout le reste) :
1. N'invente jamais une information technique que tu ne connais pas de façon fiable.
2. Ne minimise jamais un danger réel.
3. Ne recommande jamais une manipulation qui contourne un système de sécurité.
4. Le critère est le DANGER RÉEL DE LA MANIPULATION, pas le système concerné.
5. Pour les pannes courantes où l'information est fiable, reste concret et pratique.

⚠️ URGENCE ABSOLUE — PRIORITÉ SUR TOUT :
Si l'utilisateur décrit UN de ces signes : fumée sortant du capot/habitacle, voyant température rouge, forte odeur de brûlé, perte de freins, départ de feu → commence IMMÉDIATEMENT le champ "message" par "⚠️ ARRÊTEZ le véhicule en sécurité immédiatement, coupez le moteur et éloignez-vous." AVANT toute question de diagnostic.

CONTRAINTE V1 : ne propose QUE des contrôles non dangereux et non destructifs.`;

// Parsing JSON robuste
function safeJSON(text) {
  if (!text) return null;
  let t = String(text).trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function emptyState() {
  return {
    etat: "CONTEXTE",
    registre: "detaille",
    tour: 0,
    vehicule: { make: null, model: null, engine_code: null, engine_label: null, fuel: null, year: null, mileage_km: null },
    contexte: { symptome: null, chaud_froid: null, permanent_intermittent: null, codes: [] },
    hypotheses: [],
    controle_en_cours: null,
    controles_faits: [],
    reexpliquer: false,
    resume_enquete: "",
    dtc_enrichi: [],  // DTC trouvés en base Supabase
  };
}

function appliquerResultat(state, resultat) {
  const c = state.controle_en_cours;
  if (!c) return;
  if (resultat === "ne_sais_pas") { state.reexpliquer = true; return; }
  state.controles_faits.push({ hypothese_id: c.hypothese_id, pouvoir: c.pouvoir, polarite_oui: c.polarite_oui || "confirme", resultat });
  const hyp = state.hypotheses.find((h) => h.id === c.hypothese_id);
  state.controle_en_cours = null;
  if (resultat === "pas_pu") { if (hyp) ajoutPreuve(hyp, "neutre", "controle non realise", c.pouvoir); return; }
  const pol = c.polarite_oui || "confirme";
  const effetConfirme = (resultat === "oui" && pol === "confirme") || (resultat === "non" && pol === "elimine");
  if (hyp) { ajoutPreuve(hyp, effetConfirme ? "pour" : "contre", "controle_" + resultat, c.pouvoir); recalcStatut(hyp); }
}

function ajoutPreuve(hyp, sens, source, pouvoir) {
  if (!hyp.preuves) hyp.preuves = [];
  hyp.preuves.push({ sens, source, pouvoir: pouvoir || "faible" });
}

function recalcStatut(hyp) {
  const p = hyp.preuves || [];
  const contreFort = p.some((x) => x.sens === "contre" && x.pouvoir === "fort");
  const pourFort   = p.some((x) => x.sens === "pour"   && x.pouvoir === "fort");
  const pour  = p.filter((x) => x.sens === "pour").length;
  const contre = p.filter((x) => x.sens === "contre").length;
  if (pourFort && !contreFort) { hyp.statut = "confirmee"; return; }
  if (contreFort && !pourFort) { hyp.statut = "eliminee"; return; }
  if (contre > pour && pour === 0) { hyp.statut = "eliminee"; return; }
  hyp.statut = "active";
}

function contexteSuffisant(state) {
  const c = state.contexte || {};
  return !!(c.symptome && String(c.symptome).trim().length > 2) &&
         !!(c.chaud_froid || c.permanent_intermittent || (Array.isArray(c.codes) && c.codes.length));
}

function peutConclure(state) {
  const conf = state.hypotheses.find((h) => h.statut === "confirmee");
  if (conf) return conf;
  for (const h of state.hypotheses) {
    if (h.statut === "eliminee") continue;
    const pourFaibles = (h.preuves || []).filter((p) => p.sens === "pour" && p.pouvoir === "faible").length;
    if (pourFaibles >= 2) return h;
  }
  // Fallback après 2+ contrôles effectués : accepter l'hypothèse la mieux évaluée
  if ((state.controles_faits || []).length >= 2) {
    const actives = state.hypotheses.filter((h) => h.statut !== "eliminee");
    if (actives.length > 0) return actives[0];
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// #7 RAPPELS CONSTRUCTEURS — API NHTSA (gratuite)
// ──────────────────────────────────────────────────────────────
const MAKE_NORMALIZE = {
  "citroën": "CITROEN", "peugeot": "PEUGEOT", "renault": "RENAULT",
  "volkswagen": "VOLKSWAGEN", "vw": "VOLKSWAGEN", "bmw": "BMW",
  "mercedes-benz": "MERCEDES BENZ", "mercedes": "MERCEDES BENZ",
  "audi": "AUDI", "ford": "FORD", "opel": "OPEL", "vauxhall": "OPEL",
  "fiat": "FIAT", "toyota": "TOYOTA", "honda": "HONDA", "nissan": "NISSAN",
  "skoda": "SKODA", "seat": "SEAT", "hyundai": "HYUNDAI", "kia": "KIA",
  "dacia": "DACIA", "volvo": "VOLVO", "mini": "MINI",
};

async function checkRecalls(make, model, year) {
  if (!make || !year) return [];
  try {
    const makeNorm = MAKE_NORMALIZE[make.toLowerCase()] || make.toUpperCase();
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(makeNorm)}&model=${encodeURIComponent((model || "").toUpperCase())}&modelYear=${year}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.results || []).slice(0, 3).map(r => ({
      id: r.NHTSACampaignNumber,
      component: r.Component || "",
      summary: (r.Summary || "").substring(0, 200),
      remedy: (r.Remedy || "").substring(0, 120),
    }));
  } catch { return []; }
}

// ──────────────────────────────────────────────────────────────
// #2 DTC LOOKUP — interroge Supabase sur les codes OBD fournis
// ──────────────────────────────────────────────────────────────
async function enrichirDTC(codes, supabase) {
  if (!codes || !codes.length) return [];
  try {
    const { data } = await supabase
      .from("dtc_codes")
      .select("code, description, fault_category, severity")
      .in("code", codes.map(c => c.toUpperCase()))
      .limit(10);
    return data || [];
  } catch { return []; }
}

// ──────────────────────────────────────────────────────────────
// #9 MEMOIRE VEHICULE — lit et met à jour user_vehicle_memory
// ──────────────────────────────────────────────────────────────
function vehicleKey(v) {
  return [v.make, v.model, v.year].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "_");
}

async function lireMemoire(userId, vKey, supabase) {
  if (!vKey) return null;
  try {
    const { data } = await supabase.from("user_vehicle_memory")
      .select("*").eq("user_id", userId).eq("vehicle_key", vKey).single();
    return data || null;
  } catch { return null; }
}

async function majMemoire(userId, veh, conclusion, supabase) {
  if (!veh || !veh.make) return;
  const vKey = vehicleKey(veh);
  if (!vKey) return;
  try {
    const { data: existing } = await supabase.from("user_vehicle_memory")
      .select("id, known_issues, total_sessions").eq("user_id", userId).eq("vehicle_key", vKey).single();

    const issues = (existing?.known_issues || []);
    if (conclusion) {
      const found = issues.find(i => i.cause === conclusion.cause);
      if (found) { found.sessions_count = (found.sessions_count || 1) + 1; found.last_seen = new Date().toISOString(); }
      else issues.push({ cause: conclusion.cause, bande: conclusion.bande, sessions_count: 1, last_seen: new Date().toISOString() });
    }

    await supabase.from("user_vehicle_memory").upsert({
      user_id: userId, vehicle_key: vKey,
      make: veh.make, model: veh.model, fuel: veh.fuel, year: veh.year, mileage_km: veh.mileage_km,
      known_issues: issues.slice(-10), // garde les 10 derniers
      last_diagnosis_summary: conclusion ? conclusion.cause : null,
      total_sessions: (existing?.total_sessions || 0) + 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,vehicle_key" });
  } catch (e) { console.error("[DYLAN] majMemoire:", e.message); }
}

function buildSystem(state, ragContext, dtcContext, memoireContext, langInstruction = "") {
  // Compact state allégé : symptome tronqué, hypotheses sans preuves
  const compact = JSON.stringify({
    etat: state.etat,
    registre: state.registre,
    tour: state.tour,
    resume_enquete: state.resume_enquete || "",
    contexte: {
      ...state.contexte,
      symptome: state.contexte?.symptome ? state.contexte.symptome.substring(0, 150) : null,
    },
    hypotheses: (state.hypotheses || []).map(h => ({
      id: h.id, libelle: h.libelle, bande: h.bande, statut: h.statut, pouvoir: h.pouvoir,
    })),
    controle_en_cours: state.controle_en_cours,
    controles_faits: state.controles_faits.slice(-3),
    reexpliquer: state.reexpliquer,
  });

  const v = state.vehicule || {};
  const champs = [v.make, v.model, v.engine_label, v.fuel, v.year, v.mileage_km ? v.mileage_km + " km" : null, v.engine_code ? "code moteur: " + v.engine_code : null].filter(Boolean);

  let regleCarburant = "";
  const carb = (v.fuel || "").toLowerCase();
  if (carb.includes("diesel")) {
    regleCarburant = `\nRÈGLE — DIESEL : n'émets JAMAIS d'hypothèse d'allumage commandé. Raisonne diesel : EGR, MAF, MAP, pression rail, injecteurs, turbo, FAP.`;
  } else if (carb.includes("essence") || carb.includes("gpl")) {
    regleCarburant = `\nRÈGLE — ESSENCE : n'émets pas d'hypothèse purement diesel. Raisonne essence : allumage, injection, lambda, catalyseur.`;
  } else if (carb.includes("électrique") || carb.includes("electrique")) {
    regleCarburant = `\nRÈGLE — ÉLECTRIQUE : pas d'hypothèse thermique.`;
  }

  const blocVehicule = champs.length
    ? `VÉHICULE (à respecter ABSOLUMENT) :\n${champs.join(" · ")}${regleCarburant}\n\n`
    : `VÉHICULE : non précisé.\n\n`;

  const ragLine = ragContext ? `\nCas similaires connus :\n${ragContext}\n` : "";

  // #2 DTC enrichi depuis Supabase
  const dtcLine = dtcContext && dtcContext.length
    ? `\nCODES DTC IDENTIFIÉS EN BASE (utilise ces données dans tes hypothèses) :\n${dtcContext.map(d => `- ${d.code} : ${d.description}${d.fault_category ? " ["+d.fault_category+"]" : ""}${d.severity ? " — gravité: "+d.severity : ""}`).join("\n")}\n`
    : "";

  // #9 Mémoire véhicule
  const memoireLine = memoireContext
    ? `\nMÉMOIRE VÉHICULE (pannes précédentes sur ce véhicule chez cet utilisateur) :\n${(memoireContext.known_issues || []).slice(-3).map(i => `- ${i.cause} (vu ${i.sessions_count} fois)`).join("\n")}\n`
    : "";

  return `Tu es Dylan, diagnosticien automobile et ami mécanicien. Tu ENQUÊTES méthodiquement pour trouver LA vraie cause de la panne.
Chaque message doit être utile, rassurant et précis. Tu parles comme un expert mais tu restes accessible.

${blocVehicule}${SAFETY_BLOCK}
${ragLine}${dtcLine}${memoireLine}
ÉTAT D'ENQUÊTE ACTUEL (JSON) :
${compact}

MÉTHODE (un seul tour à la fois) :
- CONTEXTE : si le contexte est incomplet, pose EXACTEMENT UNE seule question dans "message".
  Jamais deux phrases interrogatives dans le même message. Une question = une seule phrase.
  Ne propose pas encore d'hypothèse.
  NE REDEMANDE JAMAIS une information déjà présente.
  ⚡ PASSAGE RAPIDE À HYPOTHESES : dès que tu as (1) le symptôme principal ET (2) l'environnement
  d'apparition (froid/chaud OU permanent/intermittent OU un code OBD), PASSE À HYPOTHESES.
  Maximum 3 questions en CONTEXTE — ne prolonge pas inutilement cette phase.
- HYPOTHESES : propose 2 à 4 hypothèses avec bande (faible/probable/forte/tres_forte),
  pouvoir (fort/faible) et le contrôle qui la confirme/élimine.
- CONTROLE : UN SEUL contrôle guidé. OBLIGATOIREMENT "polarite_oui" :
    • "confirme" si OUI confirme l'hypothèse
    • "elimine" si OUI élimine l'hypothèse
- CONCLUSION : dès qu'une hypothèse est confirmée, CONCLUS. Inclus les pièces nécessaires.

PRIORISATION : sur diesel moderne, privilégie données moteur (MAF, MAP, pression rail, EGR).
Sur panne électrique, mesure tension avant inspection visuelle.

RÈGLES STRICTES :
- Bandes qualitatives UNIQUEMENT, jamais de pourcentage.
- "parts_needed" UNIQUEMENT en CONCLUSION.
- "resume_enquete" : résumé court (2-3 phrases max) de ce qui a été établi.
- Contrôles non dangereux et non destructifs uniquement.

Réponds STRICTEMENT en JSON valide, sans texte autour :
{
  "etat": "CONTEXTE" | "HYPOTHESES" | "CONTROLE" | "CONCLUSION",
  "registre": "detaille" | "concis",
  "resume_enquete": string,
  "message": string,
  "contexte": {"symptome": string|null, "chaud_froid": string|null, "permanent_intermittent": string|null, "codes": [string]},
  "hypotheses": [{"id": number, "libelle": string, "bande": string, "statut": "active"|"confirmee"|"eliminee", "pouvoir": "fort"|"faible", "controle": string}],
  "controle_propose": {"hypothese_id": number, "polarite_oui": "confirme"|"elimine", "pourquoi": string, "comment": [string], "observer": [string]} | null,
  "conclusion": {"cause": string, "bande": string, "can_drive": boolean, "urgency": "immédiat"|"bientôt"|"préventif", "cost_min": number, "cost_max": number, "parts_needed": [string]} | null
}` + langInstruction;
}

// ---- #11 Recherche pièces en parallèle à la conclusion ----
async function searchPartsForConclusion(partsNeeded, vehicule) {
  if (!partsNeeded || partsNeeded.length === 0) return [];
  const v = vehicule || {};
  const vStr = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'véhicule';
  const piecesStr = partsNeeded.slice(0, 4).join(', ');

  const prompt = `Pour un ${vStr}, génère des liens de recherche pour ces pièces: ${piecesStr}.
Réponds UNIQUEMENT en JSON valide sans texte autour:
{"pieces":[{"nom":"nom pièce","autodoc_url":"https://www.autodoc.be/search?query=TERMES","ebay_url":"https://www.ebay.be/sch/i.html?_nkw=TERMES"}]}
Remplace TERMES par des termes de recherche précis (pièce + marque + modèle). Max 4 pièces.`;

  try {
    const resp = await anthropic.messages.create({
      model: MODEL_ENQUETE,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 4000 });
    const txt = (resp.content || []).map(b => b.text || '').join('');
    const parsed = safeJSON(txt);
    return Array.isArray(parsed?.pieces) ? parsed.pieces.slice(0, 4) : [];
  } catch (e) {
    console.error('[DYLAN] searchParts:', e.message);
    return [];
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();
  const startTime = Date.now();

  try {
    const body = JSON.parse(event.body || "{}");
    const { session_id, user_input, control_result, vehicle_marque, vehicle_modele, vehicle_km, vehicle, language } = body;

    // Langue de réponse — Dylan s'adapte à la langue de l'utilisateur
    const LANG_INSTRUCTION = {
      nl: "\n\n🌐 TAAL: Antwoord ALTIJD in het Nederlands, ook al stelt de gebruiker de vraag in een andere taal.",
      en: "\n\n🌐 LANGUAGE: Always respond in English, even if the user writes in another language.",
      de: "\n\n🌐 SPRACHE: Antworte IMMER auf Deutsch, auch wenn der Benutzer in einer anderen Sprache schreibt.",
      fr: "", // default — pas d'instruction nécessaire, le prompt est déjà en français
    };
    const langInstruction = LANG_INSTRUCTION[language] || "";

    if (!session_id && (!user_input || String(user_input).trim().length < 3)) {
      return json(400, { error: "user_input requis" });
    }
    if (user_input && String(user_input).length > 4000) {
      return json(400, { error: "user_input trop long (max 4000)" });
    }

    // ---- 1) JETONS ----
    let charged = false, sessionExpiresAt = null, usedUnlimited = false;
    const { data: act } = await supabase.rpc("has_active_diagnostic_session", { p_user_id: userId });
    const active = act && act[0];
    if (active && active.active) {
      sessionExpiresAt = active.expires_at;
    } else {
      const { data: started, error: sErr } = await supabase.rpc("start_diagnostic_session", { p_user_id: userId });
      if (sErr) throw sErr;
      const s = started && started[0];
      if (!s || !s.success) {
        return json(402, {
          success: false, code: "insufficient_credits",
          message: "Crédits insuffisants.",
          remaining_balance: s ? s.remaining_balance : 0,
        });
      }
      charged = !s.unlimited; usedUnlimited = s.unlimited; sessionExpiresAt = s.expires_at;
    }

    // ---- 2) Charger ou créer la session ----
    const veh = vehicle || {};
    const vehiculeRecu = {
      make: veh.make || vehicle_marque || null,
      model: veh.model || vehicle_modele || null,
      engine_code: veh.engine_code || null,
      engine_label: veh.engine_label || null,
      fuel: veh.fuel || null,
      year: parseInt(veh.year) || null,
      mileage_km: parseInt(veh.mileage_km || vehicle_km) || null,
    };

    let diagSessionId = session_id || null;
    let state;
    if (diagSessionId) {
      const { data: row } = await supabase
        .from("diag_sessions").select("enquete_state")
        .eq("id", diagSessionId).eq("user_id", userId).single();
      state = (row && row.enquete_state && row.enquete_state.etat) ? row.enquete_state : emptyState();
      if (!state.vehicule) state.vehicule = {};
      for (const k of Object.keys(vehiculeRecu)) {
        if (vehiculeRecu[k] != null && state.vehicule[k] == null) state.vehicule[k] = vehiculeRecu[k];
      }
    } else {
      const insertRow = {
        user_id: userId,
        veh_make: vehiculeRecu.make, veh_model: vehiculeRecu.model,
        veh_engine_code: vehiculeRecu.engine_code, veh_engine_label: vehiculeRecu.engine_label,
        veh_fuel: vehiculeRecu.fuel, veh_year: vehiculeRecu.year, veh_mileage_km: vehiculeRecu.mileage_km,
        symptoms: user_input || null,
        enquete_etat: "CONTEXTE", enquete_state: emptyState(), status: "ouvert",
      };
      const { data: created, error: cErr } = await supabase
        .from("diag_sessions").insert(insertRow).select("id").single();
      if (cErr) throw cErr;
      diagSessionId = created.id;
      state = emptyState();
      state.vehicule = vehiculeRecu;
    }

    // ---- 3) RAG + MÉMOIRE + DTC en parallèle total ----
    // Extraire codes OBD du message avant le Promise.all
    const codesMsg  = user_input ? [...(user_input.match(/[PCBU][0-9]{4}/gi) || [])] : [];
    const codesSession = state.contexte?.codes || [];
    const tousLesCodes = [...new Set([...codesSession, ...codesMsg])];
    const needsDTC = tousLesCodes.length > 0 && !(state.dtc_enrichi?.length);

    const vKey = vehicleKey(state.vehicule);
    let ragContext = "";
    const [ragResult, memoire, dtcResult] = await Promise.all([
      // RAG : uniquement CONTEXTE phase (tour < 3, pas encore d'hypothèses)
      (!state.hypotheses.length && (state.tour || 0) < 3)
        ? supabase.rpc("search_diagnostic_cases_text", {
            p_marque: state.vehicule.make || "",
            p_modele: state.vehicule.model || "",
            p_query: user_input || state.contexte.symptome || "",
            p_limit: 4,
          }).then(({ data: cases }) => cases && cases.length
            ? cases.map((c) => `- ${c.primary_diagnosis}`).join("\n")
            : ""
          ).catch(e => { console.error("[DYLAN] RAG:", e.message); return ""; })
        : Promise.resolve(""),
      // Mémoire véhicule
      lireMemoire(userId, vKey, supabase),
      // DTC lookup — uniquement si codes nouveaux et pas déjà enrichis
      needsDTC
        ? enrichirDTC(tousLesCodes, supabase)
            .catch(e => { console.error("[DYLAN] DTC:", e.message); return []; })
        : Promise.resolve(state.dtc_enrichi || []),
    ]);

    ragContext = ragResult;
    let dtcContext = dtcResult;
    if (needsDTC && dtcContext.length) {
      state.dtc_enrichi = dtcContext;
      if (!state.contexte.codes.length) state.contexte.codes = tousLesCodes;
    } else if (!needsDTC) {
      dtcContext = state.dtc_enrichi || [];
    }

    // ---- 4) Appliquer résultat contrôle ----
    state.reexpliquer = false;
    if (control_result && ["oui", "non", "ne_sais_pas", "pas_pu"].includes(control_result)) {
      appliquerResultat(state, control_result);
    }
    state.tour = (state.tour || 0) + 1;

    // ---- 5) Choisir le modèle selon la phase ----
    // #6 : Sonnet pour CONCLUSION, Haiku pour le reste
    const isConclusion = state.etat === "CONCLUSION" || peutConclure(state) !== null;
    const modelChoisi = isConclusion ? MODEL_CONCLUSION : MODEL_ENQUETE;

    const system = buildSystem(state, ragContext, dtcContext, memoire, langInstruction);
    const userMsg = control_result
      ? `Résultat du contrôle : ${control_result}`
      : `Message du client : ${user_input}`;

    console.log(`[DYLAN] tour=${state.tour} etat=${state.etat} model=${modelChoisi} dtc=${dtcContext.length} elapsed=${Date.now() - startTime}ms`);

    // Timeout manuel : 22s toutes phases / 22s conclusion (Netlify Pro 26s → 22s safe)
    // Si plan Free (10s), Netlify coupe silencieusement avant ce timeout
    let completion;
    try {
      const abortCtrl = new AbortController();
      const killTimer = setTimeout(() => abortCtrl.abort(), 22000);
      try {
        completion = await anthropic.messages.create({
          model: modelChoisi,
          max_tokens: isConclusion ? 2500 : 2400,   // +600 tokens → plus de troncature
          system,
          messages: [{ role: "user", content: userMsg }],
        }, { signal: abortCtrl.signal });
      } finally {
        clearTimeout(killTimer);
      }
    } catch (e) {
      const isTimeout = e.name === "AbortError" || e.message?.includes("abort");
      console.error(`[DYLAN] appel modèle (${isTimeout ? "timeout" : "erreur"}):`, e.message);
      return json(502, {
        success: false,
        error: isTimeout
          ? "Dylan réfléchit encore — réessaie dans 5 secondes."
          : "Service de diagnostic indisponible, réessayez.",
      });
    }

    const text = (completion.content || []).map((b) => b.text || "").join("");
    console.log(`[DYLAN] stop=${completion.stop_reason} tokens=${JSON.stringify(completion.usage)} model=${modelChoisi}`);

    // ---- #1 Retry JSON robuste ----
    let parsed = safeJSON(text);
    if (!parsed || !parsed.etat) {
      console.error(`[DYLAN] parsing échoué tour 1`);
      try {
        const retryCtrl = new AbortController();
        const retryTimer = setTimeout(() => retryCtrl.abort(), 8000);
        try {
          const retryCompletion = await anthropic.messages.create({
            model: MODEL_ENQUETE,
            max_tokens: 1800,
            system: "Tu es un assistant JSON. Extrais et retourne UNIQUEMENT l'objet JSON valide contenu dans le message. Pas de texte avant ou après. Pas de markdown.",
            messages: [{ role: "user", content: text || "Réponse vide" }],
          }, { signal: retryCtrl.signal });
          parsed = safeJSON((retryCompletion.content || []).map((b) => b.text || "").join(""));
        } finally {
          clearTimeout(retryTimer);
        }
      } catch (retryErr) { console.error("[DYLAN] retry:", retryErr.message); }
      if (!parsed || !parsed.etat) {
        return json(502, { success: false, error: "Réponse de diagnostic illisible, réessayez." });
      }
    }

    // ---- 6) Fusion état + transitions déterministes ----
    if (parsed.contexte) state.contexte = { ...state.contexte, ...parsed.contexte };
    if (parsed.registre === "concis" || parsed.registre === "detaille") state.registre = parsed.registre;

    if (Array.isArray(parsed.hypotheses) && parsed.hypotheses.length) {
      const ancien = {};
      for (const h of state.hypotheses) ancien[h.id] = h;
      state.hypotheses = parsed.hypotheses.slice(0, 4).map((h) => {
        const prev = ancien[h.id];
        return {
          id: h.id, libelle: h.libelle, bande: h.bande,
          pouvoir: h.pouvoir || (prev && prev.pouvoir) || "faible",
          controle: h.controle,
          statut: prev ? prev.statut : (h.statut === "eliminee" ? "eliminee" : "active"),
          preuves: prev ? (prev.preuves || []) : [],
        };
      });
      for (const h of Object.values(ancien)) {
        if (h.statut === "eliminee" && !state.hypotheses.find((x) => x.id === h.id)) state.hypotheses.push(h);
      }
      for (const h of state.hypotheses) {
        const estNouvelle = !ancien[h.id];
        const forte = h.bande === "forte" || h.bande === "tres_forte";
        if (estNouvelle && forte && (!h.preuves || !h.preuves.length)) ajoutPreuve(h, "pour", "coherence_contexte_initial", "faible");
      }
    }

    // Filtre carburant
    const carbu = ((state.vehicule && state.vehicule.fuel) || "").toLowerCase();
    if (carbu) {
      const motsEssence = ["bobine", "bougie d'allumage", "bougies d'allumage", "étincelle", "allumage commandé"];
      const motsDiesel = ["bougie de préchauffage", "bougies de préchauffage", "rampe commune", "fap"];
      const estDiesel = carbu.includes("diesel"), estEssence = carbu.includes("essence") || carbu.includes("gpl");
      for (const h of state.hypotheses) {
        const lib = (h.libelle || "").toLowerCase();
        const incompatible = (estDiesel && motsEssence.some((m) => lib.includes(m))) || (estEssence && motsDiesel.some((m) => lib.includes(m)));
        if (incompatible && h.statut !== "eliminee") { h.statut = "eliminee"; ajoutPreuve(h, "contre", "incompatible_carburant", "fort"); }
      }
    }

    if (typeof parsed.resume_enquete === "string" && parsed.resume_enquete.trim()) {
      state.resume_enquete = parsed.resume_enquete.slice(0, 600);
    }

    // ---- #4 Résumé anti-croissance (>5 tours) ----
    if (state.tour > 5 && !state.resume_compresse) {
      // On ne garde que les 2 derniers controles_faits pour éviter la croissance du contexte
      state.controles_faits = state.controles_faits.slice(-2);
      state.resume_compresse = true;
    }

    const etatAvant = state.etat;
    let etat = parsed.etat;

    if (etat === "CONCLUSION" && etatAvant === "CONTEXTE") {
      etat = contexteSuffisant(state) ? "HYPOTHESES" : "CONTEXTE";
    }
    if (etatAvant === "CONTEXTE" && etat !== "CONTEXTE" && !contexteSuffisant(state)) {
      etat = "CONTEXTE";
    }

    let hypConclue = null;
    if (etat === "CONCLUSION") {
      hypConclue = peutConclure(state);
      if (!hypConclue) etat = "CONTROLE";
    }
    // Forcer CONCLUSION après 3 contrôles effectués — évite le blocage infini en CONTROLE
    // peu importe ce que l'IA renvoie dans parsed.etat
    const controlesFaitsCount = (state.controles_faits || []).length;
    if (controlesFaitsCount >= 3 && etat !== "CONCLUSION") {
      const bestHyp = state.hypotheses.filter((h) => h.statut !== "eliminee")[0];
      if (bestHyp) { hypConclue = bestHyp; etat = "CONCLUSION"; }
    }
    // Aussi forcer si 2+ contrôles ET Dylan veut conclure
    if (etat === "CONTROLE" && controlesFaitsCount >= 2 && parsed.etat === "CONCLUSION") {
      const bestHyp = state.hypotheses.filter((h) => h.statut !== "eliminee")[0];
      if (bestHyp && !hypConclue) { hypConclue = bestHyp; etat = "CONCLUSION"; }
    }
    if (etat === "HYPOTHESES" && state.hypotheses.length && state.controle_en_cours === null && !peutConclure(state)) {
      etat = "CONTROLE";
    }

    let plafondAtteint = false;
    if (state.tour >= MAX_TOURS && etat !== "CONCLUSION") plafondAtteint = true;

    if (etat === "CONTROLE" && parsed.controle_propose) {
      const cp = parsed.controle_propose;
      const hyp = state.hypotheses.find((h) => h.id === cp.hypothese_id) || state.hypotheses.find((h) => h.statut !== "eliminee");
      state.controle_en_cours = {
        hypothese_id: (cp.hypothese_id ?? (hyp ? hyp.id : null)),
        pouvoir: hyp ? hyp.pouvoir : "faible",
        polarite_oui: (cp.polarite_oui === "elimine" ? "elimine" : "confirme"),
        pourquoi: cp.pourquoi || "",
        comment: Array.isArray(cp.comment) ? cp.comment : [],
        observer: Array.isArray(cp.observer) ? cp.observer : [],
      };
    }

    state.etat = etat;

    // ---- 7) Construire réponse frontend ----
    const response = {
      success: true, session_id: diagSessionId, etat, registre: state.registre,
      message: parsed.message || "",
      hypotheses: state.hypotheses.map((h) => ({ libelle: h.libelle, bande: h.bande, statut: h.statut })),
      controle: null, conclusion: null,
      session: { expires_at: sessionExpiresAt, charged, unlimited: usedUnlimited },
      metadata: { elapsed_ms: Date.now() - startTime, model: modelChoisi, tour: state.tour },
    };

    if (etat === "CONTROLE" && state.controle_en_cours) {
      response.controle = {
        pourquoi: state.controle_en_cours.pourquoi,
        comment: state.controle_en_cours.comment,
        observer: state.controle_en_cours.observer,
        options: ["oui", "non", "ne_sais_pas", "pas_pu"],
      };
    }

    if (etat === "CONCLUSION" && parsed.conclusion) {
      const c = parsed.conclusion;
      const causeFiable = hypConclue ? hypConclue.libelle : (c.cause || "");
      const bandeFiable = hypConclue ? (hypConclue.bande || "forte") : (c.bande || "probable");

      // #7+#11 Orchestration parallèle post-conclusion : rappels NHTSA + liens pièces
      // Timeout 2s pour ne pas bloquer la réponse (plan Netlify free = 10s total)
      const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
      const [recallsRes, partsLinksRes] = await Promise.allSettled([
        withTimeout(checkRecalls(state.vehicule?.make, state.vehicule?.model, state.vehicule?.year), 2000),
        withTimeout(searchPartsForConclusion(Array.isArray(c.parts_needed) ? c.parts_needed : [], state.vehicule), 2000),
      ]);
      const recalls = recallsRes.status === 'fulfilled' ? (recallsRes.value || []) : [];
      const parts_links = partsLinksRes.status === 'fulfilled' ? (partsLinksRes.value || []) : [];
      console.log(`[DYLAN] parallel: recalls=${recalls.length} parts_links=${parts_links.length}`);

      response.conclusion = {
        cause: causeFiable, bande: bandeFiable, can_drive: c.can_drive !== false,
        urgency: c.urgency || "bientôt", cost_min: Number(c.cost_min) || 0,
        cost_max: Number(c.cost_max) || 0,
        parts_needed: Array.isArray(c.parts_needed) ? c.parts_needed : [],
        recalls,      // rappels constructeurs NHTSA (peut être vide)
        parts_links,  // liens Autodoc+eBay par pièce (#11 orchestration parallèle)
      };
      // #10 Feedback loop
      response.feedback_requested = true;
    }

    if (plafondAtteint) {
      response.message += "\n\n(Plafond atteint — voici l'hypothèse la plus probable. Un professionnel pourra confirmer.)";
    }

    // ---- 8) Sauver l'état ----
    const updateRow = { enquete_etat: etat, enquete_state: state, maj_le: new Date().toISOString() };
    if (etat === "CONCLUSION") {
      updateRow.status = "attente_resultat";
      updateRow.final_confidence_band = response.conclusion ? response.conclusion.bande : null;
    }
    await supabase.from("diag_sessions").update(updateRow).eq("id", diagSessionId);

    if (etat === "CONCLUSION") {
      // #9 Mise à jour mémoire véhicule — fire-and-forget pour ne pas bloquer la réponse
      majMemoire(userId, state.vehicule, response.conclusion, supabase)
        .catch(e => console.error("[DYLAN] majMemoire:", e.message));

      // Matérialisation best-effort — fire-and-forget (non critique, ne bloque pas la réponse)
      const hypRows = state.hypotheses.map((h) => ({
        session_id: diagSessionId, cause_label_raw: h.libelle,
        confidence_band: h.bande, rang: h.id, confirmee: h.statut === "confirmee" ? true : h.statut === "eliminee" ? false : null,
      }));
      const ctrlRows = state.controles_faits.map((c) => ({
        session_id: diagSessionId, label: "controle guidé", objectif: "confirmer",
        resultat: c.resultat === "oui" ? "positif" : c.resultat === "non" ? "negatif" : c.resultat === "pas_pu" ? "non_effectue" : "non_concluant",
      }));
      Promise.allSettled([
        hypRows.length ? supabase.from("diag_hypotheses").insert(hypRows) : Promise.resolve(),
        ctrlRows.length ? supabase.from("diag_controls").insert(ctrlRows) : Promise.resolve(),
      ]).catch(e => console.error("[DYLAN] matérialisation:", e.message));

      // Sauvegarder le diagnostic dans user_diagnostics (historique + dashboard)
      if (response.conclusion && state.vehicule) {
        const { cause, bande, can_drive, urgency, cost_min, cost_max, parts_needed } = response.conclusion;
        const bandePct = { faible: 30, probable: 60, forte: 80, tres_forte: 95 };
        const vehicleId = state.vehicule.vehicle_id || null;
        supabase.from("user_diagnostics").insert({
          user_id: userId,
          vehicle_id: vehicleId,
          primary_diagnosis: cause || "Diagnostic complet",
          symptoms: state.symptomes ? [state.symptomes] : null,
          obd_codes: (state.contexte && state.contexte.codes ? state.contexte.codes : []).map(function(code) { return { code: code }; }),
          causes: [{ cause: cause, confidence: bande }],
          parts_needed: Array.isArray(parts_needed) ? parts_needed.map(function(p) { return { name: p }; }) : null,
          confidence_percent: bandePct[bande] || 60,
          urgency: urgency || "bientôt",
          can_drive: can_drive !== false,
          estimated_cost_min: cost_min || null,
          estimated_cost_max: cost_max || null,
          status: "active",
          diagnosis_date: new Date().toISOString(),
        }).then(function() { console.log("[DYLAN] user_diagnostics saved"); })
          .catch(function(e) { console.warn("[DYLAN] user_diagnostics save failed:", e.message); });
      }
    }

    return json(200, response);
  } catch (error) {
    console.error("[DYLAN] erreur:", error.message);
    return json(500, { success: false, error: error.message });
  }
};
