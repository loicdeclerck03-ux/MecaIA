// ADMIN — réservé au propriétaire (OWNER_EMAIL). Routeur d'actions.
// actions : stats | list_promos | create_promo | toggle_promo | grant
import { getUser, serviceClient, json, preflight, isOwner } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  if (!isOwner(auth)) return json(403, { error: "Forbidden : réservé au propriétaire" });

  const supabase = serviceClient();
  const { action, payload = {} } = JSON.parse(event.body || "{}");

  try {
    if (action === "stats") {
      const { data, error } = await supabase.rpc("admin_stats");
      if (error) throw error;
      return json(200, { success: true, stats: (data && data[0]) || {} });
    }

    if (action === "list_promos") {
      const { data, error } = await supabase.rpc("admin_list_promos");
      if (error) throw error;
      return json(200, { success: true, promos: data || [] });
    }

    if (action === "create_promo") {
      const { code, kind, value, max_uses, expires_at } = payload;
      if (!code || !kind || value == null) return json(400, { error: "code, kind, value requis" });
      const { data, error } = await supabase.rpc("admin_create_promo", {
        p_code: code, p_kind: kind, p_value: value,
        p_max_uses: max_uses ?? null, p_expires_at: expires_at ?? null,
      });
      if (error) throw error;
      const r = data && data[0];
      if (!r || !r.id) return json(400, { success: false, error: r ? r.message : "échec" });
      return json(201, { success: true, id: r.id, code: r.code });
    }

    if (action === "toggle_promo") {
      const { id, active } = payload;
      if (!id || typeof active !== "boolean") return json(400, { error: "id + active requis" });
      const { data, error } = await supabase.rpc("admin_set_promo_active", { p_id: id, p_active: active });
      if (error) throw error;
      return json(200, { success: true, active: data && data[0] ? data[0].active : active });
    }

    if (action === "grant") {
      const { email, kind, value } = payload;
      if (!email || !kind || value == null) return json(400, { error: "email, kind, value requis" });
      const { data, error } = await supabase.rpc("admin_grant_by_email", { p_email: email, p_kind: kind, p_value: value });
      if (error) throw error;
      const r = data && data[0];
      if (!r || !r.success) return json(400, { success: false, error: r ? r.message : "échec" });
      return json(200, { success: true, message: "Octroyé à " + email });
    }

    return json(400, { error: "action inconnue" });
  } catch (error) {
    console.error("[ADMIN]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
