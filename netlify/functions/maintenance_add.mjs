// MAINTENANCE_ADD — ajoute un entretien (auth + propriété du véhicule)
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
      vehicle_id, maintenance_type, maintenance_date, maintenance_description,
      vehicle_km_at_maintenance, cost_eur, shop_name, notes,
    } = JSON.parse(event.body || "{}");

    if (!vehicle_id || !maintenance_type || !maintenance_date)
      return json(400, { error: "Champs requis: vehicle_id, maintenance_type, maintenance_date" });

    const { data: owns } = await supabase.rpc("user_owns_vehicle", { p_user_id: userId, p_vehicle_id: vehicle_id });
    if (!owns) return json(403, { error: "Forbidden: ce véhicule ne vous appartient pas" });

    const { data, error } = await supabase.rpc("add_maintenance_record", {
      p_user_id: userId,
      p_vehicle_id: vehicle_id,
      p_maintenance_type: maintenance_type,
      p_maintenance_date: maintenance_date,
      p_maintenance_description: maintenance_description,
      p_vehicle_km_at_maintenance: vehicle_km_at_maintenance,
      p_cost_eur: cost_eur,
      p_shop_name: shop_name,
      p_notes: notes,
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("No response from add_maintenance_record");

    const result = data[0];
    return json(201, {
      success: true, record_id: result.record_id, message: result.message,
      next_maintenance_date: result.next_maintenance_date, maintenance_type, cost_eur,
    });
  } catch (error) {
    console.error("[MAINTENANCE_ADD]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
