// PHOTO_ANALYZE — analyse d'une photo (auth + session diagnostic 10 min)
import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight, ensureDiagSession } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const supabase = serviceClient();

  try {
    const { image_base64, media_type } = JSON.parse(event.body || "{}");
    if (!image_base64 || !media_type) return json(400, { error: "image_base64 et media_type requis" });

    const gate = await ensureDiagSession(supabase, auth.userId);
    if (!gate.allowed) {
      return json(402, { success: false, code: "insufficient_credits", message: "Crédits insuffisants.", remaining_balance: gate.balance });
    }

    let completion;
    try {
      completion = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: "Tu es un expert mécanicien automobile. Tu analyses des photos avec précision. Réponds en français.",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type, data: image_base64 } },
          { type: "text", text: "Analyse cette photo:\n1. Ce que tu vois précisément\n2. État de la pièce (bon/usé/défaillant)\n3. Problèmes ou défauts visibles\n4. Urgence: immédiat/bientôt/préventif\n5. Recommandations précises\n6. Pièces à commander si nécessaire" },
        ] }],
      });
    } catch (e) {
      console.error("[PHOTO] modèle:", e.message);
      return json(502, { success: false, error: "Service d'analyse photo indisponible, réessayez." });
    }

    const analysis = (completion.content || []).map((b) => b.text || "").join("");
    return json(200, { success: true, analysis, charged: gate.charged, unlimited: gate.unlimited });
  } catch (error) {
    console.error("[PHOTO]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
