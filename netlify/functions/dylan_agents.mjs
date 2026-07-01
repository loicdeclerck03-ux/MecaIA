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

// Plan Netlify PRO (26s) — Sonnet pour TOUTES les phases (plus jamais Haiku comme cerveau principal).
// Haiku reste pour les retries JSON et la consultation GPT-merge.
// Avant : Haiku enquete + Sonnet conclusion. Maintenant : Sonnet partout + GPT parallele sur phases actives.
const MODEL_ENQUETE    = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MODEL_CONCLUSION = process.env.ANTHROPIC_CONCLUSION_MODEL || "claude-sonnet-4-6";
const MODEL_HAIKU_UTIL = "claude-haiku-4-5-20251001"; // uniquement pour retry JSON et consultations légères
const MODEL_GPT_CONSULT = "gpt-4.1-mini"; // second avis parallèle sur phases hypothèses/controle/conclusion

// Plafond anti-derive de cout — 15 tours (3 contexte + 1 hyp + 4 controles + 1 conclu + marge)
const MAX_TOURS = 15;

// ──────────────────────────────────────────────────────────────
// FICHES OUTILS — mini-guides injectés quand l'outil est mentionné
// ──────────────────────────────────────────────────────────────
const TOOL_GUIDES = {
  "multimètre": `📏 Utiliser le multimètre :
• Mode V DC → tension batterie/circuit (moteur allumé)
• Mode Ω → résistance (circuit ÉTEINT obligatoire)
• Mode A → courant (en série dans le circuit)
• Mode ))) → continuité : bip = circuit fermé
• Branchement : rouge = VΩmA (borne +) · noir = COM (masse)
⚠️ Ne jamais mesurer la résistance sur un circuit sous tension.`,
  "vacuomètre": `📏 Utiliser le vacuomètre :
• Brancher sur la dépression du collecteur d'admission
• Ralenti normal : -40 à -60 kPa (aiguille stable)
• < -40 kPa = fuite admission · > -60 kPa = restriction
• Aiguille qui fluctue = joints de soupapes ou culasse`,
  "fumigène": `📏 Utiliser le fumigène :
• Raccorder sur le circuit à tester (admission ou EVAP)
• Injecter 5-10 secondes — pression max 0,5 bar
• Observer les fuites visuellement (fumée = fuite confirmée)
• Idéal pour : fuites admission, EVAP, circuit refroidissement`,
  "manomètre": `📏 Utiliser le manomètre carburant :
• Brancher sur la valve Schrader de la rampe
• Contact mis sans démarrer : 3-4 bar essence / 1 500+ bar diesel common rail
• Moteur au ralenti : 2,5-3,5 bar essence
• Chute rapide après arrêt = injecteur fuyant ou clapet pompe HS`,
  "oscilloscope": `📏 Utiliser l'oscilloscope :
• Canal 1 = signal · Masse = châssis (référence)
• Time/div : 1ms pour injecteur, 10ms pour capteurs arbre à cames
• Signal capteur arbre cames correct : carré propre 0-5V
• Signal injecteur : pic 60-80V suivi plateau bas`,
  "pince ampèremétrique": `📏 Utiliser la pince ampèremétrique :
• Passer UN SEUL fil dans la pince (jamais les deux)
• Zéroter avant mesure (bouton ZERO à vide)
• Courant de démarrage normal : 100-300 A
• Consommation parasitaire acceptable : < 50 mA (véhicule éteint)`,
};

// Détection intention carnet d'entretien
const INTENT_CARNET = /carnet|entretien|intervalles?|maintenance|vid[ae]nge|programme.*entretien|quand.*(changer|faire|refaire)|bougies.*quand|distribution.*quand|filtre.*quand/i;

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
  const hasSymptome = !!(c.symptome && String(c.symptome).trim().length > 2);
  const hasEnv = !!(c.chaud_froid || c.permanent_intermittent || (Array.isArray(c.codes) && c.codes.length));
  // Anti-boucle : apres 3 tours, le symptome seul suffit (le prompt vise max 3 questions de contexte).
  return hasSymptome && (hasEnv || (state.tour || 0) >= 3);
}

function peutConclure(state) {
  // Cas 1 : hypothèse formellement confirmée (statut = confirmee)
  const conf = state.hypotheses.find((h) => h.statut === "confirmee");
  if (conf) return conf;
  // Cas 2 : accumulation de 2+ preuves faibles "pour" sur une même hypothèse
  for (const h of state.hypotheses) {
    if (h.statut === "eliminee") continue;
    const pourFaibles = (h.preuves || []).filter((p) => p.sens === "pour" && p.pouvoir === "faible").length;
    if (pourFaibles >= 2) return h;
  }
  // Cas 3 (fallback) : 3+ contrôles effectués — seuil à 3 pour éviter conclusions sur simple vérif 12V
  // Un contrôle "alimentation présente" ne confirme pas une défaillance — il faut 3 contrôles minimum
  if ((state.controles_faits || []).length >= 3) {
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
      .select("code, description, fault_category, severity, causes_probables_fr, controles_recommandes, systeme_associe")
      .in("code", codes.map(c => c.toUpperCase()))
      .limit(10);
    return data || [];
  } catch { return []; }
}

// ──────────────────────────────────────────────────────────────
// #2b CONTEXTE VÉHICULE — specs + TSBs depuis tables locales
async function getVehicleContext(make, model, year, supabase) {
  if (!make) return null;
  try {
    const { data } = await supabase.rpc("get_vehicle_context", {
      p_make: make, p_model: model || "", p_year: year || null
    });
    return data || null;
  } catch (e) { console.error("[DYLAN] vehicleCtx:", e.message); return null; }
}

// #9 MEMOIRE VEHICULE — lit et met à jour user_vehicle_memory
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
// CARNET D'ENTRETIEN — formater les specs en message lisible
// ──────────────────────────────────────────────────────────────
function formatCarnet(specs, vehicule) {
  const v = vehicule || {};
  const label = [v.make, v.model, v.year].filter(Boolean).join(' ');
  let msg = `📋 **Carnet d'entretien${label ? ' — ' + label : ''}**\n\n`;
  if (specs && (specs.oil_spec || specs.oil_interval_km)) {
    msg += `🛢️ **Huile moteur**\n`;
    if (specs.oil_spec) msg += `   Spécification : ${specs.oil_spec}\n`;
    if (specs.oil_interval_km) msg += `   Intervalle : tous les **${Number(specs.oil_interval_km).toLocaleString('fr-FR')} km**\n`;
    msg += '\n';
  }
  if (specs && specs.filter_air_km) msg += `💨 **Filtre à air** : tous les ${Number(specs.filter_air_km).toLocaleString('fr-FR')} km\n`;
  if (specs && specs.spark_plug_km && !['null','NULL','undefined'].includes(String(specs.spark_plug_km))) {
    msg += `✨ **Bougies** : tous les ${String(specs.spark_plug_km)} km\n`;
  }
  if (specs && specs.timing_belt_km && !['null','NULL','undefined'].includes(String(specs.timing_belt_km))) {
    const tb = String(specs.timing_belt_km).toLowerCase();
    if (tb === 'chaine') msg += `⛓️ **Distribution** : chaîne (surveiller le bruit à froid)\n`;
    else msg += `⛓️ **Courroie de distribution** : tous les ${tb} km ⚠️ priorité absolue\n`;
  } else if (specs) {
    msg += `⛓️ **Distribution** : chaîne (pas de remplacement périodique)\n`;
  }
  if (specs && specs.coolant_change_years) msg += `🌡️ **Liquide de refroidissement** : tous les ${specs.coolant_change_years} ans\n`;
  if (specs && specs.brake_fluid_years) msg += `🛑 **Liquide de frein** : tous les ${specs.brake_fluid_years} ans\n`;
  if (specs && specs.tire_pression_front_bar) {
    msg += `🔵 **Pression pneus** : AV ${specs.tire_pression_front_bar} bar · AR ${specs.tire_pression_rear_bar} bar (à froid)\n`;
  }
  if (!specs || (!specs.oil_spec && !specs.oil_interval_km)) {
    msg += `\n_Données non disponibles pour ce modèle exact — consultez le carnet constructeur._`;
  }
  return msg;
}

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

// ──────────────────────────────────────────────────────────────
// CONSULTATION GPT — second avis parallèle sur phases actives
// Court et précis : GPT répond en 2-3 phrases max sur ce qu il
// voit que Sonnet pourrait avoir manqué. Injecté au tour suivant.
// ──────────────────────────────────────────────────────────────
const GPT_CONSULT_SYSTEM = `Tu es un mécanicien expert qui donne un second avis rapide sur un diagnostic automobile.
Tu reçois : le cas, l'état de l'enquête, et les hypothèses actuelles.
Réponds en 2 phrases MAX (jamais plus) :
- Si tu vois une hypothèse critique manquante ou un danger non mentionné : mentionne-le précisément.
- Si l'analyse en cours est correcte : réponds uniquement "RAS".
Ne refais pas le diagnostic complet. Uniquement ce qui manque.`;

async function runGPTConsultation(caseDescription, state, signal) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const hyps = (state.hypotheses || []).filter(h => h.statut !== "eliminee").map(h => h.libelle).join(", ");
    const input = `Cas : ${caseDescription}\nPhase : ${state.etat}\nHypothèses en cours : ${hyps || "aucune encore"}\nRésumé enquête : ${state.resume_enquete || "début"}`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL_GPT_CONSULT, max_tokens: 150,
        messages: [
          { role: "system", content: GPT_CONSULT_SYSTEM },
          { role: "user", content: input },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) return null;
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    return text && text !== "RAS" && text.length > 3 ? text : null;
  } catch { return null; }
}

function buildSystem(state, ragContext, dtcContext, memoireContext, langInstruction = "", vehicleCtx = null, prevDiags = []) {
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
    regleCarburant = `\nRÈGLE — DIESEL : n'émets JAMAIS d'hypothèse d'allumage commandé. Raisonne diesel : EGR, MAF, MAP, pression rail, injecteurs, turbo, FAP.\nPRIORITÉ DIESEL — PERTE DE PUISSANCE SANS CODE OBD : investigate dans CET ORDRE STRICT : 1) Suralimentation (turbo, circuit de dépression, électrovanne de commande, durites), 2) EGR colmatée, 3) MAF/MAP. Injecteurs et pompe = TOUJOURS EN DERNIER (coûteux/invasif) — JAMAIS avant contrôle turbo complet.\nCONTRÔLES SURALIMENTATION non destructifs (dans l'ordre) : inspection visuelle durites → écoute sifflement/claquement turbo → test résistance électrovanne (20-30Ω nominal) → test action électrovanne (dépression) → mesure pression boost si possible.\nSYSTÈME TURBO = ENSEMBLE : "turbo" englobe corps turbo + électrovanne de commande + actionneur + circuit de dépression + durites. Un contrôle visuel des durites N'ÉLIMINE PAS l'électrovanne ni la géométrie variable. Ces sous-systèmes ont des contrôles DIFFÉRENTS — investiguer séparément.\nTERMINOLOGIE TURBO OBLIGATOIRE : la quasi-totalité des diesels post-1999 ont un turbo à géométrie VARIABLE (VGT/VNT). Sur ces moteurs : utilise "électrovanne de commande géométrie variable", "actionneur turbo", "circuit de dépression". Le mot "wastegate" désigne la soupape de décharge des turbos à géométrie FIXE (anciens) — ne l'utilise PAS sur un diesel moderne à géométrie variable.\nPRIORITÉ DIESEL — FUMÉE NOIRE + SURCONSO : EGR et MAF en premier.`;
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
    ? `\nCODES DTC IDENTIFIÉS EN BASE :\n${dtcContext.map(d =>
        `- ${d.code} : ${d.description || ""}${d.fault_category ? " ["+d.fault_category+"]" : ""}${d.severity ? " — gravité: "+d.severity : ""}${d.causes_probables_fr ? "\n  \u2192 Causes : "+d.causes_probables_fr.substring(0,220) : ""}${d.controles_recommandes ? "\n  \u2192 Contrôles : "+d.controles_recommandes.substring(0,220) : ""}`
      ).join("\n")}\n`
    : "";

  // #2b Contexte véhicule enrichi : specs + TSBs constructeur
  let vehicleCtxLine = "";
  if (vehicleCtx) {
    const sp = vehicleCtx.specs || {};
    const tsbs = vehicleCtx.tsbs || [];
    const rc = vehicleCtx.recalls || [];
    if (sp.oil_spec || sp.oil_interval_km) {
      vehicleCtxLine += `\nSPECS VÉHICULE (atelier) : huile ${sp.oil_spec || "?"} tous les ${sp.oil_interval_km || "?"}km`;
      if (sp.timing_belt_km && sp.timing_belt_km !== "NULL" && sp.timing_belt_km !== "null") vehicleCtxLine += ` | distribution ${sp.timing_belt_km}km`;
      if (sp.tire_pression_front_bar) vehicleCtxLine += ` | pneus AV ${sp.tire_pression_front_bar} AR ${sp.tire_pression_rear_bar} bar`;
      vehicleCtxLine += "\n";
    }
    if (tsbs.length) {
      vehicleCtxLine += `\nBULLETINS TECHNIQUES CONSTRUCTEUR :\n${tsbs.slice(0,3).map(t => `- [${t.system}] ${t.titre}`).join("\n")}\n`;
    }
    if (rc.length) {
      vehicleCtxLine += `\nRAPPELS CONSTRUCTEURS :\n${rc.map(r => `- ${r.component || ""} : ${(r.summary || "").substring(0,100)}`).join("\n")}\n`;
    }
  }

  // #9 Mémoire véhicule + opinion GPT du tour précédent
  const memoireLine = memoireContext && (memoireContext.known_issues || []).length
    ? `\nMÉMOIRE VÉHICULE (pannes déjà vues sur ce véhicule) :\n${
        (memoireContext.known_issues || []).slice(-5)
          .map(i => `- ${i.cause}${i.sessions_count > 1 ? ` (récurrent × ${i.sessions_count})` : ""}${i.last_seen ? ` — vu le ${new Date(i.last_seen).toLocaleDateString("fr-FR")}` : ""}`)
          .join("\n")
      }${memoireContext.last_diagnosis_summary ? `\nDernier diagnostic : ${memoireContext.last_diagnosis_summary}` : ""}\n`
    : "";

  // Opinion GPT du tour précédent — second avis IA injecté si pertinent
  const gptOpinionLine = state.gpt_last_opinion
    ? `\n⚡ SECOND AVIS GPT (tour précédent) : ${state.gpt_last_opinion}\nSi ce point est pertinent pour le cas actuel, intègre-le dans ta réponse. Sinon, ignore-le.\n`
    : "";

  // Historique inter-session : diagnostics passés sur ce vehicule (charge au 1er tour)
  // REGLE ABSOLUE injectee directement — le LLM ne peut pas ignorer ce bloc.
  let prevDiagsLine = "";
  if (prevDiags && prevDiags.length > 0) {
    const lignes = prevDiags.map(d => {
      const ds = d.enquete_state || {};
      const date = new Date(d.maj_le).toLocaleDateString("fr-FR");
      const symptome = ds.contexte?.symptome || "symptôme non enregistré";
      const conclusion = (ds.hypotheses || []).find(h => h.statut === "confirmee")?.libelle
        || ds.resume_enquete
        || "diagnostic sans conclusion formelle";
      const codes = (ds.contexte?.codes || []).join(", ");
      const controles = (ds.controles_faits || []).length;
      return `• ${date} — symptôme : "${symptome}"${codes ? ` | codes : ${codes}` : ""} → conclusion : ${conclusion} (${controles} contrôle(s) effectué(s))`;
    });
    prevDiagsLine = `\n⚠️ HISTORIQUE DIAGNOSTICS SUR CE VÉHICULE (sessions précédentes) :\n${lignes.join("\n")}\n\nRÈGLE ABSOLUE MÉMOIRE — ces informations sont connues, ne pose JAMAIS de question sur :\n- Des symptômes déjà décrits ci-dessus\n- Des codes OBD déjà mentionnés\n- "Depuis quand ?" si déjà dans l'historique\nSi le symptôme actuel ressemble à un précédent, SIGNALE-LE immédiatement : "J'ai déjà vu ce symptôme sur ton véhicule le [date]..."\n`
  }

  // Fiche outil — injectée automatiquement si l'outil est mentionné dans les contrôles
  let toolGuideBlock = "";
  const stateStr = JSON.stringify(state.controle_en_cours || {}) + JSON.stringify(state.controles_faits || []);
  for (const [tool, guide] of Object.entries(TOOL_GUIDES)) {
    if (stateStr.toLowerCase().includes(tool)) {
      toolGuideBlock = "\n" + guide + "\n";
      break;
    }
  }

  // ── Instruction premier tour : afficher specs véhicule automatiquement ──
  let firstTurnBlock = "";
  if (state.tour === 1 && vehicleCtx) {
    const sp = vehicleCtx.specs || {};
    const specParts = [
      sp.oil_spec ? `Huile ${sp.oil_spec}` : null,
      sp.oil_interval_km ? `vidange ${Number(sp.oil_interval_km).toLocaleString('fr-FR')} km` : null,
      sp.timing_belt_km && !['null','NULL','undefined'].includes(String(sp.timing_belt_km))
        ? (String(sp.timing_belt_km).toLowerCase() === 'chaine' ? 'distribution chaîne ✓' : `distribution ${sp.timing_belt_km} km`)
        : 'distribution chaîne ✓',
      sp.tire_pression_front_bar ? `pneus AV ${sp.tire_pression_front_bar} / AR ${sp.tire_pression_rear_bar} bar` : null,
    ].filter(Boolean).join(' · ');
    if (specParts) {
      const vLabel = [v.make, v.model, v.year].filter(Boolean).join(' ');
      firstTurnBlock = `\n⚡ INSTRUCTION PREMIER MESSAGE — OBLIGATOIRE :\nCommence ton "message" par cette ligne EXACTE, sans rien avant :\n"📋 ${vLabel} — ${specParts}"\nPuis saute une ligne et pose ta première question de diagnostic.\nNe l\'omet jamais au premier tour.`;
    }
  }

  return `Tu es Dylan, diagnosticien automobile et ami mécanicien. Tu ENQUÊTES méthodiquement pour trouver LA vraie cause de la panne.
Chaque message doit être utile, rassurant et précis. Tu parles comme un expert mais tu restes accessible.

${blocVehicule}${SAFETY_BLOCK}
${vehicleCtxLine}${prevDiagsLine}${ragLine}${dtcLine}${memoireLine}${gptOpinionLine}${toolGuideBlock}
ÉTAT D'ENQUÊTE ACTUEL (JSON) :
${compact}

NIVEAUX DE LECTURE OBLIGATOIRES :
Chaque message doit contenir DEUX versions :
- "niveau_0" : 1 phrase MAX, simple, pour quelqu un qui ne connait rien aux voitures. Pas de jargon. Ex: "Ton moteur consomme trop de carburant depuis quelques semaines."
- "message" : le message complet habituel (pour bricoleur/mécanicien)

MÉTHODE (un seul tour à la fois) :
- CONTEXTE : si le contexte est incomplet, pose EXACTEMENT UNE seule question dans "message".
  Jamais deux phrases interrogatives dans le même message. Une question = une seule phrase.
  CONTEXTE ENRICHI OBLIGATOIRE : même en CONTEXTE, ton "message" doit TOUJOURS contenir :
  (a) 2 HYPOTHESES PRELIMINAIRES probables basées sur ce qui est déjà connu. Formule : "Les causes probables sont : 1) X 2) Y (sous réserve de confirmation)".
  (b) VERDICT SÉCURITÉ PROVISOIRE : "En attendant : vous pouvez rouler / roulez avec précaution / ne roulez pas" + une phrase d'explication.
  (c) FOURCHETTE COT APPROXIMATIVE : "Coût probable : XX-YYY€ selon la cause".
  La question de clarification vient APRÈS ces 3 éléments.
  NE REDEMANDE JAMAIS une information déjà présente dans le JSON d'état ci-dessus.
  Si contexte.symptome est rempli : INTERDIT de demander "quel est ton symptôme" ou formule équivalente.
  Si tour > 0 : INTERDIT de commencer le message par une salutation ("Salut !", "Bonjour", etc.) — va directement au sujet.
  ⚡ PASSAGE RAPIDE À HYPOTHESES : dès que tu as (1) le symptôme principal ET (2) l'environnement
  d'apparition (froid/chaud OU permanent/intermittent OU un code OBD), PASSE À HYPOTHESES.
  Maximum 3 questions en CONTEXTE — ne prolonge pas inutilement cette phase.
  ⚡ SYMPTÔME CLAIR = HYPOTHESES DIRECT : si le message décrit un symptôme précis (bruit localisé, vibration, comportement anormal, voyant, odeur, perte puissance) AVEC marque + modèle + année, PASSE DIRECTEMENT à HYPOTHESES sans question. Le symptôme + le contexte véhicule est suffisant.
  ⚡ CODE OBD PRÉSENT = HYPOTHESES DIRECT : si le message contient un code OBD (lettre + 4 chiffres ex. P0401, C0035), SAUTE le CONTEXTE et passe IMMEDÍATEMENT à HYPOTHESES dans ce même message. Pas de question préalable. Le code est un contexte suffisant.
  ⚡ COÛT + URGENCE OBLIGATOIRES en HYPOTHESES : dans ton "message", après avoir listé les hypothèses, TOUJOURS inclure : (1) fourchette de coût estimée "pièce seule XX-YY€ + pose ZZ-WW€", (2) verdict conducteur : "Vous pouvez rouler / Ne roulez pas / Roulez avec précaution + jusqu'à quand ou quels signes d'arrêt immédiat". Ces deux informations sont OBLIGATOIRES dans chaque message HYPOTHESES.
- HYPOTHESES : propose 2 à 4 hypothèses avec bande (faible/probable/forte/tres_forte),
  pouvoir (fort/faible) et le contrôle qui la confirme/élimine.
- CONTROLE : UN SEUL contrôle guidé. OBLIGATOIREMENT "polarite_oui" :
  CONTROLE ENRICHI OBLIGATOIRE : dans le "message" du CONTROLE, inclus TOUJOURS :
  (a) coût si CE contrôle confirme l'hypothèse : "Si positif : pièce XXX-YYY€ + pose ZZZ€"
  (b) verdict conducteur pendant ce test : "Vous pouvez rouler pour faire ce test / Faites-le avant de reprendre la route".
  FICHE OUTIL OBLIGATOIRE : si le contrôle nécessite un outil (multimètre, vacuomètre, manomètre, fumigène, pince ampèremétrique, oscilloscope), inclus dans les entrées "comment" : MODE de l'outil + branchement + valeur normale + valeur suspecte. Ex comment: ["Mode V DC sur multimètre", "Rouge sur + batterie, noir sur masse", "Tension normale: 13.8-14.4V moteur tourne", "< 12.8V = alternateur HS"]. L'utilisateur doit pouvoir exécuter le contrôle sans chercher ailleurs.
    • "confirme" si OUI confirme l'hypothèse
    • "elimine" si OUI élimine l'hypothèse
- CONCLUSION : dès qu'une hypothèse est confirmée, CONCLUS. Inclus les pièces nécessaires.

PRIORISATION : sur diesel moderne, privilégie données moteur (MAF, MAP, pression rail, EGR).
Sur panne électrique, mesure tension avant inspection visuelle.
⚡ VÉHICULES ÉLECTRIQUES/HYBRIDES : Ne renvoie pas systématiquement vers le constructeur. Identifie d'abord le SOUS-SYSTÈME probable (BMS, chargeur embarqué, onduleur, batterie HV, pompe à chaleur, convertisseur DC/DC) et donne :
  (a) les tests non-invasifs disponibles (tension 12V, courant charge, lecture codes via OBD standard),
  (b) coût de remplacement estimé par sous-système (même approximatif),
  (c) verdict : "Ce test vous dira si c'est X (XXX-YYY€) ou Y (YYY-ZZZ€)".
  Renvoie vers spécialiste UNIQUEMENT si le diagnostic exige un outil constructeur spécifique.

RÈGLES STRICTES :
- Bandes qualitatives UNIQUEMENT, jamais de pourcentage.
- "parts_needed" UNIQUEMENT en CONCLUSION.
- "resume_enquete" : résumé court (2-3 phrases max) de ce qui a été établi.
- Contrôles non dangereux et non destructifs uniquement.
- ORDRE DES CONTRÔLES : toujours du moins invasif au plus invasif. Visuel → écoute → test électrique → démontage. Ne propose JAMAIS un démontage (injecteurs, culasse, etc.) avant les contrôles simples.
- VALIDATION AVANT "confirmee" : une hypothèse ne passe JAMAIS à statut "confirmee" sur simple présence d'alimentation électrique ou contrôle visuel négatif. "confirmee" exige une preuve DIRECTE de défaillance de la pièce (résistance hors gamme, actionneur qui ne répond pas, dépression absente, pression boost insuffisante mesurée, fuite constatée).
- ÉLIMINATION D'HYPOTHÈSE : une hypothèse ne passe à statut "eliminee" QUE si un contrôle a DIRECTEMENT prouvé son absence. Un contrôle visuel des durites n'élimine PAS la géométrie variable ni l'électrovanne — ça élimine seulement les fuites externes. "Rien de visible" ≠ "cause écartée". Ne jamais écrire "X est éliminé" sans preuve directe de l'absence de défaillance de X.
- CONCLUSION SANS TEST INTERDIT : JAMAIS de conclusion finale sur une hypothèse sans AU MOINS un contrôle dédié à elle. La conclusion par exclusion ("j'ai éliminé A et B donc c'est C") est INTERDITE si C n'a pas été testé directement.
- CONCLUSION HONNÊTE : si tu conclus sur une hypothèse "probable" (non formellement prouvée), indique TOUJOURS les contrôles atelier restants. Exemple : "L'électrovanne est la piste la plus probable — test résistance (20-30Ω) + dépression en atelier confirmera."
- JAMAIS "on repart de zéro" ni "décrivez-moi à nouveau" en conclusion. Si doutes, liste les contrôles restants, point.
- ADAPTATION OUTILLAGE : si l'utilisateur répond "pas pu faire", "pas d'outillage" ou "pas possible", JAMAIS de répétition du même contrôle. Propose immédiatement un contrôle ALTERNATIF sans cet outillage (substitution pièce connue bonne, test visuel/auditif complémentaire, diagnostic par élimination). Si aucune alternative sans atelier : le noter, passer au contrôle suivant.
- SYSTÈMES ABS/ESP/ASC/ANTIPATINAGE : exploite TOUJOURS le code défaut calculateur pour localiser la roue ou le capteur concerné. Ordre des contrôles : (1) connecteur du capteur (humidité, oxydation, verrouillage) ; (2) câblage complet depuis capteur jusqu'au calculateur (courbures, passages de carrosserie, zones d'usure — câblage fragile sur véhicules > 200k km) ; (3) résistance capteur inductif 800-1500Ω (infini = capteur HS, 0 = court-circuit) ; (4) si outillage disponible : test dynamique — tourner roue à la main et mesurer tension AC ou Hz pour confirmer que le capteur génère un signal. Ne jamais orienter vers le boîtier ABS sans avoir éliminé capteur et câblage.
- Tour > 0 : JAMAIS de formule de salutation en début de message. Continue l'enquête directement.
${firstTurnBlock}

Réponds STRICTEMENT en JSON valide, sans texte autour :
{
  "etat": "CONTEXTE" | "HYPOTHESES" | "CONTROLE" | "CONCLUSION",
  "registre": "detaille" | "concis",
  "resume_enquete": string,
  "niveau_0": string,
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

    // —— CARNET D'ENTRETIEN — mode spécial, retour direct sans LLM ——
    if (INTENT_CARNET.test(user_input || '')) {
      const make = (vehicle && vehicle.make) || vehicle_marque || null;
      const model = (vehicle && vehicle.model) || vehicle_modele || null;
      const year = (vehicle && parseInt(vehicle.year)) || null;
      if (!make) {
        // Pas de véhicule sélectionné — message d'aide
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, mode: 'carnet_entretien',
            message: '\ud83d\udccb **Carnet d\'entretien**\n\nSélectionnez d\'abord votre véhicule dans le sélecteur ci-dessus (cliquez sur votre voiture dans la liste), puis demandez à nouveau le carnet.',
            session_id: session_id || null }) };
      }
      try {
      // Recherche par make + year en premier
      let q = supabase.from('vehicle_specs').select('*').ilike('make', make);
      if (year) q = q.lte('year_from', year).gte('year_to', year);
      // Si model fourni : chercher dans model, engine ET generation (pas seulement model)
      if (model) {
      const tokens = model.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && t !== 'de' && t !== 'le');
      if (tokens.length > 0) {
      const orParts = tokens.flatMap(t => [`model.ilike.%${t}%`, `engine.ilike.%${t}%`, `generation.ilike.%${t}%`]).join(',');
      q = q.or(orParts);
      }
      }
      let { data: specs } = await q.limit(1).maybeSingle();
      // Fallback : si rien trouvé, retourner n'importe quelle motorisation du même make/year
      if (!specs && year) {
      const fb = await supabase.from('vehicle_specs').select('*').ilike('make', make)
      .lte('year_from', year).gte('year_to', year).limit(1).maybeSingle();
      specs = fb.data;
      }
      const carnet = formatCarnet(specs, { make, model, year });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, mode: 'carnet_entretien', message: carnet,
      session_id: session_id || null }) };
      } catch(e) { console.error('[DYLAN] carnet:', e.message); }
    }

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
    const isFirstTurn = (state.tour || 0) === 0;
    const [ragResult, memoire, dtcResult, vehicleCtx, prevDiags] = await Promise.all([
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
      // Mémoire véhicule (known_issues inter-session)
      lireMemoire(userId, vKey, supabase),
      // DTC lookup — uniquement si codes nouveaux et pas déjà enrichis
      needsDTC
        ? enrichirDTC(tousLesCodes, supabase)
            .catch(e => { console.error("[DYLAN] DTC:", e.message); return []; })
        : Promise.resolve(state.dtc_enrichi || []),
      // Specs + TSBs constructeur (uniquement au premier tour)
      (isFirstTurn && !state.vehicleCtx)
        ? getVehicleContext(state.vehicule?.make, state.vehicule?.model, state.vehicule?.year, supabase)
            .catch(() => null)
        : Promise.resolve(state.vehicleCtx || null),
      // Diagnostics précédents sur ce véhicule (mémoire inter-session) — premier tour uniquement
      isFirstTurn && vehiculeRecu.make && vehiculeRecu.model
        ? supabase
            .from("diag_sessions")
            .select("maj_le, enquete_state, final_confidence_band, veh_make, veh_model")
            .eq("user_id", userId)
            .ilike("veh_make", vehiculeRecu.make)
            .ilike("veh_model", `%${String(vehiculeRecu.model).split(" ")[0]}%`)
            .eq("status", "attente_resultat")
            .order("maj_le", { ascending: false })
            .limit(4)
            .then(({ data }) => (data || []).filter(d => d.enquete_state?.contexte?.symptome))
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    ragContext = ragResult;
    let dtcContext = dtcResult;
    if (needsDTC && dtcContext.length) {
      state.dtc_enrichi = dtcContext;
      if (!state.contexte.codes.length) state.contexte.codes = tousLesCodes;
    } else if (!needsDTC) {
      dtcContext = state.dtc_enrichi || [];
    }
    // Sauvegarder le contexte véhicule dans le state (chargé une seule fois)
    if (vehicleCtx) state.vehicleCtx = vehicleCtx;
    // Sauvegarder les diags précédents dans le state (chargés une seule fois au tour 0)
    if (isFirstTurn && prevDiags && prevDiags.length) state.prev_diags = prevDiags;

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

    const system = buildSystem(state, ragContext, dtcContext, memoire, langInstruction, state.vehicleCtx, state.prev_diags || []);
    const userMsg = control_result
      ? `Résultat du contrôle : ${control_result}`
      : `Message du client : ${user_input}`;

    console.log(`[DYLAN] tour=${state.tour} etat=${state.etat} model=${modelChoisi} dtc=${dtcContext.length} elapsed=${Date.now() - startTime}ms`);

    // Phases actives = hypothèses/controle/conclusion → GPT en parallèle
    const isActivePhase = state.etat === "HYPOTHESES" || state.etat === "CONTROLE" || isConclusion
      || (state.hypotheses && state.hypotheses.length > 0);

    // Historique conversation — derniers 20 tours (40 messages)
    if (!state.conv_history) state.conv_history = [];
    const apiMessages = [
      ...(state.conv_history).slice(-40),
      { role: "user", content: userMsg },
    ];

    // ── Sonnet ‖ GPT en parallèle sur phases actives ──────────────────
    // Sonnet = réponse principale. GPT = second avis stocké pour le tour suivant.
    // Timeout 22s couvre les deux (Pro plan = 26s). GPT non bloquant si il échoue.
    let completion;
    let gptOpinionThisTurn = null;
    const abortCtrl = new AbortController();
    const killTimer = setTimeout(() => abortCtrl.abort(), 24000); // 24s — Pro plan = 26s, Sonnet cold start peut prendre 15-18s
    try {
      const tasks = [
        // Sonnet — toujours obligatoire
        anthropic.messages.create({
          model: modelChoisi,
          max_tokens: isConclusion ? 2500 : 2400,
          system,
          messages: apiMessages,
        }, { signal: abortCtrl.signal }),
        // GPT consultation — parallèle, non bloquant, phases actives seulement
        isActivePhase
          ? runGPTConsultation(
              [state.vehicule?.make, state.vehicule?.model, state.vehicule?.year].filter(Boolean).join(" ")
              + (state.contexte?.symptome ? " — " + state.contexte.symptome.slice(0, 200) : "")
              + (state.contexte?.codes?.length ? " — codes : " + state.contexte.codes.join(", ") : ""),
              state, abortCtrl.signal
            )
          : Promise.resolve(null),
      ];
      const [sonnetResult, gptResult] = await Promise.allSettled(tasks);

      // Sonnet est obligatoire — si il échoue on lève l erreur
      if (sonnetResult.status === "rejected") throw sonnetResult.reason;
      completion = sonnetResult.value;

      // GPT — optionnel, stocker pour le tour suivant
      if (gptResult.status === "fulfilled" && gptResult.value) {
        gptOpinionThisTurn = gptResult.value;
        state.gpt_last_opinion = gptOpinionThisTurn;
        console.log(`[DYLAN] GPT second avis: "${gptOpinionThisTurn.slice(0, 80)}"`);
      } else if (gptResult.status === "rejected") {
        console.warn("[DYLAN] GPT consultation echec (non bloquant):", gptResult.reason?.message);
      }
    } catch (e) {
      const isTimeout = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError" || e.message?.includes("abort");
      console.error(`[DYLAN] appel modèle (${isTimeout ? "timeout" : "erreur"}):`, e.message);
      return json(502, {
        success: false,
        error: isTimeout ? "Dylan réfléchit encore — réessaie dans 5 secondes." : "Service de diagnostic indisponible, réessayez.",
      });
    } finally {
      clearTimeout(killTimer);
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
            model: MODEL_HAIKU_UTIL,
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

    // ---- 6) Sauvegarder historique conversation ----
    // Stocker le message utilisateur + la reponse lisible (pas le JSON brut)
    // pour que les tours suivants aient le fil narratif. Limite 4 tours = 8 messages.
    state.conv_history.push(
      { role: "user", content: userMsg },
      { role: "assistant", content: parsed.message || "" }
    );
    state.conv_history = state.conv_history.slice(-40); // 20 tours max

    // ---- 7) Fusion état + transitions déterministes ----
    if (parsed.contexte) {
      const incoming = { ...parsed.contexte };
      // Fix critique : ne jamais ecraser une valeur existante avec null/undefined.
      // Le LLM renvoie souvent null pour les champs pas encore collectes — ce qui
      // ecrasait ce qui avait deja ete capture aux tours precedents.
      Object.keys(incoming).forEach(k => {
        if (incoming[k] === null || incoming[k] === undefined) delete incoming[k];
      });
      // Symptome trop court = ignore (evite "ok" ou "oui" qui remplacent le vrai symptome)
      if (incoming.symptome && String(incoming.symptome).trim().length < 3) delete incoming.symptome;
      // Codes OBD : union stricte — ne jamais remplacer par tableau vide
      const codes = [...new Set([...(state.contexte.codes || []), ...(incoming.codes || [])])];
      delete incoming.codes;
      state.contexte = { ...state.contexte, ...incoming, codes };
    }
    // Capture deterministe du symptome au 1er tour uniquement, puis verrouille (cause du blocage en CONTEXTE).
    if (!state.contexte.symptome && (state.tour || 0) <= 1 && user_input && String(user_input).trim().length >= 3) {
      state.contexte.symptome = String(user_input).trim().slice(0, 300);
    }
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
    // Anti-boucle : si le contexte est suffisant et Dylan reste bloque en CONTEXTE, on avance vers HYPOTHESES.
    if (etat === "CONTEXTE" && contexteSuffisant(state) && ((state.tour || 0) >= 3 || (state.hypotheses && state.hypotheses.length))) {
      etat = "HYPOTHESES";
    }

    // GARDE 1 — ne jamais rester en HYPOTHESES sans hypothèse (sinon blocage infini) : on continue à engager en CONTEXTE
    if (etat === "HYPOTHESES" && (!state.hypotheses || state.hypotheses.length === 0)) etat = "CONTEXTE";

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

    // GARDE 2 — best-effort : contexte suffisant mais AUCUNE hypothèse après 4 tours → conclure gracieusement (ne jamais boucler)
    if (etat !== "CONCLUSION" && (!state.hypotheses || state.hypotheses.length === 0) && contexteSuffisant(state) && (state.tour || 0) >= 4) etat = "CONCLUSION";

    // GARDE 3 — plafond terminal : au plafond de tours, on conclut quoi qu'il arrive (jamais de boucle infinie)
    let plafondAtteint = false;
    if (state.tour >= MAX_TOURS && etat !== "CONCLUSION") { etat = "CONCLUSION"; plafondAtteint = true; }
    if (etat === "CONCLUSION" && !hypConclue) hypConclue = state.hypotheses.filter((h) => h.statut !== "eliminee")[0] || null;

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

    if (etat === "CONCLUSION") {
      const c = parsed.conclusion || {};
      const causeFiable = hypConclue ? hypConclue.libelle : (c.cause || "Plusieurs causes possibles — fais vérifier par un professionnel");
      const bandeFiable = hypConclue ? (hypConclue.bande || "forte") : (c.bande || "faible");

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
      // Procédures de réparation pour les codes DTC identifiés
      const codesConclu = state.contexte?.codes || [];
      if (codesConclu.length > 0) {
        try {
          const { data: procs } = await supabase.rpc('get_dtc_procedures', {
            p_codes: codesConclu,
            p_make: state.vehicule?.make || null,
            p_model: state.vehicule?.model || null,
          });
          const seenProc = new Set();
          response.procedures = (procs || []).filter(p => {
            const k = (p.system_type || '') + '|' + (p.procedure_fr || '');
            if (seenProc.has(k)) return false;
            seenProc.add(k);
            return true;
          }).slice(0, 5);
        } catch(e) {
          console.error('[DYLAN] procedures:', e.message);
          response.procedures = [];
        }
      }

      // #10 Feedback loop
      response.feedback_requested = true;
    }

    // Injection fiche outil si controle en cours utilise un outil
    if (state.controle_en_cours) {
      const _ctrlStr = JSON.stringify(state.controle_en_cours || {}).toLowerCase() + ' ' + (parsed.message || '').toLowerCase() + ' ' + JSON.stringify(state.controles_faits || []).toLowerCase();
      for (const [_outil, _guide] of Object.entries(TOOL_GUIDES)) {
        if (_ctrlStr.includes(_outil)) {
          response.tool_guide = { outil: _outil, fiche: _guide };
          break;
        }
      }
    }

    // Alias reply = message pour compatibilite frontend + test runner
    response.reply = parsed.message || response.message || "";

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
          symptoms: state.contexte && state.contexte.symptome ? [state.contexte.symptome] : null,
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
