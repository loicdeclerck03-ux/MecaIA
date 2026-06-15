// REMINDER_SET — activer/désactiver un rappel km (coûte 1 crédit)
import { getUser, serviceClient, json, preflight, ensureDiagSession } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Non authentifié" });
  const supabase = serviceClient();

  const { vehicle_id, label, km_trigger, action } = JSON.parse(event.body || "{}");

  // DELETE un rappel
  if (action === "delete" && km_trigger) {
    await supabase.from("maintenance_reminders")
      .delete()
      .eq("user_id", auth.userId)
      .eq("vehicle_id", vehicle_id)
      .eq("km_trigger", km_trigger);
    return json(200, { success: true });
  }

  if (!vehicle_id || !label || !km_trigger)
    return json(400, { error: "vehicle_id, label, km_trigger requis" });

  // Débiter 1 crédit (via ensureDiagSession comme les autres features)
  const gate = await ensureDiagSession(supabase, auth.userId);
  if (!gate.allowed) {
    return json(402, { success: false, code: "insufficient_credits",
      message: "Crédits insuffisants.", remaining_balance: gate.balance });
  }

  const { data, error } = await supabase
    .from("maintenance_reminders")
    .insert({ user_id: auth.userId, vehicle_id, label, km_trigger })
    .select().single();

  if (error) return json(500, { error: error.message });
  return json(201, { success: true, reminder: data, charged: gate.charged });
};
