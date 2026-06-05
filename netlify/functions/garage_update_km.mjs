// GARAGE_UPDATE_KM — met à jour le kilométrage (auth + propriété)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { vehicle_id, km } = JSON.parse(event.body || "{}");
    const kmNum = parseInt(km, 10);
    if (!vehicle_id || !Number.isFinite(kmNum)) return json(400, { error: "vehicle_id et km requis" });

    const { data: owns } = await supabase.rpc("user_owns_vehicle", { p_user_id: auth.userId, p_vehicle_id: vehicle_id });
    if (!owns) return json(403, { error: "Forbidden" });

    const { data, error } = await supabase.rpc("update_vehicle_km", { p_vehicle_id: vehicle_id, p_km_new: kmNum });
    if (error) throw error;

    return json(200, { success: true, result: (data && data[0]) || null });
  } catch (error) {
    console.error("[GARAGE_UPDATE_KM]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
