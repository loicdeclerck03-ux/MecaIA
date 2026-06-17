// ============================================================
// SCHEDULED_RELANCE.MJS — Cron Netlify
// Tourne : tous les jours à 9h UTC
// Mission : utilisateurs inactifs depuis 14j → email +1 crédit
// Règle : 1 seul envoi par utilisateur (table relance_sent)
// ADR-015 : 14 jours · +1 crédit · 1 fois
// ============================================================

import { serviceClient, json } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "MecaIA <noreply@mecaiaauto.com>";
const SITE           = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

// Format Netlify scheduled function (v2)
export default async (req, context) => {
  let scheduled = false;
  try {
    const body = await req.json();
    scheduled = !!(body && body.next_run);
  } catch { /* pas de body JSON */ }

  if (!scheduled) {
    const secret = req.headers.get("x-cron-secret") || req.headers.get("x-netlify-token");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  console.log("[RELANCE] Démarrage cron relance J+14");

  if (!RESEND_API_KEY) {
    console.error("[RELANCE] RESEND_API_KEY manquante");
    return new Response(JSON.stringify({ error: "RESEND_API_KEY manquante" }), { status: 500 });
  }

  const supabase = serviceClient();
  const startTime = Date.now();
  let envoyes = 0, erreurs = 0;

  try {
    const { data: cibles, error } = await supabase.rpc("get_relance_targets");
    if (error) throw error;
    if (!cibles || !cibles.length) {
      console.log("[RELANCE] Aucun utilisateur à relancer.");
      return new Response(JSON.stringify({ success: true, envoyes: 0, message: "Aucun cible" }), { status: 200 });
    }

    console.log(`[RELANCE] ${cibles.length} utilisateur(s) à relancer`);

    for (const u of cibles) {
      try {
        const prenom = (u.name || "").trim().split(" ")[0] || "";
        const hello  = prenom ? `Bonjour ${prenom},` : "Bonjour,";

        const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
  <div style="background:#0b0f14;padding:24px;text-align:center;border-radius:12px 12px 0 0">
    <span style="color:#f0a500;font-size:22px;font-weight:bold;letter-spacing:1px">MECA IA</span>
  </div>
  <div style="padding:28px 24px;background:#ffffff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 14px;font-size:20px">${hello}</h2>
    <p style="font-size:15px;line-height:1.6;color:#333">
      Ca fait un petit moment qu'on ne t'a pas vu sur MecaIA !
    </p>
    <p style="font-size:15px;line-height:1.6;color:#333">
      Pour te souhaiter la bienvenue a nouveau, on t'a ajoute <strong>1 credit gratuit</strong>
      sur ton compte.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#333">
      Utilise-le pour poser une question a <strong>Dylan</strong>, ton expert auto IA.
    </p>
    <p style="text-align:center;margin:26px 0">
      <a href="${SITE}" style="display:inline-block;padding:13px 26px;background:#f0a500;color:#0b0f14;font-weight:bold;text-decoration:none;border-radius:8px">Retourner sur MecaIA</a>
    </p>
    <p style="font-size:13px;color:#333">A tres vite,<br>L'equipe MecaIA</p>
  </div>
</div>`;

        const subject = "On t'a reserve 1 credit gratuit";
        const resp = await fetch("https://api.resend.com/emails", {
          method : "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body   : JSON.stringify({ from: EMAIL_FROM, to: [u.email], subject, html }),
        });

        const resendData = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          console.error(`[RELANCE] Resend erreur pour ${u.user_id}:`, resendData.message);
          // Logger l'échec
          supabase.from("email_logs").insert({
            user_id: u.user_id, email_to: u.email,
            email_type: "relance_j14", subject, status: "error",
          }).catch(() => {});
          erreurs++;
          continue;
        }

        // Ajouter 1 crédit + marquer comme relancé (RPC atomique)
        const { error: addErr } = await supabase.rpc("add_relance_credit", { p_user_id: u.user_id });
        if (addErr) {
          console.error(`[RELANCE] add_relance_credit erreur pour ${u.user_id}:`, addErr.message);
          erreurs++;
          continue;
        }

        console.log(`[RELANCE] ✅ ${u.email} relancé (+1 crédit)`);
        envoyes++;

        // Logger le succès dans email_logs (fire-and-forget)
        supabase.from("email_logs").insert({
          user_id: u.user_id, email_to: u.email,
          email_type: "relance_j14", subject, status: "sent",
        }).catch(e => console.warn("[RELANCE] email_log:", e.message));

      } catch (err) {
        console.error(`[RELANCE] Erreur utilisateur ${u.user_id}:`, err.message);
        erreurs++;
      }
    }

  } catch (err) {
    console.error("[RELANCE] Erreur globale:", err.message);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }

  const elapsed = Date.now() - startTime;
  console.log(`[RELANCE] Terminé — envoyés: ${envoyes}, erreurs: ${erreurs}, durée: ${elapsed}ms`);

  return new Response(
    JSON.stringify({ success: true, envoyes, erreurs, elapsed_ms: elapsed }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  schedule: "0 9 * * *",
};
