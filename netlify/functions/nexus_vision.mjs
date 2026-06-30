// nexus_vision.mjs — NEXUS Vision (ADR-027 extension)
// Analyse photo véhicule via GPT-4o Vision.
// Identifie : codes OBD visibles, pièces endommagées, fuites, usure.
// Retourne diagnostic structuré compatible nexus_orchestrator.
// Auth requise. Pas de débit crédit — complémentaire au diagnostic.
// ============================================================

import { getUser, json, preflight } from "../lib/auth.mjs";

const MODEL_VISION = "gpt-4o";
const VISION_TIMEOUT_MS = 20000;

const VISION_SYSTEM_PROMPT = `Tu es un expert automobile qui analyse des photos de véhicules pour détecter des pannes, codes d'erreur et anomalies.

Tu reçois une photo envoyée par un conducteur. Analyse-la avec rigueur et réponds UNIQUEMENT en JSON valide, sans texte autour :

{
  "image_type": "tableau_de_bord" | "moteur" | "piece" | "code_obd_ecran" | "document_papier" | "autre",
  "codes_obd_detectes": ["P0401"],
  "pieces_visibles": ["vanne EGR", "courroie"],
  "anomalies_visuelles": ["fuite huile côté bas moteur"],
  "urgence": "immédiat" | "haute" | "moyenne" | "basse" | "aucune",
  "peut_rouler": "oui" | "non" | "avec précaution",
  "diagnostic_preliminaire": "1-2 phrases basées sur ce qui est visible",
  "hypotheses": ["cause 1", "cause 2"],
  "controles_suggeres": ["action à faire"],
  "cout_estime_min": null,
  "cout_estime_max": null,
  "confidence_visuelle": "haute" | "moyenne" | "basse",
  "note": "limitations de la photo"
}

RÈGLES STRICTES :
- Codes OBD : format P/B/C/U + 4 chiffres uniquement. Retourne seulement les codes CLAIREMENT lisibles.
- Si la photo est floue ou ne montre rien de pertinent : confidence_visuelle = "basse".
- Ne jamais inventer une pièce ou un code non visible.
- urgence "immédiat" UNIQUEMENT si danger réel visible (feu, fumée, rupture).
- Si tu vois un écran OBD : lis TOUS les codes affichés avec précision.`;

async function analyzeWithGPTVision(imageBase64, mimeType, caseContext, signal) {
  const userContent = [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" } },
    { type: "text", text: caseContext
      ? `Contexte : ${caseContext}\n\nAnalyse cette photo.`
      : "Analyse cette photo de véhicule et identifie tout ce qui concerne une panne potentielle." },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL_VISION, max_tokens: 900,
      messages: [{ role: "system", content: VISION_SYSTEM_PROMPT }, { role: "user", content: userContent }],
      response_format: { type: "json_object" },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
  const text = data?.choices?.[0]?.message?.content || "";
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Réponse vision non parsable");
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }
  const { image, mimeType = "image/jpeg", vehicle, dtcCodes, symptoms } = body;
  if (!image || typeof image !== "string" || image.length < 100) return json(400, { error: "image (base64) requise" });
  if (image.length > 6_000_000) return json(413, { error: "Image trop grande (max ~3MB)" });
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mimeType)) return json(400, { error: "Format image non supporté (jpeg/png/webp)" });
  const veh = vehicle || {};
  const caseContext = [
    veh.make && veh.model ? `${veh.make} ${veh.model}` : null,
    veh.year ? String(veh.year) : null,
    veh.fuel || null,
    veh.mileage_km ? `${veh.mileage_km} km` : null,
    dtcCodes?.length ? `codes : ${dtcCodes.join(", ")}` : null,
    symptoms || null,
  ].filter(Boolean).join(" · ") || null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  const startTs = Date.now();
  let analysis;
  try {
    analysis = await analyzeWithGPTVision(image, mimeType, caseContext, ctrl.signal);
  } catch (e) {
    const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
    console.error("[nexus_vision] error:", isAbort ? "timeout" : e.message);
    return json(isAbort ? 504 : 502, { error: isAbort ? "Analyse photo lente — réessaie avec image plus petite" : "Service vision indisponible" });
  } finally { clearTimeout(timer); }
  const elapsed = Date.now() - startTs;
  console.log(`[nexus_vision] elapsed=${elapsed}ms confidence=${analysis?.confidence_visuelle} codes=${(analysis?.codes_obd_detectes || []).length}`);
  return json(200, {
    success: true, analysis,
    codes_detected: analysis?.codes_obd_detectes || [],
    urgency: analysis?.urgence || "basse",
    can_drive: analysis?.peut_rouler || "oui",
    ready_for_orchestrator: !!((analysis?.codes_obd_detectes || []).length > 0 || (analysis?.anomalies_visuelles || []).length > 0),
    model_used: MODEL_VISION, elapsed_ms: elapsed, queried_at: new Date().toISOString(),
  });
}
