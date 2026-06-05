// GARAGE_ADD_DIAGNOSTIC — ajoute un diag à un véhicule (auth + propriété)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const {
      vehicle_id, primary_diagnosis, symptoms, obd_codes, causes, parts_needed,
      confidence_percent, urgency, can_drive, estimated_cost_min, estimated_cost_max,
    } = JSON.parse(event.body || "{}");

    if (!vehicle_id || !primary_diagnosis) return json(400, { error: "Champs requis: vehicle_id, primary_diagnosis" });

    const { data: owns } = await supabase.rpc("user_owns_vehicle", { p_user_id: userId, p_vehicle_id: vehicle_id });
    if (!owns) return json(403, { error: "Forbidden: ce véhicule ne vous appartient pas" });

    const { data, error } = await supabase.rpc("add_user_diagnostic", {
      p_user_id: userId,
      p_vehicle_id: vehicle_id,
      p_primary_diagnosis: primary_diagnosis,
      p_symptoms: symptoms,
      p_obd_codes: obd_codes,
      p_causes: causes,
      p_parts_needed: parts_needed,
      p_confidence_percent: confidence_percent,
      p_urgency: urgency,
      p_can_drive: can_drive,
      p_estimated_cost_min: estimated_cost_min,
      p_estimated_cost_max: estimated_cost_max,
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("No response from add_user_diagnostic");

    const result = data[0];
    return json(201, {
      success: true, diagnostic_id: result.diagnostic_id, message: result.message,
      primary_diagnosis, confidence_percent,
      estimated_cost: { min: estimated_cost_min, max: estimated_cost_max },
    });
  } catch (error) {
    console.error("[GARAGE_DIAG]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
