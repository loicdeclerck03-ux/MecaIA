// HEALTH_SCORE_GET — score santé d'un véhicule (auth + propriété)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const vehicle_id = event.httpMethod === "GET"
      ? event.queryStringParameters?.vehicle_id
      : JSON.parse(event.body || "{}").vehicle_id;
    if (!vehicle_id) return json(400, { error: "Missing vehicle_id" });

    const { data: owns } = await supabase.rpc("user_owns_vehicle", { p_user_id: userId, p_vehicle_id: vehicle_id });
    if (!owns) return json(403, { error: "Forbidden" });

    await supabase.rpc("calculate_vehicle_health", { p_vehicle_id: vehicle_id });
    const { data, error } = await supabase.rpc("get_vehicle_health", { p_vehicle_id: vehicle_id });
    if (error) throw error;

    return json(200, { success: true, health: (data && data[0]) || { health_score: 100, health_status: "excellent" } });
  } catch (error) {
    console.error("[HEALTH_SCORE]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
