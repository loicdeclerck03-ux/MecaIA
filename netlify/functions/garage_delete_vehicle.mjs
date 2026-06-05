// GARAGE_DELETE_VEHICLE — suppression (soft) d'un véhicule (auth + propriété)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { vehicle_id } = JSON.parse(event.body || "{}");
    if (!vehicle_id) return json(400, { error: "vehicle_id requis" });

    const { data, error } = await supabase.rpc("delete_user_vehicle", {
      p_user_id: auth.userId,
      p_vehicle_id: vehicle_id,
    });
    if (error) throw error;
    const r = data && data[0];
    if (!r || !r.success) return json(403, { success: false, error: r ? r.message : "forbidden" });

    return json(200, { success: true, message: "Véhicule supprimé" });
  } catch (error) {
    console.error("[GARAGE_DELETE]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
