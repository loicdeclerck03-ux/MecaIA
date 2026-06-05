// EMAIL_VERIFY — vérifie un email via le token du lien (endpoint PUBLIC)
// Pas de getUser : le token de vérification EST la preuve d'identité.
import { serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  const supabase = serviceClient();

  try {
    const token = event.queryStringParameters?.token || JSON.parse(event.body || "{}").token;
    if (!token) return json(400, { error: "Token required" });

    const { data, error } = await supabase.rpc("verify_email", { p_verification_token: token });

    if (error || !data || !data[0]?.success) {
      return json(400, { success: false, message: data ? data[0].message : error?.message });
    }

    return json(200, { success: true, user_id: data[0].user_id, message: data[0].message });
  } catch (error) {
    console.error("[EMAIL_VERIFY]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
