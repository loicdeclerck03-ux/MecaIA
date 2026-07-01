// ============================================================
// NEXUS ORCHESTRATOR — Chef d'orchestre multi-IA (ADR-027)
// 30/06 : Tier 1 (Haiku seul) + Tier 2 (Sonnet + Challenger) +
// Tier 3 (Sonnet ‖ GPT web search) + Tier 4 (tribunal complet
// Sonnet ‖ GPT ‖ Gemini ‖ Mistral) tous implementes. Consensus/
// challenge generalise (2 ou 4 avis) en un seul appel Haiku.
// Tier 3/4 = appel explicite (body.forceTier:3|4) uniquement,
// jamais chaine automatiquement depuis un tier inferieur dans la
// meme requete HTTP (depasserait le plafond Netlify) — voir
// needs_tier3_escalation / needs_human_escalation.
// dylan_agents.mjs reste le moteur d'enquête conversationnel
// (multi-tours) ; nexus_orchestrator produit un verdict validé
// à tier croissant pour un cas déjà formulé (codes + symptômes).
// Pas encore câblé au frontend — testable en direct uniquement.
// Tier 5 (escalade mécanicien humain) reste a faire.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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

const DIAGNOSIS_TIMEOUT_MS = 14000;
const CHALLENGER_TIMEOUT_MS = 10000; // 14s+10s=24s — donnees reelles 30/06: 13/13 cas ont depasse 7s pour le challenger (pas seulement les cas complexes), confirme via debug temporaire que c'est un vrai timeout (APIUserAbortError) et non un echec de parsing. Reste sous le plafond Pro 26s.

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
}
Barème pour vulnerability_score — utilise toute l'échelle, ne réponds JAMAIS une valeur par défaut :
0-20 = diagnostic solide, bien étayé par les données. 21-45 = zones d'ombre mineures sans gravité.
46-70 = lacune réelle qui mérite vérification avant d'agir. 71-100 = diagnostic probablement incomplet ou risqué.`;

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
      max_tokens: 600,
      system: CHALLENGER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
    },
    { signal }
  );
  const text = r?.content?.[0]?.text || "";
  const parsed = parseModelJSON(text);
  if (!parsed) {
    console.error("[nexus_orchestrator] Challenger JSON non parsable. stop_reason:", r?.stop_reason, "extrait:", text.slice(0, 300));
  }
  return parsed;
}

const GPT_DIAGNOSIS_TIMEOUT_MS = 15000; // web search peut etre plus lent qu'un appel texte simple (lecon nexus_parts_price)
const CONSENSUS_TIMEOUT_MS = 9000; // 1 seul appel Haiku qui fait consensus + challenge combines (lecon Tier2: separer les deux aurait depasse le plafond 26s)
// Tier 3 pire cas: max(14000 sonnet, 15000 gpt) + 9000 = 24000ms, sous le plafond Pro 26s — a valider empiriquement comme Tier 2

const CONSENSUS_SYSTEM_PROMPT = `Tu es un juge impartial qui évalue deux diagnostics automobiles indépendants pour le même cas, produits par deux IA différentes (tu ne sais pas lesquelles, évite tout biais d'autorité).
Ton travail a deux volets :
1. Détermine si les deux diagnostics s'accordent sur la cause principale (même cause, ou causes clairement liées) ou divergent clairement.
2. Identifie les failles ou angles morts — hypothèses manquantes, données contradictoires, conclusions trop hâtives — dans le ou les diagnostics disponibles.

Si un seul diagnostic est disponible (l'autre IA a échoué), évalue celui-ci seul comme le ferait un avocat du diable classique.

Réponds UNIQUEMENT en JSON valide, sans texte autour, au format exact :
{
  "consensus": "accord" | "accord_partiel" | "divergence" | "un_seul_avis",
  "cause_retenue": "la cause la plus probable en tenant compte du ou des avis disponibles, 1-2 phrases",
  "vulnerability_score": <0-100>,
  "failles": "explication des failles ou angles morts trouvés, ou 'aucune faille majeure identifiée'"
}
Barème pour vulnerability_score — utilise toute l'échelle, ne réponds JAMAIS une valeur par défaut :
0-20 = diagnostic(s) solide(s), bien étayé(s). 21-45 = zones d'ombre mineures sans gravité.
46-70 = lacune réelle qui mérite vérification avant d'agir. 71-100 = diagnostic(s) probablement incomplet(s) ou risqué(s).`;

async function runGPTDiagnosis(caseDescription, signal) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_OPENAI,
      tools: [{ type: "web_search_preview" }],
      input: `${NEXUS_SYSTEM_PROMPT}\n\nUtilise la recherche web si utile pour vérifier des bulletins constructeur (TSB), rappels, ou retours d'expérience connus pour ce véhicule et ce symptôme avant de répondre.\n\n${caseDescription}`,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  const outputText = data.output_text || (Array.isArray(data.output)
    ? data.output
        .filter((item) => item.type === "message")
        .flatMap((item) => (item.content || []).filter((c) => c.type === "output_text").map((c) => c.text))
        .join("\n")
    : "");
  return parseModelJSON(outputText);
}

// ──────────────────────────────────────────────────────────────
// Consensus generalise — accepte 2 (Tier3) ou 4 (Tier4) diagnostics.
// ──────────────────────────────────────────────────────────────

function buildConsensusInput(caseDescription, diagnoses) {
  const lines = diagnoses.map(
    ({ label, diagnosis }) => `Diagnostic ${label} : ${diagnosis ? JSON.stringify(diagnosis) : "indisponible (timeout ou erreur)"}`
  );
  return `Cas : ${caseDescription}\n\n${lines.join("\n\n")}`;
}

async function runConsensus(caseDescription, diagnoses, maxTokens, signal) {
  const r = await anthropic.messages.create(
    {
      model: MODEL_HAIKU,
      max_tokens: maxTokens,
      system: CONSENSUS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildConsensusInput(caseDescription, diagnoses) }],
    },
    { signal }
  );
  const text = r?.content?.[0]?.text || "";
  const parsed = parseModelJSON(text);
  if (!parsed) {
    console.error("[nexus_orchestrator] Consensus JSON non parsable. stop_reason:", r?.stop_reason, "extrait:", text.slice(0, 300));
  }
  return parsed;
}

// ──────────────────────────────────────────────────────────────
// TIER 4 — Tribunal complet (Sonnet ‖ GPT ‖ Gemini ‖ Mistral)
// Gemini et Mistral n'avaient jamais ete testes sur une vraie tache
// de raisonnement (seulement ping healthcheck "reponds OK") — budgets
// ci-dessous sont une hypothese de depart a valider empiriquement,
// pas une certitude (meme demarche que Tier2/Tier3).
// ──────────────────────────────────────────────────────────────

const SONNET_T4_TIMEOUT_MS = 12000;
const GEMINI_DIAGNOSIS_TIMEOUT_MS = 12000;
const MISTRAL_DIAGNOSIS_TIMEOUT_MS = 12000;
const TIER4_CONSENSUS_TIMEOUT_MS = 10000;
// Pire cas: max(12000 sonnet, 15000 gpt, 12000 gemini, 12000 mistral) + 10000 = 25000ms, sous 26s — marge faible, a valider.

async function runGeminiDiagnosis(caseDescription, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_GEMINI}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": process.env.GOOGLE_GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${NEXUS_SYSTEM_PROMPT}\n\n${caseDescription}` }] }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseModelJSON(text);
}

async function runMistralDiagnosis(caseDescription, signal) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_MISTRAL,
      messages: [
        { role: "system", content: NEXUS_SYSTEM_PROMPT },
        { role: "user", content: caseDescription },
      ],
      max_tokens: 700,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || data?.error?.message || `HTTP ${r.status}`);
  const text = data?.choices?.[0]?.message?.content || "";
  return parseModelJSON(text);
}

// ──────────────────────────────────────────────────────────────
// Logging flywheel — fire-and-forget vers nexus_orchestrator_log.
// ──────────────────────────────────────────────────────────────
function getLogClient() {
  return createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
async function logToFlywheel(userId, diagSessionId, tier, caseDescription, dtcCodes, result, latencyMs) {
  try {
    const supa = getLogClient();
    const consensus = result?.consensus?.consensus || null;
    const diagFields = result?.diagnosis || {};
    await supa.from("nexus_orchestrator_log").insert({
      user_id: userId || null,
      diag_session_id: diagSessionId || null,
      tier,
      dtc_codes: Array.isArray(dtcCodes) ? dtcCodes : [],
      case_description: (caseDescription || "").substring(0, 500),
      consensus,
      vulnerability_score: result?.challenger?.vulnerability_score ?? null,
      ia_count: tier === 4 ? (result?.ia_disponibles ?? 1) : (tier === 3 ? 2 : 1),
      needs_escalation: !!(result?.needs_tier3_escalation || result?.needs_tier4_escalation || result?.needs_human_escalation),
      latency_ms: latencyMs,
      diagnosis_cause: (diagFields.cause_principale || "").substring(0, 300),
      urgence: diagFields.urgence || null,
      peut_rouler: diagFields.peut_rouler || null,
    });
  } catch (e) {
    console.error("[nexus_orchestrator] flywheel log error (non bloquant):", e.message);
  }
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

  // Tier 3/4 = demande explicite uniquement (escalade depuis needs_tier3_escalation /
  // needs_tier4_escalation d'un appel precedent, ou appel direct de test). Jamais
  // chaine automatiquement ici : ferait depasser le plafond Netlify dans la meme requete.
  const forceTier = body.forceTier === 4 ? 4 : body.forceTier === 3 ? 3 : null;
  const { tier, reason } = forceTier
    ? { tier: forceTier, reason: `Tier ${forceTier} demandé explicitement (escalade ou appel direct)` }
    : decideTier({ dtcCodes, symptoms });

  if (tier === 4) {
    const [sonnetR, gptR, geminiR, mistralR] = await Promise.allSettled([
      withTimeout((signal) => runDiagnosis(MODEL_SONNET, caseDescription, signal), SONNET_T4_TIMEOUT_MS),
      withTimeout((signal) => runGPTDiagnosis(caseDescription, signal), GPT_DIAGNOSIS_TIMEOUT_MS),
      withTimeout((signal) => runGeminiDiagnosis(caseDescription, signal), GEMINI_DIAGNOSIS_TIMEOUT_MS),
      withTimeout((signal) => runMistralDiagnosis(caseDescription, signal), MISTRAL_DIAGNOSIS_TIMEOUT_MS),
    ]);

    const diagSonnet = sonnetR.status === "fulfilled" ? sonnetR.value : null;
    const diagGPT = gptR.status === "fulfilled" ? gptR.value : null;
    const diagGemini = geminiR.status === "fulfilled" ? geminiR.value : null;
    const diagMistral = mistralR.status === "fulfilled" ? mistralR.value : null;

    [["Sonnet", sonnetR], ["GPT", gptR], ["Gemini", geminiR], ["Mistral", mistralR]].forEach(([name, r]) => {
      if (r.status === "rejected") {
        console.error(`[nexus_orchestrator] Tier4 ${name} echec:`, r.reason?.message || r.reason);
      }
    });

    const availableDiagnoses = [
      { label: "A (Claude Sonnet)", diagnosis: diagSonnet },
      { label: "B (GPT avec recherche web)", diagnosis: diagGPT },
      { label: "C (Gemini)", diagnosis: diagGemini },
      { label: "D (Mistral)", diagnosis: diagMistral },
    ];
    const successfulCount = availableDiagnoses.filter((d) => d.diagnosis).length;

    if (successfulCount === 0) {
      return json(502, { error: "Service de diagnostic temporairement indisponible (les 4 IAs ont échoué)" });
    }

    let consensus = null;
    try {
      consensus = await withTimeout((signal) => runConsensus(caseDescription, availableDiagnoses, 800, signal), TIER4_CONSENSUS_TIMEOUT_MS);
    } catch (e) {
      const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
      console.error("[nexus_orchestrator] Tier4 Consensus error (non bloquant):", isAbort ? "timeout" : e.message);
    }

    const needsHumanEscalation = !!(
      consensus &&
      (consensus.consensus === "divergence" ||
        (typeof consensus.vulnerability_score === "number" && consensus.vulnerability_score > 50))
    );

    return json(200, {
      tier: 4,
      tier_reason: reason,
      diagnosis: diagSonnet || diagGPT || diagGemini || diagMistral,
      diagnosis_sonnet: diagSonnet,
      diagnosis_gpt: diagGPT,
      diagnosis_gemini: diagGemini,
      diagnosis_mistral: diagMistral,
      ia_disponibles: successfulCount,
      consensus,
      challenger: {
        active: !!consensus,
        vulnerability_score: consensus?.vulnerability_score ?? null,
        failles: consensus?.failles ?? null,
      },
      needs_human_escalation: needsHumanEscalation,
      session_charged: !!session.charged,
      unlimited: !!session.unlimited,
      queried_at: new Date().toISOString(),
    });
  }

  if (tier === 3) {
    const [sonnetResult, gptResult] = await Promise.allSettled([
      withTimeout((signal) => runDiagnosis(MODEL_SONNET, caseDescription, signal), DIAGNOSIS_TIMEOUT_MS),
      withTimeout((signal) => runGPTDiagnosis(caseDescription, signal), GPT_DIAGNOSIS_TIMEOUT_MS),
    ]);

    const diagSonnet = sonnetResult.status === "fulfilled" ? sonnetResult.value : null;
    const diagGPT = gptResult.status === "fulfilled" ? gptResult.value : null;

    if (sonnetResult.status === "rejected") {
      console.error("[nexus_orchestrator] Tier3 Sonnet echec:", sonnetResult.reason?.message || sonnetResult.reason);
    }
    if (gptResult.status === "rejected") {
      console.error("[nexus_orchestrator] Tier3 GPT echec:", gptResult.reason?.message || gptResult.reason);
    }

    if (!diagSonnet && !diagGPT) {
      return json(502, { error: "Service de diagnostic temporairement indisponible (Sonnet et GPT ont échoué)" });
    }

    let consensus = null;
    try {
      consensus = await withTimeout(
        (signal) =>
          runConsensus(
            caseDescription,
            [
              { label: "A (Claude Sonnet)", diagnosis: diagSonnet },
              { label: "B (GPT avec recherche web)", diagnosis: diagGPT },
            ],
            600,
            signal
          ),
        CONSENSUS_TIMEOUT_MS
      );
    } catch (e) {
      const isAbort = e.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
      console.error("[nexus_orchestrator] Consensus error (non bloquant):", isAbort ? "timeout" : e.message);
    }

    const needsTier4Escalation = !!(
      consensus &&
      (consensus.consensus === "divergence" ||
        (typeof consensus.vulnerability_score === "number" && consensus.vulnerability_score > 50))
    );

    return json(200, {
      tier: 3,
      tier_reason: reason,
      diagnosis: diagSonnet || diagGPT,
      diagnosis_sonnet: diagSonnet,
      diagnosis_gpt: diagGPT,
      consensus,
      challenger: {
        active: !!consensus,
        vulnerability_score: consensus?.vulnerability_score ?? null,
        failles: consensus?.failles ?? null,
      },
      needs_tier4_escalation: needsTier4Escalation,
      session_charged: !!session.charged,
      unlimited: !!session.unlimited,
      queried_at: new Date().toISOString(),
    });
  }

  const _t1t2Start = Date.now();

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

  const t1t2Result = {
    tier, tier_reason: reason, diagnosis, challenger,
    needs_tier3_escalation: needsTier3Escalation,
    model_used: modelToUse,
    session_charged: !!session.charged, unlimited: !!session.unlimited,
    queried_at: new Date().toISOString(),
  };
  // Fire-and-forget flywheel log
  logToFlywheel(auth.userId, null, tier, caseDescription, dtcCodes, t1t2Result, Date.now() - _t1t2Start).catch(() => {});
  return json(200, t1t2Result);
}
