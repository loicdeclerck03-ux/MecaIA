// scheduled_diag_reminder.mjs — Cron Netlify
// Tourne : tous les jours à 10h UTC
// Mission : sessions Dylan bloquées en CONTROLE depuis +24h → email de rappel
// Loïc : "le gars reçoit une question de Dylan, il répond pas, Dylan le relance"
// ============================================================

import { serviceClient } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "MecaIA <noreply@mecaiaauto.com>";
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");

export default async (req, context) => {
  // Auth : scheduled Netlify ou secret manuel
  let scheduled = false;
  try { const b = await req.json(); scheduled = !!(b && b.next_run); } catch {}
  if (!scheduled) {
    const secret = req.headers.get("x-cron-secret") || req.headers.get("x-netlify-token");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  console.log("[DIAG_REMINDER] Démarrage cron relance diagnostic");
  if (!RESEND_API_KEY) {
    console.error("[DIAG_REMINDER] RESEND_API_KEY manquante");
    return new Response(JSON.stringify({ error: "RESEND_API_KEY manquante" }), { status: 500 });
  }

  const supabase = serviceClient();
  let envoyes = 0, erreurs = 0;

  try {
    // Chercher les sessions bloquées en CONTROLE depuis plus de 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: sessions, error } = await supabase
      .from("diag_sessions")
      .select("id, user_id, veh_make, veh_model, veh_year, enquete_state, maj_le")
      .eq("status", "ouvert")
      .eq("enquete_etat", "CONTROLE")
      .lt("maj_le", cutoff)
      .limit(20);

    if (error) throw error;
    if (!sessions || !sessions.length) {
      console.log("[DIAG_REMINDER] Aucune session en attente.");
      return new Response(JSON.stringify({ success: true, envoyes: 0 }), { status: 200 });
    }

    console.log(`[DIAG_REMINDER] ${sessions.length} session(s) en attente`);

    for (const s of sessions) {
      try {
        // Récupérer l'email de l'utilisateur
        const { data: userData, error: uErr } = await supabase.auth.admin.getUserById(s.user_id);
        if (uErr || !userData?.user?.email) continue;
        const email = userData.user.email;
        const name = (userData.user.user_metadata?.full_name || userData.user.user_metadata?.name || "").split(" ")[0] || "";
        const hello = name ? `Bonjour ${name},` : "Bonjour,";

        // Extraire le contrôle en attente depuis l'état
        const etat = s.enquete_state || {};
        const controleEnCours = etat.controle_en_cours;
        const pourquoi = controleEnCours?.pourquoi || "";
        const comment = Array.isArray(controleEnCours?.comment) ? controleEnCours.comment[0] || "" : "";
        const vehicule = [s.veh_make, s.veh_model, s.veh_year].filter(Boolean).join(" ") || "votre véhicule";
        const hyps = (etat.hypotheses || []).filter(h => h.statut !== "eliminee").slice(0, 2).map(h => h.libelle).join(", ");

        const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
  <div style="background:#0b0f14;padding:24px;text-align:center;border-radius:12px 12px 0 0">
    <span style="color:#f0a500;font-size:22px;font-weight:bold;letter-spacing:1px">🔬 MECA IA</span>
  </div>
  <div style="padding:28px 24px;background:#ffffff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;margin:0 0 16px">${hello}</p>
    <p style="margin:0 0 16px">Dylan attend votre retour sur le diagnostic de votre <strong>${vehicule}</strong>.</p>
    ${pourquoi ? `<div style="background:#f8f9fa;border-left:4px solid #f0a500;padding:14px 16px;border-radius:6px;margin:0 0 16px"><p style="margin:0 0 8px;font-weight:600;color:#0b0f14">🔍 Contrôle en attente :</p><p style="margin:0;color:#333">${pourquoi}</p>${comment ? `<p style="margin:8px 0 0;font-size:13px;color:#666">${comment}</p>` : ""}</div>` : ""}
    ${hyps ? `<p style="color:#555;font-size:14px;margin:0 0 16px">Hypothèses en cours : <em>${hyps}</em></p>` : ""}
    <a href="${SITE}/#diag" style="display:block;background:#f0a500;color:#0b0f14;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;text-align:center;margin:20px 0">Reprendre le diagnostic →</a>
    <p style="font-size:12px;color:#999;margin:16px 0 0">Dylan — MecaIA · <a href="${SITE}/cgu" style="color:#999">Se désabonner</a></p>
  </div>
</div>`;

        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [email],
            subject: `Dylan attend votre retour — ${vehicule}`,
            html,
          }),
        });

        if (resp.ok) {
          envoyes++;
          // Marquer session comme "relancee" pour ne pas renvoyer tous les jours
          await supabase.from("diag_sessions")
            .update({ status: "relancee", maj_le: new Date().toISOString() })
            .eq("id", s.id);
          console.log(`[DIAG_REMINDER] Envoyé à ${email} — session ${s.id}`);
        } else {
          const err = await resp.text();
          console.error(`[DIAG_REMINDER] Resend erreur ${resp.status}:`, err);
          erreurs++;
        }
      } catch (e) {
        console.error("[DIAG_REMINDER] Erreur session", s.id, ":", e.message);
        erreurs++;
      }
    }
  } catch (e) {
    console.error("[DIAG_REMINDER] Erreur principale:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }

  console.log(`[DIAG_REMINDER] Terminé: ${envoyes} envoyés, ${erreurs} erreurs`);
  return new Response(JSON.stringify({ success: true, envoyes, erreurs }), { status: 200 });
};
