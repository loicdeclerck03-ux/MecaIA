// ============================================================
// BRAIN API — Cerveau projet MecaIA
// Endpoint unique : lit project_brain + métriques + état prod
// Utilisé par : dashboard /brain + Claude au démarrage session
// GET  /.netlify/functions/brain_api          → contexte complet
// POST /.netlify/functions/brain_api          → mise à jour task
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  // Auth simple par token
  const token = event.headers?.["x-brain-token"] || event.queryStringParameters?.token;
  if (token !== BRAIN_TOKEN) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const supa = getSupa();

  // ── POST : mettre à jour le statut d'une tâche ────────────
  if (event.httpMethod === "POST") {
    try {
      const { id, status } = JSON.parse(event.body || "{}");
      if (!id || !status) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "id + status requis" }) };
      const { error } = await supa.from("project_brain").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
    } catch (e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── GET : lire tout le cerveau ────────────────────────────
  try {
    const now = new Date().toISOString();

    // Lancer toutes les requêtes en parallèle
    const [brainResult, metricsResult, nexusResult, errorsResult] = await Promise.all([

      // 1) Contenu project_brain (toutes catégories actives)
      supa.from("project_brain")
        .select("id, category, title, priority, status, tags, content, updated_at")
        .neq("status", "archived")
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false }),

      // 2) Métriques réelles Supabase
      supa.rpc("brain_get_metrics").catch(() => null),

      // 3) Logs NEXUS récents (derniers diagnostics)
      supa.from("nexus_orchestrator_log")
        .select("tier_used, confidence_score, created_at, consensus_reached")
        .order("created_at", { ascending: false })
        .limit(50)
        .catch(() => ({ data: [] })),

      // 4) Sessions diagnostic 24h
      supa.from("diag_sessions")
        .select("id, cree_le, enquete_etat")
        .gte("cree_le", new Date(Date.now() - 86400000).toISOString())
        .order("cree_le", { ascending: false })
        .limit(100)
        .catch(() => ({ data: [] })),
    ]);

    const brain = brainResult.data || [];

    // Calculer les métriques depuis les logs si RPC pas dispo
    const nexusLogs = nexusResult.data || [];
    const sessions24h = errorsResult.data || [];

    // Métriques directes Supabase
    const [usersCount, sessionsTotal, betaRegs] = await Promise.all([
      supa.from("user_profiles").select("id", { count: "exact", head: true }),
      supa.from("diag_sessions").select("id", { count: "exact", head: true }),
      supa.from("beta_registrations").select("id", { count: "exact", head: true }),
    ]);

    // Stats NEXUS
    const nexusTierDist = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let nexusConfTotal = 0, nexusCount = 0;
    for (const log of nexusLogs) {
      if (log.tier_used) nexusTierDist[log.tier_used] = (nexusTierDist[log.tier_used] || 0) + 1;
      if (log.confidence_score) { nexusConfTotal += log.confidence_score; nexusCount++; }
    }
    const nexusAvgConf = nexusCount > 0 ? Math.round(nexusConfTotal / nexusCount) : null;

    // Organiser le brain par catégorie
    const byCategory = {};
    for (const item of brain) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    // Construire la réponse complète
    const payload = {
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
        sentry_errors: 0,                          // mis à jour par le dashboard via Sentry API
        netlify_status: "ready",
        deploy_id: "6a455b17e088940008490ecc",
        fonctions: 47,
        tables_supabase: 65,
      },
      metriques: {
        users_total: usersCount.count || 0,
        sessions_total: sessionsTotal.count || 0,
        sessions_24h: sessions24h.length,
        beta_registrations: betaRegs.count || 0,
        mrr_eur: 0,                                // à mettre à jour quand abonnements actifs
        abonnes_payants: 0,
        nexus: {
          diagnostics_analyses: nexusLogs.length,
          confidence_moyenne: nexusAvgConf,
          tier_distribution: nexusTierDist,
        },
      },
      objectifs: {
        m6: { cible_eur: 250, date: "2027-01-01", atteint: false },
        m12: { cible_eur: 700, date: "2027-07-01", atteint: false },
      },
      tasks_p0: (byCategory["task"] || []).filter(t => t.priority === 0 && t.status === "active"),
      tasks_p1: (byCategory["task"] || []).filter(t => t.priority === 1 && t.status === "active"),
      tasks_p2: (byCategory["task"] || []).filter(t => t.priority === 2 && t.status === "active"),
      tasks_done: (byCategory["task"] || []).filter(t => t.status === "done").slice(0, 10),
      decisions: byCategory["decision"] || [],
      architecture: byCategory["arch"] || [],
      status: byCategory["status"] || [],
      alerts: (byCategory["alert"] || []).filter(a => a.status === "active"),
    };

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(payload),
    };
  } catch (e) {
    console.error("[BRAIN_API]", e.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
