// GARAGE_ADD_VEHICLE — ajoute un véhicule (auth obligatoire)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const { marque, modele, annee, km_current, immatriculation, nickname, carburant, couleur, puissance_ch, vin, engine_code } =
      JSON.parse(event.body || "{}");

    if (!marque || !modele) return json(400, { error: "Champs requis: marque, modele" });

    const { data, error } = await supabase.rpc("add_user_vehicle", {
      p_user_id: userId,
      p_marque: marque,
      p_modele: modele,
      p_annee: annee,
      p_km_current: km_current,
      p_immatriculation: immatriculation,
      p_nickname: nickname,
      p_carburant: carburant,
      p_couleur: couleur,
      p_puissance_ch: puissance_ch,
      p_vin: vin,
      p_engine_code: engine_code,
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("No response from add_user_vehicle");

    const result = data[0];
    return json(201, { success: true, vehicle_id: result.vehicle_id, message: result.message, marque, modele });
  } catch (error) {
    console.error("[GARAGE_ADD]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
