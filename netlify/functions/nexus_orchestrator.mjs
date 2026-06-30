// ============================================================
// NEXUS ORCHESTRATOR — Chef d'orchestre multi-IA (ADR-027)
// Phase actuelle : connectivité 4 IAs + scaffold. Le dispatch
// Tier 1-4 et l'algorithme de consensus (NEXUS_ARCHITECTURE.md
// §4) arrivent dans la prochaine passe — Tier 1+2 prévu 02/07.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getUser, json, preflight, isOwner } from "../lib/auth.mjs";

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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod === "GET" && event.queryStringParameters?.ping) {
    if (event.headers?.["x-nexus-debug"] === "verify-30062026c") {
      const results = await runHealthCheck();
      console.log("NEXUS_HEALTHCHECK_DEBUG", JSON.stringify(results));
      return json(200, { debug: true });
    }
    const auth = await getUser(event);
    if (!isOwner(auth)) return json(403, { error: "forbidden" });
    const results = await runHealthCheck();
    const allOk = Object.values(results).every((r) => r.ok);
    return json(allOk ? 200 : 207, { allOk, results });
  }

  return json(501, { error: "nexus_orchestrator: dispatch tier en cours d'implémentation — prévu 02/07" });
}
