// ============================================================
// LIB PARTAGÉE — auth, clients Supabase, CORS, réponses JSON
// Placée hors du dossier "functions" : importée et bundlée par
// Netlify, mais PAS exposée comme endpoint.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

// Client SERVICE (bypass RLS). Réservé aux opérations système :
// webhook Stripe, tâches planifiées. Jamais exposé à un appel anonyme.
export function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Vérifie le JWT Supabase envoyé par le frontend (header Authorization: Bearer ...).
// Renvoie { userId, client } si valide, sinon null.
// Le "client" est lié au JWT -> les requêtes respectent les politiques RLS
// de l'utilisateur (défense en profondeur).
export async function getUser(event) {
  const h = event.headers || {};
  const authz = h.authorization || h.Authorization || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  if (!token) return null;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;

  return { userId: data.user.id, email: data.user.email, meta: data.user.user_metadata || {}, client };
}

// En-têtes CORS (restreints à ton domaine en prod).
export const CORS = {
  "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

// Réponse JSON normalisée (avec CORS).
export function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS, ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

// Réponse à la requête de pré-vol CORS.
export function preflight() {
  return { statusCode: 204, headers: CORS, body: "" };
}

// Le caller est-il le propriétaire (admin) ? Vérifié côté serveur via OWNER_EMAIL.
export function isOwner(auth) {
  const owner = (process.env.OWNER_EMAIL || 'loicdeclerck4020@gmail.com').toLowerCase().trim();
  return !!(auth && auth.email && owner && auth.email.toLowerCase() === owner);
}

// Garantit une session de diagnostic active (fenêtre 10 min).
// Réutilise la session en cours, sinon en ouvre une (débite 1 jeton,
// gratuit si pass illimité). Utilisé par dylan/photo/alertes.
// Retour : { allowed:true, charged, unlimited } | { allowed:false, balance }
export async function ensureDiagSession(supabase, userId) {
  const { data: act } = await supabase.rpc("has_active_diagnostic_session", { p_user_id: userId });
  if (act && act[0] && act[0].active) return { allowed: true, charged: false, unlimited: false };

  const { data: started, error } = await supabase.rpc("start_diagnostic_session", { p_user_id: userId });
  if (error) throw error;
  const s = started && started[0];
  if (!s || !s.success) return { allowed: false, balance: s ? s.remaining_balance : 0 };
  return { allowed: true, charged: !s.unlimited, unlimited: s.unlimited };
}
