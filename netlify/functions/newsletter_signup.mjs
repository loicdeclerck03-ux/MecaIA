// NEWSLETTER_SIGNUP.mjs — MecaIA
// Capture email cold prospect depuis les pages DTC/hub
// POST /.netlify/functions/newsletter_signup
// Body: { email, source?, source_code? }
// Public — pas d'auth requise
//
// Flow:
//   1. Valide email
//   2. INSERT OR IGNORE dans newsletter_leads (idempotent)
//   3. Si nouveau: envoi cold_welcome via email_marketing_sequence interne
//   4. Si déjà présent: 200 silencieux (pas de double envoi)

import { json, preflight } from "../lib/auth.mjs";

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const SITE          = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");
const FROM          = "Loïc de MecaIA <noreply@mecaiaauto.com>";
const VALID_SOURCES = ["codes_hub","dtc_page","blog","category_hub","mecaia_vs_fixd","homepage"];

// ─── VALIDATION ───────────────────────────────────────────────────────────────

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

// ─── TEMPLATE EMAIL CONFIRMATION ──────────────────────────────────────────────

function htmlConfirmation(email) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#060809;margin:0;padding:0">
<div style="max-width:560px;margin:30px auto;background:#0d1520;border-radius:12px;overflow:hidden">
  <div style="background:#0d1520;border-bottom:3px solid #e8a000;padding:22px 28px">
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:3px;color:#e8a000">MECA</span>
    <span style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:3px;color:#fff">IA</span>
  </div>
  <div style="padding:28px">
    <h2 style="color:#eef4fa;font-size:19px;margin:0 0 14px">Tu es maintenant informé(e) 🔧</h2>
    <p style="color:#b0bec5;font-size:14px;line-height:1.7;margin:0 0 16px">
      Merci pour ton intérêt pour MecaIA.<br>
      Voici ce qui t'attend dans les prochains jours :
    </p>
    <ul style="color:#b0bec5;font-size:14px;line-height:2;padding-left:20px;margin:0 0 24px">
      <li>✅ Accès au diagnostic IA <strong style="color:#eef4fa">gratuit</strong> — aucun boîtier requis</li>
      <li>🔎 Explication de tes codes défauts en français</li>
      <li>📊 Conseils de mécanicien basés sur tes données réelles</li>
    </ul>
    <a href="${SITE}?utm_source=newsletter&utm_medium=email&utm_campaign=cold_confirm"
       style="display:block;background:#e8a000;color:#000;text-align:center;padding:14px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:20px">
      Essayer le diagnostic gratuit maintenant →
    </a>
    <p style="color:#4a5568;font-size:12px;margin:16px 0 0;border-top:1px solid #1a2430;padding-top:14px">
      MecaIA · mecaiaauto.com · Belgique<br>
      Tu reçois cet email car tu as souscrit sur mecaiaauto.com.
    </p>
  </div>
</div></body></html>`;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "JSON invalide" }); }

  const email  = (body.email || "").trim().toLowerCase();
  const source = VALID_SOURCES.includes(body.source) ? body.source : "codes_hub";
  const code   = (body.source_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  if (!email)                return json(400, { error: "Email requis" });
  if (!isValidEmail(email))  return json(400, { error: "Email invalide" });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(500, { error: "Config manquante" });

  // ── Upsert dans newsletter_leads ──────────────────────────────────────────
  let isNew = false;
  try {
    // Vérifie si déjà présent
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/newsletter_leads?email=eq.${encodeURIComponent(email)}&select=id,status`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await existRes.json();

    if (!Array.isArray(existing) || existing.length === 0) {
      // Nouveau lead → INSERT
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_leads`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          email,
          source,
          source_code: code || null,
          status: "active",
          seq_step: 0,
          metadata: { source_code: code || null, ua: event.headers["user-agent"]?.slice(0, 120) }
        }),
      });
      isNew = insertRes.status === 201;
    } else if (existing[0]?.status === "unsubscribed") {
      // Réinscription → remettre actif
      await fetch(
        `${SUPABASE_URL}/rest/v1/newsletter_leads?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active", seq_step: 0 }),
        }
      );
      isNew = true; // Renvoi de la séquence
    }
    // Déjà actif → isNew = false → 200 silencieux
  } catch (dbErr) {
    console.error("[NEWSLETTER_SIGNUP] DB error:", dbErr.message);
    return json(500, { error: "Erreur base de données" });
  }

  // ── Envoi email de confirmation si nouveau ────────────────────────────────
  if (isNew && RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [email],
          subject: "Diagnostic auto gratuit — bienvenue sur MecaIA 🔧",
          html: htmlConfirmation(email),
        }),
      });

      // Mettre à jour last_email_at
      await fetch(
        `${SUPABASE_URL}/rest/v1/newsletter_leads?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ last_email_at: new Date().toISOString(), seq_step: 1 }),
        }
      );
    } catch (mailErr) {
      console.warn("[NEWSLETTER_SIGNUP] Email error (non-bloquant):", mailErr.message);
    }
  }

  return json(200, {
    success: true,
    new: isNew,
    message: isNew ? "Inscription confirmée — vérifie tes emails" : "Déjà inscrit(e)",
  });
};
