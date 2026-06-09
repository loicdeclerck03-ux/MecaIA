// =====================================================================
//  diag_session_create.mjs
//  MecaIA — point d'entree de la boucle d'apprentissage "Panne resolue".
//  Appelee a la fin d'un diagnostic Dylan : ecrit la session + les
//  hypotheses, passe le statut a 'attente_resultat'.
//
//  Principe : une session ecrite est irrecuperable si on ne l'ecrit pas.
//  Donc on est PERMISSIF (pas de blocage sur champs manquants) et on
//  capture un maximum de fidelite (raw_exchange) pour le futur.
//
//  Dependances : netlify/lib/auth.mjs (getUser, serviceClient).
//  Prerequis   : sql/20_panne_resolue.sql deploye.
// =====================================================================

import { getUser, serviceClient } from "../lib/auth.mjs";

// --- Reponse JSON standard ---
function resp(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// --- Helpers de nettoyage ---
function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const BANDES = ["faible", "probable", "forte", "tres_forte"];
function bandOrNull(v) {
  return BANDES.includes(v) ? v : null;
}

function strOrNull(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function handler(event) {
  // 1) Methode
  if (event.httpMethod !== "POST") {
    return resp(405, { error: "Methode non autorisee" });
  }

  // 2) Authentification (JWT Supabase)
  let user;
  try {
    user = await getUser(event);
  } catch (e) {
    return resp(401, { error: "Non authentifie" });
  }
  if (!user) return resp(401, { error: "Non authentifie" });

  // 3) Corps de la requete
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return resp(400, { error: "JSON invalide" });
  }

  const veh = body.vehicle || {};

  // 4) Construction de la ligne session (snapshot vehicule fige a l'instant T)
  //    engine_code = NULL si absent ; le libelle brut est toujours stocke.
  const sessionRow = {
    user_id: user.id,
    vehicle_id: strOrNull(body.vehicle_id),

    veh_make: strOrNull(veh.make),
    veh_model: strOrNull(veh.model),
    veh_generation: strOrNull(veh.generation),
    veh_engine_code: strOrNull(veh.engine_code),   // robuste : NULL si non disponible
    veh_engine_label: strOrNull(veh.engine_label), // libelle brut "1.6 TDI" (fallback)
    veh_fuel: strOrNull(veh.fuel),
    veh_year: intOrNull(veh.year),
    veh_mileage_km: intOrNull(veh.mileage_km),

    symptoms: strOrNull(body.symptoms),
    dtc_codes: Array.isArray(body.dtc_codes) ? body.dtc_codes : [],

    // Trace brute de l'echange : forward-compat (reconstruction future de la
    // chaine questions->controles->mesures). Accepte tel quel si fourni.
    raw_exchange: body.raw_exchange ?? null,

    final_confidence_band: bandOrNull(body.confidence_band),

    status: "attente_resultat",
  };

  const db = serviceClient();

  // 5) Insertion de la session (l'ecriture CRITIQUE)
  const { data: session, error: sErr } = await db
    .from("diag_sessions")
    .insert(sessionRow)
    .select("id")
    .single();

  if (sErr) {
    console.error("[diag_session_create] echec session:", sErr.message);
    return resp(500, { error: "Echec creation session" });
  }

  // 6) Insertion des hypotheses (BEST-EFFORT : ne doit jamais faire echouer
  //    la session deja creee. Une session sans hypotheses reste exploitable.)
  const hyps = Array.isArray(body.hypotheses) ? body.hypotheses : [];
  if (hyps.length) {
    const rows = hyps.map((h, i) => ({
      session_id: session.id,
      cause_id: h.cause_id ?? null,                  // pointe vers cause_taxonomy si connu
      cause_label_raw: strOrNull(h.label ?? h.cause_label_raw), // libelle brut Dylan
      confidence_band: bandOrNull(h.confidence_band),
      rang: intOrNull(h.rang) ?? i + 1,
      confirmee: null,                               // statut a determiner plus tard
    }));

    const { error: hErr } = await db.from("diag_hypotheses").insert(rows);
    if (hErr) {
      // Non bloquant : on logue, mais la session est deja valide.
      console.error("[diag_session_create] hypotheses non ecrites:", hErr.message);
    }
  }

  // 7) Succes : on renvoie l'id de session (le front le garde pour le retour client)
  return resp(200, {
    session_id: session.id,
    status: "attente_resultat",
  });
}
