// CARNET_ADD — ajouter une entrée d'entretien
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });
  const supabase = serviceClient();

  const {
    vehicle_id, maintenance_type, maintenance_date,
    maintenance_description, vehicle_km_at_maintenance,
    cost_eur, shop_name, next_maintenance_km,
    notes, receipt_image_url
  } = JSON.parse(event.body || "{}");

  if (!vehicle_id || !maintenance_type || !maintenance_date)
    return json(400, { error: "Champs requis: vehicle_id, maintenance_type, maintenance_date" });

  const { data, error } = await supabase
    .from("user_vehicle_maintenance")
    .insert({
      user_id: auth.userId,
      vehicle_id,
      maintenance_type,
      maintenance_date,
      maintenance_description: maintenance_description || null,
      vehicle_km_at_maintenance: vehicle_km_at_maintenance || null,
      cost_eur: cost_eur || null,
      shop_name: shop_name || null,
      next_maintenance_km: next_maintenance_km || null,
      notes: notes || null,
      receipt_image_url: receipt_image_url || null,
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  // Si next_maintenance_km défini → créer un rappel automatique
  if (next_maintenance_km) {
    await supabase.from("maintenance_reminders").insert({
      user_id: auth.userId,
      vehicle_id,
      label: `${maintenance_type} — Prochain à ${next_maintenance_km.toLocaleString()} km`,
      km_trigger: next_maintenance_km,
    });
  }

  return json(201, { success: true, entry: data });
};
