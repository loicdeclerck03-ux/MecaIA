// GARAGE_ADD_VEHICLE — ajoute un véhicule (auth obligatoire)
// Version robuste : écrit DIRECTEMENT dans la table user_vehicles via le client
// "service" (qui contourne RLS), sans dépendre de la fonction SQL add_user_vehicle.
// → règle l'erreur 500 quel que soit l'état des fonctions SQL.
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const supabase = serviceClient();

  try {
    const b = JSON.parse(event.body || "{}");
    if (!b.marque || !b.modele) return json(400, { error: "Champs requis: marque, modele" });

    // Validation km : doit être positif si fourni
    const kmRaw = b.km_current ?? null;
    if (kmRaw !== null && (isNaN(Number(kmRaw)) || Number(kmRaw) < 0))
      return json(400, { error: "km_current invalide : doit être un nombre positif ou zéro" });
    if (kmRaw !== null && Number(kmRaw) === 0)
      return json(400, { error: "km_current invalide : un véhicule neuf a au minimum quelques km" });

    // Le 1er véhicule de l'utilisateur devient le véhicule principal
    let isPrimary = false;
    try {
      const { count } = await supabase
        .from("user_vehicles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);
      isPrimary = (count || 0) === 0;
    } catch (_) { /* non bloquant */ }

    // Colonnes garanties par le schéma de base
    const row = {
      user_id: userId,
      marque: b.marque,
      modele: b.modele,
      annee: b.annee ?? null,
      km_current: b.km_current ?? null,
      immatriculation: b.immatriculation || null,
      nickname: b.nickname || null,
      carburant: b.carburant || null,
      couleur: b.couleur || null,
      puissance_ch: b.puissance_ch ?? null,
      vin: b.vin || null,
      is_primary: isPrimary,
    };
    // engine_code : seulement si fourni (la colonne peut ne pas exister sur d'anciennes bases)
    if (b.engine_code) row.engine_code = b.engine_code;
    // date_ct : date du prochain contrôle technique
    if (b.date_ct) row.date_ct = b.date_ct;

    let { data, error } = await supabase
      .from("user_vehicles")
      .insert(row)
      .select("id")
      .single();

    // Si la colonne engine_code n'existe pas encore en base, on réessaie sans elle
    if (error && /engine_code/i.test(error.message || "")) {
      delete row.engine_code;
      ({ data, error } = await supabase
        .from("user_vehicles")
        .insert(row)
        .select("id")
        .single());
    }

    if (error) throw error;

    return json(201, {
      success: true,
      vehicle_id: data.id,
      marque: b.marque,
      modele: b.modele,
      message: "Véhicule ajouté",
    });
  } catch (error) {
    console.error("[GARAGE_ADD]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
