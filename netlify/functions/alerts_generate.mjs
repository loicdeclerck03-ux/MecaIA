// ALERTS_GENERATE — alertes d'entretien par kilométrage (auth + session diag)
import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight, ensureDiagSession } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

function safeJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { vehicle_marque, vehicle_modele, vehicle_annee, vehicle_km } = JSON.parse(event.body || "{}");
    if (!vehicle_km) return json(400, { error: "vehicle_km requis" });

    const gate = await ensureDiagSession(supabase, auth.userId);
    if (!gate.allowed) {
      return json(402, { success: false, code: "insufficient_credits", message: "Crédits insuffisants.", remaining_balance: gate.balance });
    }

    const veh = [vehicle_marque, vehicle_modele, vehicle_annee].filter(Boolean).join(" ");
    let completion;
    try {
      completion = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: "Expert entretien automobile. Réponds STRICTEMENT en JSON valide sans texte autour.",
        messages: [{ role: "user", content: `Véhicule: ${veh} à ${vehicle_km} km\nJSON:\n{"alertes":[{"icon":"🔧","titre":"intervention","desc":"description précise","km_next":170000,"urgence":"Immédiat ou Bientôt ou Préventif"}]}\n6-8 alertes basées sur le kilométrage réel.` }],
      });
    } catch (e) {
      console.error("[ALERTS] modèle:", e.message);
      return json(502, { success: false, error: "Service d'alertes indisponible, réessayez." });
    }

    const parsed = safeJSON((completion.content || []).map((b) => b.text || "").join(""));
    if (!parsed || !Array.isArray(parsed.alertes)) return json(502, { success: false, error: "Réponse illisible, réessayez." });

    return json(200, { success: true, alertes: parsed.alertes, charged: gate.charged, unlimited: gate.unlimited });
  } catch (error) {
    console.error("[ALERTS]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
