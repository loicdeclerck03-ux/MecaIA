// ============================================================
// DYLAN — Moteur d'enquete V1 (cote serveur, securise)
//  • Auth obligatoire (JWT Supabase)
//  • Jetons : 1 session = 10 min (INCHANGE) -> tous les tours de
//    l'enquete sont gratuits dans la fenetre = 1 credit / enquete
//  • 1 SEUL appel Claude par tour (cout maitrise)
//  • Etat d'enquete persiste dans diag_sessions (source unique)
//  • Verrous tenus en CODE : seuil de preuve, pieces, plafond de tours
//  • RAG (cas similaires) uniquement au 1er tour
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

// Plafond anti-derive de cout : au-dela, Dylan clot honnetement.
const MAX_TOURS = 8;

// Bloc securite valide (etape 0) — reutilise tel quel.
const SAFETY_BLOCK = `RÔLE : tu aides à comprendre, à diagnostiquer, à guider des contrôles, et à réparer
quand l'information est fiable et la manipulation sans danger. Ta posture par défaut
est d'aider concrètement, y compris sur les systèmes importants.

RÈGLES DE SÉCURITÉ (priment sur tout le reste) :
1. N'invente jamais une information technique que tu ne connais pas de façon fiable :
   référence de pièce, couple de serrage, procédure constructeur, schéma électrique,
   valeur de mesure. Si tu ne sais pas avec fiabilité, dis-le clairement plutôt que deviner.
2. Ne minimise jamais un danger réel. Si un organe de sécurité peut être en cause
   (freinage, direction, pneumatiques, airbag, haute tension), signale-le clairement.
3. Ne recommande jamais une manipulation qui contourne ou neutralise un système de
   sécurité (neutraliser un airbag, contourner l'ABS, supprimer un dispositif de sécurité).
4. Le critère est le DANGER RÉEL DE LA MANIPULATION, pas le système concerné. Les freins,
   airbags, direction et haute tension peuvent être expliqués et diagnostiqués, et tu peux
   guider des contrôles non dangereux (observer une plaquette, repérer une fuite de liquide,
   vérifier visuellement un capteur). Évite seulement les procédures dont une mauvaise
   exécution mettrait en danger la sécurité des personnes.
5. Pour les pannes et réparations courantes où l'information est fiable, reste concret,
   pratique et utile. Ne renvoie pas systématiquement vers un professionnel : aide
   réellement. Oriente vers un pro uniquement quand la sécurité le justifie vraiment.

CONTRAINTE V1 : ne propose QUE des contrôles non dangereux et non destructifs
(observer, repérer visuellement, presser à la main, écouter, sentir). Pas de contrôle
au multimètre, pas de démontage, rien sur freins/airbag/haute tension qui exige une manipulation.`;

// Parsing JSON robuste (retire les ``` et extrait le 1er objet).
function safeJSON(text) {
  if (!text) return null;
  let t = String(text).trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// État d'enquête vide initial.
function emptyState() {
  return {
    etat: "CONTEXTE",
    registre: "detaille",
    tour: 0,
    vehicule: { make: null, model: null, engine_code: null, engine_label: null, fuel: null, year: null, mileage_km: null },
    contexte: { symptome: null, chaud_froid: null, permanent_intermittent: null, codes: [] },
    hypotheses: [],          // {id, libelle, bande, statut, pouvoir, controle}
    controle_en_cours: null, // {hypothese_id, pouvoir, pourquoi, comment[], observer[]}
    controles_faits: [],     // {hypothese_id, pouvoir, resultat}
    reexpliquer: false,
    resume_enquete: "",      // résumé compact (anti-croissance du contexte sur enquêtes longues)
  };
}

// --- Application DÉTERMINISTE d'un résultat de contrôle (code, pas LLM) ---
function appliquerResultat(state, resultat) {
  const c = state.controle_en_cours;
  if (!c) return;

  if (resultat === "ne_sais_pas") {
    // Problème de compréhension : on RESTE sur le même contrôle, on ré-explique.
    state.reexpliquer = true;
    return;
  }

  state.controles_faits.push({
    hypothese_id: c.hypothese_id, pouvoir: c.pouvoir,
    polarite_oui: c.polarite_oui || "confirme", resultat,
  });
  const hyp = state.hypotheses.find((h) => h.id === c.hypothese_id);
  state.controle_en_cours = null;

  if (resultat === "pas_pu") {
    // Capacité : on note, on ne conclut rien, on cherchera un contrôle alternatif.
    if (hyp) ajoutPreuve(hyp, "neutre", "controle non realise", c.pouvoir);
    return;
  }

  // oui / non : effet réel déterminé par la POLARITÉ du contrôle.
  // polarite_oui = "confirme" -> OUI confirme / NON élimine
  // polarite_oui = "elimine"  -> OUI élimine / NON confirme
  const pol = c.polarite_oui || "confirme";
  const effetConfirme =
    (resultat === "oui" && pol === "confirme") ||
    (resultat === "non" && pol === "elimine");

  if (hyp) {
    ajoutPreuve(hyp, effetConfirme ? "pour" : "contre", "controle_" + resultat, c.pouvoir);
    recalcStatut(hyp); // statut recalculé sur TOUT le registre, pas le seul dernier contrôle
  }
}

// Ajoute une preuve au registre d'une hypothèse (jamais effacée).
function ajoutPreuve(hyp, sens, source, pouvoir) {
  if (!hyp.preuves) hyp.preuves = [];
  hyp.preuves.push({ sens, source, pouvoir: pouvoir || "faible" });
}

// Recalcule le statut d'une hypothèse à partir de l'ENSEMBLE de son registre.
// Conservation des preuves : une preuve "pour" forte n'est jamais effacée par un seul contrôle.
function recalcStatut(hyp) {
  const p = hyp.preuves || [];
  const contreFort = p.some((x) => x.sens === "contre" && x.pouvoir === "fort");
  const pourFort = p.some((x) => x.sens === "pour" && x.pouvoir === "fort");
  const pour = p.filter((x) => x.sens === "pour").length;
  const contre = p.filter((x) => x.sens === "contre").length;

  if (pourFort && !contreFort) { hyp.statut = "confirmee"; return; }
  if (contreFort && !pourFort) { hyp.statut = "eliminee"; return; }
  // Une preuve "pour" existante empêche l'élimination silencieuse par cumul faible.
  if (contre > pour && pour === 0) { hyp.statut = "eliminee"; return; }
  hyp.statut = "active";
}

// --- Plancher DÉTERMINISTE pour quitter CONTEXTE ---
// Le code garantit qu'on ne saute jamais l'étape contexte : il faut au minimum
// un symptôme ET au moins un élément de contexte. Au-dessus de ce plancher,
// le modèle reste libre de poser une question de plus.
function contexteSuffisant(state) {
  const c = state.contexte || {};
  const aSymptome = !!(c.symptome && String(c.symptome).trim().length > 2);
  const aContexte = !!(c.chaud_froid || c.permanent_intermittent || (Array.isArray(c.codes) && c.codes.length));
  return aSymptome && aContexte;
}

// --- Verrou de SEUIL DE PREUVE (déterministe) ---
// Renvoie l'hypothèse concluable, ou null.
function peutConclure(state) {
  // Une hypothèse au statut "confirmee" (preuve forte au registre) suffit.
  const conf = state.hypotheses.find((h) => h.statut === "confirmee");
  if (conf) return conf;

  // Sinon : 2 preuves "pour" faibles concordantes sur une même hypothèse active.
  for (const h of state.hypotheses) {
    if (h.statut === "eliminee") continue;
    const pourFaibles = (h.preuves || []).filter((p) => p.sens === "pour" && p.pouvoir === "faible").length;
    if (pourFaibles >= 2) return h;
  }
  return null;
}

// --- Construction du prompt système selon l'état ---
function buildSystem(state, ragContext) {
  const compact = JSON.stringify({
    etat: state.etat,
    registre: state.registre,
    tour: state.tour,
    resume_enquete: state.resume_enquete || "",
    contexte: state.contexte,
    hypotheses: state.hypotheses,
    controle_en_cours: state.controle_en_cours,
    controles_faits: state.controles_faits,
    reexpliquer: state.reexpliquer,
  });

  // --- Bloc VÉHICULE : injecté EN TÊTE, avant tout raisonnement ---
  const v = state.vehicule || {};
  const champs = [
    v.make, v.model, v.engine_label, v.fuel,
    v.year, v.mileage_km ? v.mileage_km + " km" : null,
    v.engine_code ? "code moteur: " + v.engine_code : null,
  ].filter(Boolean);
  let blocVehicule;
  if (champs.length) {
    const carb = (v.fuel || "").toLowerCase();
    let regleCarburant = "";
    if (carb.includes("diesel")) {
      regleCarburant = `\nRÈGLE CARBURANT — Ce véhicule est un DIESEL. N'émets JAMAIS d'hypothèse d'allumage commandé (bougies d'allumage, bobines, étincelle, mélange air-essence, sonde lambda comme cause primaire). Raisonne diesel : EGR, débitmètre (MAF), pression d'admission (MAP), pression rail, injecteurs/corrections, turbo, géométrie variable, FAP, préchauffage. Si une hypothèse essence figure dans la liste, élimine-la immédiatement.`;
    } else if (carb.includes("essence") || carb.includes("gpl")) {
      regleCarburant = `\nRÈGLE CARBURANT — Ce véhicule est un ESSENCE. N'émets pas d'hypothèse purement diesel (bougies de préchauffage, rampe Common Rail, FAP diesel). Raisonne essence : allumage (bougies/bobines), injection, sonde lambda, catalyseur, admission.`;
    } else if (carb.includes("électrique") || carb.includes("electrique")) {
      regleCarburant = `\nRÈGLE CARBURANT — Véhicule ÉLECTRIQUE : pas d'hypothèse thermique (injection, allumage, turbo, FAP).`;
    }
    blocVehicule = `VÉHICULE (à respecter ABSOLUMENT dans toutes les hypothèses) :
${champs.join(" · ")}${regleCarburant}
Adapte chaque hypothèse à ce véhicule précis. Une hypothèse incompatible avec ce moteur est une erreur.

`;
  } else {
    blocVehicule = `VÉHICULE : non précisé. Si le carburant (diesel/essence) n'est pas connu et qu'il change le raisonnement, DEMANDE-le avant de proposer des hypothèses moteur.

`;
  }

  const ragLine = ragContext
    ? `\nCas similaires connus (base interne, à utiliser pour bâtir les hypothèses) :\n${ragContext}\n`
    : "";

  return `Tu es Dylan, diagnosticien automobile. Tu ne réponds pas : tu ENQUÊTES.
Tu réduis progressivement l'incertitude par des contrôles, jusqu'à confirmer la cause réelle.

${blocVehicule}${SAFETY_BLOCK}
${ragLine}
ÉTAT D'ENQUÊTE ACTUEL (JSON) :
${compact}

MÉTHODE (un seul tour à la fois) :
- CONTEXTE : si le contexte est incomplet, pose UNE question pour le compléter
  (chaud/froid ? permanent/intermittent ? conditions d'apparition ?). Ne propose pas encore d'hypothèse.
  NE REDEMANDE JAMAIS une information déjà présente dans le véhicule, le contexte ou le résumé ci-dessus.
- HYPOTHESES : propose 2 à 4 hypothèses, chacune avec une bande (faible/probable/forte/tres_forte),
  un "pouvoir" (fort = un seul contrôle suffit à trancher ; faible = oriente sans trancher),
  et le contrôle qui la confirme/élimine. Commence par la plus probable ET la moins coûteuse/destructive.
- CONTROLE : propose UN SEUL contrôle guidé en 4 parties : pourquoi, comment (étapes simples),
  observer (ce qu'il faut regarder), et OBLIGATOIREMENT "polarite_oui" :
    • "confirme" si une réponse OUI au contrôle CONFIRME l'hypothèse,
    • "elimine" si une réponse OUI ÉLIMINE l'hypothèse.
  Exemple : "L'aiguille atteint-elle sa température normale ?" pour un thermostat bloqué ouvert
  → polarite_oui = "elimine" (car OUI = température normale = thermostat OK).
  Si "reexpliquer" est vrai : RÉ-EXPLIQUE le MÊME contrôle plus simplement.
- CONCLUSION : dès qu'une hypothèse est confirmée (preuve suffisante), CONCLUS. Ne continue pas
  à enquêter inutilement quand la cause est établie.

PRIORISATION DES CONTRÔLES (méthode terrain réelle) :
- Sur DIESEL MODERNE / Common Rail : privilégie tôt les données moteur (pression rail, débitmètre MAF,
  pression admission MAP, corrections injecteurs, position/commande EGR, pression avant/après FAP,
  géométrie variable turbo, électrovanne N75). Un schéma "perte de puissance → coupe contact →
  puissance revenue" évoque un MODE DÉGRADÉ (régulation turbo / géométrie variable) : oriente vite vers ça.
- Sur PANNE ÉLECTRIQUE / CHARGE : privilégie la MESURE (tension batterie moteur arrêté puis tournant)
  AVANT les inspections visuelles (cosses, courroie).
- N'enchaîne pas les contrôles purement visuels quand une donnée chiffrée trancherait plus vite.
- Si des codes défaut sont disponibles, demande-les tôt.

RÈGLES STRICTES :
- Bandes qualitatives UNIQUEMENT, jamais de pourcentage.
- "parts_needed" UNIQUEMENT en CONCLUSION, jamais avant.
- "resume_enquete" : tiens à jour un résumé court (2-3 phrases max) de ce qui a été établi.
- Adapte le "registre" au langage de l'utilisateur : "concis" si vocabulaire technique, "detaille" sinon.
- Contrôles non dangereux et non destructifs uniquement (cf. contrainte V1).

Réponds STRICTEMENT en JSON valide, sans texte autour, avec EXACTEMENT ces clés :
{
  "etat": "CONTEXTE" | "HYPOTHESES" | "CONTROLE" | "CONCLUSION",
  "registre": "detaille" | "concis",
  "resume_enquete": string,
  "message": string,
  "contexte": {"symptome": string|null, "chaud_froid": string|null, "permanent_intermittent": string|null, "codes": [string]},
  "hypotheses": [{"id": number, "libelle": string, "bande": string, "statut": "active"|"confirmee"|"eliminee", "pouvoir": "fort"|"faible", "controle": string}],
  "controle_propose": {"hypothese_id": number, "polarite_oui": "confirme"|"elimine", "pourquoi": string, "comment": [string], "observer": [string]} | null,
  "conclusion": {"cause": string, "bande": string, "can_drive": boolean, "urgency": "immédiat"|"bientôt"|"préventif", "cost_min": number, "cost_max": number, "parts_needed": [string]} | null
}`;
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
    const {
      session_id, user_input, control_result,
      vehicle_marque, vehicle_modele, vehicle_km, vehicle,
    } = body;

    // Au moins un message OU un résultat de contrôle (sur une session existante)
    if (!session_id && (!user_input || String(user_input).trim().length < 3)) {
      return json(400, { error: "user_input requis (décris le problème)" });
    }
    if (user_input && String(user_input).length > 4000) {
      return json(400, { error: "user_input trop long (max 4000 caractères)" });
    }

    // ---- 1) JETONS (INCHANGÉ) : session active ? sinon en ouvrir une ----
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
          message: "Crédits insuffisants. Achetez des jetons ou activez le pass illimité.",
          remaining_balance: s ? s.remaining_balance : 0,
        });
      }
      charged = !s.unlimited;
      usedUnlimited = s.unlimited;
      sessionExpiresAt = s.expires_at;
    }

    // ---- 2) Charger ou créer la session d'enquête ----
    const veh = vehicle || {};
    // Normalisation du véhicule reçu (accepte vehicle{} ou les champs plats)
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
      // FILET : compléter le véhicule si des champs manquaient (ne jamais écraser un existant par null)
      if (!state.vehicule) state.vehicule = {};
      for (const k of Object.keys(vehiculeRecu)) {
        if (vehiculeRecu[k] != null && state.vehicule[k] == null) state.vehicule[k] = vehiculeRecu[k];
      }
    } else {
      const insertRow = {
        user_id: userId,
        veh_make: vehiculeRecu.make,
        veh_model: vehiculeRecu.model,
        veh_engine_code: vehiculeRecu.engine_code,
        veh_engine_label: vehiculeRecu.engine_label,
        veh_fuel: vehiculeRecu.fuel,
        veh_year: vehiculeRecu.year,
        veh_mileage_km: vehiculeRecu.mileage_km,
        symptoms: user_input || null,
        enquete_etat: "CONTEXTE",
        enquete_state: emptyState(),
        status: "ouvert",
      };
      const { data: created, error: cErr } = await supabase
        .from("diag_sessions").insert(insertRow).select("id").single();
      if (cErr) throw cErr;
      diagSessionId = created.id;
      state = emptyState();
      state.vehicule = vehiculeRecu; // le véhicule entre dans l'état dès le 1er tour
    }

    // ---- 3) RAG : uniquement au 1er tour (pas encore d'hypothèses) ----
    let ragContext = "";
    if (!state.hypotheses.length) {
      try {
        const { data: cases } = await supabase.rpc("search_diagnostic_cases_text", {
          p_marque: state.vehicule.make || "",
          p_modele: state.vehicule.model || "",
          p_query: user_input || state.contexte.symptome || "",
          p_limit: 6,
        });
        if (cases && cases.length) {
          ragContext = cases.map((c) => `- ${c.primary_diagnosis}`).join("\n");
        }
      } catch (e) {
        console.error("[DYLAN] RAG:", e.message); // dégradation silencieuse
      }
    }

    // ---- 4) Appliquer un résultat de contrôle EN CODE (déterministe) ----
    state.reexpliquer = false;
    if (control_result && ["oui", "non", "ne_sais_pas", "pas_pu"].includes(control_result)) {
      appliquerResultat(state, control_result);
    }
    state.tour = (state.tour || 0) + 1;

    // ---- 5) UN SEUL appel Claude ----
    const system = buildSystem(state, ragContext);
    const userMsg = control_result
      ? `Résultat du contrôle : ${control_result}`
      : `Message du client : ${user_input}`;

    let completion;
    try {
      completion = await anthropic.messages.create({
        model: MODEL, max_tokens: 1400, system,
        messages: [{ role: "user", content: userMsg }],
      });
    } catch (e) {
      console.error("[DYLAN] appel modèle:", e.message);
      return json(502, { success: false, error: "Service de diagnostic indisponible, réessayez." });
    }

    const text = (completion.content || []).map((b) => b.text || "").join("");
    const parsed = safeJSON(text);
    if (!parsed || !parsed.etat) {
      return json(502, { success: false, error: "Réponse de diagnostic illisible, réessayez." });
    }

    // ---- 6) Fusion dans l'état + TRANSITIONS DÉTERMINISTES (code, pas prompt) ----
    if (parsed.contexte) state.contexte = { ...state.contexte, ...parsed.contexte };
    if (parsed.registre === "concis" || parsed.registre === "detaille") state.registre = parsed.registre;
    // Fusion des hypothèses : on PRÉSERVE le registre de preuves et les statuts
    // (une hypothèse éliminée le reste, ses preuves ne sont jamais effacées).
    if (Array.isArray(parsed.hypotheses) && parsed.hypotheses.length) {
      const ancien = {};
      for (const h of state.hypotheses) ancien[h.id] = h;
      state.hypotheses = parsed.hypotheses.slice(0, 4).map((h) => {
        const prev = ancien[h.id];
        return {
          id: h.id,
          libelle: h.libelle,
          bande: h.bande,
          pouvoir: h.pouvoir || (prev && prev.pouvoir) || "faible",
          controle: h.controle,
          // statut et preuves : on garde l'historique du code, pas la proposition du modèle
          statut: prev ? prev.statut : (h.statut === "eliminee" ? "eliminee" : "active"),
          preuves: prev ? (prev.preuves || []) : [],
        };
      });
      // Réinjecter les hypothèses déjà ÉLIMINÉES que le modèle aurait "oubliées"
      // (verrou anti-réintroduction : elles restent visibles et éliminées).
      for (const h of Object.values(ancien)) {
        if (h.statut === "eliminee" && !state.hypotheses.find((x) => x.id === h.id)) {
          state.hypotheses.push(h);
        }
      }
      // Ancrage de contexte : l'hypothèse principale (forte/tres_forte) NOUVELLE reçoit une
      // preuve "pour" FAIBLE issue du contexte. Conservation : elle ne pourra plus être
      // éliminée silencieusement par un simple cumul faible (résout l'abandon du DIAG 7).
      for (const h of state.hypotheses) {
        const estNouvelle = !ancien[h.id];
        const forte = h.bande === "forte" || h.bande === "tres_forte";
        if (estNouvelle && forte && (!h.preuves || !h.preuves.length)) {
          ajoutPreuve(h, "pour", "coherence_contexte_initial", "faible");
        }
      }
    }

    // COHÉRENCE VÉHICULE — auto-élimination des hypothèses incompatibles avec le carburant.
    const carbu = ((state.vehicule && state.vehicule.fuel) || "").toLowerCase();
    if (carbu) {
      const motsEssence = ["bobine", "bougie d'allumage", "bougies d'allumage", "étincelle", "allumage commandé", "carburateur"];
      const motsDiesel = ["bougie de préchauffage", "bougies de préchauffage", "préchauffage", "rampe commune", "common rail", "injecteur diesel", "fap"];
      const estDiesel = carbu.includes("diesel");
      const estEssence = carbu.includes("essence") || carbu.includes("gpl");
      for (const h of state.hypotheses) {
        const lib = (h.libelle || "").toLowerCase();
        const incompatible =
          (estDiesel && motsEssence.some((m) => lib.includes(m))) ||
          (estEssence && motsDiesel.some((m) => lib.includes(m)));
        if (incompatible && h.statut !== "eliminee") {
          h.statut = "eliminee";
          ajoutPreuve(h, "contre", "incompatible_carburant_" + carbu, "fort");
        }
      }
    }

    if (typeof parsed.resume_enquete === "string" && parsed.resume_enquete.trim()) {
      state.resume_enquete = parsed.resume_enquete.slice(0, 600); // borne dure (anti-croissance)
    }

    // L'état précédent (avant ce tour), pour décider la transition en code.
    const etatAvant = state.etat;
    let etat = parsed.etat; // proposition du modèle, soumise aux verrous ci-dessous

    // VERROU 1 — interdiction de conclure depuis CONTEXTE (transition illégale).
    // On ne peut atteindre CONCLUSION qu'en étant déjà passé par CONTROLE.
    if (etat === "CONCLUSION" && etatAvant === "CONTEXTE") {
      etat = contexteSuffisant(state) ? "HYPOTHESES" : "CONTEXTE";
    }

    // VERROU 2 — plancher CONTEXTE : on ne quitte CONTEXTE que si le contexte minimal est là.
    if (etatAvant === "CONTEXTE" && etat !== "CONTEXTE" && !contexteSuffisant(state)) {
      etat = "CONTEXTE";
    }

    // VERROU 3 — seuil de preuve : CONCLUSION interdite sans preuve suffisante.
    let hypConclue = null;
    if (etat === "CONCLUSION") {
      hypConclue = peutConclure(state);
      if (!hypConclue) etat = "CONTROLE"; // override : on force un contrôle de plus
    }

    // VERROU 4 — cohérence : si on a des hypothèses mais pas de preuve, l'état utile est CONTROLE.
    if (etat === "HYPOTHESES" && state.hypotheses.length && state.controle_en_cours === null && !peutConclure(state)) {
      // le modèle a proposé des hypothèses : l'étape suivante naturelle est un contrôle
      etat = "CONTROLE";
    }

    // VERROU 5 — plafond de tours -> clôture honnête.
    let plafondAtteint = false;
    if (state.tour >= MAX_TOURS && etat !== "CONCLUSION") {
      plafondAtteint = true;
    }

    // Mémoriser le contrôle proposé (sauf si on conclut)
    if (etat === "CONTROLE" && parsed.controle_propose) {
      const cp = parsed.controle_propose;
      const hyp = state.hypotheses.find((h) => h.id === cp.hypothese_id) || state.hypotheses.find((h) => h.statut !== "eliminee");
      state.controle_en_cours = {
        hypothese_id: (cp.hypothese_id ?? (hyp ? hyp.id : null)),
        pouvoir: hyp ? hyp.pouvoir : "faible",
        polarite_oui: (cp.polarite_oui === "elimine" ? "elimine" : "confirme"), // défaut sûr : OUI confirme
        pourquoi: cp.pourquoi || "",
        comment: Array.isArray(cp.comment) ? cp.comment : [],
        observer: Array.isArray(cp.observer) ? cp.observer : [],
      };
    }

    state.etat = etat;

    // ---- 7) Construire la réponse frontend ----
    const response = {
      success: true,
      session_id: diagSessionId,
      etat,
      registre: state.registre,
      message: parsed.message || "",
      hypotheses: state.hypotheses.map((h) => ({ libelle: h.libelle, bande: h.bande, statut: h.statut })),
      controle: null,
      conclusion: null,
      session: { expires_at: sessionExpiresAt, charged, unlimited: usedUnlimited },
      metadata: { elapsed_ms: Date.now() - startTime, model: MODEL, tour: state.tour },
    };

    if (etat === "CONTROLE" && state.controle_en_cours) {
      response.controle = {
        pourquoi: state.controle_en_cours.pourquoi,
        comment: state.controle_en_cours.comment,
        observer: state.controle_en_cours.observer,
        options: ["oui", "non", "ne_sais_pas", "pas_pu"],
      };
    }

    // VERROU 6 (défensif) — conclusion et pièces UNIQUEMENT si etat === CONCLUSION,
    // même si le modèle tente d'en fournir dans un autre état.
    if (etat === "CONCLUSION" && parsed.conclusion) {
      const c = parsed.conclusion;
      // VERROU ANTI-RÉINTRODUCTION : la cause conclue DOIT être l'hypothèse confirmée
      // par le registre (hypConclue), jamais une hypothèse éliminée citée par le modèle.
      const causeFiable = hypConclue ? hypConclue.libelle : (c.cause || "");
      const bandeFiable = hypConclue ? (hypConclue.bande || "forte") : (c.bande || "probable");
      response.conclusion = {
        cause: causeFiable,
        bande: bandeFiable,
        can_drive: c.can_drive !== false,
        urgency: c.urgency || "bientôt",
        cost_min: Number(c.cost_min) || 0,
        cost_max: Number(c.cost_max) || 0,
        parts_needed: Array.isArray(c.parts_needed) ? c.parts_needed : [], // pièces SEULEMENT ici
      };
    }
    // Si etat !== CONCLUSION : response.conclusion reste null et aucune pièce n'est exposée.

    if (plafondAtteint) {
      response.message += "\n\n(Je n'ai pas pu confirmer avec certitude à ce stade. Voici l'hypothèse la plus probable ; un professionnel pourra confirmer.)";
    }

    // ---- 8) Sauver l'état d'enquête (1 écriture, source unique) ----
    const updateRow = { enquete_etat: etat, enquete_state: state, maj_le: new Date().toISOString() };

    // ---- 9) Si CONCLUSION : basculer en phase résultat + matérialiser ----
    if (etat === "CONCLUSION") {
      updateRow.status = "attente_resultat";
      updateRow.final_confidence_band = response.conclusion ? response.conclusion.bande : null;
    }

    await supabase.from("diag_sessions").update(updateRow).eq("id", diagSessionId);

    if (etat === "CONCLUSION") {
      // Matérialisation best-effort (analytique, non bloquant)
      try {
        const hypRows = state.hypotheses.map((h) => ({
          session_id: diagSessionId,
          cause_label_raw: h.libelle,
          confidence_band: h.bande,
          rang: h.id,
          confirmee: h.statut === "confirmee" ? true : h.statut === "eliminee" ? false : null,
        }));
        if (hypRows.length) await supabase.from("diag_hypotheses").insert(hypRows);

        const ctrlRows = state.controles_faits.map((c) => ({
          session_id: diagSessionId,
          label: "controle guidé",
          objectif: "confirmer",
          resultat: c.resultat === "oui" ? "positif"
                  : c.resultat === "non" ? "negatif"
                  : c.resultat === "pas_pu" ? "non_effectue" : "non_concluant",
        }));
        if (ctrlRows.length) await supabase.from("diag_controls").insert(ctrlRows);
      } catch (e) {
        console.error("[DYLAN] matérialisation (non bloquant):", e.message);
      }
    }

    return json(200, response);
  } catch (error) {
    console.error("[DYLAN] erreur:", error.message);
    return json(500, { success: false, error: error.message });
  }
};
