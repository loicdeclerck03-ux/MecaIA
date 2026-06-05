// ============================================================
// DYLAN — Diagnostic automobile (côté serveur, sécurisé)
//  • Auth obligatoire (JWT Supabase)
//  • Débit jetons : 1 session = 10 min (ou pass illimité)
//    -> ouvre/réutilise une session ; messages gratuits dans la fenêtre
//  • 1 appel Claude structuré (JSON) + parsing sécurisé
//  • Recherche de cas similaires par mots-clés (sans embeddings)
//  • Clé Anthropic lue depuis ANTHROPIC_KEY
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

// Parsing JSON robuste (retire les ``` et extrait le 1er objet).
function safeJSON(text) {
  if (!text) return null;
  let t = String(text).trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/,"").trim();
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
  const userId = auth.userId;
  const supabase = serviceClient();

  const startTime = Date.now();

  try {
    const { user_input, vehicle_marque, vehicle_modele, vehicle_km, save } =
      JSON.parse(event.body || "{}");

    if (!user_input || String(user_input).trim().length < 3) {
      return json(400, { error: "user_input requis (décris le problème)" });
    }
    if (String(user_input).length > 4000) {
      return json(400, { error: "user_input trop long (max 4000 caractères)" });
    }

    // ---- 1) Jetons : session active ? sinon en ouvrir une (débit) ----
    let charged = false;
    let sessionExpiresAt = null;
    let usedUnlimited = false;

    const { data: act } = await supabase.rpc("has_active_diagnostic_session", { p_user_id: userId });
    const active = act && act[0];

    if (active && active.active) {
      sessionExpiresAt = active.expires_at; // fenêtre 10 min en cours -> gratuit
    } else {
      const { data: started, error: sErr } = await supabase.rpc("start_diagnostic_session", { p_user_id: userId });
      if (sErr) throw sErr;
      const s = started && started[0];
      if (!s || !s.success) {
        return json(402, {
          success: false,
          code: "insufficient_credits",
          message: "Crédits insuffisants. Achetez des jetons ou activez le pass illimité.",
          remaining_balance: s ? s.remaining_balance : 0,
        });
      }
      charged = !s.unlimited;     // un pass illimité ne débite pas
      usedUnlimited = s.unlimited;
      sessionExpiresAt = s.expires_at;
    }

    // ---- 2) Cas similaires (recherche mots-clés, sans embeddings) ----
    let similar = [];
    try {
      const { data: cases } = await supabase.rpc("search_diagnostic_cases_text", {
        p_marque: vehicle_marque || "",
        p_modele: vehicle_modele || "",
        p_query: user_input,
        p_limit: 8,
      });
      similar = cases || [];
    } catch (e) {
      console.error("[DYLAN] recherche cas:", e.message); // dégradation silencieuse
    }

    const context = similar.length
      ? similar.map((c) => `- ${c.primary_diagnosis} (confiance ${c.confidence_percent ?? "?"}%, coût ${c.estimated_cost_min ?? "?"}-${c.estimated_cost_max ?? "?"}€)`).join("\n")
      : "Aucun cas similaire en base.";

    // ---- 3) Un seul appel Claude, sortie JSON stricte ----
    const system = `Tu es Dylan, expert mécanicien automobile. À partir des informations, produis un diagnostic.
Cas similaires connus (base interne) :
${context}

Réponds STRICTEMENT en JSON valide, sans texte autour, avec EXACTEMENT ces clés :
{
  "primary_diagnosis": string,
  "hypotheses": [{"diagnosis": string, "probability": number}],
  "confidence_percent": number,
  "urgency": "immédiat" | "bientôt" | "préventif",
  "can_drive": boolean,
  "estimated_cost_min": number,
  "estimated_cost_max": number,
  "parts_needed": [string],
  "clarify_question": string
}
Si la confiance est < 70%, mets une question utile dans "clarify_question", sinon "".`;

    const vehicleLine = [vehicle_marque, vehicle_modele, vehicle_km ? `${vehicle_km} km` : null]
      .filter(Boolean).join(" ");

    let completion;
    try {
      completion = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: `Véhicule: ${vehicleLine || "non précisé"}\nProblème: ${user_input}` }],
      });
    } catch (e) {
      console.error("[DYLAN] appel modèle:", e.message);
      return json(502, { success: false, error: "Service de diagnostic indisponible, réessayez." });
    }

    const text = (completion.content || []).map((b) => b.text || "").join("");
    const parsed = safeJSON(text);
    if (!parsed || !parsed.primary_diagnosis) {
      return json(502, { success: false, error: "Réponse de diagnostic illisible, réessayez." });
    }

    const result = {
      success: true,
      primary_diagnosis: parsed.primary_diagnosis,
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.slice(0, 3) : [],
      confidence_percent: Number(parsed.confidence_percent) || 0,
      urgency: parsed.urgency || "bientôt",
      can_drive: parsed.can_drive !== false,
      estimated_cost_min: Number(parsed.estimated_cost_min) || 0,
      estimated_cost_max: Number(parsed.estimated_cost_max) || 0,
      parts_needed: Array.isArray(parsed.parts_needed) ? parsed.parts_needed : [],
      clarify_question: parsed.clarify_question || "",
      session: { expires_at: sessionExpiresAt, charged, unlimited: usedUnlimited },
      metadata: { elapsed_ms: Date.now() - startTime, model: MODEL, rag_cases_found: similar.length },
    };

    // ---- 4) Sauvegarde best-effort pour accumulation (sans embedding) ----
    if (save !== false && vehicle_marque) {
      try {
        await supabase.from("diagnostic_cases").insert([{
          user_id: userId,
          vehicle_marque,
          vehicle_modele: vehicle_modele || null,
          vehicle_km: vehicle_km || null,
          primary_diagnosis: result.primary_diagnosis,
          confidence_percent: result.confidence_percent,
          urgency: result.urgency,
          can_drive: result.can_drive,
          estimated_cost_min: result.estimated_cost_min,
          estimated_cost_max: result.estimated_cost_max,
          parts_needed: result.parts_needed,
          created_at: new Date().toISOString(),
        }]);
      } catch (e) {
        console.error("[DYLAN] sauvegarde cas (non bloquant):", e.message);
      }
    }

    return json(200, result);
  } catch (error) {
    console.error("[DYLAN] erreur:", error.message);
    return json(500, { success: false, error: error.message });
  }
};
