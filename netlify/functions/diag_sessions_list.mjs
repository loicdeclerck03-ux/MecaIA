// Liste des diagnostics récents de l'utilisateur (7 jours max, non conclus)
import { getUser, json, preflight, serviceClient } from "../lib/auth.mjs";

export const handler = async (event) => {
  try {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });

  const supabase = serviceClient();

  const { data, error } = await supabase
    .from("diag_sessions")
    .select("id, veh_make, veh_model, veh_fuel, veh_year, veh_mileage_km, symptoms, dtc_codes, enquete_etat, enquete_state, cree_le, maj_le")
    .eq("user_id", auth.userId)
    .neq("enquete_etat", "CONCLUSION")           // Exclure les diagnostics terminés
    .gte("maj_le", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 7 derniers jours
    .order("maj_le", { ascending: false })
    .limit(5);

  if (error) return json(500, { error: error.message });

  // Formater pour le frontend
  const sessions = (data || []).map((s) => {
    const state = s.enquete_state || {};
    const hyps = state.hypotheses || [];
    const contexte = state.contexte || {};
    const vehicule = state.vehicule || {};

    // Nom du véhicule
    const vehLabel = [
      vehicule.make || s.veh_make,
      vehicule.model || s.veh_model,
      vehicule.year || s.veh_year,
      vehicule.fuel || s.veh_fuel,
    ].filter(Boolean).join(" ") || "Véhicule non précisé";

    // Résumé hypothèses
    const topHyp = hyps
      .filter(h => h.statut !== "eliminee")
      .slice(0, 2)
      .map(h => h.libelle)
      .join(", ");

    // Symptôme principal
    const symptome = contexte.symptome || s.symptoms || "";

    // Codes OBD
    const codes = (contexte.codes || s.dtc_codes || []).slice(0, 3).join(", ");

    // Durée depuis dernière activité
    const majDate = new Date(s.maj_le);
    const diffH = Math.round((Date.now() - majDate) / 3600000);
    const lastActivity = diffH < 1 ? "À l'instant" : diffH < 24 ? `Il y a ${diffH}h` : `Il y a ${Math.round(diffH/24)}j`;

    return {
      id: s.id,
      vehicule: vehLabel,
      etat: s.enquete_etat || "CONTEXTE",
      tour: state.tour || 0,
      symptome: symptome?.substring(0, 100),
      codes,
      topHyp,
      lastActivity,
      maj_le: s.maj_le,
      // État machine complet pour reconstruction côté client
      state: {
        etat: state.etat,
        tour: state.tour,
        vehicule: vehicule,
        contexte: { symptome: contexte.symptome?.substring(0, 150), codes: contexte.codes || [] },
        hypotheses: hyps.slice(0, 4).map(h => ({ libelle: h.libelle, bande: h.bande, statut: h.statut })),
        controle_en_cours: state.controle_en_cours || null,
        resume_enquete: state.resume_enquete || "",
      },
    };
  });

  return json(200, { success: true, sessions });
  } catch(e) {
    console.error('diag_sessions_list error:', e);
    return json(500, { error: e.message });
  }
};
