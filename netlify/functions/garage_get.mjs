// GARAGE_GET — garage de l'utilisateur (auth obligatoire)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const { data: vehicles, error: vErr } = await supabase.rpc("get_user_vehicles", { p_user_id: userId });
    if (vErr) throw vErr;

    const { data: stats, error: sErr } = await supabase.rpc("get_user_diagnostics_summary", { p_user_id: userId });
    if (sErr) throw sErr;
    const summary = stats && stats.length > 0 ? stats[0] : {};

    const vehiclesWithDiags = await Promise.all(
      (vehicles || []).map(async (v) => {
        const { data: diags } = await supabase.rpc("get_vehicle_diagnostics", { p_vehicle_id: v.id });
        return { ...v, diagnostics: diags || [], diagnostics_count: (diags || []).length };
      })
    );

    return json(200, {
      success: true,
      user_id: userId,
      vehicles: vehiclesWithDiags,
      summary: {
        total_vehicles: summary.total_vehicles || 0,
        total_diagnostics: summary.total_diagnostics || 0,
        avg_confidence: summary.avg_confidence || 0,
        pending_repairs: summary.pending_repairs || 0,
        completed_repairs: summary.completed_repairs || 0,
        total_cost_min: summary.total_estimated_cost_min || 0,
        total_cost_max: summary.total_estimated_cost_max || 0,
      },
    });
  } catch (error) {
    console.error("[GARAGE_GET]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
