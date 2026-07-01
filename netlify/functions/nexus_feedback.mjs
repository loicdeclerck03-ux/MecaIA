// nexus_feedback.mjs — Enregistre le feedback post-réparation (flywheel calibration).
// Appelé après que l utilisateur confirme si le diagnostic était correct.
// Auth requise. Pas de débit crédit.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { getUser, json, preflight } from "../lib/auth.mjs";

let _s = null;
const getSupa = () => _s || (_s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET));

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }

  const { diag_session_id, was_correct, actual_issue, repair_cost, comments } = body;

  if (typeof was_correct !== "boolean") return json(400, { error: "was_correct (boolean) requis" });

  const supa = getSupa();

  try {
    const { error } = await supa.from("nexus_feedback").insert({
      diagnostic_session_id: diag_session_id || null,
      user_id: auth.userId,
      was_correct,
      actual_issue: (actual_issue || "").substring(0, 500) || null,
      repair_cost: repair_cost ? parseFloat(repair_cost) : null,
      comments: (comments || "").substring(0, 1000) || null,
    });
    if (error) throw error;

    // Si confirmé : mettre à jour la session dylan comme "resultat_confirme"
    if (diag_session_id && was_correct) {
      await supa.from("diag_sessions")
        .update({ status: "resultat_confirme" })
        .eq("id", diag_session_id)
        .eq("user_id", auth.userId);
    }

    console.log(`[nexus_feedback] user=${auth.userId} correct=${was_correct} session=${diag_session_id}`);
    return json(200, { success: true, message: was_correct ? "Merci — ce retour améliore Dylan !" : "Merci — on analyse pour s'améliorer." });
  } catch (e) {
    console.error("[nexus_feedback] error:", e.message);
    return json(500, { error: "Erreur enregistrement feedback" });
  }
}
