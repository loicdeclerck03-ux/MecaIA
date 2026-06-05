// REPAIR_GUIDE_GET — guide de réparation par type de diagnostic (auth requise)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const diagnosis_type = event.queryStringParameters?.diagnosis_type
      || JSON.parse(event.body || "{}").diagnosis_type;
    if (!diagnosis_type) return json(400, { error: "diagnosis_type required" });

    const { data, error } = await supabase.rpc("get_repair_guide", { p_diagnosis_type: diagnosis_type });
    if (error) throw error;

    const guide = data && data.length > 0 ? data[0] : null;
    return json(200, { success: true, guide: guide || { message: "No guide found for this diagnosis" } });
  } catch (error) {
    console.error("[REPAIR_GUIDE]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
