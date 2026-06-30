// ============================================================
// NEXUS ORCHESTRATOR — Chef d'orchestre multi-IA (ADR-027)
// 30/06 : healthcheck 4 IAs (scaffold initial).
// 02/07 : Tier 1 (Haiku seul) + Tier 2 (Sonnet + Challenger
// Haiku) implémentés ci-dessous. Tier 3 (dual Sonnet+GPT) et
// Tier 4 (tribunal complet) restent à faire — NEXUS_ARCHITECTURE.md §4.
// dylan_agents.mjs reste le moteur d'enquête conversationnel
// (multi-tours) ; nexus_orchestrator produit un verdict validé
// à tier croissant pour un cas déjà formulé (codes + symptômes).
// Pas encore câblé au frontend — testable en direct uniquement.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight, isOwner, ensureDiagSession } from "../lib/auth.mjs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

// Modèles par IA (NEXUS_ARCHITECTURE.md §3, mis à jour 30/06 —
// gemini-1.5-flash et gpt-4o-mini sont périmés, voir LESSONS_LEARNED.md)
const MODEL_HAIKU = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MODEL_SONNET = process.env.ANTHROPIC_CONCLUSION_MODEL || "claude-sonnet-4-6";
const MODEL_OPENAI = "gpt-4.1-mini";
const MODEL_GEMINI = "gemini-2.5-flash-lite";
const MODEL_MISTRAL = "mistral-large-latest";

const TIMEOUT_MS = 8000; // 8s max par IA — limite fonction Netlify 10s

function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return Promise.resolve(fn(ctrl.signal)).finally(() => clearTimeout(timer));
}

async function pingClaude(signal) {
  const r = await anthropic.messages.create(
    { model: MODEL_HAIKU, max_tokens: 10, messages: [{ role: "user", content: "Réponds uniquement: OK" }] },
    { signal }
  );
  return r?.content?.[0]?.text?.trim() || null;
}

async function pingOpenAI(signal) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_OPENAI,
      messages: [{ role: "user", content: "Réponds uniquement: OK" }],
      max_tokens: 10,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

async function pingGemini(signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_GEMINI}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": process.env.GOOGLE_GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Réponds uniquement: OK" }] }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function pingMistral(signal) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_MISTRAL,
      messages: [{ role: "user", content: "Réponds uniquement: OK" }],
      max_tokens: 10,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || data?.error?.message || `HTTP ${r.status}`);
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

// Vérifie que les 4 IAs répondent réellement. Coûte de vrais tokens
// (minimes) donc réservé au owner. GET /nexus_orchestrator?ping=1
async function runHealthCheck() {
  const checks = [
    ["claude", pingClaude],
    ["openai", pingOpenAI],
    ["gemini", pingGemini],
    ["mistral", pingMistral],
  ];

  const settled = await Promise.allSettled(
    checks.map(([name, fn]) =>
      withTimeout(fn, TIMEOUT_MS).then((reply) => ({ name, ok: true, reply }))
    )
  );

  const out = {};
  settled.forEach((r, i) => {
    const name = checks[i][0];
    out[name] = r.status === "fulfilled" ? r.value : { name, ok: false, error: r.reason?.message || String(r.reason) };
  });
  return out;
}

// ──────────────────────────────────────────────────────────────
// TIER 1+2 — Dispatch fast path (Haiku seul / Sonnet + Challenger)
// Prompts repris tels quels de NEXUS_ARCHITECTURE.md §3.
// ──────────────────────────────────────────────────────────────

const DIAGNOSIS_TIMEOUT_MS = 15000;
const CHALLENGER_TIMEOUT_MS = 7000; // 15s+7s=22s — donnees reelles 30/06: budget 9s+4s encore insuffisant (4/13 diagnostic timeout, majorite challenger timeout). Plafond Pro confirme 26s actif (appels a 13.4s reussis avec le budget precedent).

const NEXUS_SYSTEM_PROMPT = `Tu es Dylan, expert automobile certifié. Analyse avec rigueur causale.
Priorise la sécurité conducteur. Indique toujours si on peut rouler et jusqu'à quand.
Fourchette coût obligatoire dans la première réponse.

Réponds UNIQUEMENT en JSON valide, sans texte autour, au format exact :
{
  "cause_principale": "diagnostic le plus probable, 1-2 phrases",
  "hypotheses_alternatives": ["autre cause possible 1", "autre cause possible 2"],
  "peut_rouler": "oui" | "non" | "avec précaution",
  "jusqu_quand": "ex: quelques jours, ne pas dépasser 50km, immédiat...",
  "cout_estime_min": <nombre EUR ou null>,
  "cout_estime_max": <nombre EUR ou null>,
  "urgence": "haute" | "moyenne" | "basse",
  "confidence": "haute" | "moyenne" | "basse"
}`;

const CHALLENGER_SYSTEM_PROMPT = `Tu es l'avocat du diable. Tu ne sais pas qui a produit ce diagnostic.
Ton seul travail : trouver pourquoi il est faux. Causes alternatives, hypothèses manquantes,
données contradictoires. Si tu ne trouves rien, dis-le clairement.

Réponds UNIQUEMENT en JSON valide, au format exact :
{
  "vulnerability_score": <0-100>,
  "failles": "explication des failles trouvées, ou aucune faille majeure identifiée"
}`;

function parseModelJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = (text || "").match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fallthrough */ }
    }
    return null;
  }
}

function buildCaseDescription({ dtcCodes, symptoms, make, model, year, fuel, mileage }) {
  const vehicule = [year, make, model, fuel].filter(Boolean).join(" ") || "véhicule non précisé";
  const codes = dtcCodes && dtcCodes.length ? dtcCodes.join(", ") : "aucun code DTC fourni";
  const km = mileage ? `${mileage} km` : "kilométrage non précisé";
  const symp = symptoms && symptoms.trim() ? symptoms.trim() : "aucun symptôme décrit en plus des codes";
  return `Véhicule : ${vehicule} (${km}). Codes DTC : ${codes}. Symptômes décrits : ${symp}`;
}

// Heuristique v1 — cohérente avec les résultats battery test dylan_agents.mjs
// (codes DTC clairs = fiables, symptômes seuls = besoin de Sonnet). À affiner
// via nexus_weights une fois du volume réel observé.
function decideTier({ dtcCodes, symptoms }) {
  const hasExactlyOneCode = Array.isArray(dtcCodes) && dtcCodes.length === 1;
  const hasSymptomText = !!(symptoms && symptoms.trim().length > 0);
  if (hasExactlyOneCode && !hasSymptomText) {
    return { tier: 1, reason: "1 seul code DTC, aucun symptôme texte additionnel — cas simple" };
  }
  if (hasExactlyOneCode) {
    return { tier: 2, reason: "code DTC + symptômes texte — nuance au-delà d'un code seul" };
  }
  return { tier: 2, reason: "0 ou plusieurs codes DTC, ou symptômes sans code — nécessite Sonnet" };
}

async function runDiagnosis(modelToUse, caseDescription, signal) {
  const r = await anthropic.messages.create(
    {
      model: modelToUse,
      max_tokens: 700,
      system: NEXUS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: caseDescription }],
    },
    { signal }
  );
  return parseModelJSON(r?.content?.[0]?.text || "");
}

async function runChallenger(caseDescription, diagnosis, signal) {
  const input = `Cas : ${caseDescription}\n\nDiagnostic à challenger : ${JSON.stringify(diagnosis)}`;
  const r = await anthropic.messages.create(
    {
      model: MODEL_HAIKU,
      max_tokens: 300,
      system: CHALLENGER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
    },
    { signal }
  );
  return parseModelJSON(r?.content?.[0]?.text || "");
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod === "GET" && event.queryStringParameters?.ping) {
    const auth = await getUser(event);
    if (!isOwner(auth)) return json(403, { error: "forbidden" });
    const results = await runHealthCheck();
    const allOk = Object.values(results).every((r) => r.ok);
    return json(allOk ? 200 : 207, { allOk, results });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only (ou GET ?ping=1 pour le healthcheck owner)" });
  }

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Authentification requise" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON invalide" });
  }

  const dtcCodes = Array.isArray(body.dtcCodes) ? body.dtcCodes : (body.dtcCodes ? [body.dtcCodes] : []);
  const { symptoms, make, model, year, fuel, mileage } = body;

  if (!dtcCodes.length && (!symptoms || !symptoms.trim())) {
    return json(400, { error: "dtcCodes ou symptoms requis (au moins un des deux)" });
  }

  let session;
  try {
    session = await ensureDiagSession(auth.client, auth.userId);
  } catch (e) {
    console.error("[nexus_orchestrator] ensureDiagSession error:", e.message);
    return json(500, { error: "Erreur vérification session diagnostic" });
  }
  if (!session.allowed) {
    return json(402, { error: "Crédits insuffisants pour un diagnostic", balance: session.balance });
  }

  const caseDescription = buildCaseDescription({ dtcCodes, symptoms, make, model, year, fuel, mileage });
  const { tier, reason } = decideTier({ dtcCodes, symptoms });
  const modelToUse = tier === 1 ? MODEL_HAIKU : MODEL_SONNET;

  let diagnosis;
  try {
    diagnosis = await withTimeout((signal) => runDiagnosis(modelToUse, caseDescription, signal), DIAGNOSIS_TIMEOUT_MS);
  } catch (e) {
    const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
    console.error("[nexus_orchestrator] Diagnosis error:", isAbort ? "timeout" : e.message);
    return json(isAbort ? 504 : 502, { error: "Service de diagnostic temporairement indisponible" });
  }

  if (!diagnosis) {
    console.error("[nexus_orchestrator] Diagnosis JSON non parsable");
    return json(502, { error: "Réponse IA non structurée, réessaie" });
  }

  let challenger = { active: false, vulnerability_score: null, failles: null };
  let needsTier3Escalation = false;

  if (tier >= 2) {
    try {
      const chall = await withTimeout((signal) => runChallenger(caseDescription, diagnosis, signal), CHALLENGER_TIMEOUT_MS);
      if (chall) {
        challenger = {
          active: true,
          vulnerability_score: typeof chall.vulnerability_score === "number" ? chall.vulnerability_score : null,
          failles: chall.failles || null,
        };
        needsTier3Escalation = challenger.vulnerability_score !== null && challenger.vulnerability_score > 50;
      }
    } catch (e) {
      const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
      console.error("[nexus_orchestrator] Challenger error (non bloquant):", isAbort ? "timeout" : e.message);
    }
  }

  return json(200, {
    tier,
    tier_reason: reason,
    diagnosis,
    challenger,
    needs_tier3_escalation: needsTier3Escalation,
    model_used: modelToUse,
    session_charged: !!session.charged,
    unlimited: !!session.unlimited,
    queried_at: new Date().toISOString(),
  });
}
