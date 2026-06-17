// EMAIL_WELCOME — bienvenue MecaIA via Resend
// Domaine mecaiaauto.com verifie dans Resend
import { getUser, json, preflight, serviceClient } from "../lib/auth.mjs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE = (process.env.FRONTEND_URL || "https://mecaiaauto.com").replace(/\/$/, "");
// HARDCODE : noreply@mecaiaauto.com verifie dans Resend
const EMAIL_FROM = "MecaIA <noreply@mecaiaauto.com>";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const auth = await getUser(event);
  if (!auth) {
    console.error("[EMAIL_WELCOME] 401 - pas d auth");
    return json(401, { error: "Unauthorized" });
  }
  const email = auth.email;
  if (!email) return json(400, { error: "Aucun email" });
  if (!RESEND_API_KEY) {
    console.error("[EMAIL_WELCOME] RESEND_API_KEY manquante !");
    return json(500, { error: "RESEND_API_KEY manquante" });
  }

  let prenom = "";
  try { prenom = (JSON.parse(event.body || "{}").name || "").trim().split(" ")[0]; } catch (_) {}
  const salut = prenom ? `Bienvenue ${prenom} !` : "Bienvenue !";

  console.log(`[EMAIL_WELCOME] Envoi a ${email} depuis ${EMAIL_FROM}`);

  const html = `
<table width="100%" bgcolor="#0a0a0a" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:40px 16px">
  <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">
    <tr><td align="center" style="padding-bottom:28px">
      <span style="font-family:Arial Black,Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:3px;color:#e8a000">MECA</span><span style="font-family:Arial Black,Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:3px;color:#ffffff"> IA</span>
    </td></tr>
    <tr><td bgcolor="#111111" style="border-radius:12px;padding:32px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:#e8a000;text-transform:uppercase;padding-bottom:10px">BIENVENUE</td></tr>
        <tr><td style="font-family:Arial,sans-serif;font-size:21px;font-weight:700;color:#ffffff;padding-bottom:14px">${salut}</td></tr>
        <tr><td style="font-family:Arial,sans-serif;font-size:14px;color:#888888;line-height:1.7;padding-bottom:26px">Ton compte MecaIA est pret. Dylan, ton mecanicien IA, est la pour diagnostiquer ta voiture en quelques messages.</td></tr>
        <tr><td align="center" style="padding-bottom:26px">
          <a href="${SITE}" style="display:inline-block;background:#e8a000;color:#0a0a0a;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;text-decoration:none;padding:13px 32px;border-radius:8px">OUVRIR MECAIA</a>
        </td></tr>
        <tr><td style="border-top:1px solid #1e1e1e;padding-top:18px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666;padding-bottom:7px">Dylan diagnostique ton probleme en 3-5 messages</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666;padding-bottom:7px">Decodeur VIN gratuit - 3 par jour</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#666666">Compare les pieces aux meilleurs prix belges</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding-top:22px;font-family:Arial,sans-serif;font-size:12px;color:#444444">MecaIA &middot; mecaiaauto.com</td></tr>
  </table>
</td></tr>
</table>`;

  try {
    const payload = {
      from: EMAIL_FROM,
      to: [email],
      subject: `Bienvenue sur MecaIA${prenom ? " " + prenom : ""} - Ton expert automobile IA`,
      html,
    };
    console.log("[EMAIL_WELCOME] Payload from:", payload.from, "to:", payload.to);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[EMAIL_WELCOME] Resend ERREUR:", resp.status, JSON.stringify(data));
      // Logger l'échec aussi
      try {
        const supa = serviceClient();
        await supa.from("email_logs").insert({
          user_id: auth.id,
          email_to: email,
          email_type: "welcome",
          subject: payload.subject,
          status: "error",
        });
      } catch(_) {}
      return json(502, { success: false, error: data.message || "Envoi echoue", resend_status: resp.status });
    }
    console.log("[EMAIL_WELCOME] SUCCES:", data.id, "->", email);

    // Logger le succès dans email_logs
    try {
      const supa = serviceClient();
      await supa.from("email_logs").insert({
        user_id: auth.id,
        email_to: email,
        email_type: "welcome",
        subject: payload.subject,
        status: "sent",
      });
    } catch (logErr) {
      console.warn("[EMAIL_WELCOME] log failed:", logErr.message);
    }

    return json(200, { success: true, id: data.id || null });
  } catch (e) {
    console.error("[EMAIL_WELCOME] EXCEPTION:", e.message);
    return json(500, { success: false, error: e.message });
  }
};
