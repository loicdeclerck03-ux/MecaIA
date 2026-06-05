// REPAIR_UPDATE — met à jour une réparation (auth + propriété de la réparation)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST" && event.httpMethod !== "PUT") return json(405, { error: "POST/PUT only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const { repair_id, new_status, actual_cost, completion_date, success_rating, notes } =
      JSON.parse(event.body || "{}");
    if (!repair_id || !new_status) return json(400, { error: "Champs requis: repair_id, new_status" });

    const { data: owns } = await supabase.rpc("user_owns_repair", { p_user_id: userId, p_repair_id: repair_id });
    if (!owns) return json(403, { error: "Forbidden: cette réparation ne vous appartient pas" });

    const { data, error } = await supabase.rpc("update_repair_status", {
      p_repair_id: repair_id,
      p_new_status: new_status,
      p_actual_cost: actual_cost,
      p_completion_date: completion_date,
      p_success_rating: success_rating,
      p_notes: notes,
    });
    if (error) throw error;

    const result = data[0];
    return json(200, { success: true, message: result.message, updated_status: result.updated_status });
  } catch (error) {
    console.error("[REPAIR_UPDATE]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
