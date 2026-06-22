// parts_search.mjs — Agent recherche pièces automobiles
// Coût optimisé : Haiku + prompt court + réponse JSON max 600 tokens

import Anthropic from "@anthropic-ai/sdk";
import { json, preflight, getUser } from "../lib/auth.mjs";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
});

// Prompt système minimal — chaque mot coûte
const SYSTEM = `Tu es un expert en pièces automobiles. Génère des termes de recherche précis et des liens utiles.
Réponds UNIQUEMENT en JSON valide, sans texte autour, sans backticks.
Format exact :
{"pieces":[{"nom":"nom exact pièce","ref_type":"type référence (OEM/aftermarket)","termes_autodoc":"termes pour autodoc.fr","termes_ebay":"termes pour ebay.fr","autodoc_url":"https://www.autodoc.fr/recherche?query=TERMES_URL_ENCODED","ebay_url":"https://www.ebay.fr/sch/i.html?_nkw=TERMES_URL_ENCODED","mister_url":"https://www.misterauto.com/recherche?query=TERMES_URL_ENCODED","conseil":"1 phrase max conseil achat"}],"resume":"résumé pièces en 1 phrase"}
Max 4 pièces. Termes de recherche = pièce + marque + modèle + année.`;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });

  try {
    const { marque, modele, annee, engine_code, pieces, language = "fr" } = JSON.parse(event.body || "{}");

    if (!pieces || !pieces.length) return json(400, { error: "pieces[] requis" });

    const veh = [annee, marque, modele, engine_code ? `(${engine_code})` : null].filter(Boolean).join(" ");
    const piecesStr = pieces.slice(0, 4).map(p => typeof p === "string" ? p : p.name || p).join(", ");

    const userMsg = `Véhicule: ${veh || "inconnu"}. Pièces recherchées: ${piecesStr}`;

    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const text = resp.content[0]?.text || "{}";
    // Parse JSON robuste
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { const m = text.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { pieces: [] }; }

    return json(200, {
      vehicule: veh,
      pieces: parsed.pieces || [],
      resume: parsed.resume || "",
      tokens: resp.usage?.input_tokens + resp.usage?.output_tokens,
    });
  } catch (e) {
    console.error("[PARTS]", e.message);
    return json(500, { error: e.message });
  }
};
