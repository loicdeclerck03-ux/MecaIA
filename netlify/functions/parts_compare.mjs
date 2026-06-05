// PARTS_COMPARE — comparatif de pièces (auth + débite 1 jeton, gratuit si pass illimité)
import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

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
    const { part_name, vehicle, vehicle_marque, vehicle_modele } = JSON.parse(event.body || "{}");
    if (!part_name) return json(400, { error: "part_name requis" });

    // Débit : 1 jeton (gratuit si pass illimité)
    const { data: cons, error: cErr } = await supabase.rpc("consume_parts_comparison", { p_user_id: auth.userId });
    if (cErr) throw cErr;
    const c = cons && cons[0];
    if (!c || !c.success) {
      return json(402, { success: false, code: "insufficient_credits", message: "Crédits insuffisants.", remaining_balance: c ? c.remaining_balance : 0 });
    }

    const veh = vehicle || [vehicle_marque, vehicle_modele].filter(Boolean).join(" ");
    const system = "Expert pièces automobiles. Références aussi précises que possible. Réponds STRICTEMENT en JSON valide sans markdown.";
    const prompt = `Véhicule: ${veh}\nPièce: ${part_name}\nJSON:\n{"pieces":[{"nom":"nom exact","marque":"NGK/Bosch/Valeo/Febi/LuK/Sachs/SKF/Brembo...","reference":"réf précise","ref_origine":"réf constructeur","prix_min":15,"prix_max":45,"compatibilite":"note précise","qualite":"OEM ou Aftermarket ou Origine","conseil":"conseil montage","urgence":"Immédiat ou Sous 1000km ou Entretien normal"}]}\n3-4 pièces de qualités différentes.`;

    let completion;
    try {
      completion = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: prompt }] });
    } catch (e) {
      console.error("[PARTS] modèle:", e.message);
      return json(502, { success: false, error: "Service de comparatif indisponible, réessayez." });
    }

    const parsed = safeJSON((completion.content || []).map((b) => b.text || "").join(""));
    if (!parsed || !Array.isArray(parsed.pieces)) return json(502, { success: false, error: "Réponse illisible, réessayez." });

    return json(200, { success: true, pieces: parsed.pieces.slice(0, 6), remaining_balance: c.remaining_balance, unlimited: c.unlimited });
  } catch (error) {
    console.error("[PARTS]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
