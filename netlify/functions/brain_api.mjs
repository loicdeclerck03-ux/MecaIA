// ============================================================
// BRAIN API — Cerveau projet MecaIA
// GET  ?token=xxx  → contexte complet JSON
// POST ?token=xxx  body={id, status} → màj task
// ============================================================

import { createClient } from "@supabase/supabase-js";

const BRAIN_TOKEN = process.env.BRAIN_TOKEN || "mecaia-brain-2026";

const getSupa = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET
);

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-brain-token",
};

async function safeCount(supa, table) {
  try {
    const { count } = await supa.from(table).select("*", { count: "exact", head: true });
    return count || 0;
  } catch { return 0; }
}

async function safeQuery(fn) {
  try { return await fn(); } catch { return null; }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const token = event.headers?.["x-brain-token"]
    || event.queryStringParameters?.token;
  if (token !== BRAIN_TOKEN) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const supa = getSupa();

  // ── POST : màj statut d'une tâche ────────────────────────
  if (event.httpMethod === "POST") {
    try {
      const { id, status } = JSON.parse(event.body || "{}");
      if (!id || !status) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "id + status requis" }) };
      }
      await supa.from("project_brain").update({ status }).eq("id", id);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── GET : lire tout le cerveau ────────────────────────────
  try {
    const now = new Date().toISOString();

    // Toutes les requêtes en parallèle avec gestion d'erreurs individuelles
    const [
      brainResult,
      usersTotal,
      sessionsTotal,
      sessions24h,
      betaRegs,
      nexusLogs,
    ] = await Promise.all([
      // Cerveau projet
      safeQuery(() => supa
        .from("project_brain")
        .select("id, category, title, priority, status, tags, content, updated_at")
        .neq("status", "archived")
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false })
        .then(r => r.data || [])
      ),
      // Métriques utilisateurs
      safeCount(supa, "user_profiles"),
      safeCount(supa, "diag_sessions"),
      // Sessions 24h
      safeQuery(() => supa
        .from("diag_sessions")
        .select("id", { count: "exact", head: true })
        .gte("cree_le", new Date(Date.now() - 86400000).toISOString())
        .then(r => r.count || 0)
      ),
      // Beta inscrits
      safeCount(supa, "beta_registrations"),
      // Logs NEXUS (50 derniers)
      safeQuery(() => supa
        .from("nexus_orchestrator_log")
        .select("tier_used, confidence_score, consensus_reached, created_at")
        .order("created_at", { ascending: false })
        .limit(50)
        .then(r => r.data || [])
      ),
    ]);

    const brain = brainResult || [];

    // Stats NEXUS
    const nexus = nexusLogs || [];
    const tierDist = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let confSum = 0, confCount = 0;
    for (const log of nexus) {
      const t = log.tier_used;
      if (t && tierDist[t] !== undefined) tierDist[t]++;
      if (log.confidence_score) { confSum += log.confidence_score; confCount++; }
    }
    const avgConf = confCount > 0 ? Math.round(confSum / confCount) : null;

    // Organiser brain par catégorie
    const byCategory = {};
    for (const item of brain) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    const tasks = byCategory["task"] || [];

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        generated_at: now,
        projet: {
          nom: "MecaIA",
          version: "3.0",
          url: "https://mecaiaauto.com",
          supabase: "vexxjbpbfrvgszvzpmgu",
          netlify: "b8c0a559-8e2c-4038-81c6-0c0de4914b0d",
          sentry_org: "loic-declerck",
          repo: "C:/Users/pasmoi/Documents/GitHub/MecaIA",
        },
        prod: {
          sentry_errors: 0,
          netlify_status: "ready",
          deploy_id: "7f51213c",
          fonctions: 48,
          tables_supabase: 65,
        },
        metriques: {
          users_total: usersTotal,
          sessions_total: sessionsTotal,
          sessions_24h: sessions24h || 0,
          beta_registrations: betaRegs,
          mrr_eur: 0,
          abonnes_payants: 0,
          nexus: {
            diagnostics_analyses: nexus.length,
            confidence_moyenne: avgConf,
            tier_distribution: tierDist,
          },
        },
        objectifs: {
          m6: { cible_eur: 250, date: "2027-01-01" },
          m12: { cible_eur: 700, date: "2027-07-01" },
        },
        tasks_p0: tasks.filter(t => t.priority === 0 && t.status === "active"),
        tasks_p1: tasks.filter(t => t.priority === 1 && t.status === "active"),
        tasks_p2: tasks.filter(t => t.priority === 2 && t.status === "active"),
        tasks_done: tasks.filter(t => t.status === "done").slice(0, 10),
        decisions: byCategory["decision"] || [],
        architecture: byCategory["arch"] || [],
        status: byCategory["status"] || [],
        alerts: (byCategory["alert"] || []).filter(a => a.status === "active"),
      }),
    };
  } catch (e) {
    console.error("[BRAIN_API] fatal:", e.message, e.stack);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
