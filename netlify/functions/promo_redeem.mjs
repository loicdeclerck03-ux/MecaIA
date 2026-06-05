// PROMO_REDEEM — un utilisateur connecté échange un code (crédits/illimité)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { code } = JSON.parse(event.body || "{}");
    if (!code) return json(400, { error: "code requis" });

    const { data, error } = await supabase.rpc("redeem_promo", { p_user_id: auth.userId, p_code: code });
    if (error) throw error;
    const r = data && data[0];
    if (!r || !r.success) {
      return json(400, { success: false, code: "promo_invalid", message: r ? r.message : "code invalide" });
    }
    return json(200, { success: true, kind: r.kind, value: r.value, message: "Code appliqué !" });
  } catch (error) {
    console.error("[PROMO_REDEEM]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
