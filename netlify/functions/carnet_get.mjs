// CARNET_GET — historique entretien + rappels pour un véhicule
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });
  const supabase = serviceClient();

  const { vehicle_id } = JSON.parse(event.body || "{}");
  if (!vehicle_id) return json(400, { error: "vehicle_id requis" });

  // Historique entretien
  const { data: history, error: hErr } = await supabase
    .from("user_vehicle_maintenance")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("vehicle_id", vehicle_id)
    .order("maintenance_date", { ascending: false })
    .limit(50);
  if (hErr) return json(500, { error: hErr.message });

  // Rappels actifs
  const { data: reminders } = await supabase
    .from("maintenance_reminders")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("vehicle_id", vehicle_id)
    .eq("active", true)
    .order("km_trigger", { ascending: true });

  // Diagnostics conclus (recap pour le carnet)
  const { data: diags } = await supabase
    .from("diag_sessions")
    .select("id, veh_make, veh_model, enquete_etat, enquete_state, cree_le")
    .eq("user_id", auth.userId)
    .eq("vehicle_id", vehicle_id)
    .eq("enquete_etat", "CONCLUSION")
    .order("cree_le", { ascending: false })
    .limit(5);

  return json(200, {
    success: true,
    history: history || [],
    reminders: reminders || [],
    diag_recaps: (diags || []).map(d => {
      const st = d.enquete_state || {};
      const hyp = (st.hypotheses || []).find(h => h.statut === "confirmee");
      return {
        id: d.id, date: d.cree_le,
        cause: hyp?.libelle || st.resume_enquete?.substring(0, 80) || "Diagnostic complété",
        bande: hyp?.bande || "",
        codes: (st.contexte?.codes || []).join(", "),
      };
    }),
  });
};
