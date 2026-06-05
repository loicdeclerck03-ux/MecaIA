// REPAIR_START — démarre une réparation (auth + propriété du véhicule)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const { vehicle_id, diagnostic_id, diagnosis_type, guide_id, estimated_cost_min, estimated_cost_max } =
      JSON.parse(event.body || "{}");
    if (!vehicle_id || !diagnosis_type) return json(400, { error: "Champs requis: vehicle_id, diagnosis_type" });

    const { data: owns } = await supabase.rpc("user_owns_vehicle", { p_user_id: userId, p_vehicle_id: vehicle_id });
    if (!owns) return json(403, { error: "Forbidden: ce véhicule ne vous appartient pas" });

    const { data, error } = await supabase.rpc("add_user_repair", {
      p_user_id: userId,
      p_vehicle_id: vehicle_id,
      p_diagnostic_id: diagnostic_id,
      p_diagnosis_type: diagnosis_type,
      p_guide_id: guide_id,
      p_estimated_cost_min: estimated_cost_min,
      p_estimated_cost_max: estimated_cost_max,
      p_start_date: new Date().toISOString().split("T")[0],
    });
    if (error) throw error;

    const result = data[0];
    return json(201, { success: true, repair_id: result.repair_id, message: result.message });
  } catch (error) {
    console.error("[REPAIR_START]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
