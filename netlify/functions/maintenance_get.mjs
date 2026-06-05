// MAINTENANCE_GET — historique d'un véhicule (auth + propriété)
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

    const { data, error } = await supabase.rpc("get_vehicle_maintenance_history", { p_vehicle_id: vehicle_id });
    if (error) throw error;

    const records = (data || []).map((r) => ({
      ...r,
      urgency_badge: r.is_overdue ? "⚠️ OVERDUE" : r.days_ago < 30 ? "⏰ RECENT" : "✅ OK",
    }));

    return json(200, {
      success: true, vehicle_id, total_records: records.length, records,
      stats: {
        total_cost: records.reduce((s, r) => s + (r.cost_eur || 0), 0),
        avg_cost: records.length ? records.reduce((s, r) => s + (r.cost_eur || 0), 0) / records.length : 0,
        last_maintenance: records[0]?.maintenance_date || null,
        days_since_last: records[0]?.days_ago || 0,
      },
    });
  } catch (error) {
    console.error("[MAINTENANCE_GET]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
