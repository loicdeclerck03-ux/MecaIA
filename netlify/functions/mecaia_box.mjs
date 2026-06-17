// ============================================================
// MECAIA_BOX.MJS — Endpoint dédié MecaIA Box (OBD2 + IA)
// Analyse les données OBD2 en temps réel avec Claude
// Supporte multi-turn conversation
// Auth: optionnelle — fonctionne avec ou sans compte connecté
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// Modèle — Sonnet pour une meilleure qualité d'analyse OBD2
const MODEL = process.env.ANTHROPIC_BOX_MODEL || process.env.ANTHROPIC_CONCLUSION_MODEL || "claude-haiku-4-5-20251001";

// ── Prompt système spécialisé OBD2 ──────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es Dylan, l'expert automobile IA de MecaIA Box. Tu lis les données OBD2 en direct du véhicule de l'utilisateur via un boitier de diagnostic connecté.

TON RÔLE :
- Analyser les données OBD2 fournies (codes défauts DTC, paramètres moteur PIDs, VIN)
- Expliquer clairement en langage simple ce que signifie chaque anomalie
- Donner les causes les plus probables et les solutions concrètes
- Indiquer l'urgence : 🟢 Peut rouler normalement / 🟡 À surveiller / 🟠 Éviter l'autoroute / 🔴 Ne pas rouler
- Estimer les coûts de réparation en euros (fourchette réaliste)
- Être précis, professionnel mais accessible à quelqu'un qui ne connait rien à la mécanique

FORMAT :
- Commence par un résumé clair de l'état général du véhicule
- Pour chaque code défaut, explique : ce que c'est → causes probables → solutions → coût estimé
- Si tout va bien, sois positif et rassurant
- Utilise des emojis pour la lisibilité (⚠️, ✅, 🔧, 💰, etc.)

RÈGLES :
- Ne jamais inventer des informations techniques non fiables
- Si tu ne connais pas un code précis, dis-le honnêtement
- Toujours mentionner de consulter un garage pour confirmation si c'est complexe
- Répondre en français sauf si l'utilisateur écrit dans une autre langue`;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  // Auth optionnelle (box peut fonctionner sans compte)
  const auth = await getUser(event);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const messages    = body.messages    || [];
  const customSystem = body.system      || null;
  const isOBD2Scan  = body.is_obd2_scan || false;

  if (!messages || messages.length === 0) {
    return json(400, { error: "messages requis" });
  }

  // Valider la structure des messages
  const validMessages = messages
    .filter(m => m && m.role && m.content && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

  if (validMessages.length === 0) {
    return json(400, { error: "Aucun message valide" });
  }

  const systemPrompt = customSystem || SYSTEM_PROMPT;

  try {
    console.log(`[MECAIA_BOX] ${auth?.userId || "anon"} | ${validMessages.length} messages | OBD2: ${isOBD2Scan}`);

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      system:     systemPrompt,
      messages:   validMessages,
    });

    const content = response.content?.[0]?.text || "Désolé, je n'ai pas pu analyser les données.";

    return json(200, {
      message:    content,
      model:      MODEL,
      stop_reason: response.stop_reason,
    });

  } catch (e) {
    console.error("[MECAIA_BOX] Erreur:", e.message);
    return json(502, { error: "Analyse temporairement indisponible", details: e.message });
  }
};
