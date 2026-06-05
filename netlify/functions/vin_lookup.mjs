// VIN_LOOKUP — décodage VIN (auth, GRATUIT mais limité à 3/jour/utilisateur)
// Source : API publique NHTSA vPIC (gratuite, sans clé).
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const DAILY_LIMIT = 3;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const vinRaw = event.httpMethod === "GET"
      ? event.queryStringParameters?.vin
      : JSON.parse(event.body || "{}").vin;
    const vin = (vinRaw || "").trim().toUpperCase();

    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
      return json(400, { error: "VIN invalide (11 à 17 caractères, sans I, O, Q)" });
    }

    // Limite : 3 décodages réussis par jour (UTC)
    const { data: usedToday, error: cErr } = await supabase.rpc("vin_count_today", { p_user_id: auth.userId });
    if (cErr) throw cErr;
    if ((usedToday || 0) >= DAILY_LIMIT) {
      return json(429, {
        success: false,
        code: "daily_limit_reached",
        message: `Limite de ${DAILY_LIMIT} VIN par jour atteinte. Réessaie demain.`,
        used: usedToday,
        max: DAILY_LIMIT,
      });
    }

    // Décodage NHTSA
    let j;
    try {
      const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`);
      j = await r.json();
    } catch (e) {
      console.error("[VIN_LOOKUP] NHTSA:", e.message);
      return json(502, { success: false, error: "Service de décodage VIN indisponible, réessayez." });
    }

    const v = j && Array.isArray(j.Results) ? j.Results[0] : null;
    if (!v) return json(404, { success: false, error: "VIN introuvable" });

    // On ne décompte QUE les décodages réussis
    try {
      await supabase.rpc("record_vin_lookup", { p_user_id: auth.userId, p_vin: vin });
    } catch (e) {
      console.error("[VIN_LOOKUP] record (non bloquant):", e.message);
    }

    return json(200, {
      success: true,
      vin,
      vehicle: {
        marque: v.Make || null,
        modele: v.Model || null,
        annee: v.ModelYear || null,
        carburant: v.FuelTypePrimary || null,
        carrosserie: v.BodyClass || null,
        cylindres: v.EngineCylinders || null,
        cylindree_l: v.DisplacementL || null,
        moteur: v.EngineModel || null,
        pays_fabrication: v.PlantCountry || null,
      },
      quota: { used: (usedToday || 0) + 1, max: DAILY_LIMIT },
    });
  } catch (error) {
    console.error("[VIN_LOOKUP]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
