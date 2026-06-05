// MAINTENANCE_ALERTS — alertes d'entretien (auth + propriété)
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

    const { data, error } = await supabase.rpc("get_maintenance_alerts", { p_vehicle_id: vehicle_id });
    if (error) throw error;

    const order = { overdue: 0, urgent: 1, warning: 2, ok: 3 };
    const alerts = (data || []).sort((a, b) => order[a.urgency] - order[b.urgency]);
    const counts = {
      overdue: alerts.filter((a) => a.urgency === "overdue").length,
      urgent: alerts.filter((a) => a.urgency === "urgent").length,
      warning: alerts.filter((a) => a.urgency === "warning").length,
      ok: alerts.filter((a) => a.urgency === "ok").length,
    };
    const global_status = counts.overdue ? "CRITICAL" : counts.urgent ? "URGENT" : counts.warning ? "WARNING" : "OK";

    return json(200, {
      success: true, vehicle_id, global_status, counts, alerts,
      recommendations: generateRecommendations(alerts),
    });
  } catch (error) {
    console.error("[MAINTENANCE_ALERTS]", error.message);
    return json(500, { success: false, error: error.message });
  }
};

function generateRecommendations(alerts) {
  const recs = [];
  for (const a of alerts) {
    if (a.urgency === "overdue") recs.push({ priority: "CRITICAL", message: `⚠️ ${a.display_name} en retard ! À planifier immédiatement.`, type: a.maintenance_type });
    else if (a.urgency === "urgent") recs.push({ priority: "URGENT", message: `🔴 ${a.display_name} dans ${a.days_until_due} jours.`, type: a.maintenance_type });
    else if (a.urgency === "warning") recs.push({ priority: "WARNING", message: `🟡 ${a.display_name} dans ${a.days_until_due} jours.`, type: a.maintenance_type });
  }
  return recs;
}
