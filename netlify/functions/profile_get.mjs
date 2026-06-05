// PROFILE_GET — profil + crédits + pass illimité (auth). Crée le profil si absent.
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    // Crée le profil + 3 crédits offerts au premier appel (idempotent)
    await supabase.rpc("ensure_user_profile", {
      p_user_id: auth.userId,
      p_name: auth.meta?.name || "",
      p_type: auth.meta?.type || "mechanic",
    });

    const { data, error } = await supabase.rpc("get_user_profile", { p_user_id: auth.userId });
    if (error) throw error;
    const p = (data && data[0]) || {};

    return json(200, {
      success: true,
      profile: {
        name: p.name || auth.email,
        type: p.type || "mechanic",
        promo_code: p.promo_code || "",
        diagnostics: p.diagnostics || 0,
        pieces_searches: p.pieces_searches || 0,
      },
      credits: Number(p.credits_balance || 0),
      unlimited: !!p.unlimited,
      unlimited_until: p.unlimited_until || null,
    });
  } catch (error) {
    console.error("[PROFILE_GET]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
