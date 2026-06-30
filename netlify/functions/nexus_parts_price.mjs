// netlify/functions/nexus_parts_price.mjs
// NEXUS — Prix pièces live via recherche web OpenAI (gpt-4.1-mini)
// Roadmap NEXUS — étape P0 01/07/2026 (cf STATUS.md / NEXUS_ARCHITECTURE.md)
//
// Entrée  : POST { partName, make?, model?, year?, fuel?, country? }
// Sortie  : { part_name, vehicle, currency, price_min, price_max,
//             price_oem_estimate, price_aftermarket_estimate,
//             sources[], notes, confidence, queried_at, model }
//
// Distinct de parts_search.mjs : parts_search génère des termes/liens de
// recherche (Haiku, pas de prix réel) ; nexus_parts_price tente une
// estimation de prix réelle via web search OpenAI. Complémentaires, pas
// redondants — à brancher ensemble côté UI quand le tier dispatch existe.
//
// Auth/coût : même politique que parts_search.mjs — getUser() requis,
// PAS de débit de crédit/session (pas de ensureDiagSession ici). Cohérent
// avec l'existant, à revisiter ensemble si le volume réel le justifie.

import { getUser, json, preflight } from "../lib/auth.mjs";

const OPENAI_MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 8000; // 8s max — limite fonction Netlify 10s (même valeur que nexus_orchestrator.mjs)

function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return Promise.resolve(fn(ctrl.signal)).finally(() => clearTimeout(timer));
}

// Extraction défensive : le modèle peut entourer le JSON de ```json ... ```
// ou ajouter du texte avant/après malgré la consigne stricte du prompt.
function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildPrompt(partName, vehicleDesc, market) {
  return `Tu es un assistant de recherche de prix de pièces automobiles pour le marché ${market}.
Cherche le prix actuel de la pièce suivante : "${partName}" pour un véhicule ${vehicleDesc}.
Base-toi sur des sources réelles (sites de vente de pièces type Oscaro, Autodoc, Mister-Auto, sites concessionnaires, ou équivalents belges/français).

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, au format EXACT suivant :
{
  "part_name": "nom normalisé de la pièce",
  "vehicle": "${vehicleDesc}",
  "currency": "EUR",
  "price_min": <nombre ou null>,
  "price_max": <nombre ou null>,
  "price_oem_estimate": <nombre ou null>,
  "price_aftermarket_estimate": <nombre ou null>,
  "sources": ["nom du site 1", "nom du site 2"],
  "notes": "courte note (qualité OEM vs aftermarket, variations selon finition/motorisation)",
  "confidence": "haute" | "moyenne" | "basse"
}

Si aucune information fiable n'est trouvée, mets price_min et price_max à null et confidence à "basse". Ne JAMAIS inventer un prix si la recherche ne retourne rien d'exploitable.`;
}

async function fetchPriceFromOpenAI(prompt, locationCountry, signal) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [
        {
          type: "web_search_preview",
          user_location: { type: "approximate", country: locationCountry },
        },
      ],
      input: prompt,
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);

  return data.output_text || (Array.isArray(data.output)
    ? data.output
        .filter((item) => item.type === "message")
        .flatMap((item) => (item.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
        .join("\n")
    : "");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON invalide" });
  }

  const { partName, make, model, year, fuel, country } = body;

  if (!partName || typeof partName !== "string" || !partName.trim()) {
    return json(400, { error: "partName requis" });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("[nexus_parts_price] OPENAI_API_KEY manquante en environnement");
    return json(500, { error: "Configuration serveur incomplète" });
  }

  const vehicleDesc = [make, model, year, fuel].filter(Boolean).join(" ") || "véhicule non précisé";
  const market = country === "France" ? "France" : "Belgique";
  const locationCountry = market === "France" ? "FR" : "BE";
  const prompt = buildPrompt(partName.trim(), vehicleDesc, market);

  let outputText;
  try {
    outputText = await withTimeout((signal) => fetchPriceFromOpenAI(prompt, locationCountry, signal), TIMEOUT_MS);
  } catch (e) {
    const isAbort = e.name === "AbortError";
    console.error("[nexus_parts_price] OpenAI:", isAbort ? "timeout" : e.message);
    return json(isAbort ? 504 : 502, {
      error: isAbort ? "Recherche de prix trop longue, réessaie" : "Service de prix temporairement indisponible",
    });
  }

  const parsed = extractJSON(outputText);

  if (!parsed) {
    console.error("[nexus_parts_price] Parsing JSON échoué, sortie brute:", outputText.slice(0, 500));
    return json(200, {
      part_name: partName.trim(),
      vehicle: vehicleDesc,
      currency: "EUR",
      price_min: null,
      price_max: null,
      price_oem_estimate: null,
      price_aftermarket_estimate: null,
      sources: [],
      notes: "Réponse IA non structurée — nouvelle tentative recommandée.",
      confidence: "basse",
      raw_fallback: true,
      queried_at: new Date().toISOString(),
      model: OPENAI_MODEL,
    });
  }

  return json(200, {
    ...parsed,
    queried_at: new Date().toISOString(),
    model: OPENAI_MODEL,
  });
};
