// EMAIL_SEND_VERIFICATION — génère un token et envoie l'email via Resend
//  • auth obligatoire : on envoie à l'email du compte connecté
//  • crée le token via create_email_verification (expire 24h)
//  • envoie via l'API Resend (RESEND_API_KEY)
import { getUser, serviceClient, json, preflight } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "MecaIA <onboarding@resend.dev>";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) return json(401, { error: "Unauthorized" });
  const userId = auth.userId;
  const email = auth.email;
  if (!email) return json(400, { error: "Aucun email sur ce compte" });

  const supabase = serviceClient();

  try {
    // 1) Générer le token de vérification (expire 24h)
    const { data, error } = await supabase.rpc("create_email_verification", {
      p_user_id: userId,
      p_email: email,
    });
    if (error) throw error;
    const token = data && data[0] && data[0].verification_token;
    if (!token) throw new Error("Token non généré");

    const base = process.env.FRONTEND_URL;
    if (!base) return json(500, { error: "FRONTEND_URL non définie" });
    const link = `${base}/.netlify/functions/email_verify?token=${encodeURIComponent(token)}`;

    // 2) Envoyer l'email via Resend
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY non définie" });
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
        <h2>Vérifie ton adresse email</h2>
        <p>Bienvenue sur MecaIA ! Clique sur le bouton ci-dessous pour confirmer ton adresse.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px">Confirmer mon email</a></p>
        <p style="color:#666;font-size:12px">Ce lien expire dans 24 heures. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
      </div>`;

    let resp, body;
    try {
      resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: "Vérifie ton email — MecaIA", html }),
      });
      body = await resp.json().catch(() => ({}));
    } catch (e) {
      console.error("[EMAIL_SEND] Resend:", e.message);
      return json(502, { success: false, error: "Service email indisponible, réessayez." });
    }
    if (!resp.ok) {
      console.error("[EMAIL_SEND] Resend status:", resp.status, body);
      return json(502, { success: false, error: "Échec de l'envoi de l'email" });
    }

    // 3) Journaliser (best-effort)
    try {
      await supabase.rpc("log_email", {
        p_user_id: userId, p_email_to: email,
        p_email_type: "verification", p_subject: "Vérifie ton email — MecaIA",
      });
    } catch (e) { console.error("[EMAIL_SEND] log (non bloquant):", e.message); }

    return json(200, { success: true, message: "Email de vérification envoyé", to: email });
  } catch (error) {
    console.error("[EMAIL_SEND]", error.message);
    return json(500, { success: false, error: error.message });
  }
};
